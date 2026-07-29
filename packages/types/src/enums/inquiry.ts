/**
 * Talep (inquiry) sabitleri ve durum makinesi.
 *
 * DURUM MAKİNESİ BURADA TANIMLIDIR ve backend ile arayüz AYNI tabloyu
 * okur. İki yerde ayrı ayrı tanımlanırsa arayüz, backend'in reddedeceği
 * bir geçişi kullanıcıya sunar — kullanıcı düğmeye basar, hata alır.
 *
 * Kaynak: docs/ARCHITECTURE.md §10.1 (V-15) + SPEC §12.
 */

export const INQUIRY_STATUSES = [
  'NEW',
  'REVIEWING',
  'CONTACTED',
  'QUOTED',
  'APPROVED',
  'CONVERTED_TO_SALE',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const INQUIRY_SOURCES = ['WEB', 'MOBILE', 'PHONE', 'IN_STORE'] as const;

export type InquirySource = (typeof INQUIRY_SOURCES)[number];

export const PREFERRED_CONTACTS = ['PHONE', 'WHATSAPP', 'EMAIL'] as const;

export type PreferredContact = (typeof PREFERRED_CONTACTS)[number];

/** Yönetim panelinde gösterilen Türkçe durum adları. */
export const INQUIRY_STATUS_LABELS: Readonly<Record<InquiryStatus, string>> = {
  NEW: 'Yeni',
  REVIEWING: 'İnceleniyor',
  CONTACTED: 'İletişime geçildi',
  QUOTED: 'Teklif verildi',
  APPROVED: 'Onaylandı',
  CONVERTED_TO_SALE: 'Satışa dönüştü',
  COMPLETED: 'Tamamlandı',
  REJECTED: 'Reddedildi',
  CANCELLED: 'İptal edildi',
};

export const PREFERRED_CONTACT_LABELS: Readonly<Record<PreferredContact, string>> = {
  PHONE: 'Telefon',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'E-posta',
};

export const INQUIRY_SOURCE_LABELS: Readonly<Record<InquirySource, string>> = {
  WEB: 'Web sitesi',
  MOBILE: 'Mobil uygulama',
  PHONE: 'Telefon',
  IN_STORE: 'Mağaza içi',
};

/**
 * Uç durumlar — bu durumlardan ÇIKIŞ YOKTUR.
 *
 * Kapanmış bir talebin yeniden açılması, geçmişi anlamsızlaştırır ve
 * finansal raporlarda hayalet kayıt üretir. Yeniden ele alınması gereken
 * bir iş için yeni talep açılır.
 */
export const TERMINAL_INQUIRY_STATUSES: readonly InquiryStatus[] = [
  'CONVERTED_TO_SALE',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

/**
 * Yalnız satışa dönüştürme akışının set edebileceği durum.
 *
 * `PATCH /admin/inquiries/:id/status` bunu REDDEDER: bir talep, karşılığında
 * satış kaydı oluşmadan "satışa dönüştü" sayılamaz. Sprint 8'deki dönüşüm
 * servisi bu durumu satışla birlikte tek transaction içinde yazacaktır.
 */
export const SALE_CONVERSION_STATUS: InquiryStatus = 'CONVERTED_TO_SALE';

/**
 * İzin verilen durum geçişleri (ARCHITECTURE §10.1).
 *
 * CANCELLED her aktif adımdan mümkündür: müşteri her aşamada vazgeçebilir.
 * REJECTED yalnız erken adımlardan mümkündür: teklif verildikten sonra
 * "spam" demek tutarsız olur, o noktada iptal doğru sözcüktür.
 */
export const ALLOWED_INQUIRY_TRANSITIONS: Readonly<
  Record<InquiryStatus, readonly InquiryStatus[]>
> = {
  NEW: ['REVIEWING', 'REJECTED', 'CANCELLED'],
  REVIEWING: ['CONTACTED', 'REJECTED', 'CANCELLED'],
  CONTACTED: ['QUOTED', 'COMPLETED', 'CANCELLED'],
  QUOTED: ['APPROVED', 'COMPLETED', 'CANCELLED'],
  APPROVED: ['CONVERTED_TO_SALE', 'COMPLETED', 'CANCELLED'],
  CONVERTED_TO_SALE: [],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** Bu geçiş yapılabilir mi? */
export function canTransitionInquiry(from: InquiryStatus, to: InquiryStatus): boolean {
  return ALLOWED_INQUIRY_TRANSITIONS[from].includes(to);
}

/** Bir durumdan gidilebilecek durumlar — arayüzde seçenek listesi kurmak için. */
export function nextInquiryStatuses(from: InquiryStatus): readonly InquiryStatus[] {
  return ALLOWED_INQUIRY_TRANSITIONS[from];
}

export function isTerminalInquiryStatus(status: InquiryStatus): boolean {
  return TERMINAL_INQUIRY_STATUSES.includes(status);
}

/** Talep numarası ön eki — ayarlardan okunur, bu yalnız yedek değerdir. */
export const DEFAULT_INQUIRY_PREFIX = 'TLP';

/** Bir talepte en fazla kalem sayısı. Kötüye kullanımı sınırlar. */
export const MAX_INQUIRY_ITEMS = 50;
