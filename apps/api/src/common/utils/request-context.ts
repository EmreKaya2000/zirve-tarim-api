import type { Request } from 'express';

/** İstemci IP'si ve tarayıcı bilgisi — denetim kaydı ve jeton takibi için. */
export interface RequestContextInfo {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * İstekten istemci bağlamını çıkarır.
 *
 * `trust proxy` açık olduğu için (main.ts) Express `req.ip` değerini
 * X-Forwarded-For başlığından doğru şekilde türetir; başlık elle
 * ayrıştırılmaz — sahtecilik yüzeyi açmamak için.
 */
export function getRequestContext(request: Request): RequestContextInfo {
  const userAgent = request.get('user-agent');

  return {
    ipAddress: request.ip ?? null,
    userAgent: userAgent === undefined ? null : userAgent.slice(0, 255),
  };
}
