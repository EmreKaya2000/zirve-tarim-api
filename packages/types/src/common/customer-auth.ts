import type { InquiryStatus } from '../enums/inquiry';
import type { PreferredContact } from '../enums/inquiry';

/**
 * Müşteri (public) kimlik doğrulama ve sepet sözleşmesi — Sprint 11.
 *
 * Yönetim panelinin sözleşmesi `auth.ts` içindedir ve BURAYLA KARIŞTIRILMAZ.
 * İki kimlik alanı bilinçli olarak ayrıdır: jetonlar farklı `aud` (audience)
 * değeri taşır ve birbirinin uçlarında GEÇERSİZDİR (docs/ARCHITECTURE.md §8.4).
 */

// =============================================================================
// JETON AUDIENCE'I
// =============================================================================

/**
 * Jeton hedef kitlesi (JWT `aud` iddiası).
 *
 * NEDEN AUDIENCE, NEDEN AYRI SIR DEĞİL:
 * `aud` iddiası jetonun İMZASININ İÇİNDEDİR; değiştirilirse imza bozulur.
 * Doğrulama tarafı beklediği audience'ı `verify` seçeneği olarak verir, yani
 * kontrol kütüphane seviyesinde ve atlanamaz biçimde yapılır. Kod içinde
 * `if (payload.aud !== ...)` yazmak da işe yarardı ama tek bir guard'da bu
 * satırı yazmayı unutmak sessiz bir yetki açığı olurdu.
 *
 * Sırların da ayrılması ek bir katmandır (JWT_CUSTOMER_ACCESS_SECRET);
 * audience tek başına yeterlidir, ikisi birlikte savunma derinliği sağlar.
 */
export const TOKEN_AUDIENCES = {
  /** Yönetim paneli kullanıcısı (`users`). */
  ADMIN: 'zirve-admin',
  /** Public müşteri hesabı (`customer_accounts`). */
  CUSTOMER: 'zirve-customer',
} as const;

export type TokenAudience = (typeof TOKEN_AUDIENCES)[keyof typeof TOKEN_AUDIENCES];

/** Jetonu üreten taraf — `iss` iddiası. */
export const TOKEN_ISSUER = 'zirve-tarim';

// =============================================================================
// ŞİFRE POLİTİKASI
// =============================================================================

/** En az uzunluk (Sprint 11 şartı: min 8). */
export const CUSTOMER_PASSWORD_MIN_LENGTH = 8;

/**
 * En fazla uzunluk.
 *
 * Argon2 uzun girdiyi de özetler ama sınırsız uzunluk bir DoS yüzeyidir:
 * 1 MB'lık bir "şifre" her denemede 19 MiB bellekli bir hash hesabı tetikler.
 */
export const CUSTOMER_PASSWORD_MAX_LENGTH = 128;

/**
 * Şifre en az bir harf ve bir rakam içermelidir (Sprint 11 şartı).
 *
 * Özel karakter ZORUNLU DEĞİLDİR: NIST SP 800-63B karmaşıklık kurallarının
 * kullanıcıyı öngörülebilir kalıplara ittiğini söyler ("Sifre123!"). Uzunluk
 * asıl korumadır; buradaki kural şartın asgarisini karşılar.
 */
export const CUSTOMER_PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*\d).+$/u;

export const CUSTOMER_PASSWORD_RULE_MESSAGE =
  `Şifre en az ${CUSTOMER_PASSWORD_MIN_LENGTH} karakter olmalı ve ` +
  'en az bir harf ile bir rakam içermelidir.';

/** Şifre politikasını uygular. Backend ve arayüz AYNI işlevi kullanır. */
export function isValidCustomerPassword(password: string): boolean {
  return (
    password.length >= CUSTOMER_PASSWORD_MIN_LENGTH &&
    password.length <= CUSTOMER_PASSWORD_MAX_LENGTH &&
    CUSTOMER_PASSWORD_PATTERN.test(password)
  );
}

