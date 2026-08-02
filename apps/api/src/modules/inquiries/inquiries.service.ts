import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, InquiryStatus, Prisma } from '@prisma/client';
import {
  DEFAULT_INQUIRY_PREFIX,
  SALE_CONVERSION_STATUS,
  canTransitionInquiry,
  isTerminalInquiryStatus,
  nextInquiryStatuses,
  SETTING_KEYS,
  type InquiryStatus as InquiryStatusType,
} from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import { normalizePhone } from '../../common/utils/phone';
import { normalizeEmail } from '../auth/auth.service';
import { InquiryNotificationsService } from './inquiry-notifications.service';
import {
  NUMBER_SCOPES,
  NumberSequenceService,
} from '../../common/services/number-sequence.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SettingsService } from '../settings/settings.service';
import type { ActorContext } from '../../common/types/actor-context';

import { InquiryValidationService } from './inquiry-validation.service';
import {
  ADMIN_INQUIRY_DETAIL_SELECT,
  ADMIN_INQUIRY_LIST_SELECT,
  PUBLIC_INQUIRY_RESULT_SELECT,
} from './inquiries.select';
import type { CreateInquiryDto, InquiryQueryDto, UpdateInquiryStatusDto } from './dto/inquiry.dto';

const ENTITY_TYPE = 'Inquiry';

/** Bu durumlara geçerken gerekçe ZORUNLUDUR. */
const NOTE_REQUIRED_STATUSES: readonly InquiryStatusType[] = ['REJECTED', 'CANCELLED'];

/**
 * Geçerli belge numarası ön eki.
 *
 * Veritabanındaki `chk_inquiries_number_format` kısıtıyla AYNI kuralı
 * uygular; ikisi birlikte değiştirilmelidir.
 */
const VALID_PREFIX = /^[A-Z]{2,6}$/;

/** İstek üstverisi — IP ve tarayıcı bilgisi. */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;

  /**
   * Talebi gönderen müşteri hesabı — Sprint 11 şartı 3.
   *
   * Giriş yapmadan gönderilen taleplerde `undefined` kalır ve MİSAFİR AKIŞI
   * AYNEN ÇALIŞIR. Değer istemciden GELMEZ; jetondan çözülür
   * (CustomerContextService), aksi hâlde herkes talebini başkasının hesabına
   * yazabilirdi.
   */
  customerAccountId?: string;
}

@Injectable()
export class InquiriesService {
  private readonly logger = new Logger(InquiriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: InquiryValidationService,
    private readonly numbers: NumberSequenceService,
    private readonly auditLogs: AuditLogsService,
    private readonly settings: SettingsService,
    private readonly queryBuilder: QueryBuilderService,
    private readonly notifications: InquiryNotificationsService,
  ) {}

  // ==========================================================================
  // PUBLIC
  // ==========================================================================

  /**
   * Sepeti doğrular; talep oluşturmaz.
   *
   * Sepet sayfası açılırken çağrılır: pasife alınmış ürün ve değişmiş fiyat
   * kullanıcıya FORM DOLDURMADAN ÖNCE gösterilir (ARCHITECTURE §10.1).
   */
  async validateCart(items: CreateInquiryDto['items']): Promise<{
    items: {
      variantId: string;
      productName: string;
      productSlug: string;
      variantName: string | null;
      sku: string;
      unitTypeName: string;
      quantity: string;
      displayedPrice: string | null;
      lineTotal: string | null;
      inStock: boolean;
    }[];
    estimatedTotal: string;
    /** Fiyatı gizli kalem var mı? Arayüz "tahmini tutar eksik" uyarısı gösterir. */
    hasHiddenPrices: boolean;
  }> {
    const validated = await this.validation.validateItems(items);

    return {
      items: validated.map((item) => ({
        variantId: item.variantId,
        productName: item.productName,
        productSlug: item.productSlug,
        variantName: item.variantName,
        sku: item.sku,
        unitTypeName: item.unitTypeName,
        quantity: item.quantity.toString(),
        displayedPrice: item.displayedPrice?.toString() ?? null,
        lineTotal: item.lineTotal?.toString() ?? null,
        // Talep stok rezerve etmez; bu yalnız bilgilendirmedir.
        inStock: item.stockQuantity.greaterThanOrEqualTo(item.quantity),
      })),
      estimatedTotal: this.validation.estimateTotal(validated).toString(),
      hasHiddenPrices: validated.some((item) => item.displayedPrice === null),
    };
  }

