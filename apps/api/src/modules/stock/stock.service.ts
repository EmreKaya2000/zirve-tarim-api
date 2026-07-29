import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma, StockMovementDirection, StockMovementType } from '@prisma/client';
import {
  ERROR_CODES,
  STOCK_MOVEMENT_DIRECTION_BY_TYPE,
  STOCK_MOVEMENT_TYPE_LABELS,
  requiresSuperAdminForStockType,
  type ApiErrorDetail,
  type StockReferenceType,
  type UserRole,
} from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

import { ADMIN_STOCK_MOVEMENT_SELECT } from './stock.select';
import type { CreateStockAdjustmentDto } from './dto/stock.dto';

/** `applyMovement` girdisi. */
export interface StockMovementInput {
  variantId: string;
  type: StockMovementType;

  /**
   * Kullanıcının/çağıranın girdiği POZİTİF miktar.
   *
   * DİKKAT — tek istisna `INVENTORY_ADJUSTMENT`: orada bu alan bir DEĞİŞİM
   * değil, SAYILAN FİZİKSEL STOKTUR. Yön ve fark kayıtlı stokla
   * karşılaştırılarak hesaplanır. Gerekçe: sayımı yapan kişi "12 çuval
   * saydım" bilir, "3 eksik" bilmez; farkı ona hesaplatmak hata kaynağıdır.
   */
  quantity: Prisma.Decimal;

  /** Elle girilen hareketlerde ZORUNLU (çağıran doğrular). */
  description?: string | null;

  referenceType?: StockReferenceType | null;
  referenceId?: string | null;

  /** Hareket anındaki birim maliyet snapshot'ı. */
  unitCost?: Prisma.Decimal | null;

  /** İşlemi tetikleyen kullanıcı. */
  actorId?: string | null;

  /**
   * Hata mesajlarında kullanılacak alan yolu. Örn. `items[2].quantity`.
   * Verilmezse `variantId` kullanılır.
   */
  errorField?: string;
}

/** Yazılan hareketin özeti. */
export interface StockMovementResult {
  id: string;
  variantId: string;
  type: StockMovementType;
  direction: StockMovementDirection;
  quantity: Prisma.Decimal;
  previousStock: Prisma.Decimal;
  newStock: Prisma.Decimal;
}

/** Kilitlenmiş varyasyon satırı. */
interface LockedVariant {
  id: string;
  productId: string;
  sku: string;
  variantName: string | null;
  productName: string;
  stockQuantity: Prisma.Decimal;
  trackStock: boolean;
}

/** Ham SQL'in döndürdüğü satır — sayısal alanlar metin olarak gelir. */
interface LockedVariantRow {
  id: string;
  productId: string;
  sku: string;
  variantName: string | null;
  productName: string;
  stockQuantity: string;
  trackStock: boolean;
}

/** Bir hareketin hesaplanmış yönü ve mutlak miktarı. */
interface ResolvedDelta {
  direction: StockMovementDirection;
  quantity: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

const ENTITY_TYPE = 'StockMovement';

/**
 * Stok servisi — `product_variants.stockQuantity`'nin TEK YAZICISI.
 *
 * ============================================================
 * DEĞİŞMEZ KURAL (K-55, K-56 / Sprint 9 şartı 2)
 * ============================================================
 * Stok, `stockQuantity` doğrudan UPDATE edilerek ASLA değiştirilmez.
 * Her değişim `applyMovement()` üzerinden geçer ve bir `stock_movements`
 * satırı üretir. Bu kuralın kod dışındaki güvenceleri:
 *
 *   - `chk_stock_movements_chain_consistent` — zincir kırılırsa INSERT düşer
 *   - `stock_movements_no_update/no_delete` RULE — geçmiş yeniden yazılamaz
 *   - `chk_product_variants_stock_not_negative` — negatif stok DB'de yasak
 *
 * Bu üçü olmadan "stok yalnız hareketle değişir" bir temenni olurdu;
 * bunlarla birlikte doğrulanabilir bir kısıt olur.
 *
 * ============================================================
 * EŞZAMANLILIK (K-66 / Sprint 9 test şartı)
 * ============================================================
 * `applyMovements()` işlem yapacağı varyasyon satırlarını `SELECT ... FOR
 * UPDATE` ile ve DAİMA ID SIRASINDA kilitler. İki güvence sağlar:
 *
 *   1. Aşırı satış olamaz — "önce oku sonra yaz" penceresi kapanır; ikinci
 *      transaction birincinin COMMIT'ini bekler ve GÜNCEL stoğu görür.
 *   2. Kilitleme sırası sabit olduğu için iki satış aynı iki varyasyonu ters
 *      sırada kilitleyip birbirini bekleyemez (deadlock).
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /**
   * Tek bir stok hareketi uygular.
   *
   * DAİMA bir transaction içinde çağrılır: hareketi doğuran işlem (satış
   * onayı, iptal, varyasyon oluşturma) geri alınırsa stok da geri alınmalıdır.
   *
   * @returns Yazılan hareket; `trackStock = false` ise `null`.
   */
  async applyMovement(
    tx: Prisma.TransactionClient,
    input: StockMovementInput,
  ): Promise<StockMovementResult | null> {
    const [result] = await this.applyMovements(tx, [input]);

    return result ?? null;
  }

