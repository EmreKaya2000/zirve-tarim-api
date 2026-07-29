import { Prisma } from '@prisma/client';

/**
 * Prisma `select` tanımları.
 *
 * KURAL 8 BURADA UYGULANIR: public sorgular AÇIK `select` kullanır.
 * `include` ile geniş nesne çekip sonra alan ayıklamak, yeni bir hassas
 * alan eklendiğinde onu sessizce dışarı sızdırır. Açık `select` ile yeni
 * alan varsayılan olarak GİZLİDİR — güvenli varsayılan.
 *
 * `purchasePrice` bu dosyanın hiçbir public seçicisinde geçmez.
 */

/** Public varyasyon alanları — purchasePrice YOK. */
export const PUBLIC_VARIANT_SELECT = {
  id: true,
  sku: true,
  name: true,
  unitQuantity: true,
  salePrice: true,
  taxRate: true,
  minOrderQuantity: true,
  quantityStep: true,
  maxOrderQuantity: true,
  stockQuantity: true,
  isDefault: true,
  sortOrder: true,
  unitType: {
    select: { id: true, name: true, code: true, allowsDecimal: true, measurementType: true },
  },
} as const satisfies Prisma.ProductVariantSelect;

/** Public liste öğesi. */
export const PUBLIC_PRODUCT_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  showPrice: true,
  isFeatured: true,
  isNew: true,
  isPopular: true,
  createdAt: true,
  brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
  images: {
    where: { isPrimary: true },
    take: 1,
    select: { url: true, altText: true },
  },
  categories: {
    select: {
      isPrimary: true,
      category: { select: { id: true, name: true, slug: true } },
    },
  },
  variants: {
    where: { isActive: true, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    select: PUBLIC_VARIANT_SELECT,
  },
} as const satisfies Prisma.ProductSelect;

/** Public ürün detayı. */
export const PUBLIC_PRODUCT_DETAIL_SELECT = {
  ...PUBLIC_PRODUCT_LIST_SELECT,
  description: true,
  usageInstructions: true,
  ingredients: true,
  storageConditions: true,
  licenseNumber: true,
  metaTitle: true,
  metaDesc: true,
  images: {
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    select: { id: true, url: true, altText: true, isPrimary: true, sortOrder: true },
  },
  plants: {
    select: {
      note: true,
      plant: { select: { id: true, name: true, slug: true, latinName: true } },
    },
  },
  soilTypes: {
    select: {
      note: true,
      soilType: { select: { id: true, name: true, slug: true, phRange: true } },
    },
  },
  benefits: {
    orderBy: { sortOrder: 'asc' },
    select: {
      note: true,
      benefit: { select: { id: true, name: true, slug: true, description: true, icon: true } },
    },
  },
  sideEffects: {
    orderBy: { sortOrder: 'asc' },
    select: {
      note: true,
      severityOverride: true,
      sideEffect: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          severity: true,
          precaution: true,
        },
      },
    },
  },
  usagePeriods: {
    orderBy: { usagePeriod: { sortOrder: 'asc' } },
    select: {
      note: true,
      usagePeriod: { select: { id: true, name: true, slug: true, description: true } },
    },
  },
} as const satisfies Prisma.ProductSelect;

/** Yönetim listesi — maliyet ve kâr alanları BURADA görünür. */
export const ADMIN_PRODUCT_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  isActive: true,
  isPublished: true,
  showPrice: true,
  isFeatured: true,
  isNew: true,
  isPopular: true,
  sortOrder: true,
  viewCount: true,
  createdAt: true,
  updatedAt: true,
  brand: { select: { id: true, name: true, slug: true } },
  images: { where: { isPrimary: true }, take: 1, select: { url: true, altText: true } },
  categories: {
    select: { isPrimary: true, category: { select: { id: true, name: true, slug: true } } },
  },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      sku: true,
      name: true,
      unitQuantity: true,
      purchasePrice: true,
      salePrice: true,
      stockQuantity: true,
      lowStockThreshold: true,
      isDefault: true,
      isActive: true,
      unitType: { select: { id: true, name: true, code: true, allowsDecimal: true } },
    },
  },
  _count: { select: { variants: true, images: true } },
} as const satisfies Prisma.ProductSelect;

/** Yönetim detayı — form için tüm ilişkiler. */
export const ADMIN_PRODUCT_DETAIL_SELECT = {
  ...ADMIN_PRODUCT_LIST_SELECT,
  description: true,
  usageInstructions: true,
  ingredients: true,
  storageConditions: true,
  licenseNumber: true,
  metaTitle: true,
  metaDesc: true,
  brandId: true,
  images: {
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      url: true,
      altText: true,
      isPrimary: true,
      sortOrder: true,
      originalName: true,
      sizeBytes: true,
    },
  },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }],
    select: {
      id: true,
      sku: true,
      name: true,
      unitTypeId: true,
      unitQuantity: true,
      purchasePrice: true,
      salePrice: true,
      taxRate: true,
      minOrderQuantity: true,
      quantityStep: true,
      maxOrderQuantity: true,
      stockQuantity: true,
      lowStockThreshold: true,
      trackStock: true,
      isDefault: true,
      isActive: true,
      sortOrder: true,
      unitType: { select: { id: true, name: true, code: true, allowsDecimal: true } },
    },
  },
  plants: { select: { plantId: true, note: true, plant: { select: { name: true } } } },
  soilTypes: { select: { soilTypeId: true, note: true, soilType: { select: { name: true } } } },
  benefits: {
    orderBy: { sortOrder: 'asc' },
    select: { benefitId: true, note: true, sortOrder: true, benefit: { select: { name: true } } },
  },
  sideEffects: {
    orderBy: { sortOrder: 'asc' },
    select: {
      sideEffectId: true,
      note: true,
      severityOverride: true,
      sortOrder: true,
      sideEffect: { select: { name: true, severity: true } },
    },
  },
  usagePeriods: {
    select: { usagePeriodId: true, note: true, usagePeriod: { select: { name: true } } },
  },
} as const satisfies Prisma.ProductSelect;

/**
 * Fiyat gizleme.
 *
 * `showPrice = false` olan üründe salePrice public'e DÖNMEZ. Bu, seçici
 * düzeyinde yapılamaz (satır bazlı koşul) — bu yüzden yanıt kurulurken
 * uygulanır.
 */
export function stripHiddenPrices<
  T extends { showPrice: boolean; variants: { salePrice: unknown }[] },
>(product: T): T {
  if (product.showPrice) {
    return product;
  }

  return {
    ...product,
    variants: product.variants.map((variant) => {
      const { salePrice: _hidden, ...rest } = variant;

      return rest as typeof variant;
    }),
  };
}
