import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CART_SKIP_REASONS,
  CART_SKIP_REASON_LABELS,
  type CartAdjustedItem,
  type CartItemView,
  type CartMergeResult,
  type CartSkipReason,
  type CartSkippedItem,
  type CartView,
} from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { hashToken } from '../../common/utils/token-hash';
import {
  checkQuantity,
  quantityViolationMessage,
  resolveNearestValidQuantity,
  toQuantityDecimal,
  toQuantityRules,
  trimQuantity,
} from '../../common/utils/quantity-rules';
import { PrismaService } from '../../infra/prisma/prisma.service';

import {
  CART_ITEM_SELECT,
  CART_VARIANT_SELECT,
  type CartItemRow,
  type CartVariantRow,
} from './cart.select';
import { MAX_CART_ITEMS, type CartItemInputDto } from './dto/cart.dto';

/**
 * Sunucu tarafı sepet — Sprint 11 şartı 2.
 *
 * KAPSAM: yalnız GİRİŞLİ müşteri. Misafir sepeti localStorage'da kalır ve
 * Sprint 6 akışı değişmez; iki sepet ancak `merge` ile buluşur.
 *
 * İKİ FARKLI MİKTAR POLİTİKASI VARDIR ve bu bilinçlidir:
 *
 *   Ekleme/güncelleme -> KURAL İHLALİNİ REDDEDER. Kullanıcı o an ekranda ve
 *                        ne istediğini söylüyor; miktarını sessizce
 *                        değiştirmek şaşırtıcı olurdu.
 *   Birleştirme       -> EN YAKIN GEÇERLİ MİKTARA AYARLAR. Reddetmek,
 *                        kullanıcının misafirken topladığı sepeti
 *                        kaybettirirdi — sprintin amacının tam tersi.
 *
 * Kuralların kendisi tek yerdedir: `common/utils/quantity-rules.ts`.
 */
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ==========================================================================
  // OKUMA
  // ==========================================================================

  /**
   * Sepeti döner.
   *
   * SEPET SATIRI OLUŞTURMAZ: okuma isteği yazma yapmamalıdır. Hesabın henüz
   * sepeti yoksa boş görünüm döner ve ilk ekleme/birleştirme sırasında
   * satır açılır.
   */
  async getCart(accountId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({
      where: { customerAccountId: accountId },
      select: {
        updatedAt: true,
        items: { orderBy: { createdAt: 'asc' }, select: CART_ITEM_SELECT },
      },
    });

    if (cart === null) {
      return emptyCartView();
    }

    return toCartView(cart.items, cart.updatedAt);
  }

  // ==========================================================================
  // KALEM İŞLEMLERİ
  // ==========================================================================

  /**
   * Sepete kalem ekler.
   *
   * VARYASYON ZATEN SEPETTEYSE MİKTARLAR TOPLANIR — localStorage sepetiyle
   * aynı davranış (cart-store.ts). Kullanıcı aynı ürünü ikinci kez
   * eklediğinde ilk seçimini kaybetmesi beklenmeyen bir sonuç olurdu.
   *
   * Toplam sonuç kuralları ihlal ediyorsa (ör. üst sınırı aşıyorsa) istek
   * REDDEDİLİR ve neden söylenir. Sessizce üst sınıra çekmek, kullanıcının
   * istediğinden azını sepette görmesine yol açardı.
   */
  async addItem(accountId: string, input: CartItemInputDto): Promise<CartView> {
    const requested = this.parseQuantity(input.quantity);
    const variant = await this.loadVariant(input.productVariantId);

    this.assertVariantAvailable(variant);

    const cart = await this.getOrCreateCart(accountId);

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        cartId_productVariantId: {
          cartId: cart.id,
          productVariantId: variant.id,
        },
      },
      select: { id: true, quantity: true },
    });

    const total =
      existing === null ? requested : new Prisma.Decimal(existing.quantity).plus(requested);

    this.assertQuantityValid(total, variant);

    if (existing === null) {
      await this.assertCartHasRoom(cart.id);

      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: variant.product.id,
          productVariantId: variant.id,
          quantity: total,
        },
      });
    } else {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: total },
      });
    }

    await this.touchCart(cart.id);

    return this.getCart(accountId);
  }

  /** Kalem miktarını MUTLAK değere ayarlar (toplamaz). */
  async updateItem(accountId: string, itemId: string, quantityInput: string): Promise<CartView> {
    const quantity = this.parseQuantity(quantityInput);
    const item = await this.loadOwnedItem(accountId, itemId);

    this.assertVariantAvailable(item.productVariant);
    this.assertQuantityValid(quantity, item.productVariant);

    await this.prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    await this.touchCart(item.cartId);

    return this.getCart(accountId);
  }

  async removeItem(accountId: string, itemId: string): Promise<CartView> {
    const item = await this.loadOwnedItem(accountId, itemId);

    await this.prisma.cartItem.delete({ where: { id: item.id } });
    await this.touchCart(item.cartId);

    return this.getCart(accountId);
  }

  /**
   * Sepeti boşaltır.
   *
   * `lastMergeFingerprint` DE SİLİNİR: kullanıcı sepeti bilinçli olarak
   * boşalttıysa, aynı misafir sepetini yeniden birleştirmek istemesi geçerli
   * bir niyettir ve engellenmemelidir.
   */
  async clear(accountId: string): Promise<CartView> {
    const cart = await this.prisma.cart.findUnique({
      where: { customerAccountId: accountId },
      select: { id: true },
    });

    if (cart === null) {
      return emptyCartView();
    }

    await this.prisma.$transaction([
      this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } }),
      this.prisma.cart.update({
        where: { id: cart.id },
        data: { lastMergeFingerprint: null },
      }),
    ]);

    return this.getCart(accountId);
  }

  // ==========================================================================
  // BİRLEŞTİRME
  // ==========================================================================

  /**
   * Misafir sepetini hesabın sepetiyle birleştirir — Sprint 11 şartı 2.
   *
   * Kurallar:
   *   a) Aynı varyasyon iki sepette de varsa miktarlar TOPLANIR.
   *   b) Sonuç min/adım/max kurallarına uyan EN YAKIN geçerli miktara ayarlanır.
   *   c) Pasif/silinmiş/yayında olmayan varyasyonlar ATLANIR ve nedenleriyle
   *      `skippedItems` içinde döner.
   *   d) İDEMPOTENT: aynı payload ikinci kez gönderilirse sepet DEĞİŞMEZ
   *      (bkz. `carts.lastMergeFingerprint` açıklaması).
   *
   * TEK TRANSACTION: yarım kalan bir birleştirme, kullanıcının sepetinin bir
   * kısmının taşındığı ve gerisinin kaybolduğu bir durum üretirdi — istemci
   * yerel sepeti başarı yanıtından sonra temizlediği için bu geri alınamaz.
   */
  async merge(accountId: string, items: CartItemInputDto[]): Promise<CartMergeResult> {
    const incoming = sumByVariant(items);
    const fingerprint = fingerprintOf(incoming);

    const cart = await this.getOrCreateCart(accountId);

    const existingItems = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      select: { id: true, productVariantId: true, quantity: true },
    });

    const existingByVariant = new Map(
      existingItems.map((item) => [item.productVariantId, item] as const),
    );

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: [...incoming.keys()] } },
      select: CART_VARIANT_SELECT,
    });

    const variantById = new Map(variants.map((variant) => [variant.id, variant] as const));

    const skippedItems: CartSkippedItem[] = [];
    const adjustedItems: CartAdjustedItem[] = [];
    const writes: {
      existingId: string | null;
      variant: CartVariantRow;
      quantity: Prisma.Decimal;
    }[] = [];

    // Sepette kaç yeni kaleme yer var? Sınır, talep sınırıyla aynıdır.
    let remainingSlots = MAX_CART_ITEMS - existingItems.length;

    for (const [variantId, requested] of incoming) {
      const variant = variantById.get(variantId);

      const skip = (reason: CartSkipReason): void => {
        skippedItems.push({
          productVariantId: variantId,
          productName: variant?.product.name ?? null,
          reason,
          message: CART_SKIP_REASON_LABELS[reason],
        });
      };

      if (variant === undefined) {
        skip(CART_SKIP_REASONS.VARIANT_NOT_FOUND);
        continue;
      }

      if (!variant.isActive || variant.deletedAt !== null) {
        skip(CART_SKIP_REASONS.VARIANT_UNAVAILABLE);
        continue;
      }

      const product = variant.product;

      if (product.deletedAt !== null || !product.isActive || !product.isPublished) {
        skip(CART_SKIP_REASONS.PRODUCT_UNAVAILABLE);
        continue;
      }

      if (requested === null || requested.lessThanOrEqualTo(0)) {
        skip(CART_SKIP_REASONS.INVALID_QUANTITY);
        continue;
      }

      const existing = existingByVariant.get(variantId) ?? null;

      // (a) TOPLAMA
      const target =
        existing === null ? requested : new Prisma.Decimal(existing.quantity).plus(requested);

      // (b) EN YAKIN GEÇERLİ MİKTAR
      const resolved = resolveNearestValidQuantity(target, toQuantityRules(variant));

      if (resolved === null) {
        skip(CART_SKIP_REASONS.NO_VALID_QUANTITY);
        continue;
      }

      if (existing === null) {
        if (remainingSlots <= 0) {
          skip(CART_SKIP_REASONS.CART_LIMIT_REACHED);
          continue;
        }

        remainingSlots -= 1;
      }

      if (!resolved.equals(target)) {
        adjustedItems.push({
          productVariantId: variantId,
          productName: product.name,
          requestedQuantity: trimQuantity(target),
          finalQuantity: trimQuantity(resolved),
          unitCode: variant.unitType.code,
          message:
            `${product.name}: istenen ${trimQuantity(target)} ${variant.unitType.code} miktarı ` +
            `sipariş kurallarına uyacak şekilde ${trimQuantity(resolved)} ` +
            `${variant.unitType.code} olarak ayarlandı.`,
        });
      }

      writes.push({ existingId: existing?.id ?? null, variant, quantity: resolved });
    }

    // (d) İDEMPOTENCY — aynı payload ikinci kez geldiyse hiçbir yazma yapılmaz.
    //
    // Boş payload muaftır: "sepetimi getir" anlamına gelir ve parmak izi
    // karşılaştırmasına dahil edilirse ilk boş çağrı sonrakileri de kilitlerdi.
    const isRepeat = incoming.size > 0 && cart.lastMergeFingerprint === fingerprint;

    if (isRepeat) {
      this.logger.log(`Aynı sepet birleştirme isteği yok sayıldı (hesap=${accountId}).`);

      return {
        cart: await this.getCart(accountId),
        addedCount: 0,
        mergedCount: 0,
        // Atlanan kalemler YİNE bildirilir: istemci ilk yanıtı kaçırmış
        // olabilir ve kullanıcı hangi ürünlerin taşınmadığını görmelidir.
        skippedItems,
        adjustedItems: [],
      };
    }

    const addedCount = writes.filter((write) => write.existingId === null).length;
    const mergedCount = writes.length - addedCount;

    await this.prisma.$transaction(async (tx) => {
      for (const write of writes) {
        if (write.existingId === null) {
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              productId: write.variant.product.id,
              productVariantId: write.variant.id,
              quantity: write.quantity,
            },
          });
        } else {
          await tx.cartItem.update({
            where: { id: write.existingId },
            data: { quantity: write.quantity },
          });
        }
      }

      await tx.cart.update({
        where: { id: cart.id },
        data: { lastMergeFingerprint: incoming.size > 0 ? fingerprint : null },
      });
    });

    return {
      cart: await this.getCart(accountId),
      addedCount,
      mergedCount,
      skippedItems,
      adjustedItems,
    };
  }

  // ==========================================================================
  // YARDIMCILAR
  // ==========================================================================

  private async getOrCreateCart(
    accountId: string,
  ): Promise<{ id: string; lastMergeFingerprint: string | null }> {
    // `upsert` kullanılır, "bul yoksa oluştur" DEĞİL: iki eşzamanlı istek
    // (sepet sayfası + birleştirme) arasında ikincisi UNIQUE hatasına düşerdi.
    return this.prisma.cart.upsert({
      where: { customerAccountId: accountId },
      create: { customerAccountId: accountId },
      update: {},
      select: { id: true, lastMergeFingerprint: true },
    });
  }

  /**
   * Sepetin `updatedAt` damgasını tazeler.
   *
   * Kalem yazıldığında sepet satırı kendiliğinden değişmez (ayrı tablo);
   * damga tazelenmezse arayüz "sepet en son ne zaman değişti" bilgisini
   * yanlış gösterirdi.
   */
  private async touchCart(cartId: string): Promise<void> {
    await this.prisma.cart.update({ where: { id: cartId }, data: { updatedAt: new Date() } });
  }

  private parseQuantity(value: string): Prisma.Decimal {
    const quantity = toQuantityDecimal(value);

    if (quantity === null) {
      throw AppException.badRequest('Miktar geçersiz.', [
        { field: 'quantity', message: 'Miktar sayısal bir değer olmalıdır.' },
      ]);
    }

    return quantity;
  }

  private async loadVariant(variantId: string): Promise<CartVariantRow> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: CART_VARIANT_SELECT,
    });

    if (variant === null) {
      throw AppException.notFound('Ürün bulunamadı.', [
        { field: 'productVariantId', message: 'Bu satış birimi katalogda bulunamadı.' },
      ]);
    }

    return variant;
  }

  /** Kalemin GERÇEKTEN bu hesabın sepetine ait olduğunu doğrular. */
  private async loadOwnedItem(
    accountId: string,
    itemId: string,
  ): Promise<CartItemRow & { cartId: string }> {
    const item = await this.prisma.cartItem.findFirst({
      // Sahiplik WHERE'İN İÇİNDEDİR, sonradan kontrol edilmez: başkasının
      // kalem kimliğiyle gelen istek "bulunamadı" alır ve o kalemin VAR
      // OLDUĞU bilgisi bile sızmaz.
      where: { id: itemId, cart: { customerAccountId: accountId } },
      select: { ...CART_ITEM_SELECT, cartId: true },
    });

    if (item === null) {
      throw AppException.notFound('Sepet kalemi bulunamadı.');
    }

    return item;
  }

  private assertVariantAvailable(variant: CartVariantRow): void {
    if (!variant.isActive || variant.deletedAt !== null) {
      throw AppException.badRequest(
        `${variant.product.name}: bu satış birimi artık mevcut değil.`,
        [{ field: 'productVariantId', message: 'Satış birimi pasif veya kaldırılmış.' }],
      );
    }

    const product = variant.product;

    if (product.deletedAt !== null || !product.isActive || !product.isPublished) {
      throw AppException.badRequest(`${product.name}: ürün artık satışta değil.`, [
        { field: 'productVariantId', message: 'Ürün yayında değil.' },
      ]);
    }
  }

  private assertQuantityValid(quantity: Prisma.Decimal, variant: CartVariantRow): void {
    const violation = checkQuantity(quantity, toQuantityRules(variant));

    if (violation !== null) {
      throw AppException.badRequest('Miktar sipariş kurallarına uymuyor.', [
        {
          field: 'quantity',
          message: quantityViolationMessage(violation, variant.unitType.code),
        },
      ]);
    }
  }

  private async assertCartHasRoom(cartId: string): Promise<void> {
    const count = await this.prisma.cartItem.count({ where: { cartId } });

    if (count >= MAX_CART_ITEMS) {
      throw AppException.badRequest(
        `Sepetinizde en fazla ${MAX_CART_ITEMS} farklı ürün olabilir.`,
        [{ field: 'productVariantId', message: 'Sepet kalem sınırına ulaşıldı.' }],
      );
    }
  }
}

