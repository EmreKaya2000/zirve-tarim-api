/**
 * Finans ve rapor sabitleri (Sprint 10).
 *
 * Rapor tanımlarının TEK KAYNAĞI burasıdır: yaşlandırma kovaları, kırılım
 * tipleri ve "hangi satış sayılır" kuralı hem backend hem arayüz
 * tarafından buradan okunur. İki yerde ayrı tanımlansaydı ekrandaki
 * "0-30 gün" ile sorgudaki aralık sessizce ayrışabilirdi.
 */

import type { SaleStatus } from './sale';

// =============================================================================
// HANGİ SATIŞ SAYILIR
// =============================================================================

/**
 * Finansal toplamlara GİREN satış durumları.
 *
 * DRAFT girmez: taslak henüz müşteriye tebliğ edilmemiştir, borç doğurmaz.
 * CANCELLED girmez: geri alınmış bir belgedir (Sprint 10 şartı 7).
 *
 * Bu liste raporların tamamında kullanılır; bir rapor kendi durum filtresini
 * yazmaz.
 */
export const REPORTABLE_SALE_STATUSES: readonly SaleStatus[] = [
  'CONFIRMED',
  'PARTIALLY_PAID',
  'PAID',
];

/** Kalan borcu olabilecek durumlar — tamamı ödenmiş satışın kalanı sıfırdır. */
export const OPEN_DEBT_SALE_STATUSES: readonly SaleStatus[] = ['CONFIRMED', 'PARTIALLY_PAID'];

// =============================================================================
// ALACAK YAŞLANDIRMA
// =============================================================================

/**
 * Yaşlandırma kovaları.
 *
 * `NOT_DUE` BİLİNÇLİ olarak ayrı bir kovadır: vadesi gelmemiş alacak
 * "gecikmiş" değildir ve 0-30 kovasına konulsaydı tahsilat baskısı olan
 * tutar olduğundan büyük görünürdü.
 */
export const AGING_BUCKETS = [
  'NOT_DUE',
  'DAYS_0_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_90_PLUS',
] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Readonly<Record<AgingBucket, string>> = {
  NOT_DUE: 'Vadesi gelmemiş',
  DAYS_0_30: '0-30 gün',
  DAYS_31_60: '31-60 gün',
  DAYS_61_90: '61-90 gün',
  DAYS_90_PLUS: '90+ gün',
};

/**
 * Kovaların gün sınırları — üst sınır DAHİL.
 *
 * Sorgudaki `CASE` ifadesiyle aynı sınırlar; ekrandaki etiketle veritabanı
 * aralığı ayrışmasın diye tek yerde.
 */
export const AGING_BUCKET_DAYS: Readonly<Record<AgingBucket, { min: number; max: number | null }>> =
  {
    NOT_DUE: { min: -Infinity, max: -1 },
    DAYS_0_30: { min: 0, max: 30 },
    DAYS_31_60: { min: 31, max: 60 },
    DAYS_61_90: { min: 61, max: 90 },
    DAYS_90_PLUS: { min: 91, max: null },
  };

// =============================================================================
// RAPOR KIRILIMLARI
// =============================================================================

/** Kâr raporunun kırılım eksenleri. */
export const PROFIT_BREAKDOWN_TYPES = ['PRODUCT', 'CATEGORY'] as const;

export type ProfitBreakdownType = (typeof PROFIT_BREAKDOWN_TYPES)[number];

export const PROFIT_BREAKDOWN_LABELS: Readonly<Record<ProfitBreakdownType, string>> = {
  PRODUCT: 'Ürün',
  CATEGORY: 'Kategori',
};

/** Grafik serilerinde gösterilen ay sayısı. */
export const CHART_MONTHS = 12;

/** "En çok" listelerinde varsayılan satır sayısı. */
export const TOP_LIST_LIMIT = 10;

/** Dashboard'daki "son işlemler" listelerinin uzunluğu. */
export const RECENT_LIST_LIMIT = 5;

/** Yaklaşan vade uyarısının kaç gün ilerisine baktığı. */
export const UPCOMING_DUE_DAYS = 7;
