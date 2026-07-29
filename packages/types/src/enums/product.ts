/**
 * Ürün sabitleri — Prisma enum'larıyla birebir aynı olmalıdır.
 */

/** Ürünler arası ilişki türleri. */
export const PRODUCT_RELATION_TYPES = [
  'COMPATIBLE',
  'INCOMPATIBLE',
  'SIMILAR',
  'ALTERNATIVE',
  'COMPLEMENTARY',
  'RECOMMENDED_TOGETHER',
] as const;

export type ProductRelationType = (typeof PRODUCT_RELATION_TYPES)[number];

/**
 * SİMETRİK ilişki türleri.
 *
 * "A, B ile uyumsuzdur" = "B, A ile uyumsuzdur". Tek satır saklanır,
 * sorgu iki yönü birden tarar.
 */
export const SYMMETRIC_RELATION_TYPES = [
  'COMPATIBLE',
  'INCOMPATIBLE',
  'SIMILAR',
] as const satisfies readonly ProductRelationType[];

/**
 * YÖNLÜ ilişki türleri.
 *
 * "A yerine B önerilir" ifadesi tersine çevrilemez: pahalı ürünün alternatifi
 * ucuz olabilir ama tersini önermek mağazanın istemeyeceği bir davranıştır.
 */
export const DIRECTIONAL_RELATION_TYPES = [
  'ALTERNATIVE',
  'COMPLEMENTARY',
  'RECOMMENDED_TOGETHER',
] as const satisfies readonly ProductRelationType[];

/** İlişki türü simetrik mi? */
export function isSymmetricRelation(type: ProductRelationType): boolean {
  return (SYMMETRIC_RELATION_TYPES as readonly string[]).includes(type);
}

/** Kullanıcıya gösterilecek ilişki adları. */
export const PRODUCT_RELATION_LABELS: Record<ProductRelationType, string> = {
  COMPATIBLE: 'Birlikte Kullanılabilir',
  INCOMPATIBLE: 'Birlikte Kullanılamaz',
  SIMILAR: 'Benzer Ürün',
  ALTERNATIVE: 'Alternatif',
  COMPLEMENTARY: 'Tamamlayıcı',
  RECOMMENDED_TOGETHER: 'Birlikte Önerilir',
};

/** Public ürün listesinde izin verilen sıralama seçenekleri. */
export const PRODUCT_SORT_OPTIONS = [
  'newest',
  'name-asc',
  'name-desc',
  'price-asc',
  'price-desc',
  'featured',
] as const;

export type ProductSortOption = (typeof PRODUCT_SORT_OPTIONS)[number];

export const PRODUCT_SORT_LABELS: Record<ProductSortOption, string> = {
  newest: 'En Yeni',
  'name-asc': 'İsme Göre (A-Z)',
  'name-desc': 'İsme Göre (Z-A)',
  'price-asc': 'Fiyat (Artan)',
  'price-desc': 'Fiyat (Azalan)',
  featured: 'Öne Çıkanlar',
};

/**
 * Public yanıtta ASLA bulunmaması gereken alan adları.
 *
 * Otomatik sızıntı testi bu listeyi kullanır (docs/ARCHITECTURE.md §11.2).
 * Yeni hassas alan eklendiğinde buraya da eklenmelidir.
 */
export const FORBIDDEN_PUBLIC_FIELDS = [
  'purchasePrice',
  'averageCost',
  'unitCost',
  'costTotal',
  'grossProfit',
  'netProfit',
  'lineProfit',
  'creditLimit',
  'currentBalance',
  'internalNote',
  'passwordHash',
  'tokenHash',
] as const;
