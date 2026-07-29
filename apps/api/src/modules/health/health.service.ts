import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import type { DependencyHealth, HealthCheckResult } from '@zirve/types';

import { AppConfig } from '../../config/app.config';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** package.json okunamazsa kullanılacak değer. */
const UNKNOWN_VERSION = '0.0.0';

/** Veritabanı ping'i için azami bekleme süresi (ms). */
const DATABASE_PING_TIMEOUT_MS = 3000;

/**
 * Uygulama sürümü, package.json'dan bir kez okunur.
 *
 * `npm_package_version` ortam değişkenine güvenilmez: yalnızca uygulama bir
 * npm/pnpm script'i üzerinden başlatıldığında tanımlıdır. Üretimde konteyner
 * doğrudan `node dist/main.js` çalıştırdığı için o değer boş gelir.
 *
 * Yol hem geliştirmede (apps/api/dist/main.js) hem Docker imajında
 * (/app/apps/api/dist/main.js) package.json'a bir üst dizinden ulaşır.
 */
const APP_VERSION = readAppVersion();

function readAppVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);

    if (parsed !== null && typeof parsed === 'object' && 'version' in parsed) {
      const version = (parsed as { version: unknown }).version;

      if (typeof version === 'string' && version.length > 0) {
        return version;
      }
    }
  } catch (error) {
    new Logger('HealthService').warn(
      `Uygulama sürümü package.json'dan okunamadı: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return UNKNOWN_VERSION;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Uygulamanın ve bağımlılıklarının durumunu döndürür.
   *
   * Veritabanı erişilemezse genel durum `error` olur; controller bunu
   * 503 Service Unavailable'a çevirir.
   */
  async check(): Promise<HealthCheckResult> {
    const database = await this.checkDatabase();

    return {
      status: database.status === 'up' ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: this.resolveVersion(),
      environment: this.config.nodeEnv,
      dependencies: { database },
    };
  }

  /** Veritabanına `SELECT 1` atar ve gecikmeyi ölçer. */
  private async checkDatabase(): Promise<DependencyHealth> {
    const startedAt = process.hrtime.bigint();

    try {
      await this.withTimeout(this.prisma.ping(), DATABASE_PING_TIMEOUT_MS);

      const elapsedNs = process.hrtime.bigint() - startedAt;

      return {
        status: 'up',
        latencyMs: Number(elapsedNs / 1_000_000n),
      };
    } catch (error) {
      const result: DependencyHealth = {
        status: 'down',
        latencyMs: null,
      };

      // Hata ayrıntısı yalnız üretim dışında paylaşılır (Kural 8 / §11.1).
      if (!this.config.isProduction) {
        result.message = error instanceof Error ? error.message : String(error);
      }

      return result;
    }
  }

  /** Asılı kalan bir bağlantının sağlık kontrolünü kilitlemesini engeller. */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Veritabanı yanıt vermedi (${timeoutMs} ms).`)),
        timeoutMs,
      );
    });

    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private resolveVersion(): string {
    return APP_VERSION;
  }
}
