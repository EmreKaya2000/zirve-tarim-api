import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, InquiryStatus, Prisma, SaleStatus } from '@prisma/client';
import { CUSTOMER_CODE_PREFIX, SALE_NUMBER_PREFIX, type ApiErrorDetail } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import {
  NUMBER_SCOPES,
  NumberSequenceService,
} from '../../common/services/number-sequence.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { SaleCalculationService } from '../sales/sale-calculation.service';
import type { ActorContext } from '../../common/types/actor-context';

import { normalizePhone } from '../../common/utils/phone';
import type { ConvertInquiryDto } from './dto/inquiry-conversion.dto';

const ENTITY_TYPE = 'Sale';

/**
 * Talep -> satış dönüşümü.
 *
 * ==========================================================================
 * İDEMPOTENCY — BU SERVİSİN EN KRİTİK ÖZELLİĞİ
 * ==========================================================================
 * Bir talep EN FAZLA BİR satışa dönüşür. Aksi hâlde aynı talep iki kez
 * faturalanır: müşteri iki kat borçlanır, stok iki kez düşer (Sprint 9),
 * kâr iki kez sayılır. Bu, sistemin yapabileceği en pahalı hatadır.
 *
 * Üç katmanla güvence altına alındı:
 *
 *   1. UYGULAMA KONTROLÜ: talebin durumu ve mevcut satışı okunur.
 *      Tek başına YETMEZ — iki eşzamanlı istek de kontrolü geçebilir.
 *   2. VERİTABANI UNIQUE KISITI: `sales.inquiryId` UNIQUE. İki
 *      eşzamanlı transaction'dan ikincisi commit anında P2002 alır.
 *      GERÇEK GÜVENCE BUDUR.
 *   3. P2002 YAKALAMA: ikinci istek 500 değil, anlaşılır bir 409 alır ve
 *      var olan satışa yönlendirilir.
 *
 * Kural 6: müşteri oluşturma/seçme, satış, kalemler, talep durumu ve bağ
 * TEK transaction içinde yazılır.
 */
@Injectable()
export class InquiryConversionService {
  private readonly logger = new Logger(InquiryConversionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: SaleCalculationService,
    private readonly numbers: NumberSequenceService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async convert(inquiryId: string, dto: ConvertInquiryDto, actor: ActorContext): Promise<unknown> {
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { id: inquiryId, deletedAt: null },
      select: {
        id: true,
        inquiryNumber: true,
        status: true,
        contactName: true,
        contactPhone: true,
        contactEmail: true,
        city: true,
        district: true,
        address: true,
        customerNote: true,
        sale: { select: { id: true, saleNumber: true } },
        items: {
          select: {
            variantId: true,
            quantity: true,
            productNameSnapshot: true,
          },
        },
      },
    });

    if (inquiry === null) {
      throw AppException.notFound('Talep bulunamadı.');
    }

    // --- Katman 1: uygulama kontrolü ---
    if (inquiry.sale !== null) {
      throw AppException.conflict('Bu talep zaten satışa dönüştürülmüş.', [
        {
          field: 'inquiryId',
          message: `Mevcut satış: ${inquiry.sale.saleNumber}. Bir talep en fazla bir satışa dönüşür.`,
        },
      ]);
    }

    if (inquiry.status === InquiryStatus.CANCELLED || inquiry.status === InquiryStatus.REJECTED) {
      throw AppException.badRequest('İptal veya reddedilmiş talep satışa dönüştürülemez.', [
        { field: 'status', message: `Talep "${inquiry.status}" durumunda.` },
      ]);
    }

    const resolvedItems = await this.resolveItems(dto, inquiry.items);

    this.assertDueDate(dto);

