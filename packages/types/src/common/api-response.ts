import type { PaginationMeta } from './pagination';
import type { ErrorCode } from './error-codes';

/**
 * Standart API yanıt formatı — SPEC §14.
 * docs/ARCHITECTURE.md §7.1
 *
 * Bu tipler backend (ResponseInterceptor / AllExceptionsFilter) ve tüm
 * istemciler (web, ileride mobil) arasındaki tek sözleşmedir.
 */

/** Başarılı yanıt. `meta` yalnızca liste uçlarında bulunur. */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta?: PaginationMeta;
}

/** Hata yanıtının `error` gövdesi. */
export interface ApiErrorBody {
  /** Makine-okunur hata kodu. İstemci mantığı buna dayanır, message'a değil. */
  code: ErrorCode | string;
  /** Kullanıcıya gösterilebilir Türkçe mesaj. */
  message: string;
  /** Alan bazlı hata ayrıntıları. Hata yoksa boş dizi. */
  details: ApiErrorDetail[];
}

/** Tek bir alan/kural ihlali. */
export interface ApiErrorDetail {
  /** Hatalı alanın yolu. Örn. "items[2].quantity" */
  field?: string;
  /** Bu alana özgü açıklama. */
  message: string;
  /**
   * İş kuralına özgü MAKİNE-OKUNUR ek veri. İsteğe bağlıdır.
   *
   * Arayüzün `message` metnini ayrıştırmak zorunda kalmaması içindir:
   * yetersiz stok hatasında istenen/mevcut miktarı buradan okuyup tablo
   * çizebilir. Metin değişince arayüz bozulmaz.
   *
   * Değerler STRING'dir — para ve miktar alanları float'a uğratılmaz
   * (ARCHITECTURE §13.6).
   */
  context?: Readonly<Record<string, string>>;
}

/**
 * İş kuralı UYARISI — hata değildir.
 *
 * İşlem BAŞARIYLA tamamlanmıştır; uyarı, kullanıcının bilmesi gereken ama
 * işlemi engellemeyen bir durumu taşır. Tipik örnek: aynı telefonla ikinci
 * bir müşteri açmak. Bunu 409 ile engellemek yanlış olurdu — aynı hattı
 * paylaşan baba–oğul iki ayrı müşteri gerçek bir durumdur; ama sessizce
 * geçmek de yanlış olurdu, çünkü mükerrer kayıt borcu iki hesaba böler.
 *
 * Uyarılar yanıt gövdesinde `warnings` alanında taşınır; hata formatıyla
 * KARIŞTIRILMAZ, çünkü istemcinin bunları farklı göstermesi gerekir.
 */
export interface ApiWarning {
  /** Makine-okunur uyarı kodu. */
  code: string;
  /** Kullanıcıya gösterilebilir Türkçe mesaj. */
  message: string;
  /** Alan bazlı uyarılarda ilgili alanın yolu. */
  field?: string;
  /** Ek makine-okunur bağlam (ör. çakışan kaydın kimliği). */
  context?: Readonly<Record<string, string>>;
}

/** Uyarı taşıyabilen yanıt gövdesi. */
export interface WithWarnings {
  warnings?: ApiWarning[];
}

/** Makine-okunur uyarı kodları. */
export const WARNING_CODES = {
  /** Aynı telefon numarasıyla kayıtlı başka bir müşteri var. */
  DUPLICATE_PHONE: 'DUPLICATE_PHONE',
} as const;

export type WarningCode = (typeof WARNING_CODES)[keyof typeof WARNING_CODES];

/** Hata yanıtı. */
export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

/** Herhangi bir API yanıtı. */
export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

/** Sayfalanmış liste yanıtı. */
export type ApiPaginatedResponse<TItem> = ApiSuccessResponse<TItem[]> & {
  meta: PaginationMeta;
};

/**
 * Bir yanıtın başarılı olup olmadığını daraltan tip koruyucu.
 * İstemci kodunda `if (isApiSuccess(res)) { res.data ... }` şeklinde kullanılır.
 */
export function isApiSuccess<TData>(
  response: ApiResponse<TData>,
): response is ApiSuccessResponse<TData> {
  return response.success === true;
}

/** Bir yanıtın hata olup olmadığını daraltan tip koruyucu. */
export function isApiError<TData>(response: ApiResponse<TData>): response is ApiErrorResponse {
  return response.success === false;
}
