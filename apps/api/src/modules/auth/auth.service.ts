import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, type User } from '@prisma/client';
import { ERROR_CODES, type AuthUser, type LoginResponse, type UserRole } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PasswordService } from './password.service';
import { REVOKE_REASONS, TokenService, type TokenContext } from './token.service';

/** Hesabın kilitleneceği ardışık başarısız deneme sayısı. */
const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** Kilit süresi (dakika). */
const LOCKOUT_MINUTES = 15;

const ENTITY_TYPE = 'User';

/**
 * Kimlik doğrulama iş mantığı.
 *
 * Güvenlik ilkeleri:
 *  - Yanlış e-posta ile yanlış şifre AYNI hatayı verir (kullanıcı sayımı /
 *    enumeration engeli). Hangi alanın hatalı olduğu asla söylenmez.
 *  - Pasif kullanıcı giriş yapamaz.
 *  - Refresh token tek kullanımlıktır; kullanıldığında iptal edilir (rotation).
 *  - İptal edilmiş bir jetonun yeniden kullanımı, jetonun çalındığına işarettir:
 *    kullanıcının tüm oturumları düşürülür.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async login(email: string, password: string, context: TokenContext): Promise<LoginResponse> {
    const normalizedEmail = normalizeEmail(email);

    const user = await this.prisma.user.findFirst({
      where: { email: normalizedEmail, deletedAt: null },
    });

    // Kullanıcı yoksa bile şifre doğrulamasının maliyeti ödenir: aksi hâlde
    // yanıt süresi farkından e-postanın kayıtlı olup olmadığı anlaşılır.
    if (user === null) {
      await this.passwordService.verify(DUMMY_HASH, password);
      await this.recordFailedLogin(null, normalizedEmail, context, 'Kullanıcı bulunamadı');
      throw AppException.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
    }

    this.assertNotLocked(user);

    const passwordValid = await this.passwordService.verify(user.passwordHash, password);

    if (!passwordValid) {
      await this.registerFailedAttempt(user);
      await this.recordFailedLogin(user.id, normalizedEmail, context, 'Şifre hatalı');
      throw AppException.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
    }

    // Şifre doğru ama hesap pasif: burada AYRI bir hata vermek güvenlik açığı
    // değildir — kimliğini zaten kanıtladı ve neden giremediğini bilmeli.
    if (!user.isActive) {
      await this.recordFailedLogin(user.id, normalizedEmail, context, 'Hesap pasif');
      throw AppException.unauthorized(ERROR_CODES.ACCOUNT_INACTIVE);
    }

    return this.prisma.$transaction(async (tx) => {
      const tokens = await this.tokenService.issueTokens(
        tx,
        { id: user.id, email: user.email, role: user.role },
        context,
      );

      const updated = await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });

      await this.auditLogs.record(tx, {
        userId: user.id,
        action: AuditAction.LOGIN,
        entityType: ENTITY_TYPE,
        entityId: user.id,
        description: 'Giriş yapıldı.',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return { ...tokens, tokenType: 'Bearer' as const, user: toAuthUser(updated) };
    });
  }

  /**
   * Refresh token'ı yenisiyle değiştirir (rotation).
   *
   * Kullanılan jeton anında iptal edilir; bir daha kullanılamaz.
   */
  async refresh(rawRefreshToken: string, context: TokenContext): Promise<LoginResponse> {
    const tokenHash = this.tokenService.hashRefreshToken(rawRefreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (stored === null) {
      throw AppException.unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    // İptal edilmiş jetonun yeniden kullanımı: jeton sızmış olabilir.
    // Hangi tarafın saldırgan olduğu bilinemediği için tüm oturumlar düşürülür.
    if (stored.revokedAt !== null) {
      await this.handleTokenReuse(stored.userId, context);
      throw AppException.unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized(ERROR_CODES.INVALID_REFRESH_TOKEN);
    }

    const user = stored.user;

    if (user.deletedAt !== null || !user.isActive) {
      await this.prisma.$transaction(async (tx) => {
        await this.tokenService.revokeAllForUser(tx, user.id, REVOKE_REASONS.USER_DEACTIVATED);
      });

      throw AppException.unauthorized(ERROR_CODES.ACCOUNT_INACTIVE);
    }

    return this.prisma.$transaction(async (tx) => {
      // Önce iptal et, sonra yenisini ver: aynı transaction içinde olduğu için
      // araya başka bir istek giremez.
      await this.tokenService.revoke(tx, tokenHash, REVOKE_REASONS.ROTATED);

      const tokens = await this.tokenService.issueTokens(
        tx,
        { id: user.id, email: user.email, role: user.role },
        context,
        tokenHash,
      );

      return { ...tokens, tokenType: 'Bearer' as const, user: toAuthUser(user) };
    });
  }

  /** Çıkış: verilen refresh token iptal edilir. */
  async logout(
    userId: string,
    rawRefreshToken: string | undefined,
    context: TokenContext,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (rawRefreshToken !== undefined && rawRefreshToken.length > 0) {
        await this.tokenService.revoke(
          tx,
          this.tokenService.hashRefreshToken(rawRefreshToken),
          REVOKE_REASONS.LOGOUT,
        );
      }

      await this.auditLogs.record(tx, {
        userId,
        action: AuditAction.LOGOUT,
        entityType: ENTITY_TYPE,
        entityId: userId,
        description: 'Çıkış yapıldı.',
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });
  }

  /** Oturum açmış kullanıcının profili. */
  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });

    if (user === null) {
      throw AppException.unauthorized();
    }

    return toAuthUser(user);
  }

  private assertNotLocked(user: User): void {
    if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
      const remainingMinutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);

      throw AppException.unauthorized(
        ERROR_CODES.ACCOUNT_LOCKED,
        `Çok fazla hatalı deneme. Hesabınız ${remainingMinutes} dakika sonra tekrar denenebilir.`,
      );
    }
  }

  /** Başarısız denemeyi sayar; eşiği aşınca hesabı geçici kilitler. */
  private async registerFailedAttempt(user: User): Promise<void> {
    const nextCount = user.failedLoginCount + 1;
    const shouldLock = nextCount >= MAX_FAILED_LOGIN_ATTEMPTS;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : nextCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });

    if (shouldLock) {
      this.logger.warn(`Hesap geçici olarak kilitlendi: ${user.email}`);
    }
  }

  private async handleTokenReuse(userId: string, context: TokenContext): Promise<void> {
    this.logger.warn(
      `Yenileme jetonu yeniden kullanıldı (userId=${userId}). Tüm oturumlar iptal ediliyor.`,
    );

    await this.prisma.$transaction(async (tx) => {
      const revokedCount = await this.tokenService.revokeAllForUser(
        tx,
        userId,
        REVOKE_REASONS.REUSE_DETECTED,
      );

      await this.auditLogs.record(tx, {
        userId,
        action: AuditAction.LOGIN_FAILED,
        entityType: ENTITY_TYPE,
        entityId: userId,
        description: `İptal edilmiş yenileme jetonu yeniden kullanıldı. ${revokedCount} oturum iptal edildi.`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    });
  }

  /**
   * Başarısız giriş denemesini kaydeder.
   *
   * `recordSafe` kullanılır: denetim kaydı yazılamazsa bile giriş akışı
   * normal şekilde (reddederek) sonuçlanmalıdır.
   */
  private async recordFailedLogin(
    userId: string | null,
    email: string,
    context: TokenContext,
    reason: string,
  ): Promise<void> {
    await this.auditLogs.recordSafe({
      userId,
      action: AuditAction.LOGIN_FAILED,
      entityType: ENTITY_TYPE,
      entityId: userId,
      description: `Başarısız giriş denemesi (${email}): ${reason}`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }
}

/**
 * Kullanıcı bulunamadığında zaman farkını gizlemek için doğrulanan sahte hash.
 * Gerçek bir Argon2id çıktısıdır; hiçbir şifreyle eşleşmez.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$1kzP1CZzTlKPBQ8Yl8v3Kb0kQ4oqvPKfAhOwZ8kM8Xo';

/** Prisma kullanıcısını dışarıya güvenli gösterime çevirir. passwordHash asla taşınmaz. */
export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role as UserRole,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** E-postayı normalize eder: baş/son boşluk atılır, küçük harfe çevrilir. */
export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase('en-US');
}
