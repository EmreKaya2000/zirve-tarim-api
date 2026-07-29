import type { UserRole } from '../enums/user-role';

/** Kimlik doğrulama sözleşmesi — /auth/* uçları. */

/** Oturum açmış kullanıcının güvenli gösterimi. Şifre/hash ASLA taşınmaz. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  isActive: boolean;
  /** ISO 8601, UTC. Hiç giriş yapmadıysa null. */
  lastLoginAt: string | null;
  createdAt: string;
}

/** POST /auth/login isteği. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** POST /auth/login ve /auth/refresh yanıtı. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access token'ın kalan ömrü (saniye). İstemci yenilemeyi buna göre zamanlar. */
  expiresIn: number;
  tokenType: 'Bearer';
}

/** POST /auth/login yanıtının `data` gövdesi. */
export interface LoginResponse extends AuthTokens {
  user: AuthUser;
}

/** POST /auth/refresh isteği. */
export interface RefreshRequest {
  refreshToken: string;
}

/** JWT access token'ın çözülmüş içeriği. */
export interface JwtPayload {
  /** Kullanıcı id'si. */
  sub: string;
  email: string;
  role: UserRole;
  /** Jeton kimliği — iptal takibi için. */
  jti: string;
  /** Veriliş zamanı (saniye). */
  iat: number;
  /** Son kullanma (saniye). */
  exp: number;
}

/**
 * Access token'ın yenilenmesi için son kullanma tarihinden ne kadar önce
 * harekete geçileceği (saniye). Ağ gecikmesi ve saat kayması payı.
 */
export const TOKEN_REFRESH_LEEWAY_SECONDS = 60;