// =============================================================================
// HESAP
// =============================================================================

/** Müşteri hesabının güvenli gösterimi. `passwordHash` ASLA taşınmaz. */
export interface CustomerAccountProfile {
  id: string;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  /** `firstName + lastName` — talep formunu ön doldurmak için hazır hâli. */
  fullName: string;
  /** ISO 8601. NULL ise e-posta doğrulanmamıştır. */
  emailVerifiedAt: string | null;
  isEmailVerified: boolean;
  /**
   * Hesabın bir CRM müşteri kartına bağlı olup olmadığı.
   *
   * Yalnız BOOLEAN döner: müşteri kartının kodu, borcu veya kredi limiti
   * public tarafa SIZMAZ (Kural 8). Borç görüntüleme bu sprintin kapsamı
   * dışındadır.
   */
  hasLinkedCustomer: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** POST /customer-auth/register isteği. */
export interface CustomerRegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  consentAccepted: boolean;
}

/** POST /customer-auth/login ve /refresh yanıtı. */
export interface CustomerAuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token'ın kalan ömrü (saniye). */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface CustomerLoginResponse extends CustomerAuthTokens {
  account: CustomerAccountProfile;
}

/**
 * Kayıt yanıtı — KASITEN İÇERİKSİZ.
 *
 * JETON DÖNMEZ ve bu bilinçli bir ödünleşmedir.
 *
 * Kayıt ucu oturum açmış hâlde dönseydi, e-posta zaten kayıtlıyken jeton
 * dönemezdi (o hesabın sahibi olmadığımızı bilmiyoruz) ve yanıt biçimi
 * ayrışırdı: "jeton geldi" = adres boş, "gelmedi" = adres kayıtlı. Bu, tam
 * olarak engellemeye çalıştığımız kullanıcı sayımı (enumeration) açığıdır.
 *
 * Bu yüzden yanıt HER İKİ DURUMDA DA aynıdır ve istemci kayıttan sonra
 * `POST /customer-auth/login` çağırır. Adres başkasınınsa giriş
 * `INVALID_CREDENTIALS` ile döner — bu da "hesap var" demez, çünkü aynı hata
 * yanlış şifre için de gelir.
 */
export interface CustomerRegisterResponse {
  /** DAİMA `true`. Adres kayıtlı olsa da aynı değer döner. */
  success: true;
  /** Kullanıcıya gösterilecek genel bilgilendirme. */
  message: string;
}

/** JWT müşteri access token'ının çözülmüş içeriği. */
export interface CustomerJwtPayload {
  /** `customer_accounts.id` */
  sub: string;
  email: string;
  /** DAİMA `zirve-customer`. Admin jetonunda `zirve-admin` olur. */
  aud: string;
  iss: string;
  jti: string;
  iat: number;
  exp: number;
}

/**
 * POST /customer-auth/verify-email yanıtı.
 *
 * `linkedInquiryCount`: doğrulama sonrasında hesaba TAŞINAN geçmiş misafir
 * talep sayısı. Arayüz bunu görürse "3 eski talebiniz hesabınıza eklendi"
 * bildirimi gösterir — kullanıcı Taleplerim'de neden yeni kayıtlar
 * gördüğünü anlar.
 */
export interface CustomerVerifyEmailResponse {
  account: CustomerAccountProfile;
  linkedInquiryCount: number;
}

/** GET/PATCH /customer/profile — düzenlenebilir alanlar. */
export interface CustomerProfileUpdateRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  /**
   * Yeni e-posta adresi.
   *
   * DEĞİŞİKLİK ANINDA UYGULANMAZ: yeni adrese doğrulama bağlantısı gönderilir
   * ve hesabın adresi ancak bağlantı açıldığında güncellenir. Aksi hâlde
   * yanlış yazılmış bir adres hesabı kalıcı olarak erişilemez yapardı.
   */
  email?: string;
}

