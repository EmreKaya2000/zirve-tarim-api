import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, SaleStatus, StockMovementType } from '@prisma/client';
import { SALE_NUMBER_PREFIX, canCancelSale, canEditSale, type PaymentType } from '@zirve/types';
import type { ApiErrorDetail } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { QueryBuilderService } from '../../common/services/query-builder.service';
import {
  NUMBER_SCOPES,
  NumberSequenceService,
} from '../../common/services/number-sequence.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CustomersService } from '../customers/customers.service';
import { PaymentsService } from '../payments/payments.service';
import { StockService } from '../stock/stock.service';
import type { ActorContext } from '../../common/types/actor-context';

import { SaleCalculationService } from './sale-calculation.service';
import { ADMIN_SALE_DETAIL_SELECT, ADMIN_SALE_LIST_SELECT } from './sales.select';
import type {
  AddAdditionalCostDto,
  CancelSaleDto,
  CreateSaleDto,
  SaleItemInputDto,
  SaleQueryDto,
  UpdateSaleDto,
} from './dto/sale.dto';

const ENTITY_TYPE = 'Sale';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculation: SaleCalculationService,
    private readonly numbers: NumberSequenceService,
    private readonly auditLogs: AuditLogsService,
    private readonly customers: CustomersService,
    private readonly payments: PaymentsService,
    private readonly stock: StockService,
    private readonly queryBuilder: QueryBuilderService,
  ) {}

  // ==========================================================================
  // OLUŞTURMA VE DÜZENLEME
  // ==========================================================================

  /**
   * TASLAK satış oluşturur.
   *
   * Kural 6: numara üretimi, satış, kalemler ve varsa ilk ödeme TEK
   * transaction içinde yazılır.
   *
   * Satış DRAFT doğar; `finalize()` çağrılmadan borç doğurmaz ve müşteri
   * finans özetine girmez. Bu, yanlış girilen bir satışın kayıt
   * bırakmadan düzeltilebilmesini sağlar.
   */
  async create(dto: CreateSaleDto, actor: ActorContext): Promise<unknown> {
    const customer = await this.requireActiveCustomer(dto.customerId);

    this.assertDueDate(dto.paymentType, dto.dueDate);

    const resolved = await this.resolveItems(dto.items);
    const now = new Date();

    const sale = await this.prisma.$transaction(async (tx) => {
      const saleNumber = await this.numbers.next(
        tx,
        NUMBER_SCOPES.SALE,
        SALE_NUMBER_PREFIX,
        new Date(dto.saleDate),
      );

      const created = await tx.sale.create({
        data: {
          saleNumber,
          customerId: customer.id,
          status: SaleStatus.DRAFT,
          paymentType: dto.paymentType,
          saleDate: new Date(dto.saleDate),
          dueDate: dto.dueDate === undefined ? null : new Date(dto.dueDate),
          note: dto.note ?? null,
          createdById: actor.id,
          items: { create: resolved.map(toItemCreateData) },
        },
        select: { id: true, saleNumber: true },
      });

      // Toplamlar kalemler yazıldıktan SONRA hesaplanır: hesaplama
      // veritabanındaki kalemleri okur, bellekteki listeyi değil. Böylece
      // saklanan toplam ile kayıtlı kalemler arasında ayrışma olamaz.
      await this.calculation.recalculate(tx, created.id);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: { saleNumber, customerId: customer.id, itemCount: resolved.length },
        description: `Satış taslağı oluşturuldu: ${saleNumber}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return created;
    });

    // İlk ödeme varsa satış ÖNCE onaylanır: taslak satışa ödeme eklenemez
    // (SPEC §15/12). Bu sıra bilinçli — ödeme, onaylanmış bir belgeye
    // yazılır.
    if (dto.initialPayment !== undefined) {
      await this.finalize(sale.id, actor);
      await this.payments.create(
        sale.id,
        {
          method: dto.initialPayment.method,
          amount: dto.initialPayment.amount,
          paymentDate: now.toISOString(),
          dueDate: dto.initialPayment.dueDate,
          reference: dto.initialPayment.reference,
          note: dto.initialPayment.note,
        },
        actor,
      );
    }

    this.logger.log(`Satış oluşturuldu: ${sale.saleNumber}`);

    return this.findOne(sale.id);
  }

  /**
   * Satışı günceller.
   *
   * YALNIZ TASLAK düzenlenebilir. Onaylanmış satışın kalemleri
   * değiştirilemez: müşteriye verilmiş belgenin sonradan değişmesi hem
   * muhasebe hem güven sorunudur. Hata varsa satış iptal edilip yenisi
   * açılır.
   */
  async update(id: string, dto: UpdateSaleDto, actor: ActorContext): Promise<unknown> {
    const existing = await this.getExisting(id);

    if (!canEditSale(existing.status)) {
      throw AppException.badRequest('Yalnız taslak satış düzenlenebilir.', [
        {
          field: 'status',
          message: `Satış "${existing.status}" durumunda. Değişiklik için iptal edip yeni satış oluşturun.`,
        },
      ]);
    }

    if (dto.customerId !== undefined) {
      await this.requireActiveCustomer(dto.customerId);
    }

    const paymentType = dto.paymentType ?? (existing.paymentType as PaymentType);
    const dueDate = dto.dueDate ?? existing.dueDate?.toISOString();

    this.assertDueDate(paymentType, dueDate);

    const resolved = dto.items === undefined ? null : await this.resolveItems(dto.items);

    await this.prisma.$transaction(async (tx) => {
      await tx.sale.update({
        where: { id },
        data: {
          ...(dto.customerId !== undefined && { customerId: dto.customerId }),
          ...(dto.saleDate !== undefined && { saleDate: new Date(dto.saleDate) }),
          ...(dto.paymentType !== undefined && { paymentType: dto.paymentType }),
          ...(dto.dueDate !== undefined && { dueDate: new Date(dto.dueDate) }),
          // Peşine dönerse vade tarihi temizlenir; aksi hâlde kayıtta
          // anlamsız bir vade kalır.
          ...(dto.paymentType === 'CASH' && { dueDate: null }),
          ...(dto.note !== undefined && { note: dto.note }),
        },
      });

      if (resolved !== null) {
        await tx.saleItem.deleteMany({ where: { saleId: id } });
        await tx.saleItem.createMany({
          data: resolved.map((item) => ({ ...toItemCreateData(item), saleId: id })),
        });
      }

      await this.calculation.recalculate(tx, id);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { grandTotal: existing.grandTotal.toString() },
        newData: { itemCount: resolved?.length ?? existing.itemCount },
        description: `Satış taslağı güncellendi: ${existing.saleNumber}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOne(id);
  }

  // ==========================================================================
  // DURUM GEÇİŞLERİ
  // ==========================================================================

  /**
   * Satışı onaylar (DRAFT -> CONFIRMED).
   *
   * ============================================================
   * STOK (Sprint 9)
   * ============================================================
   * Onay, stoğu düşen adımdır — taslak satış stoğu bloke ETMEZ. Gerekçe:
   * fiziksel bir mağazada müşteri malı kasada alır; günlerce açık duran bir
   * taslak yüzünden rafta duran malın satılamaz görünmesi gerçeğe aykırıdır.
   *
   * Stok kontrolü ve düşümü `finalizeWithinTransaction()` içindedir;
   * yetersiz stokta transaction geri alınır ve satış DRAFT kalır.
   */
  async finalize(id: string, actor: ActorContext): Promise<unknown> {
    const existing = await this.getExisting(id);

    if (existing.status !== SaleStatus.DRAFT) {
      throw AppException.badRequest('Yalnız taslak satış onaylanabilir.', [
        { field: 'status', message: `Satış hâlihazırda "${existing.status}" durumunda.` },
      ]);
    }

    if (existing.itemCount === 0) {
      throw AppException.badRequest('Kalemsiz satış onaylanamaz.', [
        { field: 'items', message: 'Satışa en az bir kalem eklenmelidir.' },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      await this.finalizeWithinTransaction(tx, id, actor);
    });

    // Kredi limiti aşımı UYARIDIR, engel değil: satışı yapıp yapmama
    // kararı mağaza sahibinin. Aşım yalnız loglanır ve arayüzde
    // müşteri kartında gösterilir.
    const summary = await this.customers.financeSummary(existing.customerId);

    if (summary.isOverLimit) {
      this.logger.warn(
        `Kredi limiti aşıldı: ${existing.saleNumber} — borç ${summary.currentDebt}, limit ${summary.creditLimit}`,
      );
    }

    return this.findOne(id);
  }

  /**
   * Onaylama işleminin transaction içindeki gövdesi.
   *
   * AYRI FONKSİYON: talep→satış dönüşümü de bunu çağırabilsin ve stok adımı
   * TEK YERDE dursun.
   */
  async finalizeWithinTransaction(
    tx: Prisma.TransactionClient,
    saleId: string,
    actor: ActorContext,
  ): Promise<void> {
    // STOK İLK ADIMDIR — bilinçli sıralama.
    //
    // Yetersiz stokta `applyMovements()` fırlatır ve transaction geri
    // alınır; satış DRAFT kalır. Stok en sona bırakılsaydı sonuç aynı
    // olurdu ama hata yolu daha uzun olurdu: satır kilitleri, gereksiz yere
    // durum ve toplam güncellemelerinden sonra alınırdı.
    await this.applySaleStockMovements(tx, saleId, StockMovementType.SALE, actor);

    await tx.sale.update({
      where: { id: saleId },
      data: { status: SaleStatus.CONFIRMED, confirmedAt: new Date() },
    });

    // Durum CONFIRMED olduktan SONRA hesaplanır: `resolveStatus()` taslak
    // satışın durumunu değiştirmez, onaylandıktan sonra ödeme durumuna
    // göre PARTIALLY_PAID/PAID'e taşır.
    await this.calculation.recalculate(tx, saleId);

    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: { saleNumber: true, grandTotal: true, netProfit: true, customerId: true },
    });

    await this.auditLogs.record(tx, {
      userId: actor.id,
      action: AuditAction.UPDATE,
      entityType: ENTITY_TYPE,
      entityId: saleId,
      oldData: { status: SaleStatus.DRAFT },
      newData: {
        status: SaleStatus.CONFIRMED,
        grandTotal: sale.grandTotal.toString(),
        netProfit: sale.netProfit.toString(),
      },
      description: `Satış onaylandı: ${sale.saleNumber} (${sale.grandTotal.toString()})`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  /**
   * Satışı iptal eder.
   *
   * Kural 4: kayıt SİLİNMEZ, iptal durumuna alınır. İptal nedeni
   * zorunludur — altı ay sonra kaydı okuyan kişi neden iptal edildiğini
   * bilmelidir.
   *
   * TAMAMI ÖDENMİŞ satış iptal edilemez: iade akışı bu sprintte yok.
   * Yanlış ödeme önce silinir, sonra satış iptal edilir.
   *
   * STOK (Sprint 9): stok yalnız ONAYLANMIŞ satışta düşmüştür, dolayısıyla
   * yalnız onaylanmış satışın iptalinde geri eklenir. Taslak iptalinde stok
   * hareketi yazılmaz — yazılsaydı hiç düşmemiş stok geri eklenir ve envanter
   * her taslak iptalinde şişerdi.
   */
  async cancel(id: string, dto: CancelSaleDto, actor: ActorContext): Promise<unknown> {
    const existing = await this.getExisting(id);

    if (!canCancelSale(existing.status)) {
      const detail: ApiErrorDetail =
        existing.status === SaleStatus.PAID
          ? {
              field: 'status',
              message: 'Tamamı ödenmiş satış iptal edilemez. Önce ödemeyi silin, sonra iptal edin.',
            }
          : { field: 'status', message: `Satış hâlihazırda "${existing.status}" durumunda.` };

      throw AppException.badRequest('Bu satış iptal edilemez.', [detail]);
    }

    const wasConfirmed = existing.status !== SaleStatus.DRAFT;

    await this.prisma.$transaction(async (tx) => {
      if (wasConfirmed) {
        await this.applySaleStockMovements(tx, id, StockMovementType.SALE_CANCEL, actor);
      }

      await tx.sale.update({
        where: { id },
        data: {
          status: SaleStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: actor.id,
          cancelReason: dto.reason,
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { status: existing.status, grandTotal: existing.grandTotal.toString() },
        newData: { status: SaleStatus.CANCELLED, cancelReason: dto.reason },
        description: `Satış iptal edildi: ${existing.saleNumber} — ${dto.reason}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    this.logger.log(`Satış iptal edildi: ${existing.saleNumber}`);

    return this.findOne(id);
  }

  // ==========================================================================
  // STOK ENTEGRASYONU (Sprint 9)
  // ==========================================================================

  /**
   * Satışın kalemleri için stok hareketi yazar.
   *
   * TEK FONKSİYON, İKİ YÖN: onayda `SALE` (çıkış), iptalde `SALE_CANCEL`
   * (giriş). Aynı kalem listesini iki ayrı yerde okumak, iptalin onayla
   * ASİMETRİK olması riskini doğururdu — geri eklenen miktar düşülenden
   * farklı olsaydı envanter sessizce kayardı.
   *
   * `variantId` null olan kalemler ATLANIR: varyasyon silinmişse geri
   * eklenecek bir stok satırı yoktur. Kalem snapshot'ı yine de durur, satış
   * belgesi eksilmez.
   *
   * MALİYET SNAPSHOT'TAN GELİR, güncel alış fiyatından değil (Ç-03): iptal
   * edilen mal, satıldığı günkü maliyetle stoğa dönmelidir.
   */
  private async applySaleStockMovements(
    tx: Prisma.TransactionClient,
    saleId: string,
    type: 'SALE' | 'SALE_CANCEL',
    actor: ActorContext,
  ): Promise<void> {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      select: {
        saleNumber: true,
        items: {
          orderBy: { sortOrder: 'asc' },
          select: {
            variantId: true,
            quantity: true,
            unitPurchasePrice: true,
            productNameSnapshot: true,
            skuSnapshot: true,
            sortOrder: true,
          },
        },
      },
    });

    const label = type === StockMovementType.SALE ? 'Satış' : 'Satış iptali';

    await this.stock.applyMovements(
      tx,
      sale.items
        .filter((item): item is typeof item & { variantId: string } => item.variantId !== null)
        .map((item, index) => ({
          variantId: item.variantId,
          type,
          quantity: item.quantity,
          unitCost: item.unitPurchasePrice,
          referenceType: 'SALE' as const,
          referenceId: saleId,
          description: `${label}: ${sale.saleNumber} — ${item.productNameSnapshot} (${item.skuSnapshot})`,
          actorId: actor.id,
          // Hata alan bazlı döner: arayüz eksik kalemi satış formunda
          // doğru satırın altında gösterebilsin.
          errorField: `items[${index}].quantity`,
        })),
    );
  }

  // ==========================================================================
  // EK MALİYETLER
  // ==========================================================================

  /**
   * Ek maliyet ekler (nakliye, kargo, komisyon, işçilik).
   *
   * FİNALİZE SONRASINDA DA EKLENEBİLİR (Sprint 8 şartı 6): nakliye
   * faturası satıştan günler sonra gelebilir. `netProfit` aynı
   * transaction içinde yeniden hesaplanır.
   *
   * İptal edilmiş satışa eklenemez: iptal edilmiş bir belgenin maliyeti
   * kâr raporunu bozar.
   */
  async addAdditionalCost(
    saleId: string,
    dto: AddAdditionalCostDto,
    actor: ActorContext,
  ): Promise<unknown> {
    const existing = await this.getExisting(saleId);

    if (existing.status === SaleStatus.CANCELLED) {
      throw AppException.badRequest('İptal edilmiş satışa ek maliyet eklenemez.', [
        { field: 'saleId', message: 'Satış iptal edilmiş.' },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      const cost = await tx.saleAdditionalCost.create({
        data: {
          saleId,
          costType: dto.costType,
          description: dto.description ?? null,
          amount: new Prisma.Decimal(dto.amount),
          createdById: actor.id,
        },
        select: { id: true, amount: true, costType: true },
      });

      await this.calculation.recalculate(tx, saleId);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: 'SaleAdditionalCost',
        entityId: cost.id,
        newData: { saleId, costType: cost.costType, amount: cost.amount.toString() },
        description: `Ek maliyet eklendi: ${existing.saleNumber} — ${dto.costType} ${dto.amount}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOne(saleId);
  }

  /** Ek maliyeti kaldırır ve netProfit'i yeniden hesaplar. */
  async removeAdditionalCost(
    saleId: string,
    costId: string,
    actor: ActorContext,
  ): Promise<unknown> {
    const existing = await this.getExisting(saleId);

    const cost = await this.prisma.saleAdditionalCost.findFirst({
      where: { id: costId, saleId },
      select: { id: true, costType: true, amount: true },
    });

    if (cost === null) {
      throw AppException.notFound('Ek maliyet bulunamadı.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Ek maliyet FİNANSAL KAYIT DEĞİL, bir maliyet kalemidir ve
      // satışın kendisi gibi belge niteliği taşımaz; hard delete edilir.
      // Silinme işlemi audit log'a yazıldığı için iz kaybolmaz.
      await tx.saleAdditionalCost.delete({ where: { id: costId } });

      await this.calculation.recalculate(tx, saleId);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.DELETE,
        entityType: 'SaleAdditionalCost',
        entityId: costId,
        oldData: { saleId, costType: cost.costType, amount: cost.amount.toString() },
        description: `Ek maliyet kaldırıldı: ${existing.saleNumber} — ${cost.costType} ${cost.amount.toString()}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });

    return this.findOne(saleId);
  }

  // ==========================================================================
  // OKUMA
  // ==========================================================================

  async findMany(query: SaleQueryDto): Promise<{ items: unknown[]; meta: unknown }> {
    const where = buildSaleWhere(query);
    const skip = (query.page - 1) * query.limit;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        skip,
        take: query.limit,
        orderBy: { [query.sortBy]: query.sortOrder },
        select: ADMIN_SALE_LIST_SELECT,
      }),
      this.prisma.sale.count({ where }),
    ]);

    return { items, meta: this.queryBuilder.buildMeta(total, query) };
  }

  async findOne(id: string): Promise<unknown> {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      select: ADMIN_SALE_DETAIL_SELECT,
    });

    if (sale === null) {
      throw AppException.notFound('Satış bulunamadı.');
    }

    return sale;
  }

  /** Duruma göre satış sayıları — liste sekmeleri için. */
  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.sale.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  // ==========================================================================
  // YARDIMCILAR
  // ==========================================================================

  /**
   * Kalem girdilerini varyasyon verisiyle birleştirir ve snapshot alanlarını
   * hazırlar.
   *
   * KURAL 5: fiyatlar BURADA, satış anında kopyalanır. Varyasyonun fiyatı
   * sonradan değişse eski satış kalemleri değişmez — bunun testi
   * "snapshot değişmezliği" senaryosudur.
   *
   * Alış fiyatı istemciden ASLA alınmaz: maliyeti dışarıdan gönderilebilir
   * yapmak, kâr rakamını manipüle edilebilir kılardı.
   */
  private async resolveItems(items: SaleItemInputDto[]): Promise<ResolvedSaleItem[]> {
    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: items.map((item) => item.variantId) } },
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
    const resolved: ResolvedSaleItem[] = [];

    for (const [index, item] of items.entries()) {
      const field = (name: string): string => `items[${index}].${name}`;
      const variant = byId.get(item.variantId);

      if (variant === undefined) {
        details.push({ field: field('variantId'), message: 'Ürün varyasyonu bulunamadı.' });
        continue;
      }

      // Pasif/silinmiş varyasyon SATIŞA EKLENEMEZ. Mağazada fiilen
      // satılabilen bir ürünse önce yönetimde aktif edilmelidir.
      if (!variant.isActive || variant.deletedAt !== null || variant.product.deletedAt !== null) {
        details.push({
          field: field('variantId'),
          message: `${variant.product.name}: bu satış birimi artık kullanılamaz.`,
        });
        continue;
      }

      const quantity = toDecimal(item.quantity);

      if (quantity === null || quantity.lessThanOrEqualTo(0)) {
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

      // Satış fiyatı gönderilmediyse varyasyonun O ANKİ fiyatı; gönderildiyse
      // pazarlık fiyatı. Alış fiyatı DAİMA varyasyondan okunur.
      const unitSalePrice =
        item.unitSalePrice === undefined
          ? new Prisma.Decimal(variant.salePrice)
          : toDecimal(item.unitSalePrice);

      if (unitSalePrice === null || unitSalePrice.lessThan(0)) {
        details.push({ field: field('unitSalePrice'), message: 'Fiyat negatif olamaz.' });
        continue;
      }

      const discountAmount =
        item.discountAmount === undefined ? new Prisma.Decimal(0) : toDecimal(item.discountAmount);

      if (discountAmount === null || discountAmount.lessThan(0)) {
        details.push({ field: field('discountAmount'), message: 'İndirim negatif olamaz.' });
        continue;
      }

      const calculated = this.calculation.calculateItem({
        quantity,
        unitSalePrice,
        unitPurchasePrice: new Prisma.Decimal(variant.purchasePrice),
        discountAmount,
        // KDV oranı SATIŞ ANINDA kopyalanır: ürünün oranı sonradan değişse
        // bile geçmiş satış değişmemelidir (SPEC §15.15-16).
        taxRate: new Prisma.Decimal(variant.taxRate),
      });

      // İndirim satır ara toplamını aşamaz: aşarsa satır negatif tutara
      // düşer ve "eksi fiyatlı satış" gibi anlamsız bir kayıt oluşur.
      if (discountAmount.greaterThan(calculated.lineSubtotal)) {
        details.push({
          field: field('discountAmount'),
          message: `İndirim satır tutarını (${calculated.lineSubtotal.toString()}) aşamaz.`,
        });
        continue;
      }

      resolved.push({
        variantId: variant.id,
        productId: variant.product.id,
        productNameSnapshot: variant.product.name,
        variantNameSnapshot: variant.name,
        skuSnapshot: variant.sku,
        unitTypeSnapshot: variant.unitType.name,
        sortOrder: index,
        ...calculated,
      });
    }

    if (details.length > 0) {
      throw AppException.badRequest('Satış kalemleri geçersiz.', details);
    }

    return resolved;
  }

  private async requireActiveCustomer(
    customerId: string,
  ): Promise<{ id: string; code: string; fullName: string }> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, code: true, fullName: true, isActive: true },
    });

    if (customer === null) {
      throw AppException.notFound('Müşteri bulunamadı.');
    }

    if (!customer.isActive) {
      throw AppException.badRequest('Pasif müşteriye satış yapılamaz.', [
        { field: 'customerId', message: `${customer.fullName} pasif durumda.` },
      ]);
    }

    return customer;
  }

  /** Vadeli satışta vade tarihi zorunludur. */
  private assertDueDate(paymentType: PaymentType, dueDate: string | undefined): void {
    if (paymentType === 'CREDIT' && (dueDate === undefined || dueDate === '')) {
      throw AppException.badRequest('Vadeli satışta vade tarihi zorunludur.', [
        { field: 'dueDate', message: 'Vadeli satış için vade tarihi giriniz.' },
      ]);
    }
  }

  /** Satışı getirir; yoksa 404. */
  async getExisting(id: string): Promise<{
    id: string;
    saleNumber: string;
    status: SaleStatus;
    paymentType: string;
    customerId: string;
    grandTotal: Prisma.Decimal;
    dueDate: Date | null;
    itemCount: number;
  }> {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      select: {
        id: true,
        saleNumber: true,
        status: true,
        paymentType: true,
        customerId: true,
        grandTotal: true,
        dueDate: true,
        _count: { select: { items: true } },
      },
    });

    if (sale === null) {
      throw AppException.notFound('Satış bulunamadı.');
    }

    return { ...sale, itemCount: sale._count.items };
  }
}

interface ResolvedSaleItem {
  variantId: string;
  productId: string;
  productNameSnapshot: string;
  variantNameSnapshot: string | null;
  skuSnapshot: string;
  unitTypeSnapshot: string;
  sortOrder: number;
  quantity: Prisma.Decimal;
  unitSalePrice: Prisma.Decimal;
  unitPurchasePrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  lineCost: Prisma.Decimal;
  lineTax: Prisma.Decimal;
  lineProfit: Prisma.Decimal;
}

function toItemCreateData(item: ResolvedSaleItem): Omit<Prisma.SaleItemCreateManyInput, 'saleId'> {
  return {
    productId: item.productId,
    variantId: item.variantId,
    productNameSnapshot: item.productNameSnapshot,
    variantNameSnapshot: item.variantNameSnapshot,
    skuSnapshot: item.skuSnapshot,
    unitTypeSnapshot: item.unitTypeSnapshot,
    quantity: item.quantity,
    unitPurchasePrice: item.unitPurchasePrice,
    unitSalePrice: item.unitSalePrice,
    discountAmount: item.discountAmount,
    // KDV oranı ve ayrışan vergi SNAPSHOT olarak yazılır: ürünün oranı
    // sonradan değişse bile geçmiş satış değişmemelidir (SPEC §15.15-16).
    taxRate: item.taxRate,
    lineSubtotal: item.lineSubtotal,
    lineTotal: item.lineTotal,
    lineCost: item.lineCost,
    lineTax: item.lineTax,
    lineProfit: item.lineProfit,
    sortOrder: item.sortOrder,
  };
}

function buildSaleWhere(query: SaleQueryDto): Prisma.SaleWhereInput {
  const conditions: Prisma.SaleWhereInput[] = [];

  const statuses = (query.status ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is SaleStatus => value in SaleStatus);

  if (statuses.length > 0) {
    conditions.push({ status: { in: statuses } });
  }

  if (query.customerId !== undefined) {
    conditions.push({ customerId: query.customerId });
  }

  if (query.paymentType !== undefined) {
    conditions.push({ paymentType: query.paymentType });
  }

  if (query.overdue === '1') {
    conditions.push({
      dueDate: { lt: new Date() },
      status: { in: [SaleStatus.CONFIRMED, SaleStatus.PARTIALLY_PAID] },
    });
  }

  if (query.dateFrom !== undefined || query.dateTo !== undefined) {
    conditions.push({
      saleDate: {
        ...(query.dateFrom !== undefined && { gte: new Date(query.dateFrom) }),
        ...(query.dateTo !== undefined && { lte: new Date(query.dateTo) }),
      },
    });
  }

  if (query.search !== undefined && query.search !== '') {
    const term = query.search.trim();

    conditions.push({
      OR: [
        { saleNumber: { contains: term, mode: 'insensitive' } },
        { customer: { fullName: { contains: term, mode: 'insensitive' } } },
        { customer: { code: { contains: term, mode: 'insensitive' } } },
        { customer: { phone: { contains: term.replace(/\D/g, '') } } },
      ],
    });
  }

  return conditions.length === 0 ? {} : { AND: conditions };
}

function toDecimal(value: Prisma.Decimal | string): Prisma.Decimal | null {
  try {
    return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    return null;
  }
}
