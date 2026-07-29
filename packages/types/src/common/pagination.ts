/**
 * Sayfalama, arama, filtreleme ve sıralama sözleşmesi.
 * Tüm liste uçlarında aynıdır — docs/ARCHITECTURE.md §7.1, Kural 12.
 */

/** Varsayılan sayfa numarası. */
export const DEFAULT_PAGE = 1;

/** Varsayılan sayfa boyutu. */
export const DEFAULT_LIMIT = 20;

/** İzin verilen azami sayfa boyutu. Aşan istekler reddedilir. */
export const MAX_LIMIT = 100;

/** İzin verilen asgari sayfa boyutu. */
export const MIN_LIMIT = 1;

/** Sıralama yönü. */
export const SORT_ORDERS = ['asc', 'desc'] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

/** Varsayılan sıralama yönü. */
export const DEFAULT_SORT_ORDER: SortOrder = 'desc';

/** Varsayılan sıralama alanı. */
export const DEFAULT_SORT_BY = 'createdAt';

/** Tüm liste uçlarının kabul ettiği ortak sorgu parametreleri. */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
  /** ISO 8601 tarih (dahil). */
  dateFrom?: string;
  /** ISO 8601 tarih (dahil). */
  dateTo?: string;
}

/** Liste yanıtlarındaki sayfalama üstverisi. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Servis katmanının döndürdüğü sayfalanmış sonuç.
 * ResponseInterceptor bunu `{ success, data, meta }` biçimine sarar.
 */
export interface PaginatedResult<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

/**
 * Toplam kayıt sayısı ve sayfa parametrelerinden üstveri üretir.
 * `totalPages` daima `ceil(total / limit)`; total 0 ise 0 döner.
 */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const safeLimit = Math.max(MIN_LIMIT, Math.min(limit, MAX_LIMIT));
  const safePage = Math.max(DEFAULT_PAGE, page);

  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
  };
}

/** Sayfa/limit değerlerinden Prisma `skip`/`take` hesaplar. */
export function toSkipTake(page: number, limit: number): { skip: number; take: number } {
  const safeLimit = Math.max(MIN_LIMIT, Math.min(limit, MAX_LIMIT));
  const safePage = Math.max(DEFAULT_PAGE, page);

  return {
    skip: (safePage - 1) * safeLimit,
    take: safeLimit,
  };
}