/** PATCH /customer/profile yanıtı. */
export interface CustomerProfileUpdateResponse {
  account: CustomerAccountProfile;
  /**
   * Doğrulanması beklenen yeni e-posta adresi. Değişiklik istenmediyse null.
   * Arayüz bunu görürse "posta kutunuzu kontrol edin" uyarısı gösterir.
   */
  pendingEmail: string | null;
}

// =============================================================================
// SEPET
// =============================================================================

/**
 * Sepet kaleminin okuma gösterimi.
 *
 * Ürün adı, fiyat ve miktar kuralları HER OKUMADA katalogdan gelir —
 * `cart_items` snapshot tutmaz (bkz. şemadaki gerekçe).
 */
export interface CartItemView {
  id: string;
  productId: string;
  productVariantId: string;
  productName: string;
  productSlug: string;
  variantName: string | null;
  sku: string;
  imageUrl: string | null;
  /** Sayısal METİN (Kural 2). */
  quantity: string;
  unitCode: string;
  unitName: string;
  allowsDecimal: boolean;
  minOrderQuantity: string;
  quantityStep: string;
  maxOrderQuantity: string | null;
  /** Ürünün fiyatı gizliyse null ("Fiyat sorunuz"). */
  displayedPrice: string | null;
  lineTotal: string | null;
  /** Talep stok rezerve etmez; bu yalnız bilgilendirmedir. */
  inStock: boolean;

  /**
   * Kalem hâlâ talep edilebilir mi?
   *
   * Yayından kalkan ürün sepetten SİLİNMEZ, işaretlenir: okuma isteğinin
   * satır silmesi hem bir GET'in yazma yapması olurdu hem de kullanıcı
   * ürünün neden kaybolduğunu asla öğrenemezdi. Arayüz bu kalemi uyarıyla
   * gösterir ve talep gönderiminden önce kaldırılmasını ister.
   */
  isAvailable: boolean;
  /** `isAvailable` false ise kullanıcıya gösterilecek neden; değilse null. */
  unavailableReason: string | null;
}

export interface CartView {
  items: CartItemView[];
  /** Farklı kalem sayısı (miktarların toplamı DEĞİL). */
  itemCount: number;
  /** Yalnız fiyatı gösterilen kalemlerden. BAĞLAYICI DEĞİLDİR. */
  estimatedTotal: string;
  hasHiddenPrices: boolean;
  updatedAt: string | null;
}

/**
 * Sepet birleştirmede bir kalemin atlanma nedeni.
 *
 * Kod olarak döner (Kural 12): arayüz metni değiştirmek isterse sunucuyu
 * değiştirmek zorunda kalmasın, ama `message` de gönderilir ki istemci
 * bilinmeyen bir kodu yine de gösterebilsin.
 */
export const CART_SKIP_REASONS = {
  /** Varyasyon hiç bulunamadı (silinmiş veya uydurma kimlik). */
  VARIANT_NOT_FOUND: 'VARIANT_NOT_FOUND',
  /** Varyasyon pasif veya soft delete edilmiş. */
  VARIANT_UNAVAILABLE: 'VARIANT_UNAVAILABLE',
  /** Ürün pasif, yayından kalkmış veya silinmiş. */
  PRODUCT_UNAVAILABLE: 'PRODUCT_UNAVAILABLE',
  /** Miktar sayı değil, sıfır veya negatif. */
  INVALID_QUANTITY: 'INVALID_QUANTITY',
  /**
   * Geçerli hiçbir miktar üretilemedi: `minOrderQuantity > maxOrderQuantity`
   * gibi tutarsız bir varyasyon yapılandırması.
   */
  NO_VALID_QUANTITY: 'NO_VALID_QUANTITY',
  /** Sepet kalem sınırına ulaşıldı; kalan kalemler eklenmedi. */
  CART_LIMIT_REACHED: 'CART_LIMIT_REACHED',
} as const;

