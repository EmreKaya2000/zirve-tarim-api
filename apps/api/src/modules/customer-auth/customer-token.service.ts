import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { TOKEN_AUDIENCES, TOKEN_ISSUER } from '@zirve/types';

import { AppConfig } from '../../config/app.config';
import { generateRawToken, hashToken } from '../../common/utils/token-hash';
import { parseDuration } from '../auth/token.service';

/**
 * Müşteri jetonlarının iptal gerekçeleri (Kural 12).
 *
 * `REVOKE_REASONS` (yönetici) ile aynı değerleri paylaşan ayrı bir sabit
 * kümesidir: `USER_DEACTIVATED` yerine `ACCOUNT_DEACTIVATED` yazar. Aynı
 * nesne kullanılsaydı denetim kaydını okuyan kişi "user" kelimesini görüp
 * bir yönetici hesabının düşürüldüğünü sanardı.
 */
export const CUSTOMER_REVOKE_REASONS = {
  ROTATED: 'ROTATED',
  LOGOUT: 'LOGOUT',
  REUSE_DETECTED: 'REUSE_DETECTED',
  ACCOUNT_DEACTIVATED: 'ACCOUNT_DEACTIVATED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
} as const;

export type CustomerRevokeReason =
  (typeof CUSTOMER_REVOKE_REASONS)[keyof typeof CUSTOMER_REVOKE_REASONS];

export interface IssuedCustomerTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface CustomerTokenContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Müşteri jetonlarının üretimi, saklanması ve iptali.
 *
 * NEDEN `TokenService`İN YANINDA AYRI BİR SINIF:
 *
 *   1. FARKLI TABLO. Jetonlar `customer_refresh_tokens`a yazılır. Tek servisle
 *      yapılabilmesi için tablo adının parametre olarak geçirilmesi gerekirdi;
 *      Prisma'nın üretilmiş tipleri buna izin vermez (her delege ayrı tiptir)
 *      ve `any`ye düşmek yabancı anahtar güvencesini kaybettirirdi.
 *   2. FARKLI SIR VE AUDIENCE. Müşteri jetonu `JWT_CUSTOMER_ACCESS_SECRET` ile
 *      imzalanır ve `aud: zirve-customer` taşır. Aynı kod yolunda iki kimlik
 *      alanını yönetmek, "hangi sırla imzalandı" sorusunu her çağrıda
 *      parametreye bırakırdı — yanlış parametre sessiz bir yetki açığıdır.
 *   3. FARKLI ÖMÜR. Vitrin oturumu daha uzundur (bkz. env.validation.ts).
 *
 * Ortak olan kısım (rastgele jeton üretimi ve SHA-256 özeti) tek yerde
 * durur: `common/utils/token-hash.ts`.
 */
@Injectable()
export class CustomerTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfig,
  ) {}

  /** Ham refresh token'ın veritabanında aranacak özetini üretir. */
  hashRefreshToken(rawToken: string): string {
    return hashToken(rawToken);
  }

  /**
   * Yeni bir access + refresh token çifti üretir ve refresh'i kaydeder.
   *
   * @param replacedTokenHash Rotasyonda, yerine geçilen jetonun özeti.
   */
  async issueTokens(
    tx: Prisma.TransactionClient,
    account: { id: string; email: string },
    context: CustomerTokenContext,
    replacedTokenHash?: string,
  ): Promise<IssuedCustomerTokens> {
    const expiresIn = this.accessTokenSeconds;

    const accessToken = await this.jwtService.signAsync(
      { sub: account.id, email: account.email, jti: randomUUID() },
      {
        secret: this.config.jwtCustomerAccessSecret,
        expiresIn,
        audience: TOKEN_AUDIENCES.CUSTOMER,
        issuer: TOKEN_ISSUER,
      },
    );

    const rawRefreshToken = generateRawToken();
    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    await tx.customerRefreshToken.create({
      data: {
        customerAccountId: account.id,
        tokenHash,
        expiresAt: new Date(Date.now() + this.refreshTokenSeconds * 1000),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      },
    });

    if (replacedTokenHash !== undefined) {
      await tx.customerRefreshToken.update({
        where: { tokenHash: replacedTokenHash },
        data: { replacedByTokenHash: tokenHash },
      });
    }

    return { accessToken, refreshToken: rawRefreshToken, expiresIn };
  }

  /** Tek bir refresh token'ı iptal eder. */
  async revoke(
    tx: Prisma.TransactionClient,
    tokenHash: string,
    reason: CustomerRevokeReason,
  ): Promise<void> {
    await tx.customerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Hesabın TÜM aktif oturumlarını iptal eder.
   *
   * Üç durumda çağrılır: jeton yeniden kullanımı (jeton çalınmış olabilir),
   * hesabın pasife alınması ve şifre değişikliği. Üçünde de "elindeki
   * jetonla devam edebilen biri" istenmeyen durumdur.
   */
  async revokeAllForAccount(
    tx: Prisma.TransactionClient,
    customerAccountId: string,
    reason: CustomerRevokeReason,
  ): Promise<number> {
    const result = await tx.customerRefreshToken.updateMany({
      where: { customerAccountId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    return result.count;
  }

  get accessTokenSeconds(): number {
    return parseDuration(this.config.jwtCustomerAccessExpiresIn);
  }

  get refreshTokenSeconds(): number {
    return parseDuration(this.config.jwtCustomerRefreshExpiresIn);
  }
}