  /**
   * Talep oluşturur.
   *
   * Kural 6: numara üretimi, talep, kalemler ve ilk durum geçmişi TEK
   * transaction içinde yazılır. Yarıda kalan bir talep, mağazanın
   * göremediği ama müşterinin gönderdiğini sandığı bir kayıt olurdu.
   */
  async create(dto: CreateInquiryDto, context: RequestContext): Promise<unknown> {
    // KVKK onayı ZORUNLU. DTO `@IsBoolean` ile tipi doğrular; değerin
    // `true` olması iş kuralıdır ve burada kontrol edilir.
    if (dto.consentAccepted !== true) {
      throw AppException.badRequest('Talep göndermek için KVKK onayı gereklidir.', [
        { field: 'consentAccepted', message: 'Aydınlatma metnini onaylamanız gerekir.' },
      ]);
    }

    const validated = await this.validation.validateItems(dto.items);
    const estimatedTotal = this.validation.estimateTotal(validated);
    const prefix = await this.resolvePrefix();
    const now = new Date();

    const inquiry = await this.prisma.$transaction(async (tx) => {
      // Numara üretimi sayaç satırını KİLİTLER; kilit commit'e kadar
      // sürer. Bu yüzden doğrulama ve ayar okuma transaction DIŞINDA
      // yapıldı — aksi hâlde tüm o süre boyunca diğer talepler beklerdi.
      const inquiryNumber = await this.numbers.next(tx, NUMBER_SCOPES.INQUIRY, prefix, now);

      const created = await tx.inquiry.create({
        data: {
          inquiryNumber,
          status: InquiryStatus.NEW,
          contactName: dto.contactName,
          contactPhone: normalizePhone(dto.contactPhone),
          // KÜÇÜK HARFE NORMALLEŞTİRİLİR (Sprint 11): doğrulanmış e-postayla
          // geçmiş misafir taleplerini bulan sorgu TAM EŞİTLİK kullanır ve
          // `inquiries_contactEmail_idx` indeksi ancak öyle devreye girer.
          contactEmail: dto.contactEmail === undefined ? null : normalizeEmail(dto.contactEmail),
          // Jetondan çözülür, gövdeden DEĞİL (bkz. RequestContext).
          customerAccountId: context.customerAccountId ?? null,
          city: dto.city,
          district: dto.district,
          address: dto.address ?? null,
          preferredContact: dto.preferredContact,
          customerNote: dto.customerNote ?? null,
          consentAccepted: true,
          consentAt: now,
          estimatedTotal,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent?.slice(0, 255) ?? null,
          items: {
            create: validated.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              productNameSnapshot: item.productName,
              variantNameSnapshot: item.variantName,
              skuSnapshot: item.sku,
              unitTypeSnapshot: item.unitTypeName,
              unitQuantitySnapshot: item.unitQuantity,
              displayedPriceSnapshot: item.displayedPrice,
              quantity: item.quantity,
              lineTotal: item.lineTotal,
              note: item.note,
            })),
          },
          // İlk durum geçmişi: talep yoktan NEW'e doğar, fromStatus NULL.
          statusHistories: {
            create: { fromStatus: null, toStatus: InquiryStatus.NEW, changedById: null },
          },
        },
        select: PUBLIC_INQUIRY_RESULT_SELECT,
      });

      await this.auditLogs.record(tx, {
        userId: null,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: { inquiryNumber, itemCount: validated.length },
        description: `Talep oluşturuldu: ${inquiryNumber}`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return created;
    });

    this.logger.log(`Talep alındı: ${inquiry.inquiryNumber} (${validated.length} kalem)`);

    /*
     * BİLDİRİM TRANSACTION'IN DIŞINDA ve AWAIT EDİLMEDEN.
     *
     * Dışında: transaction commit olmadan gönderilen bir "talebiniz alındı"
     * e-postası, rollback hâlinde var olmayan bir talebi bildirirdi.
     * Await edilmeden: SMTP arızası istemciye 500 döndürseydi kullanıcı formu
     * yeniden gönderir ve AYNI talep ikinci kez oluşurdu.
     */
    this.notifications.dispatchCreated(inquiry.id);