export type CartSkipReason = (typeof CART_SKIP_REASONS)[keyof typeof CART_SKIP_REASONS];

export const CART_SKIP_REASON_LABELS: Record<CartSkipReason, string> = {
  [CART_SKIP_REASONS.VARIANT_NOT_FOUND]: 'Ürün artık katalogda bulunmuyor.',
  [CART_SKIP_REASONS.VARIANT_UNAVAILABLE]: 'Bu satış birimi artık mevcut değil.',
  [CART_SKIP_REASONS.PRODUCT_UNAVAILABLE]: 'Ürün artık satışta değil.',
  [CART_SKIP_REASONS.INVALID_QUANTITY]: 'Miktar geçersiz olduğu için eklenmedi.',
  [CART_SKIP_REASONS.NO_VALID_QUANTITY]: 'Bu ürün için geçerli bir miktar belirlenemedi.',
  [CART_SKIP_REASONS.CART_LIMIT_REACHED]: 'Sepet kalem sınırına ulaşıldı.',
};

export interface CartSkippedItem {
  productVariantId: string;
  /** Bilinebiliyorsa ürün adı; varyasyon hiç bulunamadıysa null. */
  productName: string | null;
  reason: CartSkipReason;
  /** Kullanıcıya gösterilmeye hazır Türkçe açıklama. */
  message: string;
}

/**
 * Miktarı kurallara uydurmak için DEĞİŞTİRİLEN kalem.
 *
 * Atlanan kalemden farkı: bu kalem sepete GİRDİ ama istenen miktarla değil.
 * Sessizce yapılsaydı kullanıcı 12 kg istediğini sanarken sepetinde 10 kg
 * bulurdu; toast ile bildirilmesi için ayrı liste döner.
 */
export interface CartAdjustedItem {
  productVariantId: string;
  productName: string;
  requestedQuantity: string;
  finalQuantity: string;
  unitCode: string;
  message: string;
}

/** POST /customer/cart/merge isteği — localStorage sepeti. */
export interface CartMergeRequest {
  items: { productVariantId: string; quantity: string }[];
}

export interface CartMergeResult {
  cart: CartView;
  /** Eklenen (sepette hiç olmayan) kalem sayısı. */
  addedCount: number;
  /** Miktarı toplandığı için güncellenen kalem sayısı. */
  mergedCount: number;
  skippedItems: CartSkippedItem[];
  adjustedItems: CartAdjustedItem[];
}

// =============================================================================
// TALEPLERİM
// =============================================================================

export interface CustomerInquiryListItem {
  inquiryNumber: string;
  status: InquiryStatus;
  createdAt: string;
  itemCount: number;
  estimatedTotal: string;
  currency: string;
}

export interface CustomerInquiryDetailItem {
  productName: string;
  variantName: string | null;
  sku: string;
  unitTypeName: string;
  quantity: string;
  displayedPrice: string | null;
  lineTotal: string | null;
  note: string | null;
  /** Ürün hâlâ yayındaysa adresi; değilse null (bağlantı gösterilmez). */
  productSlug: string | null;
}

/**
 * Talep detayı — MÜŞTERİ GÖRÜNÜMÜ.
 *
 * Kural 8: `internalNote`, `ipAddress`, `userAgent`, atanmış personel ve
 * müşterinin CRM kartı BU YANITTA YOKTUR. Yönetim görünümünden alan
 * çıkararak değil, ayrı bir seçiciyle üretilir — `include` ile yazılsaydı
 * ileride şemaya eklenecek bir alan sessizce dışarı sızardı.
 */
export interface CustomerInquiryDetail {
  inquiryNumber: string;
  status: InquiryStatus;
  createdAt: string;
  contactedAt: string | null;
  closedAt: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  city: string;
  district: string;
  address: string | null;
  preferredContact: PreferredContact;
  customerNote: string | null;
  estimatedTotal: string;
  currency: string;
  items: CustomerInquiryDetailItem[];
}