// ============================================================================
// SAF YARDIMCILAR (test edilebilir, Prisma'ya bağımsız)
// ============================================================================

/**
 * Gelen kalemleri varyasyona göre toplar.
 *
 * Misafir sepetinde aynı varyasyon iki kez bulunabilir (eski sürüm bir
 * istemci, elle düzenlenmiş localStorage). Toplanmazsa ikinci kalem
 * birincinin üzerine yazar ve kullanıcı miktar kaybeder.
 *
 * Değer `null` ise miktar sayıya çevrilemedi; çağıran bunu
 * `INVALID_QUANTITY` olarak atlar.
 */
export function sumByVariant(items: CartItemInputDto[]): Map<string, Prisma.Decimal | null> {
  const totals = new Map<string, Prisma.Decimal | null>();

  for (const item of items) {
    const parsed = toQuantityDecimal(item.quantity);
    const current = totals.get(item.productVariantId);

    if (!totals.has(item.productVariantId)) {
      totals.set(item.productVariantId, parsed);
      continue;
    }

    // Bir tanesi bile çevrilemiyorsa kalemin tamamı geçersiz sayılır:
    // bozuk bir değeri sessizce yok sayıp diğerini kullanmak, kullanıcının
    // göremediği bir miktar üretirdi.
    totals.set(
      item.productVariantId,
      current === null || current === undefined || parsed === null ? null : current.plus(parsed),
    );
  }

  return totals;
}

