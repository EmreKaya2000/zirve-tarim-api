import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, type User } from '@prisma/client';
import {
  buildPaginationMeta,
  ERROR_CODES,
  toSkipTake,
  type AuthUser,
  type PaginatedResult,
} from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import type { RequestContextInfo } from '../../common/utils/request-context';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { normalizeEmail, toAuthUser } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { REVOKE_REASONS, TokenService } from '../auth/token.service';
import type {
  ChangePasswordDto,
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto';

const ENTITY_TYPE = 'User';

/** Denetim kaydına yazılacak, hassas olmayan kullanıcı alanları. */
function auditSnapshot(user: User) {
  return {
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findMany(query: ListUsersQueryDto): Promise<PaginatedResult<AuthUser>> {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.role !== undefined && { role: query.role }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.search !== undefined &&
        query.search.length > 0 && {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      ...(buildDateRange(query.dateFrom, query.dateTo) !== undefined && {
        createdAt: buildDateRange(query.dateFrom, query.dateTo),
      }),
    };

    const { skip, take } = toSkipTake(query.page, query.limit);

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { [query.sortBy]: query.sortOrder },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: users.map(toAuthUser),
      meta: buildPaginationMeta(total, query.page, query.limit),
    };
  }

  async findOne(id: string): Promise<AuthUser> {
    return toAuthUser(await this.getExistingUser(id));
  }

  async create(dto: CreateUserDto, actor: ActorContext): Promise<AuthUser> {
    const email = normalizeEmail(dto.email);

    await this.assertEmailAvailable(email);

    const passwordHash = await this.passwordService.hash(dto.password);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: dto.fullName,
          phone: dto.phone ?? null,
          role: dto.role,
          isActive: true,
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.CREATE,
        entityType: ENTITY_TYPE,
        entityId: created.id,
        newData: auditSnapshot(created),
        description: `Kullanıcı oluşturuldu: ${created.email}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toAuthUser(created);
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: ActorContext): Promise<AuthUser> {
    const existing = await this.getExistingUser(id);

    // Son aktif SUPER_ADMIN'in rolü düşürülemez: sistem yönetilemez hâle gelir.
    if (dto.role !== undefined && existing.role === 'SUPER_ADMIN' && dto.role !== 'SUPER_ADMIN') {
      await this.assertNotLastSuperAdmin(existing.id);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined && { fullName: dto.fullName }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.role !== undefined && { role: dto.role }),
        },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: auditSnapshot(existing),
        newData: auditSnapshot(updated),
        description: `Kullanıcı güncellendi: ${updated.email}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toAuthUser(updated);
    });
  }

  /**
   * Kullanıcıyı aktifleştirir veya pasife alır.
   *
   * Pasife alınan kullanıcının tüm oturumları anında düşürülür — aksi hâlde
   * elindeki jetonlarla erişmeye devam ederdi.
   */
  async setStatus(id: string, isActive: boolean, actor: ActorContext): Promise<AuthUser> {
    const existing = await this.getExistingUser(id);

    if (existing.id === actor.id) {
      throw new AppException(
        ERROR_CODES.SELF_ACTION_FORBIDDEN,
        'Kendi hesabınızı pasife alamazsınız.',
        422,
      );
    }

    if (!isActive && existing.role === 'SUPER_ADMIN') {
      await this.assertNotLastSuperAdmin(existing.id);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id }, data: { isActive } });

      if (!isActive) {
        await this.tokenService.revokeAllForUser(tx, id, REVOKE_REASONS.USER_DEACTIVATED);
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.STATUS_CHANGE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: { isActive: existing.isActive },
        newData: { isActive },
        description: `Kullanıcı ${isActive ? 'aktifleştirildi' : 'pasife alındı'}: ${updated.email}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toAuthUser(updated);
    });
  }

  /** Yönetici tarafından şifre sıfırlama. Kullanıcının oturumları düşürülür. */
  async resetPassword(id: string, newPassword: string, actor: ActorContext): Promise<void> {
    const existing = await this.getExistingUser(id);
    const passwordHash = await this.passwordService.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });

      await this.tokenService.revokeAllForUser(tx, id, REVOKE_REASONS.PASSWORD_CHANGED);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.PASSWORD_CHANGE,
        entityType: ENTITY_TYPE,
        entityId: id,
        description: `Şifre yönetici tarafından sıfırlandı: ${existing.email}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  /** Kullanıcının kendi şifresini değiştirmesi. */
  async changeOwnPassword(id: string, dto: ChangePasswordDto, actor: ActorContext): Promise<void> {
    const user = await this.getExistingUser(id);
    const valid = await this.passwordService.verify(user.passwordHash, dto.currentPassword);

    if (!valid) {
      throw AppException.unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'Mevcut şifreniz hatalı.');
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await this.tokenService.revokeAllForUser(tx, id, REVOKE_REASONS.PASSWORD_CHANGED);

      await this.auditLogs.record(tx, {
        userId: id,
        action: AuditAction.PASSWORD_CHANGE,
        entityType: ENTITY_TYPE,
        entityId: id,
        description: 'Kullanıcı kendi şifresini değiştirdi.',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  /** Soft delete. Kullanıcı kaydı korunur; denetim izleri kırılmaz. */
  async remove(id: string, actor: ActorContext): Promise<void> {
    const existing = await this.getExistingUser(id);

    if (existing.id === actor.id) {
      throw new AppException(
        ERROR_CODES.SELF_ACTION_FORBIDDEN,
        'Kendi hesabınızı silemezsiniz.',
        422,
      );
    }

    if (existing.role === 'SUPER_ADMIN') {
      await this.assertNotLastSuperAdmin(existing.id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          // E-posta anonimleştirilir. İki nedeni var:
          //  1. Adres serbest kalır; aynı kişi yeniden eklenebilir.
          //     (Kısmi unique index yerine bu yol seçildi — migration'daki
          //      nota bakınız: kısmi index Prisma drift kontrolünü bozuyor.)
          //  2. KVKK: silinen kullanıcının kişisel verisi tutulmaz.
          // Özgün e-posta denetim kaydında (oldData) korunur.
          email: anonymizedEmail(id),
          phone: null,
        },
      });

      await this.tokenService.revokeAllForUser(tx, id, REVOKE_REASONS.USER_DEACTIVATED);

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.SOFT_DELETE,
        entityType: ENTITY_TYPE,
        entityId: id,
        oldData: auditSnapshot(existing),
        description: `Kullanıcı silindi: ${existing.email}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
    });
  }

  private async getExistingUser(id: string): Promise<User> {
    const user = await this.prisma.user.findFirst({ where: { id, deletedAt: null } });

    if (user === null) {
      throw AppException.notFound('Kullanıcı bulunamadı.');
    }

    return user;
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const existing = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true },
    });

    if (existing !== null) {
      throw new AppException(
        ERROR_CODES.EMAIL_ALREADY_EXISTS,
        'Bu e-posta adresi zaten kullanılıyor.',
        409,
        [{ field: 'email', message: 'Bu e-posta adresi zaten kullanılıyor.' }],
      );
    }
  }

  /** Sistemde başka aktif SUPER_ADMIN kalmıyorsa işlemi reddeder. */
  private async assertNotLastSuperAdmin(excludeUserId: string): Promise<void> {
    const remaining = await this.prisma.user.count({
      where: {
        role: 'SUPER_ADMIN',
        isActive: true,
        deletedAt: null,
        id: { not: excludeUserId },
      },
    });

    if (remaining === 0) {
      throw new AppException(
        ERROR_CODES.LAST_SUPER_ADMIN,
        'Sistemde en az bir aktif süper yönetici bulunmalıdır.',
        422,
      );
    }
  }
}

/** İşlemi yapan kullanıcının bağlamı — denetim kaydı için. */
export interface ActorContext extends RequestContextInfo {
  id: string;
}

/**
 * Silinen kullanıcı için çakışmayan, gerçek olamayacak bir e-posta üretir.
 *
 * `.invalid` IETF tarafından ayrılmış bir üst düzey alan adıdır (RFC 2606):
 * hiçbir zaman gerçek bir adrese karşılık gelemez. Kullanıcı id'si benzersiz
 * olduğu için üretilen değer de benzersizdir.
 */
export function anonymizedEmail(userId: string): string {
  return `silinmis-${userId}@deleted.invalid`;
}

function buildDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (from === undefined && to === undefined) {
    return undefined;
  }

  return {
    ...(from !== undefined && { gte: new Date(from) }),
    ...(to !== undefined && { lte: new Date(to) }),
  };
}