    try {
      const sale = await this.prisma.$transaction(async (tx) => {
        const customerId = await this.resolveCustomer(tx, dto, inquiry, actor);
        const saleDate = dto.saleDate === undefined ? new Date() : new Date(dto.saleDate);

        const saleNumber = await this.numbers.next(
          tx,
          NUMBER_SCOPES.SALE,
          SALE_NUMBER_PREFIX,
          saleDate,
        );

        const created = await tx.sale.create({
          data: {
            saleNumber,
            customerId,
            // --- Katman 2: bu alanın UNIQUE kısıtı gerçek güvencedir ---
            inquiryId: inquiry.id,
            status: SaleStatus.DRAFT,
            paymentType: dto.paymentType,
            saleDate,
            dueDate: dto.dueDate === undefined ? null : new Date(dto.dueDate),
            note: dto.note ?? inquiry.customerNote,
            createdById: actor.id,
            items: { create: resolvedItems },
          },
          select: { id: true, saleNumber: true },
        });

        await this.calculation.recalculate(tx, created.id);

        // Talep uç duruma alınır ve müşteriye bağlanır.
        //
        // CONVERTED_TO_SALE YALNIZ BURADA set edilir: durum değiştirme ucu
        // (PATCH /admin/inquiries/:id/status) bu değeri reddeder, çünkü
        // karşılığında satış kaydı oluşmadan dönüşüm sayılmaz.
        await tx.inquiry.update({
          where: { id: inquiry.id },
          data: {
            status: InquiryStatus.CONVERTED_TO_SALE,
            customerId,
            closedAt: new Date(),
          },
        });

        await tx.inquiryStatusHistory.create({
          data: {
            inquiryId: inquiry.id,
            fromStatus: inquiry.status,
            toStatus: InquiryStatus.CONVERTED_TO_SALE,
            note: `Satışa dönüştürüldü: ${saleNumber}`,
            changedById: actor.id,
          },
        });

        await this.auditLogs.record(tx, {
          userId: actor.id,
          action: AuditAction.CREATE,
          entityType: ENTITY_TYPE,
          entityId: created.id,
          newData: {
            saleNumber,
            inquiryNumber: inquiry.inquiryNumber,
            customerId,
            itemCount: resolvedItems.length,
          },
          description: `Talep satışa dönüştürüldü: ${inquiry.inquiryNumber} -> ${saleNumber}`,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });

        return created;
      });

      this.logger.log(`Dönüşüm tamamlandı: ${inquiry.inquiryNumber} -> ${sale.saleNumber}`);

      return this.prisma.sale.findUniqueOrThrow({
        where: { id: sale.id },
        select: CONVERSION_RESULT_SELECT,
      });
    } catch (error) {
      // --- Katman 3: eşzamanlı ikinci isteği anlaşılır hataya çevir ---
      throw this.translateRaceCondition(error, inquiry.inquiryNumber);
    }
  }

  /**
   * Mevcut müşteriyi seçer veya yeni müşteri oluşturur.
   *
   * Yeni müşteri, TALEBİN İLETİŞİM BİLGİLERİNDEN üretilir: yöneticinin
   * aynı bilgileri ikinci kez yazması gereksiz ve hata kaynağıdır.
   */
  private async resolveCustomer(
    tx: Prisma.TransactionClient,
    dto: ConvertInquiryDto,
    inquiry: {
      contactName: string;
      contactPhone: string;
      contactEmail: string | null;
      city: string;
      district: string;
      address: string | null;
    },
    actor: ActorContext,
  ): Promise<string> {
    if (dto.customerId !== undefined) {
      const customer = await tx.customer.findFirst({
        where: { id: dto.customerId, deletedAt: null },
        select: { id: true, isActive: true, fullName: true },
      });

      if (customer === null) {
        throw AppException.notFound('Müşteri bulunamadı.');
      }

      if (!customer.isActive) {
        throw AppException.badRequest('Pasif müşteriye satış yapılamaz.', [
          { field: 'customerId', message: `${customer.fullName} pasif durumda.` },
        ]);
      }

      return customer.id;
    }

    const phone = normalizePhone(inquiry.contactPhone);

    // Aynı telefonla kayıtlı müşteri VARSA ona bağlanır: yönetici
    // "yeni müşteri" seçse bile mükerrer kayıt oluşturulmaz.
    const existing = await tx.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true, isActive: true, fullName: true },
    });

    if (existing !== null) {
      if (!existing.isActive) {
        throw AppException.badRequest('Bu telefona kayıtlı müşteri pasif durumda.', [
          {
            field: 'customerId',
            message: `${existing.fullName} pasif. Önce müşteriyi aktif edin veya farklı müşteri seçin.`,
          },
        ]);
      }

      return existing.id;
    }

    const code = await this.numbers.next(tx, NUMBER_SCOPES.CUSTOMER, CUSTOMER_CODE_PREFIX);

    const created = await tx.customer.create({
      data: {
        code,
        fullName: dto.newCustomerName ?? inquiry.contactName,
        phone,
        email: inquiry.contactEmail,
        city: inquiry.city,
        district: inquiry.district,
        address: inquiry.address,
      },
      select: { id: true, code: true, fullName: true },
    });

    await this.auditLogs.record(tx, {
      userId: actor.id,
      action: AuditAction.CREATE,
      entityType: 'Customer',
      entityId: created.id,
      newData: { code: created.code, fullName: created.fullName, phone },
      description: `Müşteri talepten oluşturuldu: ${created.code} — ${created.fullName}`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return created.id;
  }

  /**
   * Satış kalemlerini hazırlar.
   *
   * Yönetici miktar ve fiyatı DÜZENLEYEBİLİR (Sprint 8 şartı 7): talepte
   * 100 kg isteyen müşteri mağazada 80 kg alabilir. `dto.items`
   * verilmezse talebin kalemleri olduğu gibi aktarılır.
   *
   * Fiyatlar ve maliyet her hâlükârda VARYASYONDAN okunur: talepteki
   * `displayedPriceSnapshot` müşteriye gösterilen bilgilendirme fiyatıdır,
   * bağlayıcı değildir ve satış fiyatı olarak kullanılamaz.
   */
  private async resolveItems(
    dto: ConvertInquiryDto,
    inquiryItems: { variantId: string | null; quantity: Prisma.Decimal }[],
  ): Promise<Prisma.SaleItemCreateWithoutSaleInput[]> {
    const requested =
      dto.items !== undefined && dto.items.length > 0
        ? dto.items
        : inquiryItems
            .filter(
              (item): item is { variantId: string; quantity: Prisma.Decimal } =>
                item.variantId !== null,
            )
            .map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity.toString(),
              unitSalePrice: undefined,
              discountAmount: undefined,
            }));

    if (requested.length === 0) {
      throw AppException.badRequest('Satışa aktarılacak kalem bulunamadı.', [
        {
          field: 'items',
          message: 'Talep kalemlerinin ürünleri silinmiş olabilir; kalemleri elle giriniz.',
        },
      ]);
    }

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: requested.map((item) => item.variantId) } },
      select: {
        id: true,
        sku: true,
        name: true,
        isActive: true,
        deletedAt: true,
        purchasePrice: true,
        // KDV oranı satış kalemine snapshot olarak kopyalanır.
        taxRate: true,
        salePrice: true,
        unitType: { select: { name: true, code: true, allowsDecimal: true } },
        product: { select: { id: true, name: true, deletedAt: true } },
      },
    });

    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const details: ApiErrorDetail[] = [];
    const result: Prisma.SaleItemCreateWithoutSaleInput[] = [];

    for (const [index, item] of requested.entries()) {
      const field = (name: string): string => `items[${index}].${name}`;
      const variant = byId.get(item.variantId);

      if (variant === undefined) {
        details.push({ field: field('variantId'), message: 'Ürün varyasyonu bulunamadı.' });
        continue;
      }

      if (!variant.isActive || variant.deletedAt !== null || variant.product.deletedAt !== null) {
        details.push({
          field: field('variantId'),
          message: `${variant.product.name}: bu satış birimi artık kullanılamaz.`,
        });
        continue;
      }

      const quantity = new Prisma.Decimal(item.quantity);

      if (quantity.lessThanOrEqualTo(0)) {
        details.push({ field: field('quantity'), message: 'Miktar sıfırdan büyük olmalıdır.' });
        continue;
      }

      if (!variant.unitType.allowsDecimal && !quantity.isInteger()) {
        details.push({
          field: field('quantity'),
          message: `${variant.unitType.code} biriminde ondalık miktar girilemez.`,
        });
        continue;
      }

      const calculated = this.calculation.calculateItem({
        quantity,
        unitSalePrice: item.unitSalePrice ?? new Prisma.Decimal(variant.salePrice),
        unitPurchasePrice: new Prisma.Decimal(variant.purchasePrice),
        discountAmount: item.discountAmount ?? '0',
        // KDV oranı SATIŞ ANINDA kopyalanır: ürünün oranı sonradan değişse
        // bile geçmiş satış değişmemelidir (SPEC §15.15-16).
        taxRate: new Prisma.Decimal(variant.taxRate),
      });

      if (calculated.discountAmount.greaterThan(calculated.lineSubtotal)) {
        details.push({
          field: field('discountAmount'),
          message: `İndirim satır tutarını (${calculated.lineSubtotal.toString()}) aşamaz.`,
        });
        continue;
      }

      result.push({
        product: { connect: { id: variant.product.id } },
        variant: { connect: { id: variant.id } },
        productNameSnapshot: variant.product.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku,
        unitTypeSnapshot: variant.unitType.name,
        quantity: calculated.quantity,
        unitPurchasePrice: calculated.unitPurchasePrice,
        unitSalePrice: calculated.unitSalePrice,
        discountAmount: calculated.discountAmount,
        // KDV SNAPSHOT — ürünün oranı sonradan değişse bile geçmiş satış
        // değişmemelidir (SPEC §15.15-16).
        taxRate: calculated.taxRate,
        lineSubtotal: calculated.lineSubtotal,
        lineTotal: calculated.lineTotal,
        lineCost: calculated.lineCost,
        lineTax: calculated.lineTax,
        lineProfit: calculated.lineProfit,
        sortOrder: index,
      });
    }

    if (details.length > 0) {
      throw AppException.badRequest('Satış kalemleri geçersiz.', details);
    }

    return result;
  }

  private assertDueDate(dto: ConvertInquiryDto): void {
    if (dto.paymentType === 'CREDIT' && dto.dueDate === undefined) {
      throw AppException.badRequest('Vadeli satışta vade tarihi zorunludur.', [
        { field: 'dueDate', message: 'Vadeli satış için vade tarihi giriniz.' },
      ]);
    }
  }

  /**
   * Eşzamanlı ikinci dönüşüm isteğini anlaşılır hataya çevirir.
   *
   * `sales.inquiryId` UNIQUE olduğu için ikinci transaction commit anında
   * P2002 alır. Bu, 500 olarak dönerse kullanıcı "sistem çöktü" sanır;
   * oysa doğru davranış gerçekleşmiştir — tek satış oluşmuştur.
   */
  private translateRaceCondition(error: unknown, inquiryNumber: string): unknown {
    const isUniqueViolation =
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      JSON.stringify(error.meta ?? {}).includes('inquiryId');

    if (!isUniqueViolation) {
      return error;
    }

    this.logger.warn(
      `Eşzamanlı dönüşüm denemesi engellendi: ${inquiryNumber} (sales.inquiryId unique kısıtı).`,
    );

    return AppException.conflict('Bu talep aynı anda başka bir istekle satışa dönüştürüldü.', [
      {
        field: 'inquiryId',
        message: 'Talebin satışını görüntüleyin; ikinci bir satış oluşturulmadı.',
      },
    ]);
  }
}

const CONVERSION_RESULT_SELECT = {
  id: true,
  saleNumber: true,
  status: true,
  paymentType: true,
  subtotal: true,
  discountTotal: true,
  grandTotal: true,
  paidTotal: true,
  remainingTotal: true,
  grossProfit: true,
  netProfit: true,
  saleDate: true,
  dueDate: true,
  customer: { select: { id: true, code: true, fullName: true, phone: true } },
  inquiry: { select: { id: true, inquiryNumber: true, status: true } },
  _count: { select: { items: true } },
} as const satisfies Prisma.SaleSelect;
