import { Prisma } from '@prisma/client';

/**
 * Sepet okuması için varyasyon seçicisi.
 *
 * KURAL 8: `purchasePrice` BURADA YOKTUR ve olmamalıdır — alış fiyatı public
 * tarafa asla sızmaz. `include` kullanılmaması bu güvencenin kendisidir.
 *
 * Miktar kuralları (`minOrderQuantity`, `quantityStep`, `maxOrderQuantity`,
 * `allowsDecimal`) yanıta DAHİL EDİLİR: arayüz adımlayıcıyı bu değerlerle
 * kurar. Sepet snapshot tutmadığı için bu bilgi her okumada güncel gelir —
 * yönetici adımı 5'ten 10'a çıkardıysa kullanıcı bir sonraki sepet açılışında
 * doğru adımlayıcıyı görür.
 */
export const CART_VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  isActive: true,
  deletedAt: true,
  salePrice: true,
  minOrderQuantity: true,
  quantityStep: true,
  maxOrderQuantity: true,
  stockQuantity: true,
  unitType: { select: { name: true, code: true, allowsDecimal: true } },
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      isPublished: true,
      showPrice: true,
      deletedAt: true,
      images: {
        where: { isPrimary: true },
        take: 1,
        select: { url: true },
      },
    },
  },
} as const satisfies Prisma.ProductVariantSelect;

export type CartVariantRow = Prisma.ProductVariantGetPayload<{
  select: typeof CART_VARIANT_SELECT;
}>;

/** Sepet kalemi + varyasyonu tek sorguda. */
export const CART_ITEM_SELECT = {
  id: true,
  productId: true,
  productVariantId: true,
  quantity: true,
  createdAt: true,
  productVariant: { select: CART_VARIANT_SELECT },
} as const satisfies Prisma.CartItemSelect;

export type CartItemRow = Prisma.CartItemGetPayload<{ select: typeof CART_ITEM_SELECT }>;
