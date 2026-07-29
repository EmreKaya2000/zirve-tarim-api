import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, SaleStatus } from '@prisma/client';
import {
  CUSTOMER_CODE_PREFIX,
  WARNING_CODES,
  hasFirstAndLastName,
  type ApiErrorDetail,
  type ApiWarning,
  type CustomerType,
} from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import {
  NUMBER_SCOPES,
  NumberSequenceService,
} from '../../common/services/number-sequence.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { normalizePhone } from '../../common/utils/phone';
import { ADMIN_SALE_LIST_SELECT } from '../sales/sales.select';
import type { ActorContext } from '../../common/types/actor-context';
import type { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

import type { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './dto/customer.dto';

const ENTITY_TYPE = 'Customer';

/**
 * Müşteri yönetimi (Sprint 7).
 *
 * TARİHÇE: bu modül önce Sprint 8'in (satış) ihtiyacı kadar kurulmuştu —
 * satış müşterisiz çalışamıyordu. Sprint 7 sonradan tamamlandığında tip
 * bazlı kurallar, görüşme notları, mükerrer telefon uyarısı ve müşteri
 * bazlı satış/ödeme uçları eklendi.
 *
 * CARİ BAKİYE SAKLANMIYOR: müşterinin borcu, satış ve ödeme
 * toplamlarından hesaplanır (`financeSummary`). Satışta stored toplam
 * kararı verilmişken burada verilmemesinin sebebi, ikinci bir türetilmiş
 * alanın ikinci bir tutarsızlık kaynağı olması: satış toplamları zaten
 * saklanıyor, müşteri bakiyesi onların toplamıdır ve müşteri sayısı
 * satış sayısından çok daha azdır — toplama maliyeti düşük.
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: NumberSequenceService,
    private readonly auditLogs: AuditLogsService,
    private readonly queryBuilder: QueryBuilderService,
  ) {}

  async create(dto: CreateCustomerDto, actor: ActorContext): Promise<unknown> {
    const phone = normalizePhone(dto.phone);

    this.assertTypeRules(dto.type, dto.fullName, dto.companyName);

    // MÜKERRER TELEFON: UYARI, ENGEL DEĞİL (Sprint 7 şartı 2).
    //
    // Aynı hattı paylaşan iki müşteri gerçek bir durumdur — baba ile oğul,
    // ya da şirket ile sahibi. Kaydı 409 ile reddetmek, mağaza sahibini
    // numarayı bozarak ("...67 " gibi) girmeye iter ve mükerrer tespitini
    // tamamen kaybettirir. Kayıt açılır, uyarı yanıtla birlikte döner.
    const duplicateWarning = await this.duplicateWarningFor(phone);

    const customer = await this.prisma.$transaction(async (tx) => {
      // Müşteri kodu da belge numaralarıyla AYNI çakışmasız mekanizmadan
      // üretilir (MUS-2026-000001). Ayrı bir üreteç yazmak, aynı yarış
      // koşulunu ikinci kez çözmek olurdu.
      const code = await this.numbers.next(tx, NUMBER_SCOPES.CUSTOMER, CUSTOMER_CODE_PREFIX);

      const created = await tx.customer.create({
        data: {
          code,
          type: dto.type,
          fullName: dto.fullName,
          companyName: dto.companyName ?? null,
          phone,
          altPhone: dto.altPhone === undefined ? null : normalizePhone(dto.altPhone),
          email: dto.email ?? null,
          taxNumber: dto.taxNumber ?? null,
          taxOffice: dto.taxOffice ?? null,
          city: dto.city ?? null,
          district: dto.district ?? null,
          address: dto.address ?? null,
          creditLimit: new Prisma.Decimal(dto.creditLimit ?? 0),
          openingBalance: new Prisma.Decimal(dto.openingBalance ?? 0),
          note: dto.note ?? null,
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: { code, fullName: created.fullName, phone: created.phone },
        description: `Müşteri oluşturuldu: ${code} — ${created.fullName}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });

    this.logger.log(`Müşteri oluşturuldu: ${customer.code}`);

    return withWarnings(customer, duplicateWarning);
  }

  async findMany(query: CustomerQueryDto): Promise<{ items: unknown[]; meta: unknown }> {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
        select: CUSTOMER_LIST_SELECT,
      }),
      this.prisma.customer.count({ where }),
    ]);

    // Borç bilgisi liste ekranında gerekiyor; her satır için ayrı sorgu
    // N+1 olurdu. Tek toplama sorgusuyla çekilip eşleştirilir.
    const balances = await this.balancesFor(items.map((item) => item.id));

    const enriched = items.map((item) => ({
      ...item,
      ...(balances.get(item.id) ?? EMPTY_BALANCE),
    }));

    const filtered =
      query.hasDebt === '1'
        ? enriched.filter((item) => new Prisma.Decimal(item.currentDebt).greaterThan(0))
        : enriched;

    return { items: filtered, meta: this.queryBuilder.buildMeta(total, query) };
  }

  async findOne(id: string): Promise<unknown> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: CUSTOMER_DETAIL_SELECT,
    });

    if (customer === null) {
      throw AppException.notFound('Müşteri bulunamadı.');
    }

    return { ...customer, financeSummary: await this.financeSummary(id) };
  }

  async update(id: string, dto: UpdateCustomerDto, actor: ActorContext): Promise<unknown> {
    const existing = await this.getExisting(id);

    // Doğrulama, MEVCUT ve GÜNCELLENMİŞ değerlerin birleşimi üzerinde
    // yapılır: yalnız `type` gönderildiğinde de kural bütün olarak
    // kontrol edilmelidir — bireyselden kurumsala geçen bir kaydın firma
    // adı boş kalamaz.
    this.assertTypeRules(
      dto.type ?? existing.type,
      dto.fullName ?? existing.fullName,
      dto.companyName === undefined ? existing.companyName : dto.companyName,
    );

    const duplicateWarning =
      dto.phone === undefined
        ? null
        : await this.duplicateWarningFor(normalizePhone(dto.phone), id);

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: {
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.fullName !== undefined && { fullName: dto.fullName }),
          ...(dto.companyName !== undefined && { companyName: dto.companyName }),
          ...(dto.phone !== undefined && { phone: normalizePhone(dto.phone) }),
          ...(dto.altPhone !== undefined && { altPhone: normalizePhone(dto.altPhone) }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.taxNumber !== undefined && { taxNumber: dto.taxNumber }),
          ...(dto.taxOffice !== undefined && { taxOffice: dto.taxOffice }),
          ...(dto.city !== undefined && { city: dto.city }),
          ...(dto.district !== undefined && { district: dto.district }),
          ...(dto.address !== undefined && { address: dto.address }),
          ...(dto.creditLimit !== undefined && {
            creditLimit: new Prisma.Decimal(dto.creditLimit),
          }),
          ...(dto.note !== undefined && { note: dto.note }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { fullName: existing.fullName, phone: existing.phone },
        newData: { fullName: dto.fullName ?? existing.fullName },
        description: `Müşteri güncellendi: ${existing.code}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return withWarnings(await this.findOne(id), duplicateWarning);
  }

  // ==========================================================================
  // TİP BAZLI KURALLAR (Sprint 7 şartı 2)
  // ==========================================================================

  /**
   * Müşteri tipine göre zorunlu alanları doğrular.
   *
   * Kurallar `@zirve/types` içindeki tablodan okunur; arayüzün yıldızlı
   * gösterdiği alanla servisin reddettiği alan ayrışamaz.
   */
  private assertTypeRules(
    type: CustomerType,
    fullName: string,
    companyName: string | null | undefined,
  ): void {
    const details: ApiErrorDetail[] = [];

    if (type === 'INDIVIDUAL' && !hasFirstAndLastName(fullName)) {
      details.push({
        field: 'fullName',
        message: 'Bireysel müşteride ad ve soyad birlikte girilmelidir.',
      });
    }

    // Kurumsal müşteride fatura ticari unvana kesilir; unvan yoksa kayıt
    // fatura kesilemeyecek bir müşteri üretir.
    if (type === 'CORPORATE' && (companyName === null || (companyName ?? '').trim() === '')) {
      details.push({
        field: 'companyName',
        message: 'Kurumsal müşteride firma adı zorunludur.',
      });
    }

    if (details.length > 0) {
      throw AppException.badRequest('Müşteri bilgileri eksik.', details);
    }
  }

  // ==========================================================================
  // MÜKERRER TELEFON
  // ==========================================================================

  /**
   * Aynı telefonla kayıtlı başka müşteri varsa uyarı üretir; yoksa `null`.
   *
   * Hem kayıt/güncelleme yanıtında hem de formun ön kontrolünde
   * (`checkDuplicatePhone`) aynı fonksiyon kullanılır.
   */
  private async duplicateWarningFor(phone: string, excludeId?: string): Promise<ApiWarning | null> {
    const duplicate = await this.prisma.customer.findFirst({
      where: {
        phone,
        deletedAt: null,
        ...(excludeId !== undefined && { id: { not: excludeId } }),
      },
      select: { id: true, code: true, fullName: true },
      orderBy: { createdAt: 'asc' },
    });

    if (duplicate === null) {
      return null;
    }

    return {
      code: WARNING_CODES.DUPLICATE_PHONE,
      field: 'phone',
      message: `Bu numara ${duplicate.fullName} (${duplicate.code}) kaydında da kayıtlı. Aynı kişi ise kayıtları birleştirin.`,
      context: {
        customerId: duplicate.id,
        code: duplicate.code,
        fullName: duplicate.fullName,
      },
    };
  }

  /** Form kaydetmeden ÖNCE mükerrer kontrolü yapabilsin. */
  async checkDuplicatePhone(
    phone: string,
    excludeId?: string,
  ): Promise<{ isDuplicate: boolean; warning: ApiWarning | null }> {
    const warning = await this.duplicateWarningFor(normalizePhone(phone), excludeId);

    return { isDuplicate: warning !== null, warning };
  }

  // ==========================================================================
  // GÖRÜŞME NOTLARI
  // ==========================================================================

  /**
   * Müşteri görüşme notu ekler.
   *
   * `customers.note` alanının ÜZERİNE YAZMAZ: o kalıcı bilgi, bu zaman
   * çizelgesidir (bkz. `CustomerNote` model açıklaması).
   */
  async addNote(customerId: string, body: string, actor: ActorContext): Promise<unknown> {
    const customer = await this.getExisting(customerId);

    return this.prisma.$transaction(async (tx) => {
      const note = await tx.customerNote.create({
        data: { customerId, body, createdById: actor.id },
        select: CUSTOMER_NOTE_SELECT,
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: 'CustomerNote',
        entityId: note.id,
        newData: { customerId, length: body.length },
        description: `Müşteri notu eklendi: ${customer.code}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return note;
    });
  }

  /** Müşterinin görüşme notları — en yeni önce. */
  async findNotes(
    customerId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; meta: unknown }> {
    await this.getExisting(customerId);

    const where: Prisma.CustomerNoteWhereInput = { customerId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerNote.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: CUSTOMER_NOTE_SELECT,
      }),
      this.prisma.customerNote.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  // ==========================================================================
  // MÜŞTERİ BAZLI SATIŞ VE ÖDEME LİSTELERİ
  // ==========================================================================

  /**
   * Müşterinin satışları.
   *
   * SalesService'e delege ETMİYOR, doğrudan sorguluyor: `SalesModule`
   * zaten `CustomersModule`'ü import ediyor, ters yönde bir bağımlılık
   * döngü üretirdi. Paylaşılan tek şey `select` şekli — o da saf bir
   * sabit olduğu için güvenle import edilebilir.
   */
  async findSales(
    customerId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; meta: unknown }> {
    await this.getExisting(customerId);

    const where: Prisma.SaleWhereInput = { customerId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { saleDate: 'desc' },
        select: ADMIN_SALE_LIST_SELECT,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  /** Müşterinin tahsilatları. Silinmiş ödemeler listelenmez. */
  async findPayments(
    customerId: string,
    query: PaginationQueryDto,
  ): Promise<{ items: unknown[]; meta: unknown }> {
    await this.getExisting(customerId);

    const where: Prisma.PaymentWhereInput = { customerId, deletedAt: null };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { paymentDate: 'desc' },
        select: CUSTOMER_PAYMENT_SELECT,
      }),
      this.prisma.payment.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  /**
   * Soft delete.
   *
   * Kural 4: finansal geçmişi olan müşteri kaydı silinmez. Ayrıca
   * `sales.customerId` FK'sı `Restrict` olduğu için hard delete
   * veritabanı seviyesinde de mümkün değildir.
   *
   * BORCU OLAN MÜŞTERİ PASİFE ALINAMAZ: alacak takibi kaybolur.
   */
  async remove(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.getExisting(id);
    const summary = await this.financeSummary(id);

    if (new Prisma.Decimal(summary.currentDebt).greaterThan(0)) {
      throw AppException.badRequest('Borcu olan müşteri silinemez.', [
        {
          field: 'id',
          message: `Kalan borç: ${summary.currentDebt}. Önce tahsilat yapılmalı veya satış iptal edilmeli.`,
        },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { code: existing.code, fullName: existing.fullName },
        description: `Müşteri silindi: ${existing.code}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  /**
   * Telefon numarasına göre müşteri arar.
   *
   * Talebi satışa dönüştürürken kullanılır: talepteki telefonla kayıtlı
   * müşteri varsa yönetici yeni kayıt açmak zorunda kalmaz.
   */
  async findByPhone(phone: string): Promise<{ id: string; code: string; fullName: string } | null> {
    return this.prisma.customer.findFirst({
      where: { phone: normalizePhone(phone), deletedAt: null },
      select: { id: true, code: true, fullName: true },
    });
  }

  /**
   * Müşteri finans özeti (SPEC §9.5).
   *
   * Hesaplanan alanlar:
   *   totalSales      : iptal EDİLMEMİŞ ve taslak OLMAYAN satışların toplamı
   *   totalPaid       : silinmemiş ödemelerin toplamı
   *   currentDebt     : devir bakiyesi + satış toplamı - tahsilat
   *   overdueDebt     : vadesi geçmiş ve tamamı ödenmemiş satışların kalanı
   *   creditLimit     : tanımlı limit
   *   availableCredit : limit - currentDebt (negatif olabilir: limit aşımı)
   *
   * TASLAK VE İPTAL SATIŞLAR SAYILMAZ: taslak henüz müşteriye tebliğ
   * edilmemiş, iptal ise geri alınmış bir belgedir. İkisi de borç doğurmaz.
   */
  async financeSummary(customerId: string): Promise<CustomerFinanceSummary> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { openingBalance: true, creditLimit: true },
    });

    if (customer === null) {
      throw AppException.notFound('Müşteri bulunamadı.');
    }

    const now = new Date();

    const [salesAggregate, paymentAggregate, overdueAggregate, counts] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { customerId, status: { in: COUNTED_SALE_STATUSES } },
        _sum: { grandTotal: true, remainingTotal: true },
      }),
      this.prisma.payment.aggregate({
        where: { customerId, deletedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.sale.aggregate({
        where: {
          customerId,
          status: { in: OVERDUE_SALE_STATUSES },
          dueDate: { lt: now },
        },
        _sum: { remainingTotal: true },
      }),
      this.prisma.sale.groupBy({
        by: ['status'],
        where: { customerId },
        _count: { _all: true },
      }),
    ]);

    const openingBalance = new Prisma.Decimal(customer.openingBalance);
    const totalSales = new Prisma.Decimal(salesAggregate._sum.grandTotal ?? 0);
    const totalPaid = new Prisma.Decimal(paymentAggregate._sum.amount ?? 0);

    // Devir bakiyesi de borca dahildir: sisteme geçişte müşterinin
    // önceki borcu bu alanda taşınır.
    const currentDebt = openingBalance.plus(totalSales).minus(totalPaid).toDecimalPlaces(4);
    const overdueDebt = new Prisma.Decimal(overdueAggregate._sum.remainingTotal ?? 0);
    const creditLimit = new Prisma.Decimal(customer.creditLimit);

    return {
      openingBalance: openingBalance.toString(),
      totalSales: totalSales.toString(),
      totalPaid: totalPaid.toString(),
      currentDebt: currentDebt.toString(),
      overdueDebt: overdueDebt.toString(),
      creditLimit: creditLimit.toString(),
      availableCredit: creditLimit.minus(currentDebt).toDecimalPlaces(4).toString(),
      isOverLimit: creditLimit.greaterThan(0) && currentDebt.greaterThan(creditLimit),
      saleCount: counts.reduce((sum, row) => sum + row._count._all, 0),
      salesByStatus: Object.fromEntries(counts.map((row) => [row.status, row._count._all])),
    };
  }

  /** Kaydı getirir; yoksa 404. */
  async getExisting(id: string): Promise<{
    id: string;
    code: string;
    fullName: string;
    phone: string;
    type: CustomerType;
    companyName: string | null;
  }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        code: true,
        fullName: true,
        phone: true,
        type: true,
        companyName: true,
      },
    });

    if (customer === null) {
      throw AppException.notFound('Müşteri bulunamadı.');
    }

    return customer;
  }

  /** Birden çok müşterinin borç bilgisini tek sorguda çeker. */
  private async balancesFor(ids: string[]): Promise<Map<string, CustomerBalance>> {
    if (ids.length === 0) {
      return new Map();
    }

    const now = new Date();

    const [customers, sales, payments, overdue] = await Promise.all([
      this.prisma.customer.findMany({
        where: { id: { in: ids } },
        select: { id: true, openingBalance: true, creditLimit: true },
      }),
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: { in: COUNTED_SALE_STATUSES } },
        _sum: { grandTotal: true },
      }),
      this.prisma.payment.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, deletedAt: null },
        _sum: { amount: true },
      }),
      this.prisma.sale.groupBy({
        by: ['customerId'],
        where: {
          customerId: { in: ids },
          status: { in: OVERDUE_SALE_STATUSES },
          dueDate: { lt: now },
        },
        _sum: { remainingTotal: true },
      }),
    ]);

    const salesById = new Map(sales.map((row) => [row.customerId, row._sum.grandTotal]));
    const paymentsById = new Map(payments.map((row) => [row.customerId, row._sum.amount]));
    const overdueById = new Map(overdue.map((row) => [row.customerId, row._sum.remainingTotal]));

    return new Map(
      customers.map((customer) => {
        const totalSales = new Prisma.Decimal(salesById.get(customer.id) ?? 0);
        const totalPaid = new Prisma.Decimal(paymentsById.get(customer.id) ?? 0);
        const debt = new Prisma.Decimal(customer.openingBalance)
          .plus(totalSales)
          .minus(totalPaid)
          .toDecimalPlaces(4);

        return [
          customer.id,
          {
            totalSales: totalSales.toString(),
            totalPaid: totalPaid.toString(),
            currentDebt: debt.toString(),
            overdueDebt: new Prisma.Decimal(overdueById.get(customer.id) ?? 0).toString(),
            isOverLimit:
              new Prisma.Decimal(customer.creditLimit).greaterThan(0) &&
              debt.greaterThan(customer.creditLimit),
          },
        ];
      }),
    );
  }

  private buildWhere(query: CustomerQueryDto): Prisma.CustomerWhereInput {
    const conditions: Prisma.CustomerWhereInput[] = [{ deletedAt: null }];

    if (query.isActive !== undefined) {
      conditions.push({ isActive: query.isActive });
    }

    if (query.type !== undefined) {
      conditions.push({ type: query.type });
    }

    if (query.search !== undefined && query.search !== '') {
      const term = query.search.trim();

      conditions.push({
        OR: [
          { fullName: { contains: term, mode: 'insensitive' } },
          { companyName: { contains: term, mode: 'insensitive' } },
          { code: { contains: term, mode: 'insensitive' } },
          // Telefon aramasında da normalleştirme uygulanır: kullanıcı
          // "0532 123" yazsa da kayıttaki "5321234567" bulunur.
          { phone: { contains: normalizePhone(term) } },
          { email: { contains: term, mode: 'insensitive' } },
          { taxNumber: { contains: term } },
        ],
      });
    }

    if (query.dateFrom !== undefined || query.dateTo !== undefined) {
      conditions.push({
        createdAt: {
          ...(query.dateFrom !== undefined && { gte: new Date(query.dateFrom) }),
          ...(query.dateTo !== undefined && { lte: new Date(query.dateTo) }),
        },
      });
    }

    return { AND: conditions };
  }
}

