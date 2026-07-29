/**
 * Stok hareketi sabitleri.
 *
 * TEK KAYNAK: hareket tipleri, yönleri ve "hangi tip elle girilebilir"
 * kuralı burada tanımlıdır; backend ve arayüz aynı tabloyu okur. İki yerde
 * ayrı tanımlanırsa arayüz, backend'in reddedeceği bir hareket tipini
 * kullanıcıya sunar.
 */

// =============================================================================
// YÖN
// =============================================================================

export const STOCK_MOVEMENT_DIRECTIONS = ['IN', 'OUT'] as const;

export type StockMovementDirection = (typeof STOCK_MOVEMENT_DIRECTIONS)[number];

export const STOCK_MOVEMENT_DIRECTION_LABELS: Readonly<Record<StockMovementDirection, string>> = {
  IN: 'Giriş',
  OUT: 'Çıkış',
};

// =============================================================================
// HAREKET TİPİ
// =============================================================================

export const STOCK_MOVEMENT_TYPES = [
  'INITIAL',
  'PURCHASE',
  'SALE',
  'SALE_CANCEL',
  'MANUAL_IN',
  'MANUAL_OUT',
  'WASTE',
  'DAMAGE',
  'INVENTORY_ADJUSTMENT',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const STOCK_MOVEMENT_TYPE_LABELS: Readonly<Record<StockMovementType, string>> = {
  INITIAL: 'Açılış stoğu',
  PURCHASE: 'Alış',
  SALE: 'Satış',
  SALE_CANCEL: 'Satış iptali',
  MANUAL_IN: 'Elle giriş',
  MANUAL_OUT: 'Elle çıkış',
  WASTE: 'Fire',
  DAMAGE: 'Hasar / zayi',
  INVENTORY_ADJUSTMENT: 'Sayım düzeltmesi',
};

/**
 * Hareket tipinin sabit yönü.
 *
 * `INVENTORY_ADJUSTMENT` bilinçli olarak `null`: sayım düzeltmesinin yönü
 * tipten değil, sayılan miktar ile kayıtlı stoğun farkından belirlenir.
 * Sayımda hem fazla hem eksik çıkabilir; tipi ikiye bölmek (SAYIM_FAZLA /
 * SAYIM_EKSİK) kullanıcıyı, henüz bilmediği bir yönü önceden seçmeye
 * zorlardı.
 */
export const STOCK_MOVEMENT_DIRECTION_BY_TYPE: Readonly<
  Record<StockMovementType, StockMovementDirection | null>
> = {
  INITIAL: 'IN',
  PURCHASE: 'IN',
  SALE: 'OUT',
  SALE_CANCEL: 'IN',
  MANUAL_IN: 'IN',
  MANUAL_OUT: 'OUT',
  WASTE: 'OUT',
  DAMAGE: 'OUT',
  INVENTORY_ADJUSTMENT: null,
};

/**
 * Sistemin ürettiği hareket tipleri — stok düzeltme ucundan girilemez.
 *
 * Satış hareketi elle yazılabilseydi, satış belgesiyle stok geçmişi
 * ayrışırdı: hareket satışa referans verir ama karşılığında satış olmazdı.
 */
export const SYSTEM_STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = ['SALE', 'SALE_CANCEL'];

/** Stok düzeltme ucundan girilebilen tipler (Sprint 9 şartı 1). */
export const MANUAL_STOCK_MOVEMENT_TYPES = [
  'INITIAL',
  'PURCHASE',
  'MANUAL_IN',
  'MANUAL_OUT',
  'WASTE',
  'DAMAGE',
  'INVENTORY_ADJUSTMENT',
] as const satisfies readonly StockMovementType[];

export type ManualStockMovementType = (typeof MANUAL_STOCK_MOVEMENT_TYPES)[number];

export function isManualStockMovementType(type: string): type is ManualStockMovementType {
  return (MANUAL_STOCK_MOVEMENT_TYPES as readonly string[]).includes(type);
}

/**
 * Yalnız SUPER_ADMIN'in girebileceği tipler.
 *
 * Fire, hasar ve sayım düzeltmesi stoğu BELGESİZ değiştirir: karşılığında
 * ne satış ne alış vardır. Bu üç tip, envanter farkını görünmez kılmanın
 * en kolay yoludur; bu yüzden yetki daraltılır (ARCHITECTURE §10.4).
 */
export const SUPER_ADMIN_STOCK_MOVEMENT_TYPES: readonly StockMovementType[] = [
  'WASTE',
  'DAMAGE',
  'INVENTORY_ADJUSTMENT',
];

export function requiresSuperAdminForStockType(type: StockMovementType): boolean {
  return SUPER_ADMIN_STOCK_MOVEMENT_TYPES.includes(type);
}

// =============================================================================
// REFERANS
// =============================================================================

/**
 * Hareketi doğuran belgenin türü (`referenceType`).
 *
 * Polimorfik referans bilinçlidir: hareketi doğurabilecek belge sayısı
 * artacak (alış, iade, transfer) ve her biri için ayrı nullable FK kolonu
 * açmak tabloyu boş kolonlarla şişirirdi.
 */
export const STOCK_REFERENCE_TYPES = ['SALE'] as const;

export type StockReferenceType = (typeof STOCK_REFERENCE_TYPES)[number];

export const STOCK_REFERENCE_TYPE_LABELS: Readonly<Record<StockReferenceType, string>> = {
  SALE: 'Satış',
};

/** Stok düzeltmesinde açıklama ZORUNLUDUR; en fazla bu kadar karakter. */
export const STOCK_DESCRIPTION_MAX_LENGTH = 500;
