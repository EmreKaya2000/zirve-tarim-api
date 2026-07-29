import { Prisma } from '@prisma/client';

/**
 * Stok listesi satırı — varyasyon bazlı.
 *
 * `purchasePrice` BİLİNÇLİ OLARAK buradadır: stok değeri (miktar × alış
 * fiyatı) mağaza sahibinin ilk baktığı rakamdır. Uç `/admin/*` altındadır ve
 * JWT + rol ister; public tarafa sızmaz (Kural 8).
 */
export const ADMIN_STOCK_LIST_SELECT = {
  id: true,
  sku: true,
  name: true,
  stockQuantity: true,
  lowStockThreshold: true,
  trackStock: true,
  purchasePrice: true,
  salePrice: true,
  isActive: true,
  deletedAt: true,
  updatedAt: true,
  unitType: { select: { id: true, name: true, code: true, allowsDecimal: true } },
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      isPublished: true,
      brand: { select: { id: true, name: true } },
      categories: {
        where: { isPrimary: true },
        take: 1,
        select: { category: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect;

/** Hareket geçmişi satırı. Önceki/sonraki stok kolonları listede gösterilir. */
export const ADMIN_STOCK_MOVEMENT_SELECT = {
  id: true,
  type: true,
  direction: true,
  quantity: true,
  previousStock: true,
  newStock: true,
  referenceType: true,
  referenceId: true,
  description: true,
  unitCost: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true } },
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      unitType: { select: { code: true, name: true } },
    },
  },
  product: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.StockMovementSelect;