  /**
   * Birden çok hareketi TEK transaction içinde uygular.
   *
   * Satış onayı/iptali bunu kullanır: kalemler tek tek işlenirse üçüncü
   * kalemde yetersiz stok çıktığında ilk ikisi çoktan düşmüş olur ve hata
   * mesajı yalnız ilk eksik kalemi gösterir. Toplu işlemde EKSİK KALEMLERİN
   * TAMAMI tek yanıtta listelenir (Sprint 9 şartı 3).
   *
   * @returns Yazılan hareketler. `trackStock = false` varyasyonlar atlanır,
   *          dolayısıyla dizi girdiden kısa olabilir.
   */
  async applyMovements(
    tx: Prisma.TransactionClient,
    inputs: StockMovementInput[],
  ): Promise<StockMovementResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    const merged = mergeByVariant(inputs);
    const locked = await this.lockVariants(
      tx,
      merged.map((input) => input.variantId),
    );

    const shortages: ApiErrorDetail[] = [];
    const results: StockMovementResult[] = [];

    // TEK GEÇİŞ — kontrol ve yazma iç içe.
    //
    // "Önce hepsini kontrol et, sonra hepsini yaz" daha temiz görünürdü ama
    // yanlış olurdu: aynı varyasyona iki hareket uygulandığında ikinci
    // hareketin kontrolü, birincinin etkisini görmeyen ESKİ stoğa bakardı.
    // Burada `writeMovement` bellekteki stoğu ilerlettiği için sonraki
    // kontroller güncel değeri görür.
    //
    // Eksik kalem çıktığında yazılmış hareketler kaybolmaz mı? Kaybolur —
    // ve olması gereken de budur: fonksiyon daima bir transaction içinde
    // çağrılır, `throw` tümünü geri alır. Karşılığında eksik kalemlerin
    // TAMAMINI tek yanıtta listeleyebiliyoruz.
    for (const input of merged) {
      const variant = locked.get(input.variantId);

      if (variant === undefined) {
        throw AppException.notFound('Ürün varyasyonu bulunamadı.', [
          { field: input.errorField ?? 'variantId', message: 'Varyasyon bulunamadı.' },
        ]);
      }

      // K-64: stok takibi kapalı varyasyonda (hizmet, montaj vb.) sayılacak
      // bir fiziksel miktar yoktur. Hareket de YAZILMAZ: previousStock ile
      // newStock'un eşit olduğu bir satır, zincir tutarlılık kısıtını ihlal
      // eder ve geçmişte anlamsız bir iz bırakırdı.
      if (!variant.trackStock) {
        continue;
      }

      const delta = this.resolveDelta(input, variant);
      const newStock =
        delta.direction === StockMovementDirection.IN
          ? variant.stockQuantity.plus(delta.quantity)
          : variant.stockQuantity.minus(delta.quantity);

      // §13.4: negatif stok yasak. Fiziksel bir mağazada ürün rafta ya
      // vardır ya yoktur; negatif stok maliyet ve kâr hesabını da bozar.
      if (newStock.lessThan(ZERO)) {
        shortages.push(buildShortageDetail(input, variant, delta.quantity));
        continue;
      }

      results.push(await this.writeMovement(tx, input, variant, delta));
    }