/** Borç hesabına DAHİL satış durumları. */
const COUNTED_SALE_STATUSES: SaleStatus[] = [
  SaleStatus.CONFIRMED,
  SaleStatus.PARTIALLY_PAID,
  SaleStatus.PAID,
];

/** Vadesi geçmiş borç hesabına dahil durumlar (tamamı ödenmemiş olanlar). */
const OVERDUE_SALE_STATUSES: SaleStatus[] = [SaleStatus.CONFIRMED, SaleStatus.PARTIALLY_PAID];

const EMPTY_BALANCE: CustomerBalance = {
  totalSales: '0',
  totalPaid: '0',
  currentDebt: '0',
  overdueDebt: '0',
  isOverLimit: false,
};

export interface CustomerBalance {
  totalSales: string;
  totalPaid: string;
  currentDebt: string;
  overdueDebt: string;
  isOverLimit: boolean;
}

export interface CustomerFinanceSummary extends CustomerBalance {
  openingBalance: string;
  creditLimit: string;
  availableCredit: string;
  saleCount: number;
  salesByStatus: Record<string, number>;
}

/**
 * Liste seçicisi.
 *
 * `openingBalance` ve `creditLimit` YÖNETİM alanıdır ve listede
 * gösterilmez; borç bilgisi türetilmiş alanlarla döner.
 */
