/**
 * `settings` tablosu için sabitler.
 *
 * Sprint 1'de veritabanına giren tek tablo settings olduğu için bu değerler
 * burada tanımlanır. Ayarlar anahtar-değer olarak saklanır; `valueType`
 * okuma sırasında doğru tipe dönüştürmeyi sağlar.
 */

/** Ayar değerinin saklanma tipi. */
export const SETTING_VALUE_TYPES = ['string', 'number', 'boolean', 'json'] as const;

export type SettingValueType = (typeof SETTING_VALUE_TYPES)[number];

/** Ayarların yönetim panelinde gruplanma başlıkları. */
export const SETTING_GROUPS = ['general', 'store', 'inventory', 'sales', 'seo', 'legal'] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * Bilinen ayar anahtarları.
 *
 * Kural 12: kodda serbest string ayar anahtarı kullanılmaz.
 */
export const SETTING_KEYS = {
  /** Mağaza görünen adı. */
  STORE_NAME: 'store.name',
  /** Mağaza telefonu (public). */
  STORE_PHONE: 'store.phone',
  /** Mağaza e-postası (public). */
  STORE_EMAIL: 'store.email',
  /** Mağaza açık adresi (public). */
  STORE_ADDRESS: 'store.address',
  /** Çalışma saatleri metni (public). */
  STORE_WORKING_HOURS: 'store.workingHours',
  /** WhatsApp numarası — ülke kodu dahil, yalnız rakam (public). */
  STORE_WHATSAPP: 'store.whatsapp',
  /** Harita/yol tarifi bağlantısı (public). */
  STORE_MAP_URL: 'store.mapUrl',
  /**
   * Ürün sayfasında gösterilen yasal uyarı metni (public).
   * SPEC §4.7 — zirai ilaç satışında zorunlu bilgilendirme.
   */
  LEGAL_PRODUCT_WARNING: 'legal.productWarning',
  /** Kritik stok uyarı eşiği. */
  INVENTORY_CRITICAL_STOCK_WARNING: 'inventory.criticalStockWarning',
  /** Sistem para birimi. */
  GENERAL_CURRENCY: 'general.currency',
  /** Varsayılan KDV oranı (yüzde, string). */
  SALES_DEFAULT_TAX_RATE: 'sales.defaultTaxRate',
  /**
   * Negatif stoğa izin verilsin mi?
   * Varsayılan false — docs/ARCHITECTURE.md §13.4.
   */
  INVENTORY_ALLOW_NEGATIVE_STOCK: 'inventory.allowNegativeStock',
  /** Talep numarası ön eki. */
  GENERAL_REQUEST_PREFIX: 'general.requestNumberPrefix',
  /** Satış numarası ön eki. */
  GENERAL_SALE_PREFIX: 'general.saleNumberPrefix',
  /** Ödeme numarası ön eki. */
  GENERAL_PAYMENT_PREFIX: 'general.paymentNumberPrefix',
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** Tek bir ayar kaydının API gösterimi. */
export interface SettingDto {
  key: string;
  value: string;
  valueType: SettingValueType;
  group: string;
  description: string | null;
  isPublic: boolean;
}