/**
 * Birleştirme isteğinin parmak izi.
 *
 * Varyasyon kimliğine göre SIRALANIR: aynı sepetin farklı sırayla gönderilmesi
 * farklı bir istek sayılmamalıdır (istemcinin liste sırası kullanıcı
 * etkileşimine göre değişir).
 */
export function fingerprintOf(totals: Map<string, Prisma.Decimal | null>): string {
  const normalized = [...totals.entries()]
    .map(
      ([variantId, quantity]) => `${variantId}:${quantity === null ? 'NaN' : quantity.toString()}`,
    )
    .sort()
    .join('|');

  return hashToken(normalized);
}

/** Sepeti hiç oluşturmadan boş görünüm üretir. */
function emptyCartView(): CartView {
  return {
    items: [],
    itemCount: 0,
    estimatedTotal: '0',
    hasHiddenPrices: false,
    updatedAt: null,
  };
}

/** Prisma satırlarını API görünümüne çevirir. */
export function toCartView(rows: CartItemRow[], updatedAt: Date): CartView {
  const items = rows.map(toCartItemView);

  const estimatedTotal = items.reduce(
    (total, item) => (item.lineTotal === null ? total : total.plus(item.lineTotal)),
    new Prisma.Decimal(0),
  );

  return {
    items,
    itemCount: items.length,
    estimatedTotal: estimatedTotal.toString(),
    hasHiddenPrices: items.some((item) => item.displayedPrice === null && item.isAvailable),
    updatedAt: updatedAt.toISOString(),
  };
}

