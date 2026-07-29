/**
 * Parasal ve miktar değerleri için taşıma tipi.
 *
 * JSON'da `number` tipi IEEE-754 double'dır; backend'de Prisma Decimal kullanıp
 * yanıtta `number`'a çevirmek Kural 2'yi son metrede ihlal eder
 * (`12450.55` -> `12450.549999999999`).
 *
 * Bu yüzden tüm parasal ve miktar alanları API sözleşmesinde **string** taşınır.
 * Karar kaydı: docs/ARCHITECTURE.md §13.6
 *
 * @example "12450.5000"
 */
export type Money = string;

/**
 * Ondalıklı miktar (kg, litre, ton...). Money ile aynı gerekçeyle string.
 *
 * @example "2.500"
 */
export type Quantity = string;

/**
 * Yüzde oran (KDV, iskonto). String olarak taşınır.
 *
 * @example "20.000" — yüzde 20
 */
export type Rate = string;

/**
 * Döviz kuru.
 *
 * @example "34.12345678"
 */
export type ExchangeRateValue = string;

/**
 * Para birimi kodu (ISO 4217 alt kümesi).
 * MVP'de yalnız TRY aktif; yapı çoklu para birimine hazır tutulur.
 */
export const CURRENCY_CODES = ['TRY', 'USD', 'EUR'] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Sistemin varsayılan para birimi. */
export const DEFAULT_CURRENCY: CurrencyCode = 'TRY';

/** Tutar alanlarının ondalık basamak sayısı (numeric(18,4)). */
export const MONEY_SCALE = 4;

/** Miktar alanlarının ondalık basamak sayısı (numeric(18,3)). */
export const QUANTITY_SCALE = 3;

/** Kullanıcıya gösterilen para biçimlendirmesinde kullanılan basamak sayısı. */
export const MONEY_DISPLAY_SCALE = 2;
