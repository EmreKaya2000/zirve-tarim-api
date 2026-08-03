/**
 * Satış, ödeme ve müşteri sabitleri.
 *
 * Talep durum makinesinde olduğu gibi, satış durum makinesi de BURADA
 * tanımlıdır ve backend ile arayüz AYNI tabloyu okur. İki yerde ayrı ayrı
 * tanımlanırsa arayüz, backend'in reddedeceği bir işlemi kullanıcıya sunar.
 */

// =============================================================================
// MÜŞTERİ
// =============================================================================

export const CUSTOMER_TYPES = ['INDIVIDUAL', 'CORPORATE'] as const;

export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const CUSTOMER_TYPE_LABELS: Readonly<Record<CustomerType, string>> = {
  INDIVIDUAL: 'Bireysel',
  CORPORATE: 'Kurumsal',
};

/** Müşteri kodu ön eki: MUS-000001. */
export const CUSTOMER_CODE_PREFIX = 'MUS';

/**
 * KARTSIZ (PERAKENDE) PEŞİN SATIŞ KARTI.
 *
 * Tezgâhtaki küçük peşin satışta müşteriden isim/telefon istemek işi
 * yavaşlatır. Zorunlu tutulduğunda personel ya sahte kart açar ya satışı hiç
 * girmez; ikincisinde stok gerçekle bir hafta içinde ayrışır. Bu yüzden tüm
 * kartsız satışlar TEK bir sistem kartına bağlanır.
 *
 * NEDEN BOOLEAN ALAN DEĞİL, SABİT KOD:
 *   1. Sıfır şema değişikliği. Bool alan hem migration hem de "tek perakende
 *      kartı" garantisi için partial unique index isterdi; Prisma partial
 *      index tanımlayamaz (bkz. 20260731163313_soft_delete_partial_unique).
 *      `customers.code` ZATEN tam unique — teklik bedava ve veritabanı
 *      garantisi.
 *   2. `code` zaten müşteri listesi ve satış yanıtı seçicilerinde var; hiçbir
 *      API sözleşmesi değişmiyor, işaret bugün taşınıyor.
 *   3. `code` UpdateCustomerDto'da YOK — işaret API'den değiştirilemez.
 *      Bool alan iki DTO'dan da elle dışarıda tutulmak zorunda kalır ve
 *      ileride bir PartialType refaktörü sessizce açardı.
 *
 * KOD BİÇİMİ: `customers.code` bir CHECK kısıtına tabidir. Sayısal biçimin
 * (`MUS-<yıl>-<6 hane>`) yanına AYRILMIŞ BİR SİSTEM ALANI eklendi:
 * `<ÖNEK>-SYS-<AD>`. `SYS` segmenti numara üreteci tarafından asla
 * üretilemez (o daima dört haneli yıl yazar), dolayısıyla çakışma imkânsız
 * ve kod listede okunduğunda ne olduğu anlaşılır. İleride başka bir sistem
 * kaydı gerekirse aynı kalıp kullanılır.
 */
export const RETAIL_CUSTOMER_CODE = 'MUS-SYS-PERAKENDE';

/** Perakende kartının görünen adı. */
export const RETAIL_CUSTOMER_NAME = 'Perakende Müşteri';

/** Bu kod perakende (kartsız satış) kartına mı ait? */
export function isRetailCustomer(code: string): boolean {
  return code === RETAIL_CUSTOMER_CODE;
}

/**
 * Müşteri tipine göre ZORUNLU alanlar (Sprint 7 şartı 2).
 *
 * Backend ile arayüz aynı tabloyu okur: form hangi alanı yıldızlı
 * göstereceğini, servis hangi alanı reddedeceğini buradan öğrenir. İki
 * yerde ayrı tanımlansaydı arayüz, backend'in reddedeceği bir kaydı
 * geçerli gösterirdi.
 *
 * BİREYSEL müşteride `fullName` AD VE SOYAD içermelidir — tek kelimelik
 * "Ahmet" kaydı, aynı adı taşıyan iki müşteri arasında ayrım bırakmaz.
 * KURUMSAL müşteride ticari unvan zorunludur: fatura o ada kesilir.
 */
export const CUSTOMER_REQUIRED_FIELDS: Readonly<Record<CustomerType, readonly string[]>> = {
  INDIVIDUAL: ['fullName'],
  CORPORATE: ['fullName', 'companyName'],
};

/** Bireysel müşteride ad + soyad aranır: en az iki kelime. */
export const INDIVIDUAL_NAME_MIN_WORDS = 2;

/**
 * `fullName` ad ve soyad içeriyor mu?
 *
 * Tek kaynak: aynı kontrol hem formda (kaydetmeden uyarmak için) hem
 * serviste (asıl zorlama) çalışır.
 */
export function hasFirstAndLastName(fullName: string): boolean {
  return fullName.trim().split(/\s+/).filter(Boolean).length >= INDIVIDUAL_NAME_MIN_WORDS;
}

/** Müşteri notu gövdesinin uzunluk sınırları. */
export const CUSTOMER_NOTE_MIN_LENGTH = 2;
export const CUSTOMER_NOTE_MAX_LENGTH = 4000;

// =============================================================================
// SATIŞ
// =============================================================================

