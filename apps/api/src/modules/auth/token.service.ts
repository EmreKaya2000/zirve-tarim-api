import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import { TOKEN_AUDIENCES, TOKEN_ISSUER, type UserRole } from '@zirve/types';

import { AppConfig } from '../../config/app.config';
import { generateRawToken, hashToken } from '../../common/utils/token-hash';

/** İptal gerekçeleri — serbest string yerine sabit (Kural 12). */
export const REVOKE_REASONS = {
  /** Rotasyon: jeton kullanıldı, yerine yenisi verildi. */
  ROTATED: 'ROTATED',
  /** Kullanıcı çıkış yaptı. */
  LOGOUT: 'LOGOUT',
  /** İptal edilmiş jeton yeniden kullanıldı — zincir tamamen iptal edildi. */
  REUSE_DETECTED: 'REUSE_DETECTED',
  /** Kullanıcı pasife alındı veya silindi. */
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  /** Şifre değişti. */
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
} as const;

export type RevokeReason = (typeof REVOKE_REASONS)[keyof typeof REVOKE_REASONS];

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface TokenContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Jeton üretimi, saklanması ve iptali.
 *
 * Refresh token'lar ham hâlde ASLA saklanmaz — yalnız SHA-256 özeti tutulur.
 * Veritabanı ele geçse bile jetonlar kullanılamaz (docs/ARCHITECTURE.md §11.1).
 *
 * SHA-256 burada yeterlidir (Argon2 değil): refresh token 256 bit kriptografik
 * rastgelelik taşır, sözlük saldırısına açık bir "şifre" değildir. Argon2'nin
 * yavaşlığı her istekte gereksiz maliyet olurdu.
 */
@Injectable()
export class TokenService {
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
    user: { id: string; email: string; role: UserRole },
    context: TokenContext,
    replacedTokenHash?: string,
  ): Promise<IssuedTokens> {
    const expiresIn = this.accessTokenSeconds;

    // expiresIn'e SANİYE (number) verilir: @nestjs/jwt'nin string tipi `ms`
    // paketinin literal birleşimidir ve yapılandırmadan gelen serbest string
    // ona atanamaz. Saniye hem tip-güvenli hem tek anlamlıdır.
    //
    // AUDIENCE (Sprint 11): jeton `aud: zirve-admin` taşır ve JwtAuthGuard
    // yalnız bu audience'ı kabul eder. Müşteri jetonu (`zirve-customer`)
    // yönetim uçlarında imza doğrulaması aşamasında reddedilir; guard'ın
    // içinde elle karşılaştırma yapılmaz — atlanması mümkün olmasın
    // (docs/ARCHITECTURE.md §8.4).
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, email: user.email, role: user.role, jti: randomUUID() },
      {
        secret: this.config.jwtAccessSecret,
        expiresIn,
        audience: TOKEN_AUDIENCES.ADMIN,
        issuer: TOKEN_ISSUER,
      },
    );

    const rawRefreshToken = generateRawToken();
    const tokenHash = this.hashRefreshToken(rawRefreshToken);

    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + this.refreshTokenSeconds * 1000),
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 255) ?? null,
      },
    });

    // Rotasyon zincirini kur: eski jeton hangi jetonla değiştirildi.
    if (replacedTokenHash !== undefined) {
      await tx.refreshToken.update({
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
    reason: RevokeReason,
  ): Promise<void> {
    await tx.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /**
   * Kullanıcının TÜM aktif oturumlarını iptal eder.
   *
   * Jeton yeniden kullanımı tespit edildiğinde çağrılır: jeton çalınmış
   * olabilir ve hangi tarafın saldırgan olduğu bilinemez, bu yüzden güvenli
   * davranış tüm oturumları düşürmektir.
   */
  async revokeAllForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: RevokeReason,
  ): Promise<number> {
    const result = await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });

    return result.count;
  }

  /** Access token'ın saniye cinsinden ömrü. */
  get accessTokenSeconds(): number {
    return parseDuration(this.config.jwtAccessExpiresIn);
  }

  /** Refresh token'ın saniye cinsinden ömrü. */
  get refreshTokenSeconds(): number {
    return parseDuration(this.config.jwtRefreshExpiresIn);
  }
}

/**
 * "15m", "7d", "12h", "30s" biçimindeki süreyi saniyeye çevirir.
 * Salt sayı verilirse saniye kabul edilir.
 */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])?$/i.exec(value.trim());

  if (match === null) {
    throw new Error(
      `Geçersiz süre biçimi: "${value}". Beklenen: 30s, 15m, 12h, 7d veya salt saniye.`,
    );
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

  return amount * (multipliers[unit] ?? 1);
}
