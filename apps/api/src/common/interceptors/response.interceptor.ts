import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { ApiSuccessResponse, PaginationMeta } from '@zirve/types';

/** Sarmalanmış ya da ham geçirilmiş yanıt. */
type WrappedResponse = ApiSuccessResponse<unknown> | StreamableFile;

/**
 * Controller'ların döndürdüğü ham veriyi SPEC §14 standart formatına sarar:
 *
 *   { "success": true, "data": ..., "meta": { page, limit, total, totalPages } }
 *
 * `meta` yalnızca servis `PaginatedResult` (yani `{ items, meta }`) döndürdüğünde
 * eklenir. Controller'lar sarmalama işini bilmez, düz veri döndürür.
 *
 * Dosya indirme (StreamableFile) yanıtları olduğu gibi geçirilir.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, WrappedResponse> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<WrappedResponse> {
    return next.handle().pipe(map((payload) => this.wrap(payload)));
  }

  private wrap(payload: unknown): WrappedResponse {
    // Dosya/stream yanıtları JSON değildir; sarmalanmaz.
    if (payload instanceof StreamableFile) {
      return payload;
    }

    if (isPaginatedResult(payload)) {
      return {
        success: true,
        data: payload.items,
        meta: payload.meta,
      };
    }

    return {
      success: true,
      data: payload ?? null,
    };
  }
}

/** `{ items, meta }` biçimindeki sayfalanmış servis sonucunu tanır. */
function isPaginatedResult(value: unknown): value is { items: unknown[]; meta: PaginationMeta } {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { items?: unknown; meta?: unknown };

  if (!Array.isArray(candidate.items)) {
    return false;
  }

  if (candidate.meta === null || typeof candidate.meta !== 'object') {
    return false;
  }

  const meta = candidate.meta as Partial<PaginationMeta>;

  return (
    typeof meta.page === 'number' &&
    typeof meta.limit === 'number' &&
    typeof meta.total === 'number' &&
    typeof meta.totalPages === 'number'
  );
}