const CUSTOMER_LIST_SELECT = {
  id: true,
  code: true,
  type: true,
  fullName: true,
  companyName: true,
  phone: true,
  email: true,
  city: true,
  district: true,
  isActive: true,
  createdAt: true,
} as const satisfies Prisma.CustomerSelect;

const CUSTOMER_DETAIL_SELECT = {
  ...CUSTOMER_LIST_SELECT,
  altPhone: true,
  taxNumber: true,
  taxOffice: true,
  address: true,
  creditLimit: true,
  openingBalance: true,
  note: true,
  updatedAt: true,
  /**
   * Bağlı public giriş hesabı (Sprint 11 şartı 5).
   *
   * Yönetici bunu görmek zorundadır: müşteri "sitede talep gönderdim ama
   * göremiyorum" dediğinde ilk bakılacak yer, kartın bir hesaba bağlı olup
   * olmadığıdır. `passwordHash` gibi alanlar seçilmez — bu bir kimlik
   * yönetimi ekranı değil, bağ göstergesidir.
   */
  account: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      emailVerifiedAt: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
  },
} as const satisfies Prisma.CustomerSelect;

const CUSTOMER_NOTE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true } },
} as const satisfies Prisma.CustomerNoteSelect;

/**
 * Müşteri kartındaki ödeme satırı.
 *
 * Ödeme listesi ucundan DAHA DAR: müşteri zaten belli olduğu için müşteri
 * alanları tekrarlanmaz.
 */
const CUSTOMER_PAYMENT_SELECT = {
  id: true,
  paymentNumber: true,
  method: true,
  amount: true,
  currency: true,
  paymentDate: true,
  dueDate: true,
  reference: true,
  note: true,
  createdAt: true,
  sale: { select: { id: true, saleNumber: true, status: true } },
  createdBy: { select: { id: true, fullName: true } },
} as const satisfies Prisma.PaymentSelect;

/**
 * Yanıta uyarı iliştirir.
 *
 * Uyarı yoksa gövde DEĞİŞMEZ — boş bir `warnings: []` alanı, istemcide
 * "uyarı var mı?" kontrolünü gereksiz yere karmaşıklaştırırdı.
 */
function withWarnings(payload: unknown, warning: ApiWarning | null): unknown {
  if (warning === null) {
    return payload;
  }

  return { ...(payload as Record<string, unknown>), warnings: [warning] };
}