function toCartItemView(row: CartItemRow): CartItemView {
  const variant = row.productVariant;
  const product = variant.product;

  const unavailableReason = resolveUnavailableReason(variant);
  const isAvailable = unavailableReason === null;

  // Fiyatı gizli ürün için tutar hesaplanmaz: müşteri fiyatı görmedi.
  // Yayından kalkmış kalem de toplama girmez — mağazaya iletilemeyecek bir
  // ürünü tahmini tutara katmak yanıltıcı olurdu.
  const displayedPrice =
    product.showPrice && isAvailable ? new Prisma.Decimal(variant.salePrice) : null;

  const quantity = new Prisma.Decimal(row.quantity);

  return {
    id: row.id,
    productId: row.productId,
    productVariantId: row.productVariantId,
    productName: product.name,
    productSlug: product.slug,
    variantName: variant.name,
    sku: variant.sku,
    imageUrl: variant.product.images[0]?.url ?? null,
    quantity: trimQuantity(quantity),
    unitCode: variant.unitType.code,
    unitName: variant.unitType.name,
    allowsDecimal: variant.unitType.allowsDecimal,
    minOrderQuantity: trimQuantity(variant.minOrderQuantity),
    quantityStep: trimQuantity(variant.quantityStep),
    maxOrderQuantity:
      variant.maxOrderQuantity === null ? null : trimQuantity(variant.maxOrderQuantity),
    displayedPrice: displayedPrice?.toString() ?? null,
    lineTotal: displayedPrice === null ? null : displayedPrice.times(quantity).toString(),
    inStock: new Prisma.Decimal(variant.stockQuantity).greaterThanOrEqualTo(quantity),
    isAvailable,
    unavailableReason,
  };
}

/**
 * Sepetteki kalem hâlâ talep edilebilir mi?
 *
 * YAYINDAN KALKAN KALEM SEPETTEN SİLİNMEZ, İŞARETLENİR. Okuma isteğinde
 * satır silmek hem bir GET'in yazma yapması olurdu hem de kullanıcı ürünün
 * neden kaybolduğunu asla öğrenemezdi. Talep gönderiminde S6 doğrulaması
 * zaten bu kalemi reddeder.
 */
function resolveUnavailableReason(variant: CartVariantRow): string | null {
  if (!variant.isActive || variant.deletedAt !== null) {
    return CART_SKIP_REASON_LABELS[CART_SKIP_REASONS.VARIANT_UNAVAILABLE];
  }

  const product = variant.product;

  if (product.deletedAt !== null || !product.isActive || !product.isPublished) {
    return CART_SKIP_REASON_LABELS[CART_SKIP_REASONS.PRODUCT_UNAVAILABLE];
  }

  return null;
}
