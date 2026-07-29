import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, PaymentMethod, Prisma, SaleStatus } from '@prisma/client';
import { PAYMENT_NUMBER_PREFIX, canAcceptPayment, requiresPaymentDueDate } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import {
  NUMBER_SCOPES,
  NumberSequenceService,
} from '../../common/services/number-sequence.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SaleCalculationService } from '../sales/sale-calculation.service';
import type { ActorContext } from '../../common/types/actor-context';

import type { CreatePaymentDto, PaymentQueryDto } from './dto/payment.dto';

const ENTITY_TYPE = 'Payment';

/**
 * Tahsilat yönetimi.
 *
 * Ödeme eklendiğinde/silindiğinde satışın saklanan toplamları AYNI
 * transaction içinde yeniden hesaplanır (SaleCalculationService). Ödeme
 * yazıp toplamı güncellemeyi atlayan bir yol yoktur.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: SaleCalculationService,
    private readonly numbers: NumberSequenceService,
    private readonly auditLogs: AuditLogsService,
    private readonly queryBuilder: QueryBuilderService,
  ) {}

  /**
   * Satışa ödeme ekler.
   *
   * İş kuralları (SPEC §15/10-12):
   *   - tutar > 0
   *   - kalan borç AŞILAMAZ
   *   - DRAFT veya CANCELLED satışa ödeme eklenemez
   *   - çek/senette vade tarihi zorunludur
   *
   * Ödeme sonrası satış durumu otomatik güncellenir:
   *   kısmi -> PARTIALLY_PAID, tamamı -> PAID
   */
  async create(saleId: string, dto: CreatePaymentDto, actor: ActorContext): Promise<unknown> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        saleNumber: true,
        status: true,
        customerId: true,
        grandTotal: true,
        paidTotal: true,
        remainingTotal: true,
      },
    });

    if (sale === null) {
      throw AppException.notFound('Satış bulunamadı.');
    }

    if (!canAcceptPayment(sale.status)) {
      throw AppException.badRequest('Bu satışa ödeme eklenemez.', [
        {
          field: 'saleId',
          message:
            sale.status === SaleStatus.DRAFT
              ? 'Taslak satışa ödeme eklenemez. Önce satışı onaylayın.'
              : sale.status === SaleStatus.CANCELLED
                ? 'İptal edilmiş satışa ödeme eklenemez.'
                : 'Satışın tamamı ödenmiş.',
        },
      ]);
    }

    const amount = toDecimal(dto.amount);

    if (amount === null || amount.lessThanOrEqualTo(0)) {
      throw AppException.badRequest('Ödeme tutarı sıfırdan büyük olmalıdır.', [
        { field: 'amount', message: 'Tutar sıfırdan büyük olmalıdır.' },
      ]);
    }

    // FAZLA ÖDEME REDDEDİLİR. Avans/açık bakiye bu sprintte yok; fazla
    // tahsilatı sessizce kabul etmek, müşteri hesabında izlenmeyen bir
    // alacak bırakırdı.
    const remaining = new Prisma.Decimal(sale.remainingTotal);

    if (amount.greaterThan(remaining)) {
      throw AppException.badRequest('Ödeme tutarı kalan borcu aşamaz.', [
        {
          field: 'amount',
          message: `Kalan borç ${remaining.toString()}. Fazla tahsilat kaydedilemez.`,
        },
      ]);
    }

    if (requiresPaymentDueDate(dto.method) && dto.dueDate === undefined) {
      throw AppException.badRequest('Bu ödeme yönteminde vade tarihi zorunludur.', [
        { field: 'dueDate', message: 'Çek ve senette vade tarihi giriniz.' },
      ]);
    }

    const paymentDate = new Date(dto.paymentDate);

    const payment = await this.prisma.$transaction(async (tx) => {
      const paymentNumber = await this.numbers.next(
        tx,
        NUMBER_SCOPES.PAYMENT,
        PAYMENT_NUMBER_PREFIX,
        paymentDate,
      );

      const created = await tx.payment.create({
        data: {
          paymentNumber,
          saleId: sale.id,
          // Denormalize: müşteri bazlı ödeme listesi join'siz çalışsın.
          customerId: sale.customerId,
          method: dto.method,
          amount,
          paymentDate,
          dueDate: dto.dueDate === undefined ? null : new Date(dto.dueDate),
          reference: dto.reference ?? null,
          note: dto.note ?? null,
          createdById: actor.id,
        },
        select: { id: true, paymentNumber: true, amount: true },
      });

      // Toplamlar ve durum AYNI transaction içinde güncellenir.
      const totals = await this.calculation.recalculate(tx, sale.id);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: {
          paymentNumber,
          saleNumber: sale.saleNumber,
          amount: created.amount.toString(),
          method: dto.method,
          paidTotal: totals.paidTotal.toString(),
          remainingTotal: totals.remainingTotal.toString(),
          saleStatus: totals.status,
        },
        description: `Ödeme alındı: ${paymentNumber} — ${sale.saleNumber} (${created.amount.toString()})`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });

    this.logger.log(`Ödeme alındı: ${payment.paymentNumber} (${payment.amount.toString()})`);

    return this.findOne(payment.id);
  }

  /**
   * Ödemeyi soft delete eder.
   *
   * Kural 4: finansal kayıt HARD DELETE EDİLMEZ. Yanlış girilmiş bir
   * tahsilat silindiğinde borç yeniden doğar; satış toplamları ve durumu
   * aynı transaction içinde düzeltilir (PAID -> PARTIALLY_PAID gibi).
   */
  async remove(id: string, reason: string, actor: ActorContext): Promise<void> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        paymentNumber: true,
        amount: true,
        method: true,
        saleId: true,
        sale: { select: { saleNumber: true, status: true } },
      },
    });

    if (payment === null) {
      throw AppException.notFound('Ödeme bulunamadı.');
    }

    if (payment.sale.status === SaleStatus.CANCELLED) {
      throw AppException.badRequest('İptal edilmiş satışın ödemesi silinemez.', [
        { field: 'saleId', message: 'Satış iptal edilmiş; ödeme kaydı olduğu gibi korunur.' },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id }, data: { deletedAt: new Date() } });

      const totals = await this.calculation.recalculate(tx, payment.saleId);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: {
          paymentNumber: payment.paymentNumber,
          amount: payment.amount.toString(),
          method: payment.method,
        },
        newData: {
          reason,
          paidTotal: totals.paidTotal.toString(),
          remainingTotal: totals.remainingTotal.toString(),
          saleStatus: totals.status,
        },
        description: `Ödeme silindi: ${payment.paymentNumber} — ${payment.sale.saleNumber} — ${reason}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    this.logger.log(`Ödeme silindi: ${payment.paymentNumber} — ${reason}`);
  }

  async findMany(query: PaymentQueryDto): Promise<{ items: unknown[]; meta: unknown }> {
    const where = buildPaymentWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [items, total, sum] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
        select: PAYMENT_LIST_SELECT,
      }),
      this.prisma.payment.count({ where }),
      // Filtrelenmiş toplam: "bu ay nakit ne kadar tahsil ettim" sorusu
      // liste ekranından cevaplanabilsin.
      this.prisma.payment.aggregate({ where, _sum: { amount: true } }),
    ]);

    return {
      items,
      meta: {
        ...this.queryBuilder.buildMeta(total, query),
        totalAmount: (sum._sum.amount ?? new Prisma.Decimal(0)).toString(),
      },
    };
  }

  async findOne(id: string): Promise<unknown> {
    const payment = await this.prisma.payment.findFirst({
      where: { id, deletedAt: null },
      select: PAYMENT_DETAIL_SELECT,
    });

    if (payment === null) {
      throw AppException.notFound('Ödeme bulunamadı.');
    }

    return payment;
  }

  /** Bir satışın ödemeleri. */
  async findBySale(saleId: string): Promise<unknown[]> {
    return this.prisma.payment.findMany({
      where: { saleId, deletedAt: null },
      orderBy: { paymentDate: 'asc' },
      select: PAYMENT_LIST_SELECT,
    });
  }
}

const PAYMENT_LIST_SELECT = {
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
  customer: { select: { id: true, code: true, fullName: true, phone: true } },
  createdBy: { select: { id: true, fullName: true } },
} as const satisfies Prisma.PaymentSelect;

const PAYMENT_DETAIL_SELECT = PAYMENT_LIST_SELECT;

function buildPaymentWhere(query: PaymentQueryDto): Prisma.PaymentWhereInput {
  const conditions: Prisma.PaymentWhereInput[] = [{ deletedAt: null }];

  if (query.method !== undefined) {
    conditions.push({ method: query.method as PaymentMethod });
  }

  if (query.customerId !== undefined) {
    conditions.push({ customerId: query.customerId });
  }

  if (query.saleId !== undefined) {
    conditions.push({ saleId: query.saleId });
  }

  if (query.dateFrom !== undefined || query.dateTo !== undefined) {
    conditions.push({
      paymentDate: {
        ...(query.dateFrom !== undefined && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo !== undefined && { lte: new Date(query.dateTo) }),
      },
    });
  }

  if (query.search !== undefined && query.search !== '') {
    const term = query.search.trim();

    conditions.push({
      OR: [
        { paymentNumber: { contains: term, mode: 'insensitive' } },
        { reference: { contains: term, mode: 'insensitive' } },
        { sale: { saleNumber: { contains: term, mode: 'insensitive' } } },
        { customer: { fullName: { contains: term, mode: 'insensitive' } } },
      ],
    });
  }

  return { AND: conditions };
}

function toDecimal(value: string): Prisma.Decimal | null {
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}
