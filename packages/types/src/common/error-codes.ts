/**
 * Makine-okunur hata kodları.
 *
 * Kural 12 (magic number/string yok): hata kodları kodun içine serbest string
 * olarak yazılmaz, buradan kullanılır. İstemci mantığı `message` metnine değil
 * daima bu koda dayanır.
 *
 * Sprint 1'de yalnız altyapı ve genel kodlar tanımlıdır; iş kuralı kodları
 * (INSUFFICIENT_STOCK, CREDIT_LIMIT_EXCEEDED vb.) ilgili sprintlerde eklenecek.
 */
export const ERROR_CODES = {
  // --- Genel / altyapı ---
  /** Beklenmeyen sunucu hatası. Ayrıntı istemciye sızdırılmaz. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** İstek gövdesi veya parametreleri şema doğrulamasından geçemedi. */
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  /** Kaynak bulunamadı. */
  NOT_FOUND: 'NOT_FOUND',
  /** Benzersizlik veya durum çakışması. */
  CONFLICT: 'CONFLICT',
  /** İş kuralı ihlali (şema doğru ama işlem izinli değil). */
  UNPROCESSABLE: 'UNPROCESSABLE',
  /** İstek gövdesi hatalı biçimli. */
  BAD_REQUEST: 'BAD_REQUEST',
  /** İstek sayısı sınırı aşıldı. */
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  /** Servis geçici olarak kullanılamıyor (ör. veritabanı erişilemez). */
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // --- Kimlik ve yetki ---
  /** Kimlik bilgisi yok veya geçersiz. */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Kimlik geçerli ama bu işlem için yetki yok. */
  FORBIDDEN: 'FORBIDDEN',
  /** Erişim jetonu süresi doldu. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** Yenileme jetonu geçersiz veya iptal edilmiş. */
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  /** E-posta veya şifre hatalı. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** Hesap geçici olarak kilitli. */
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  /** Hesap pasife alınmış; giriş yapamaz. */
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',

  // --- Kullanıcı yönetimi ---
  /** Bu e-posta ile kayıtlı bir kullanıcı zaten var. */
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  /** Kullanıcı kendi hesabı üzerinde bu işlemi yapamaz. */
  SELF_ACTION_FORBIDDEN: 'SELF_ACTION_FORBIDDEN',
  /** Sistemde en az bir aktif SUPER_ADMIN kalmalıdır. */
  LAST_SUPER_ADMIN: 'LAST_SUPER_ADMIN',

  // --- Stok ---
  /**
   * Çıkış hareketi mevcut stoğu aşıyor. Negatif stok yasaktır (§13.4).
   * `details` eksik kalan her kalemi ve o kalemin mevcut stoğunu taşır.
   */
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',

  // --- Müşteri hesabı (Sprint 11) ---
  /**
   * Şifre politikayı karşılamıyor (min uzunluk, harf + rakam).
   *
   * `VALIDATION_ERROR`dan ayrı tutuldu: arayüz bu kodu görünce şifre
   * kurallarını hatırlatan yardım metnini açar.
   */
  WEAK_PASSWORD: 'WEAK_PASSWORD',

  /**
   * İşlem e-posta doğrulaması gerektiriyor.
   *
   * Bugün YALNIZ geçmiş misafir taleplerinin hesaba bağlanmasında kullanılır;
   * giriş yapmak için doğrulama gerekmez.
   */
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',

  /**
   * Doğrulama / şifre sıfırlama jetonu geçersiz, süresi dolmuş veya
   * KULLANILMIŞ. Üç durum tek kodla döner: hangisi olduğunu söylemek,
   * geçerli jeton adreslerini tarayan birine bilgi verirdi.
   */
  INVALID_TOKEN: 'INVALID_TOKEN',

  /** KVKK onayı verilmeden kayıt/talep oluşturulamaz. */
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',

  /**
   * Hesap ↔ müşteri kartı bağlanamıyor: kart başka bir hesaba bağlı ya da
   * hesap zaten başka bir karta bağlı (1↔1 kardinalitesi).
   */
  ACCOUNT_LINK_CONFLICT: 'ACCOUNT_LINK_CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Hata kodlarının varsayılan Türkçe karşılıkları.
 * Servisler daha bağlamsal bir mesaj verebilir; bu liste geri düşüş içindir.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.INTERNAL_ERROR]: 'Beklenmeyen bir hata oluştu.',
  [ERROR_CODES.VALIDATION_ERROR]: 'Gönderilen veriler geçerli değil.',
  [ERROR_CODES.NOT_FOUND]: 'Kayıt bulunamadı.',
  [ERROR_CODES.CONFLICT]: 'İşlem mevcut kayıtla çakışıyor.',
  [ERROR_CODES.UNPROCESSABLE]: 'İşlem iş kuralları nedeniyle gerçekleştirilemedi.',
  [ERROR_CODES.BAD_REQUEST]: 'Geçersiz istek.',
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 'Çok fazla istek gönderildi. Lütfen biraz bekleyin.',
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 'Servis şu anda kullanılamıyor.',
  [ERROR_CODES.UNAUTHORIZED]: 'Bu işlem için giriş yapmanız gerekiyor.',
  [ERROR_CODES.FORBIDDEN]: 'Bu işlem için yetkiniz yok.',
  [ERROR_CODES.TOKEN_EXPIRED]: 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.',
  [ERROR_CODES.INVALID_REFRESH_TOKEN]: 'Oturum geçersiz. Lütfen tekrar giriş yapın.',
  [ERROR_CODES.INVALID_CREDENTIALS]: 'E-posta veya şifre hatalı.',
  [ERROR_CODES.ACCOUNT_LOCKED]: 'Hesabınız geçici olarak kilitlendi. Lütfen daha sonra deneyin.',
  [ERROR_CODES.ACCOUNT_INACTIVE]: 'Hesabınız aktif değil. Lütfen yöneticinizle görüşün.',
  [ERROR_CODES.EMAIL_ALREADY_EXISTS]: 'Bu e-posta adresi zaten kullanılıyor.',
  [ERROR_CODES.SELF_ACTION_FORBIDDEN]: 'Bu işlemi kendi hesabınız üzerinde yapamazsınız.',
  [ERROR_CODES.LAST_SUPER_ADMIN]: 'Sistemde en az bir aktif süper yönetici bulunmalıdır.',
  [ERROR_CODES.INSUFFICIENT_STOCK]: 'Stok yetersiz.',
  [ERROR_CODES.WEAK_PASSWORD]:
    'Şifre en az 8 karakter olmalı ve en az bir harf ile bir rakam içermelidir.',
  [ERROR_CODES.EMAIL_NOT_VERIFIED]: 'Bu işlem için e-posta adresinizi doğrulamanız gerekiyor.',
  [ERROR_CODES.INVALID_TOKEN]: 'Bağlantı geçersiz veya süresi dolmuş. Lütfen yeniden talep edin.',
  [ERROR_CODES.CONSENT_REQUIRED]: 'Devam etmek için aydınlatma metnini onaylamanız gerekir.',
  [ERROR_CODES.ACCOUNT_LINK_CONFLICT]: 'Bu bağlantı kurulamıyor: kayıtlardan biri zaten bağlı.',
};