export const SALE_STATUSES = ['DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];

export const SALE_STATUS_LABELS: Readonly<Record<SaleStatus, string>> = {
  DRAFT: 'Taslak',
  CONFIRMED: 'Onaylandı',
  PARTIALLY_PAID: 'Kısmi ödendi',
  PAID: 'Ödendi',
  CANCELLED: 'İptal edildi',
};

/**
 * Uç durumlar.
 *
 * PAID satış iptal EDİLEMEZ: tahsilat yapılmış bir satışı iptal etmek iade
 * işlemi gerektirir ve iade akışı bu sprintte yok. Yanlış girilen ödeme
 * önce silinir (satış PARTIALLY_PAID/CONFIRMED'a döner), sonra iptal edilir.
 */
export const TERMINAL_SALE_STATUSES: readonly SaleStatus[] = ['PAID', 'CANCELLED'];

/** Ödeme kabul eden durumlar. DRAFT ve CANCELLED'a ödeme eklenemez. */
export const PAYABLE_SALE_STATUSES: readonly SaleStatus[] = ['CONFIRMED', 'PARTIALLY_PAID'];

/** İptal edilebilen durumlar. */
export const CANCELLABLE_SALE_STATUSES: readonly SaleStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'PARTIALLY_PAID',
];

/**
 * Satış yalnız TASLAK durumunda düzenlenebilir.
 *
 * Onaylanmış satışın kalemleri değiştirilemez: müşteriye verilmiş bir
 * belgenin sonradan değişmesi, hem muhasebe hem güven sorunudur. Hata
 * varsa satış iptal edilip yenisi açılır.
 */
export const EDITABLE_SALE_STATUSES: readonly SaleStatus[] = ['DRAFT'];

export function isTerminalSaleStatus(status: SaleStatus): boolean {
  return TERMINAL_SALE_STATUSES.includes(status);
}

export function canAcceptPayment(status: SaleStatus): boolean {
  return PAYABLE_SALE_STATUSES.includes(status);
}

export function canCancelSale(status: SaleStatus): boolean {
  return CANCELLABLE_SALE_STATUSES.includes(status);
}

export function canEditSale(status: SaleStatus): boolean {
  return EDITABLE_SALE_STATUSES.includes(status);
}

// =============================================================================
// ÖDEME
// =============================================================================

export const PAYMENT_TYPES = ['CASH', 'CREDIT'] as const;

export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Readonly<Record<PaymentType, string>> = {
  CASH: 'Peşin',
  CREDIT: 'Vadeli',
};

export const PAYMENT_METHODS = [
  'CASH',
  'BANK_TRANSFER',
  'CREDIT_CARD',
  'CHECK',
  'PROMISSORY_NOTE',
  'OFFSET',
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = {
  CASH: 'Nakit',
  BANK_TRANSFER: 'Havale / EFT',
  CREDIT_CARD: 'Kredi kartı',
  CHECK: 'Çek',
  PROMISSORY_NOTE: 'Senet',
  OFFSET: 'Mahsup',
};

/**
 * Vade tarihi ZORUNLU olan ödeme yöntemleri.
 *
 * Vadesiz bir çek takip edilemez: ne zaman tahsil edileceği bilinmeyen bir
 * kıymetli evrak, borç raporunda yanlış tarafta durur.
 */
export const DUE_DATE_REQUIRED_METHODS: readonly PaymentMethod[] = ['CHECK', 'PROMISSORY_NOTE'];

export function requiresPaymentDueDate(method: PaymentMethod): boolean {
  return DUE_DATE_REQUIRED_METHODS.includes(method);
}

/** Belge numarası ön ekleri. */
export const SALE_NUMBER_PREFIX = 'SAT';
export const PAYMENT_NUMBER_PREFIX = 'ODM';

/** Ek maliyet türleri — serbest metin değil, sabit liste (Kural 12). */
export const ADDITIONAL_COST_TYPES = [
  'SHIPPING',
  'FREIGHT',
  'COMMISSION',
  'LABOR',
  'PACKAGING',
  'OTHER',
] as const;

export type AdditionalCostType = (typeof ADDITIONAL_COST_TYPES)[number];

export const ADDITIONAL_COST_TYPE_LABELS: Readonly<Record<AdditionalCostType, string>> = {
  SHIPPING: 'Nakliye',
  FREIGHT: 'Kargo',
  COMMISSION: 'Komisyon',
  LABOR: 'İşçilik',
  PACKAGING: 'Ambalaj',
  OTHER: 'Diğer',
};

/** Bir satışta en fazla kalem sayısı. */
export const MAX_SALE_ITEMS = 200;

/**
 * Public yanıtta ASLA bulunmaması gereken finansal alanlar.
 *
 * Kural 8'in test edilebilir hâli: sızıntı testi bu listeyi gezer.
 * Yeni bir hassas alan eklendiğinde buraya da eklenmelidir.
 */
export const FORBIDDEN_FINANCIAL_FIELDS: readonly string[] = [
  'unitPurchasePrice',
  'lineCost',
  'lineProfit',
  'costTotal',
  'additionalCostTotal',
  'grossProfit',
  'netProfit',
  'creditLimit',
  'openingBalance',
];
