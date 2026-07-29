import type { RequestContextInfo } from '../utils/request-context';

/**
 * İşlemi yapan kullanıcının bağlamı — denetim kaydı için.
 *
 * Controller'lar `toActor(user, request)` ile üretir; servisler bunu
 * `AuditLogsService`'e geçirir.
 */
export interface ActorContext extends RequestContextInfo {
  id: string;
}