    if (shortages.length > 0) {
      throw AppException.unprocessable(
        ERROR_CODES.INSUFFICIENT_STOCK,
        shortages.length === 1
          ? 'Stok yetersiz: bir kalem için mevcut stok yeterli değil.'
          : `Stok yetersiz: ${shortages.length} kalem için mevcut stok yeterli değil.`,
        shortages,
      );
    }

    return results;
  }

  // ==========================================================================
  // ELLE STOK DÜZELTME
  // ==========================================================================

  /**
   * `POST /admin/stock/adjustment` gövdesi.
   *
   * Kendi transaction'ını açar: düzeltme, hareketi doğuran başka bir belgeye
   * bağlı olmayan tek stok işlemidir. `referenceType`/`referenceId` bu yüzden
   * boştur; hareketin tek gerekçesi kullanıcının yazdığı açıklamadır.
   */
  async adjust(
    dto: CreateStockAdjustmentDto,
    role: UserRole,
    actor: ActorContext,
  ): Promise<unknown> {
    // Fire, hasar ve sayım düzeltmesi stoğu BELGESİZ değiştirir; envanter
    // farkını gizlemenin en kolay yolu budur. Yetki bu yüzden daraltılır.
    if (requiresSuperAdminForStockType(dto.type) && role !== 'SUPER_ADMIN') {
      throw AppException.forbidden(
        `"${STOCK_MOVEMENT_TYPE_LABELS[dto.type]}" hareketini yalnız süper yönetici girebilir.`,
      );
    }

    const quantity = toDecimal(dto.quantity);

    if (quantity === null) {
      throw AppException.badRequest('Miktar geçerli bir sayı değil.', [
        { field: 'quantity', message: 'Miktar sayısal olmalıdır.' },
      ]);
    }

    const unitCost = dto.unitCost === undefined ? null : toDecimal(dto.unitCost);

    if (dto.unitCost !== undefined && (unitCost === null || unitCost.lessThan(ZERO))) {
      throw AppException.badRequest('Birim maliyet geçersiz.', [
        { field: 'unitCost', message: 'Birim maliyet 0 veya daha büyük olmalıdır.' },
      ]);
    }

    await this.assertAdjustableVariant(dto.variantId);

    const movementId = await this.prisma.$transaction(async (tx) => {
      const movement = await this.applyMovement(tx, {
        variantId: dto.variantId,
        type: dto.type,
        quantity,
        description: dto.description,
        unitCost,
        actorId: actor.id,
        errorField: 'quantity',
      });

      if (movement === null) {
        throw AppException.badRequest('Bu varyasyonda stok takibi kapalı.', [
          {
            field: 'variantId',
            message: 'Stok düzeltmesi için önce varyasyonda stok takibini açın.',
          },
        ]);
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.STOCK_ADJUST,
        entityType: ENTITY_TYPE,
        entityId: movement.id,
        oldData: { stockQuantity: movement.previousStock.toString() },
        newData: {
          type: movement.type,
          direction: movement.direction,
          quantity: movement.quantity.toString(),
          stockQuantity: movement.newStock.toString(),
        },
        description:
          `Stok düzeltmesi (${STOCK_MOVEMENT_TYPE_LABELS[movement.type]}): ` +
          `${movement.previousStock.toString()} -> ${movement.newStock.toString()} — ${dto.description}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return movement.id;
    });

    return this.prisma.stockMovement.findUniqueOrThrow({
      where: { id: movementId },
      select: ADMIN_STOCK_MOVEMENT_SELECT,
    });
  }

  /** Düzeltme yapılabilecek bir varyasyon mu? Silinmiş varyasyona hareket yazılmaz. */
  private async assertAdjustableVariant(variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null, product: { deletedAt: null } },
      select: { id: true },
    });

    if (variant === null) {
      throw AppException.notFound('Ürün varyasyonu bulunamadı.', [
        { field: 'variantId', message: 'Varyasyon bulunamadı veya silinmiş.' },
      ]);
    }
  }

  // ==========================================================================
  // İÇ ADIMLAR
  // ==========================================================================

  /**
   * Varyasyon satırlarını ID SIRASINDA kilitler (`SELECT ... FOR UPDATE`).
   *
   * Prisma'nın sorgu API'si satır kilidi ifade edemediği için ham SQL
   * kullanılır. `FOR UPDATE OF v` yalnız varyasyon satırını kilitler;
   * `products` yalnız ad için okunur ve kilitlenmez — aynı ürünün farklı
   * varyasyonlarını satan iki satış birbirini beklememelidir.
   *
   * Sayısal alanlar `::text` ile çekilir: değer float'a uğramadan Decimal'e
   * dönüşsün (Kural 2).
   */
  private async lockVariants(
    tx: Prisma.TransactionClient,
    variantIds: string[],
  ): Promise<Map<string, LockedVariant>> {
    const ids = [...new Set(variantIds)].sort();

    const rows = await tx.$queryRaw<LockedVariantRow[]>(Prisma.sql`
      SELECT v."id",
             v."productId",
             v."sku",
             v."name"                  AS "variantName",
             p."name"                  AS "productName",
             v."stockQuantity"::text   AS "stockQuantity",
             v."trackStock"
        FROM "product_variants" v
        JOIN "products" p ON p."id" = v."productId"
       WHERE v."id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
       ORDER BY v."id"
         FOR UPDATE OF v
    `);

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          productId: row.productId,
          sku: row.sku,
          variantName: row.variantName,
          productName: row.productName,
          stockQuantity: new Prisma.Decimal(row.stockQuantity),
          trackStock: row.trackStock,
        },
      ]),
    );
  }

  /**
   * Hareketin yönünü ve mutlak miktarını belirler.
   *
   * `INVENTORY_ADJUSTMENT` dışındaki tiplerin yönü sabittir ve
   * `STOCK_MOVEMENT_DIRECTION_BY_TYPE` tablosundan okunur — yön, tipe bakan
   * bir `if` zincirinden değil tek bir tablodan gelir ki backend ile arayüz
   * ayrışamasın.
   */
  private resolveDelta(input: StockMovementInput, variant: LockedVariant): ResolvedDelta {
    const field = input.errorField ?? 'quantity';

    if (input.type === StockMovementType.INVENTORY_ADJUSTMENT) {
      const counted = input.quantity;

      if (counted.lessThan(ZERO)) {
        throw AppException.badRequest('Sayılan miktar negatif olamaz.', [
          { field, message: 'Sayım sonucu 0 veya daha büyük olmalıdır.' },
        ]);
      }

      const difference = counted.minus(variant.stockQuantity);

      // Fark yoksa yazılacak bir hareket de yoktur. Sıfır miktarlı satır
      // kısıtla zaten reddedilir; hatayı kullanıcıya anlaşılır dille vermek
      // "constraint violation" görmesinden iyidir.
      if (difference.isZero()) {
        throw AppException.badRequest('Sayım sonucu kayıtlı stokla aynı; düzeltme gerekmiyor.', [
          {
            field,
            message: `${variant.sku} için kayıtlı stok zaten ${variant.stockQuantity.toString()}.`,
          },
        ]);
      }

      return difference.greaterThan(ZERO)
        ? { direction: StockMovementDirection.IN, quantity: difference }
        : { direction: StockMovementDirection.OUT, quantity: difference.abs() };
    }

    if (input.quantity.lessThanOrEqualTo(ZERO)) {
      throw AppException.badRequest('Hareket miktarı sıfırdan büyük olmalıdır.', [
        { field, message: 'Miktar sıfırdan büyük olmalıdır.' },
      ]);
    }

    const direction = STOCK_MOVEMENT_DIRECTION_BY_TYPE[input.type];

    /* c8 ignore next 3 -- yalnız enum'a yönsüz yeni tip eklenirse ulaşılır */
    if (direction === null) {
      throw new Error(`Yönü tanımsız stok hareketi tipi: ${input.type}`);
    }

    return { direction, quantity: input.quantity };
  }

  /** Stoğu günceller ve hareketi yazar. Satır zaten kilitlidir. */
  private async writeMovement(
    tx: Prisma.TransactionClient,
    input: StockMovementInput,
    variant: LockedVariant,
    delta: ResolvedDelta,
  ): Promise<StockMovementResult> {
    const previousStock = variant.stockQuantity;
    const newStock =
      delta.direction === StockMovementDirection.IN
        ? previousStock.plus(delta.quantity)
        : previousStock.minus(delta.quantity);

    await tx.productVariant.update({
      where: { id: variant.id },
      data: { stockQuantity: newStock },
    });

    const movement = await tx.stockMovement.create({
      data: {
        variantId: variant.id,
        productId: variant.productId,
        type: input.type,
        direction: delta.direction,
        quantity: delta.quantity,
        previousStock,
        newStock,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        description: input.description ?? null,
        unitCost: input.unitCost ?? null,
        createdById: input.actorId ?? null,
      },
      select: { id: true },
    });

    // Aynı transaction içinde okunacak bir sonraki hesap için bellekteki
    // stoğu ilerlet: tek çağrıda aynı varyasyona iki hareket uygulanırsa
    // (ör. sayım düzeltmesi + fire) zincir bozulmasın.
    variant.stockQuantity = newStock;

    if (delta.direction === StockMovementDirection.OUT) {
      this.logger.debug(
        `Stok düştü: ${variant.sku} ${previousStock.toString()} -> ${newStock.toString()} (${input.type})`,
      );
    }

    return {
      id: movement.id,
      variantId: variant.id,
      type: input.type,
      direction: delta.direction,
      quantity: delta.quantity,
      previousStock,
      newStock,
    };
  }
}

/**
 * Aynı varyasyona ait girdileri tek harekette toplar.
 *
 * Bir satışta aynı varyasyon iki ayrı satırda geçebilir (farklı pazarlık
 * fiyatıyla). Ayrı ayrı işlenselerdi her biri stoğu bağımsız kontrol eder,
 * toplamı stoğu aşsa bile ikisi de tek başına geçerli görünürdü.
 *
 * Yalnız aynı TİP ve aynı REFERANS birleştirilir; sayım düzeltmesi
 * birleştirilmez (miktarı fark değil, mutlak sayımdır).
 */
function mergeByVariant(inputs: StockMovementInput[]): StockMovementInput[] {
  const merged: StockMovementInput[] = [];
  const indexByKey = new Map<string, number>();

  for (const input of inputs) {
    if (input.type === StockMovementType.INVENTORY_ADJUSTMENT) {
      merged.push(input);
      continue;
    }

    const key = `${input.variantId}|${input.type}|${input.referenceType ?? ''}|${input.referenceId ?? ''}`;
    const existingIndex = indexByKey.get(key);

    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push({ ...input });
      continue;
    }

    const existing = merged[existingIndex] as StockMovementInput;

    merged[existingIndex] = { ...existing, quantity: existing.quantity.plus(input.quantity) };
  }

  return merged;
}

/** Sayısal metni Decimal'e çevirir; geçersizse null (Kural 2: float'a uğramaz). */
function toDecimal(value: string): Prisma.Decimal | null {
  try {
    return new Prisma.Decimal(value);
  } catch {
    return null;
  }
}

/** Yetersiz stok ayrıntısı — mesaj ve makine-okunur bağlam birlikte. */
function buildShortageDetail(
  input: StockMovementInput,
  variant: LockedVariant,
  requested: Prisma.Decimal,
): ApiErrorDetail {
  const label =
    variant.variantName === null
      ? variant.productName
      : `${variant.productName} — ${variant.variantName}`;

  return {
    field: input.errorField ?? 'variantId',
    message:
      `${label} (${variant.sku}): ${STOCK_MOVEMENT_TYPE_LABELS[input.type].toLocaleLowerCase('tr-TR')} için ` +
      `${requested.toString()} gerekiyor, mevcut stok ${variant.stockQuantity.toString()}.`,
    context: {
      variantId: variant.id,
      sku: variant.sku,
      productName: variant.productName,
      variantName: variant.variantName ?? '',
      requested: requested.toString(),
      available: variant.stockQuantity.toString(),
      missing: requested.minus(variant.stockQuantity).toString(),
    },
  };
}
