import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { buildPaginationMeta, toSkipTake, type PaginatedResult } from '@zirve/types';

import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Denetim kaydına ASLA yazılmaması gereken alan adları.
 *
 * Bir entity'nin oldData/newData'sı buraya düşerken bu alanlar maskelenir.
 * Liste yeni hassas alan eklendiğinde genişletilmelidir (kod inceleme kuralı).
 */
const REDACTED_FIELDS = new Set([
  'password',
  'passwordHash',
  'newPassword',
  'currentPassword',
  'token',
  'tokenHash',
  'accessToken',
  'refreshToken',
  'replacedByTokenHash',
]);

const REDACTED_PLACEHOLDER = '[gizlendi]';

/** Bir denetim kaydı oluşturmak için gereken bilgi. */
export interface AuditEntry {
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldData?: unknown;
  newData?: unknown;
  description?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogFilter {
  page: number;
  limit: number;
  userId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Denetim kaydı servisi.
 *
 * Tüm modüllerin kritik işlemleri buraya yazar (Kural 4).
 * İki yazma biçimi vardır:
 *
 *   record(tx, entry)  — bir transaction İÇİNDE. Finansal işlemlerde ZORUNLU:
 *                        işlem geri alınırsa denetim kaydı da geri alınmalı.
 *   recordSafe(entry)  — transaction dışında, hata yutularak. Yalnız denetim
 *                        kaydının başarısızlığı asıl işlemi bozmamalıysa
 *                        (ör. başarısız giriş denemesi loglama).
 */
@Injectable()
export class AuditLogsService {
  private readonly logger = new Logger(AuditLogsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Transaction içinde denetim kaydı yazar.
   * Hata fırlatırsa çağıran transaction geri alınır — kasıtlıdır.
   */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toCreateInput(entry) });
  }

  /**
   * Transaction dışında denetim kaydı yazar; hata yutulur ve loglanır.
   *
   * Kullanım alanı dardır: denetim kaydının yazılamaması asıl akışı
   * bozmamalıysa. Finansal işlemlerde `record()` kullanılmalıdır.
   */
  async recordSafe(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toCreateInput(entry) });
    } catch (error) {
      this.logger.error(
        `Denetim kaydı yazılamadı (${entry.action} ${entry.entityType}).`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Denetim kayıtlarını sayfalayarak listeler (yalnız SUPER_ADMIN). */
  async findMany(filter: AuditLogFilter): Promise<PaginatedResult<unknown>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(filter.userId !== undefined && { userId: filter.userId }),
      ...(filter.action !== undefined && { action: filter.action }),
      ...(filter.entityType !== undefined && { entityType: filter.entityType }),
      ...(filter.entityId !== undefined && { entityId: filter.entityId }),
      ...(buildDateRange(filter.dateFrom, filter.dateTo) !== undefined && {
        createdAt: buildDateRange(filter.dateFrom, filter.dateTo),
      }),
    };

    const { skip, take } = toSkipTake(filter.page, filter.limit);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          oldData: true,
          newData: true,
          description: true,
          ipAddress: true,
          createdAt: true,
          user: { select: { id: true, fullName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(total, filter.page, filter.limit) };
  }

  private toCreateInput(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      oldData: toJsonValue(redact(entry.oldData)),
      newData: toJsonValue(redact(entry.newData)),
      description: entry.description ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: truncate(entry.userAgent, 255),
    };
  }
}

/**
 * Nesnedeki hassas alanları özyinelemeli olarak maskeler.
 * Denetim kaydına şifre hash'i veya jeton sızmamalıdır.
 */
export function redact(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = REDACTED_FIELDS.has(key) ? REDACTED_PLACEHOLDER : redact(item);
  }

  return result;
}

/** Prisma'nın Json alanına yazılabilir değere çevirir. */
function toJsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return value.length > max ? value.slice(0, max) : value;
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
