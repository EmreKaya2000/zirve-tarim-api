import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, StockMovementType, type ProductVariant } from '@prisma/client';
import { ERROR_CODES } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ProductPricingService } from '../products/product-pricing.service';
import { StockService } from '../stock/stock.service';
import type { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';

const ENTITY_TYPE = 'ProductVariant';

/** Varyasyona ait sayısal alanların çözümlenmiş hâli. */
interface ResolvedNumbers {
  unitQuantity: Prisma.Decimal;
  purchasePrice: Prisma.Decimal;
  salePrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  minOrderQuantity: Prisma.Decimal;
  quantityStep: Prisma.Decimal;
  maxOrderQuantity: Prisma.Decimal | null;
  stockQuantity: Prisma.Decimal;
  lowStockThreshold: Prisma.Decimal;
}

@Injectable()
export class ProductVariantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly pricing: ProductPricingService,
    private readonly stock: StockService,
  ) {}

  async findMany(productId: string): Promise<ProductVariant[]> {
    await this.assertProductExists(productId);

    return this.prisma.productVariant.findMany({
      where: { productId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
      include: { unitType: { select: { id: true, name: true, code: true, allowsDecimal: true } } },
    });
  }

  async create(
    productId: string,
    dto: CreateVariantDto,
    actor: ActorContext,
  ): Promise<ProductVariant> {
    await this.assertProductExists(productId);

    return this.prisma.$transaction((tx) => this.createInTransaction(tx, productId, dto, actor));
  }

  /**
   * Varyasyonu VERİLEN transaction içinde oluşturur.
   *
   * NEDEN AYRI BİR GİRİŞ NOKTASI VAR: ürün oluşturma, varyasyonları ürünle
   * aynı transaction'da yazar (`ProductsService.create`). Kendi transaction'ını
   * açan `create()` oradan çağrılamaz — iç içe `$transaction` çağrısı dış
   * transaction'ın atomikliğini bozar ve varyasyon başarısız olsa bile ürün
   * kaydedilmiş kalırdı.
   *
   * DOĞRULAMALAR DA `tx` ÜZERİNDEN YAPILIR. Bu ayrıntı önemli: aynı istekte
   * gelen iki varyasyon aynı SKU'yu taşıyorsa, kontrol dış bağlantıdan
   * (`this.prisma`) yapılsa henüz commit edilmemiş ilk kaydı GÖRMEZ ve
   * çakışma yalnız veritabanı kısıtından ham bir hata olarak dönerdi.
   */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    productId: string,
    dto: CreateVariantDto,
    actor: ActorContext,
  ): Promise<ProductVariant> {
    await this.assertSkuAvailable(dto.sku, tx);

    const unitType = await this.getUnitType(dto.unitTypeId, tx);
    const numbers = resolveNumbers(dto);

    this.assertQuantityRules(numbers, unitType.allowsDecimal, unitType.name);

    // Varsayılan işaretlendiyse diğerlerinin işareti kaldırılır.
    // Kısmi unique index bunu DB'de de garanti eder; buradaki temizlik
    // kullanıcıya hata göstermek yerine beklenen davranışı üretmek içindir.
    if (dto.isDefault === true) {
      await tx.productVariant.updateMany({
        where: { productId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await tx.productVariant.create({
      data: {
        productId,
        unitTypeId: dto.unitTypeId,
        sku: dto.sku,
        name: dto.name ?? buildVariantName(numbers.unitQuantity, unitType.code),
        ...numbers,
        // Varyasyon DAİMA SIFIR stokla doğar; başlangıç stoğu hemen
        // ardından bir INITIAL hareketiyle eklenir (aşağıda). Alan
        // doğrudan yazılsaydı sistemdeki ilk stok, geçmişte karşılığı
        // olmayan tek miktar olurdu (Sprint 9 şartı 2).
        stockQuantity: 0,
        trackStock: dto.trackStock ?? true,
        isDefault: dto.isDefault ?? (await isFirstVariant(tx, productId)),
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    if (numbers.stockQuantity.greaterThan(0)) {
      await this.stock.applyMovement(tx, {
        variantId: created.id,
        type: StockMovementType.INITIAL,
        quantity: numbers.stockQuantity,
        unitCost: numbers.purchasePrice,
        description: `Açılış stoğu: ${created.sku}`,
        actorId: actor.id,
        errorField: 'stockQuantity',
      });
    }

    await this.pricing.recalculate(tx, productId);

    await this.auditLogs.record(tx, {
      userId: actor.id,
      action: AuditAction.CREATE,
      entityType: ENTITY_TYPE,
      entityId: created.id,
      newData: {
        sku: created.sku,
        salePrice: created.salePrice.toString(),
        initialStock: numbers.stockQuantity.toString(),
      },
      description: `Varyasyon eklendi: ${created.sku}`,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    // Yeniden okunur: `created` INITIAL hareketinden ÖNCEKİ hâli taşır,
    // yani stoğu 0 görünür. İstemciye eski değeri döndürmek, forma
    // "stok kaydedilmedi" izlenimi verirdi.
    return tx.productVariant.findUniqueOrThrow({ where: { id: created.id } });
  }

  async update(
    productId: string,
    variantId: string,
    dto: UpdateVariantDto,
    actor: ActorContext,
  ): Promise<ProductVariant> {
    const existing = await this.getExisting(productId, variantId);

    // K-56: stok bu uçtan DEĞİŞTİRİLEMEZ.
    //
    // Sessizce yok saymak yerine reddediliyor: kullanıcı stok yazdığını
    // sanıp kaydetseydi, formu kapattığında değişikliğin uygulanmadığını
    // fark etmezdi. Hata, doğru akışın adresini de veriyor.
    if (dto.stockQuantity !== undefined) {
      throw AppException.badRequest('Stok bu ekrandan doğrudan değiştirilemez.', [
        {
          field: 'stockQuantity',
          message:
            'Stok yalnız stok hareketiyle değişir. "Stok" ekranından stok düzeltmesi yapınız.',
        },
      ]);
    }

    // Son aktif varyasyon PASİFE ALINAMAZ (SPEC §15.3) — bkz. `assertNotLastActive`.
    if (dto.isActive === false && existing.isActive) {
      await this.assertNotLastActive(productId, variantId, 'isActive');
    }

    if (dto.sku !== undefined && dto.sku !== existing.sku) {
      await this.assertSkuAvailable(dto.sku);
    }

    const unitTypeId = dto.unitTypeId ?? existing.unitTypeId;
    const unitType = await this.getUnitType(unitTypeId);

    // Doğrulama, mevcut değerlerle GÜNCELLENMİŞ değerlerin birleşimi üzerinde
    // yapılır: yalnız `quantityStep` gönderildiğinde de kural bütün olarak
    // kontrol edilmelidir.
    const numbers = resolveNumbers({
      unitQuantity: dto.unitQuantity ?? existing.unitQuantity.toString(),
      purchasePrice: dto.purchasePrice ?? existing.purchasePrice.toString(),
      salePrice: dto.salePrice ?? existing.salePrice.toString(),
      taxRate: dto.taxRate ?? existing.taxRate.toString(),
      minOrderQuantity: dto.minOrderQuantity ?? existing.minOrderQuantity.toString(),
      quantityStep: dto.quantityStep ?? existing.quantityStep.toString(),
      maxOrderQuantity: dto.maxOrderQuantity ?? existing.maxOrderQuantity?.toString(),
      // Doğrulama için okunur (ör. "adet biriminde ondalık stok olamaz"),
      // güncellemeye YAZILMAZ — aşağıdaki `writableNumbers` onu ayıklar.
      stockQuantity: existing.stockQuantity.toString(),
      lowStockThreshold: dto.lowStockThreshold ?? existing.lowStockThreshold.toString(),
    });

    this.assertQuantityRules(numbers, unitType.allowsDecimal, unitType.name);

    // K-56'nın kod seviyesindeki güvencesi: `stockQuantity` UPDATE gövdesine
    // HİÇ girmez. Mevcut değerle yazmak "zararsız" görünür ama değildir —
    // eşzamanlı bir satış araya girdiğinde okunan eski değer güncel stoğu
    // ezerdi ve kayıp, hiçbir hareket kaydı bırakmazdı.
    const { stockQuantity: _ignoredStock, ...writableNumbers } = numbers;

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.productVariant.updateMany({
          where: { productId, isDefault: true, id: { not: variantId } },
          data: { isDefault: false },
        });
      }

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.sku !== undefined && { sku: dto.sku }),
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.unitTypeId !== undefined && { unitTypeId: dto.unitTypeId }),
          ...writableNumbers,
          ...(dto.trackStock !== undefined && { trackStock: dto.trackStock }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
          ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
        },
      });

      await this.pricing.recalculate(tx, productId);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: variantId,
        oldData: { sku: existing.sku, salePrice: existing.salePrice.toString() },
        newData: { sku: updated.sku, salePrice: updated.salePrice.toString() },
        description: `Varyasyon güncellendi: ${updated.sku}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /** Soft delete. Geçmiş satış satırları varyasyona referans verebilir. */
  async remove(productId: string, variantId: string, actor: ActorContext): Promise<void> {
    const existing = await this.getExisting(productId, variantId);

    // Son aktif varyasyon SİLİNEMEZ (SPEC §15.3) — bkz. `assertNotLastActive`.
    if (existing.isActive) {
      await this.assertNotLastActive(productId, variantId, 'variantId');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { deletedAt: new Date(), isActive: false, isDefault: false },
      });

      await this.pricing.recalculate(tx, productId);

      /*
       * Varsayılan varyasyon silindiyse sıradaki devralır.
       *
       * Ürün kartı varsayılan varyasyonun fiyatını gösterir; varsayılansız ürün
       * kartsız kalırdı. Eskiden bu boşluk fark edilmiyordu çünkü son aktif
       * varyasyon da silinebildiği için ürün zaten yayından düşüyordu. Artık
       * en az bir aktif varyasyonun kaldığı GARANTİ, dolayısıyla devralacak
       * bir aday da her zaman var.
       */
      if (existing.isDefault) {
        const next = await tx.productVariant.findFirst({
          where: { productId, isActive: true, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        });

        if (next !== null) {
          await tx.productVariant.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: ENTITY_TYPE,
        entityId: variantId,
        oldData: { sku: existing.sku },
        description: `Varyasyon silindi: ${existing.sku}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  // ==========================================================================
  // İŞ KURALLARI
  // ==========================================================================

  /**
   * Miktar kuralları (SPEC §15).
   *
   * En kritik kural `allowsDecimal`: "2,5 kg" geçerli bir miktardır ama
   * "2,5 adet" değildir. Bu kontrol olmadan sistem yarım çuval satabilir.
   */
  private assertQuantityRules(
    numbers: ResolvedNumbers,
    allowsDecimal: boolean,
    unitName: string,
  ): void {
    const errors: { field: string; message: string }[] = [];

    if (numbers.purchasePrice.lessThan(0)) {
      errors.push({ field: 'purchasePrice', message: 'Alış fiyatı negatif olamaz.' });
    }

    if (numbers.salePrice.lessThan(0)) {
      errors.push({ field: 'salePrice', message: 'Satış fiyatı negatif olamaz.' });
    }

    if (numbers.unitQuantity.lessThanOrEqualTo(0)) {
      errors.push({ field: 'unitQuantity', message: 'Ambalaj miktarı 0’dan büyük olmalıdır.' });
    }

    if (numbers.minOrderQuantity.lessThanOrEqualTo(0)) {
      errors.push({ field: 'minOrderQuantity', message: 'En az miktar 0’dan büyük olmalıdır.' });
    }

    if (numbers.quantityStep.lessThanOrEqualTo(0)) {
      errors.push({ field: 'quantityStep', message: 'Miktar adımı 0’dan büyük olmalıdır.' });
    }

    if (
      numbers.maxOrderQuantity !== null &&
      numbers.maxOrderQuantity.lessThan(numbers.minOrderQuantity)
    ) {
      errors.push({
        field: 'maxOrderQuantity',
        message: 'En fazla miktar, en az miktardan küçük olamaz.',
      });
    }

    if (numbers.stockQuantity.lessThan(0)) {
      errors.push({ field: 'stockQuantity', message: 'Stok negatif olamaz.' });
    }

    // --- allowsDecimal ---
    if (!allowsDecimal) {
      const decimalFields: { field: keyof ResolvedNumbers; label: string }[] = [
        { field: 'unitQuantity', label: 'Ambalaj miktarı' },
        { field: 'minOrderQuantity', label: 'En az miktar' },
        { field: 'quantityStep', label: 'Miktar adımı' },
        { field: 'maxOrderQuantity', label: 'En fazla miktar' },
        { field: 'stockQuantity', label: 'Stok' },
      ];

      for (const { field, label } of decimalFields) {
        const value = numbers[field];

        if (value !== null && !value.isInteger()) {
          errors.push({
            field,
            message: `${label} ondalıklı olamaz: "${unitName}" birimi tam sayı gerektirir.`,
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Varyasyon değerleri geçerli değil.',
        422,
        errors,
      );
    }
  }

  private async assertProductExists(productId: string): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });

    if (product === null) {
      throw AppException.notFound('Ürün bulunamadı.');
    }
  }

  private async getExisting(productId: string, variantId: string): Promise<ProductVariant> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId, deletedAt: null },
    });

    if (variant === null) {
      throw AppException.notFound('Varyasyon bulunamadı.');
    }

    return variant;
  }

  /**
   * SKU tüm ürünler arasında benzersizdir (SPEC §15.24).
   *
   * `client` parametresi devam eden bir transaction'ı görebilmek içindir:
   * aynı istekte gelen ikinci varyasyon, henüz commit edilmemiş ilkiyle
   * çakışıyorsa bunu görmelidir.
   */
  private async assertSkuAvailable(
    sku: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const existing = await client.productVariant.findFirst({
      where: { sku },
      select: { id: true },
    });

    if (existing !== null) {
      throw new AppException(ERROR_CODES.CONFLICT, `Bu SKU zaten kullanılıyor: ${sku}`, 409, [
        { field: 'sku', message: 'Bu stok kodu başka bir varyasyonda kullanılıyor.' },
      ]);
    }
  }

  private async getUnitType(unitTypeId: string, client: Prisma.TransactionClient = this.prisma) {
    const unitType = await client.unitType.findFirst({
      where: { id: unitTypeId, deletedAt: null },
      select: { id: true, name: true, code: true, allowsDecimal: true },
    });

    if (unitType === null) {
      throw new AppException(ERROR_CODES.NOT_FOUND, 'Birim bulunamadı.', 404, [
        { field: 'unitTypeId', message: 'Geçersiz birim.' },
      ]);
    }

    return unitType;
  }

  /**
   * Ürünün son aktif varyasyonunu koruyan muhafız (SPEC §15.3).
   *
   * "Ürünün en az bir aktif varyasyonu olmalıdır" bir DEĞİŞMEZDİR. Fiyat, stok
   * ve SKU varyasyon düzeyinde tutulduğu için aktif varyasyonu olmayan ürün
   * satılamaz; katalogda duran ama alınamayan bir kayıt olur.
   *
   * ÖNCEKİ DAVRANIŞ: son aktif varyasyon silinebiliyordu, ürün yalnızca
   * yayından kaldırılıyordu (`unpublishIfNoActiveVariant`). Sonuç, sessizce
   * birikebilen satılamaz ürünlerdi. Kural artık kaynağında engelliyor.
   *
   * DOĞRU YÖNLENDİRME ÖNEMLİ: yönetici gerçekten ürünü satıştan çekmek
   * istiyorsa yapması gereken şey varyasyonu değil ÜRÜNÜ pasife almak ya da
   * silmektir. Hata mesajı bu yüzden alternatifi söylüyor.
   *
   * Zaten pasif olan varyasyon bu muhafızdan geçmez (çağıranlar `isActive`
   * kontrolü yapıyor): eski verideki aktif varyasyonu olmayan ürünlerde
   * yönetici kilitlenmez, pasif varyasyonları hâlâ silebilir.
   */
  private async assertNotLastActive(
    productId: string,
    variantId: string,
    field: 'isActive' | 'variantId',
  ): Promise<void> {
    const otherActiveCount = await this.prisma.productVariant.count({
      where: { productId, isActive: true, deletedAt: null, id: { not: variantId } },
    });

    if (otherActiveCount === 0) {
      throw new AppException(
        ERROR_CODES.UNPROCESSABLE,
        'Ürünün son aktif varyasyonu kaldırılamaz.',
        422,
        [
          {
            field,
            message:
              'Her ürünün en az bir aktif varyasyonu olmalıdır. Ürünü satıştan çekmek için ' +
              'önce başka bir varyasyon ekleyin ya da ürünün kendisini pasife alın.',
          },
        ],
      );
    }
  }
}

