import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma, type Setting } from '@prisma/client';
import { ERROR_CODES, type SettingValueType } from '@zirve/types';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { ActorContext } from '../../common/types/actor-context';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { ListSettingsQueryDto, SettingUpdateItemDto } from './dto/setting.dto';

const ENTITY_TYPE = 'Setting';

/** Public ayarların istemciye dönen biçimi. */
export interface PublicSetting {
  key: string;
  value: string;
  valueType: SettingValueType;
}

/**
 * Sistem ayarları.
 *
 * Ayarlar anahtar-değer olarak saklanır. Yeni ayar EKLEME/SİLME uçları
 * bilinçli olarak yoktur: anahtarlar kodda sabit olarak referans verilir
 * (SETTING_KEYS) ve çalışma zamanında yaratılan bir anahtarın karşılığı
 * kodda bulunmaz. Yeni ayar seed ile gelir; yönetici yalnız DEĞERİ değiştirir.
 */
@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  /** Yönetici listesi: tüm ayarlar, gruba göre sıralı. */
  async findMany(query: ListSettingsQueryDto): Promise<Setting[]> {
    const where: Prisma.SettingWhereInput = {
      ...(query.group !== undefined && { group: query.group }),
      ...(query.search !== undefined && {
        OR: [
          { key: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    return this.prisma.setting.findMany({ where, orderBy: [{ group: 'asc' }, { key: 'asc' }] });
  }

  /**
   * Public ayarlar.
   *
   * YALNIZ `isPublic = true` olanlar döner ve yanıt açık `select` ile
   * kurulur — `description`/`group` gibi dahili alanlar dışarı sızmaz
   * (Kural 8).
   */
  async findPublic(): Promise<PublicSetting[]> {
    const settings = await this.prisma.setting.findMany({
      where: { isPublic: true },
      select: { key: true, value: true, valueType: true },
      orderBy: { key: 'asc' },
    });

    return settings.map((setting) => ({
      key: setting.key,
      value: setting.value,
      valueType: setting.valueType as SettingValueType,
    }));
  }

  async findByKey(key: string): Promise<Setting> {
    const setting = await this.prisma.setting.findUnique({ where: { key } });

    if (setting === null) {
      throw AppException.notFound(`Ayar bulunamadı: ${key}`);
    }

    return setting;
  }

  /**
   * Ayarın ham değerini döndürür; kayıt yoksa `null`.
   *
   * `findByKey`den farkı HATA FIRLATMAMASIDIR. Bir ayarın eksikliği,
   * çağıran akışı durdurmak zorunda değil: numara ön eki gibi
   * durumlarda yedek değere düşülüp devam edilir.
   */
  async getValue(key: string): Promise<string | null> {
    const setting = await this.prisma.setting.findUnique({
      where: { key },
      select: { value: true },
    });

    return setting?.value ?? null;
  }

  /** Tek ayarın değerini günceller. */
  async update(
    key: string,
    value: string,
    description: string | undefined,
    actor: ActorContext,
  ): Promise<Setting> {
    const existing = await this.findByKey(key);

    this.assertValueMatchesType(value, existing.valueType as SettingValueType, key);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.setting.update({
        where: { key },
        data: { value, ...(description !== undefined && { description }) },
      });

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: null,
        oldData: { key, value: existing.value },
        newData: { key, value },
        description: `Ayar güncellendi: ${key}`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /**
   * Toplu güncelleme — ayarlar sayfasındaki "Kaydet" için.
   *
   * Tümü TEK transaction içinde yazılır: yarısı kaydedilmiş bir ayar
   * ekranı tutarsız bir yapılandırma bırakırdı.
   */
  async updateMany(items: SettingUpdateItemDto[], actor: ActorContext): Promise<Setting[]> {
    if (items.length === 0) {
      return [];
    }

    const keys = items.map((item) => item.key);
    const existing = await this.prisma.setting.findMany({ where: { key: { in: keys } } });
    const existingByKey = new Map(existing.map((setting) => [setting.key, setting]));

    const missing = keys.filter((key) => !existingByKey.has(key));

    if (missing.length > 0) {
      throw new AppException(
        ERROR_CODES.NOT_FOUND,
        `Bilinmeyen ayar anahtarı: ${missing.join(', ')}`,
        404,
        missing.map((key) => ({ field: key, message: 'Böyle bir ayar yok.' })),
      );
    }

    for (const item of items) {
      const current = existingByKey.get(item.key);

      if (current !== undefined) {
        this.assertValueMatchesType(item.value, current.valueType as SettingValueType, item.key);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated: Setting[] = [];

      for (const item of items) {
        updated.push(
          await tx.setting.update({ where: { key: item.key }, data: { value: item.value } }),
        );
      }

      await this.auditLogs.record(tx, {
        userId: actor.id,
        action: AuditAction.UPDATE,
        entityType: ENTITY_TYPE,
        entityId: null,
        oldData: Object.fromEntries(
          items.map((item) => [item.key, existingByKey.get(item.key)?.value ?? null]),
        ),
        newData: Object.fromEntries(items.map((item) => [item.key, item.value])),
        description: `${items.length} ayar güncellendi.`,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return updated;
    });
  }

  /**
   * Değerin bildirilen tiple uyumlu olduğunu doğrular.
   *
   * Ayarlar metin olarak saklanır ama `valueType` onları nasıl okuyacağımızı
   * söyler. "sayı" tipindeki bir ayara "abc" yazılırsa hata ÇALIŞMA ZAMANINDA,
   * ilgisiz bir yerde ortaya çıkardı; burada girişte yakalanır.
   */
  private assertValueMatchesType(value: string, valueType: SettingValueType, key: string): void {
    if (valueType === 'number' && Number.isNaN(Number(value))) {
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        `"${key}" ayarı sayısal bir değer bekliyor.`,
        400,
        [{ field: key, message: 'Sayısal bir değer girin.' }],
      );
    }

    if (valueType === 'boolean' && value !== 'true' && value !== 'false') {
      throw new AppException(
        ERROR_CODES.VALIDATION_ERROR,
        `"${key}" ayarı true veya false bekliyor.`,
        400,
        [{ field: key, message: 'true veya false girin.' }],
      );
    }

    if (valueType === 'json') {
      try {
        JSON.parse(value);
      } catch {
        throw new AppException(
          ERROR_CODES.VALIDATION_ERROR,
          `"${key}" ayarı geçerli bir JSON bekliyor.`,
          400,
          [{ field: key, message: 'Geçerli bir JSON girin.' }],
        );
      }
    }
  }
}