    return inquiry;
  }

  // ==========================================================================
  // YÖNETİM
  // ==========================================================================

  async findMany(query: InquiryQueryDto): Promise<{ items: unknown[]; meta: unknown }> {
    const where = buildAdminWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.inquiry.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: buildOrderBy(query),
        select: ADMIN_INQUIRY_LIST_SELECT,
      }),
      this.prisma.inquiry.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  async findOne(id: string): Promise<unknown> {
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { id, deletedAt: null },
      select: ADMIN_INQUIRY_DETAIL_SELECT,
    });

    if (inquiry === null) {
      throw AppException.notFound('Talep bulunamadı.');
    }

    return inquiry;
  }

  /** Durum sayaçları — liste sayfasındaki sekme rozetleri için. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.inquiry.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    });

    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  /**
   * Talebi bir müşteriye bağlar veya bağı kaldırır (Sprint 7 şartı 4).
   *
   * NEDEN GEREKLİ: talep formu public taraftan, müşteri kaydı olmayan bir
   * ziyaretçi tarafından doldurulur. Aynı kişinin daha önce açılmış bir
   * müşteri kartı varsa, talebi ona bağlamak müşteri geçmişini tek yerde
   * toplar; satışa dönüşümde de yeni bir mükerrer kart açılmaz.
   *
   * DÖNÜŞMÜŞ TALEP DEĞİŞTİRİLEMEZ: satış zaten bir müşteriye yazılmıştır;
   * talebin müşterisini sonradan değiştirmek, belge ile talebi
   * birbirinden koparırdı.
   */
  async linkCustomer(id: string, customerId: string | null, actor: ActorContext): Promise<unknown> {
    const existing = await this.prisma.inquiry.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, inquiryNumber: true, status: true, customerId: true },
    });

    if (existing === null) {
      throw AppException.notFound('Talep bulunamadı.');
    }

    if (existing.status === SALE_CONVERSION_STATUS) {
      throw AppException.badRequest('Satışa dönüşmüş talebin müşterisi değiştirilemez.', [
        {
          field: 'customerId',
          message: 'Bu talep bir satışa bağlı; müşteri satış üzerinden yönetilir.',
        },
      ]);
    }

    if (customerId !== null) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, deletedAt: null },
        select: { id: true, fullName: true, isActive: true },
      });

      if (customer === null) {
        throw AppException.notFound('Müşteri bulunamadı.', [
          { field: 'customerId', message: 'Seçilen müşteri bulunamadı veya silinmiş.' },
        ]);
      }

      if (!customer.isActive) {
        throw AppException.badRequest('Pasif müşteri talebe bağlanamaz.', [
          { field: 'customerId', message: `${customer.fullName} pasif durumda.` },
        ]);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inquiry.update({ where: { id }, data: { customerId } });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { customerId: existing.customerId },
        newData: { customerId },
        description:
          customerId === null
            ? `Talep müşteri bağı kaldırıldı: ${existing.inquiryNumber}`
            : `Talep müşteriye bağlandı: ${existing.inquiryNumber}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOne(id);
  }

  /**
   * Talebi bir PUBLIC MÜŞTERİ HESABINA bağlar veya bağı kaldırır
   * (Sprint 11 şartı 3).
   *
   * NEDEN ELLE: geçmiş misafir talepleri e-posta DOĞRULANDIKTAN sonra
   * otomatik bağlanır. Telefon eşleşmesiyle otomatik bağlama YAPILMAZ çünkü
   * telefon bu sistemde doğrulanmıyor — numarayı bilen biri o kişinin talep
   * geçmişini okuyabilirdi. Numarası eşleşen ama e-postası tutmayan (ya da
   * hiç e-posta bırakmamış) talepler için tek doğru yol, kişiyi tanıyan
   * mağazanın bağı kendisi kurmasıdır.
   *
   * `customerId` (CRM kartı) İLE BAĞIMSIZDIR: bir talep hem bir hesaba hem
   * bir karta, ya da yalnız birine bağlı olabilir.
   */
  async linkCustomerAccount(
    id: string,
    customerAccountId: string | null,
    actor: ActorContext,
  ): Promise<unknown> {
    const existing = await this.prisma.inquiry.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, inquiryNumber: true, customerAccountId: true },
    });

    if (existing === null) {
      throw AppException.notFound('Talep bulunamadı.');
    }

    if (customerAccountId !== null) {
      const account = await this.prisma.customerAccount.findFirst({
        where: { id: customerAccountId, deletedAt: null },
        select: { id: true, email: true, isActive: true },
      });

      if (account === null) {
        throw AppException.notFound('Müşteri hesabı bulunamadı.', [
          { field: 'customerAccountId', message: 'Seçilen hesap bulunamadı veya silinmiş.' },
        ]);
      }

      if (!account.isActive) {
        throw AppException.badRequest('Pasif hesap talebe bağlanamaz.', [
          { field: 'customerAccountId', message: `${account.email} pasif durumda.` },
        ]);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inquiry.update({ where: { id }, data: { customerAccountId } });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.ACCOUNT_LINKED,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { customerAccountId: existing.customerAccountId },
        newData: { customerAccountId },
        description:
          customerAccountId === null
            ? `Talep hesap bağı kaldırıldı: ${existing.inquiryNumber}`
            : `Talep bir müşteri hesabına bağlandı: ${existing.inquiryNumber}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOne(id);
  }

  /**
   * Durum değiştirir.
   *
   * Geçiş kuralları @zirve/types içindeki ALLOWED_INQUIRY_TRANSITIONS
   * tablosundan gelir; arayüz de aynı tabloyu okur, böylece kullanıcıya
   * backend'in reddedeceği bir seçenek sunulmaz.
   */
  async updateStatus(
    id: string,
    dto: UpdateInquiryStatusDto,
    actor: ActorContext,
  ): Promise<unknown> {
    const existing = await this.prisma.inquiry.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, inquiryNumber: true, status: true, internalNote: true },
    });

    if (existing === null) {
      throw AppException.notFound('Talep bulunamadı.');
    }

    const from = existing.status as InquiryStatusType;
    const to = dto.status;

    if (from === to) {
      throw AppException.badRequest('Talep zaten bu durumda.', [
        { field: 'status', message: `Talep hâlihazırda "${from}" durumunda.` },
      ]);
    }

    // CONVERTED_TO_SALE bu uçtan SET EDİLEMEZ.
    //
    // Bir talep, karşılığında satış kaydı oluşmadan "satışa dönüştü"
    // sayılamaz; aksi hâlde raporlarda satışsız dönüşüm görünür.
    // Sprint 8'in dönüşüm servisi bu durumu satışla aynı transaction
    // içinde yazacaktır.
    if (to === SALE_CONVERSION_STATUS) {
      throw AppException.badRequest(
        'Satışa dönüştürme bu uçtan yapılamaz; satış oluşturma akışını kullanın.',
        [{ field: 'status', message: 'Bu durum yalnız satış kaydıyla birlikte set edilir.' }],
      );
    }

    if (isTerminalInquiryStatus(from)) {
      throw AppException.badRequest(`"${from}" durumundaki talebin durumu değiştirilemez.`, [
        {
          field: 'status',
          message: 'Kapanmış talep yeniden açılamaz. Gerekiyorsa yeni talep oluşturun.',
        },
      ]);
    }

    if (!canTransitionInquiry(from, to)) {
      throw AppException.badRequest('Bu durum geçişine izin verilmiyor.', [
        {
          field: 'status',
          message: `"${from}" durumundan yalnız şunlara geçilebilir: ${nextInquiryStatuses(from).join(', ')}.`,
        },
      ]);
    }

    // İptal ve reddin gerekçesi olmalı: altı ay sonra kaydı okuyan kişi
    // neden kapandığını bilmeli.
    if (NOTE_REQUIRED_STATUSES.includes(to) && (dto.note === undefined || dto.note === '')) {
      throw AppException.badRequest('Bu durum için gerekçe zorunludur.', [
        { field: 'note', message: 'İptal ve red işlemlerinde gerekçe yazmanız gerekir.' },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.inquiry.update({
        where: { id },
        data: {
          status: to,
          ...(dto.internalNote !== undefined && { internalNote: dto.internalNote }),
          // İlk kez iletişime geçildiğinde damgalanır; sonraki
          // değişikliklerde korunur.
          ...(to === 'CONTACTED' && { contactedAt: new Date() }),
          ...(isTerminalInquiryStatus(to) && { closedAt: new Date() }),
        },
      });

      await tx.inquiryStatusHistory.create({
        data: {
          inquiryId: id,
          fromStatus: from,
          toStatus: to,
          note: dto.note ?? null,
          changedById: actor.id,
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { status: from },
        newData: { status: to, note: dto.note ?? null },
        description: `Talep durumu değişti: ${existing.inquiryNumber} (${from} -> ${to})`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    // Yalnız READY ve CANCELLED müşteriye bildirilir; kararı servis verir.
    // Transaction dışında ve await edilmeden — gerekçe create() içinde.
    this.notifications.dispatchStatusChanged(id, to);

    return this.findOne(id);
  }

  /**
   * Talep numarası ön eki — ayardan okunur.
   *
   * DEĞER DOĞRULANIR: veritabanındaki `chk_inquiries_number_format` kısıtı
   * yalnız 2-6 harflik ön eke izin verir. Yönetici ayara "120" gibi bir
   * değer yazarsa doğrulanmadan geçirilirse her talep 500 ile düşerdi —
   * ziyaretçi için sebebi anlaşılmaz bir hata. Geçersiz değerde yedek ön
   * ek kullanılır ve durum loglanır.
   */
  private async resolvePrefix(): Promise<string> {
    const raw = (await this.settings.getValue(SETTING_KEYS.GENERAL_REQUEST_PREFIX))?.trim() ?? '';
    const candidate = raw.toLocaleUpperCase('tr-TR');

    if (VALID_PREFIX.test(candidate)) {
      return candidate;
    }

    this.logger.warn(
      `${SETTING_KEYS.GENERAL_REQUEST_PREFIX} ayarı geçersiz ("${raw}"); ` +
        `"${DEFAULT_INQUIRY_PREFIX}" kullanılıyor. Ön ek 2-6 harf olmalıdır.`,
    );

    return DEFAULT_INQUIRY_PREFIX;
  }
}

/** Yönetim listesi filtresi. */
function buildAdminWhere(query: InquiryQueryDto): Prisma.InquiryWhereInput {
  const conditions: Prisma.InquiryWhereInput[] = [{ deletedAt: null }];

  const statuses = (query.status ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is InquiryStatus => value in InquiryStatus);

  if (statuses.length > 0) {
    conditions.push({ status: { in: statuses } });
  }

  if (query.dateFrom !== undefined || query.dateTo !== undefined) {
    conditions.push({
      createdAt: {
        ...(query.dateFrom !== undefined && { gte: new Date(query.dateFrom) }),
        // Gün sonu DAHİL: kullanıcı "31 Temmuz'a kadar" derken o günü de
        // kastediyor. Tarih verildiyse ertesi günün başına kadar alınır.
        ...(query.dateTo !== undefined && { lt: endOfDay(query.dateTo) }),
      },
    });
  }

  if (query.search !== undefined && query.search !== '') {
    const term = query.search.trim();

    conditions.push({
      OR: [
        { inquiryNumber: { contains: term, mode: 'insensitive' } },
        { contactName: { contains: term, mode: 'insensitive' } },
        { contactPhone: { contains: normalizePhone(term) } },
        { contactEmail: { contains: normalizeEmail(term) } },
        { city: { contains: term, mode: 'insensitive' } },
      ],
    });
  }

  return { AND: conditions };
}

const SORTABLE_FIELDS = ['createdAt', 'inquiryNumber', 'status', 'estimatedTotal'] as const;

function buildOrderBy(query: InquiryQueryDto): Prisma.InquiryOrderByWithRelationInput {
  const field = SORTABLE_FIELDS.find((name) => name === query.sortBy) ?? 'createdAt';
  const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';

  return { [field]: direction };
}

/** Verilen günün BİTİMİNİ (ertesi günün başlangıcını) döndürür. */
function endOfDay(value: string): Date {
  const date = new Date(value);

  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 1);

  return date;
}