/** String alanları Decimal'e çevirir (Kural 2: float'a uğratılmaz). */
function resolveNumbers(dto: {
  unitQuantity?: string;
  purchasePrice?: string;
  salePrice?: string;
  taxRate?: string;
  minOrderQuantity?: string;
  quantityStep?: string;
  maxOrderQuantity?: string;
  stockQuantity?: string;
  lowStockThreshold?: string;
}): ResolvedNumbers {
  return {
    unitQuantity: new Prisma.Decimal(dto.unitQuantity ?? '1'),
    purchasePrice: new Prisma.Decimal(dto.purchasePrice ?? '0'),
    salePrice: new Prisma.Decimal(dto.salePrice ?? '0'),
    taxRate: new Prisma.Decimal(dto.taxRate ?? '0'),
    minOrderQuantity: new Prisma.Decimal(dto.minOrderQuantity ?? '1'),
    quantityStep: new Prisma.Decimal(dto.quantityStep ?? '1'),
    maxOrderQuantity:
      dto.maxOrderQuantity === undefined || dto.maxOrderQuantity === ''
        ? null
        : new Prisma.Decimal(dto.maxOrderQuantity),
    stockQuantity: new Prisma.Decimal(dto.stockQuantity ?? '0'),
    lowStockThreshold: new Prisma.Decimal(dto.lowStockThreshold ?? '0'),
  };
}

/** Ad verilmediyse birim ve miktardan üretir. Örn. "5 kg". */
function buildVariantName(unitQuantity: Prisma.Decimal, unitCode: string): string {
  // Gereksiz sıfırlar atılır: "5.000" -> "5"
  const quantity = unitQuantity
    .toDecimalPlaces(3)
    .toString()
    .replace(/\.?0+$/, '');

  return `${quantity} ${unitCode}`;
}

/** Ürünün ilk varyasyonu mu? İlk varyasyon otomatik varsayılan olur. */
async function isFirstVariant(tx: Prisma.TransactionClient, productId: string): Promise<boolean> {
  const count = await tx.productVariant.count({ where: { productId, deletedAt: null } });

  return count === 0;
}
