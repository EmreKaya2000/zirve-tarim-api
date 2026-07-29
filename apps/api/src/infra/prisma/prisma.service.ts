import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { AppConfig } from '../../config/app.config';

/**
 * Prisma bağlantısını Nest yaşam döngüsüne bağlar.
 *
 * Uygulama açılışında bağlantı kurulmaya çalışılır ancak başarısız olursa
 * uygulama ÇÖKMEZ — `GET /health` ucunun "database: down" bilgisi verebilmesi
 * için ayakta kalması gerekir. Gerçek sorgular yine hata verir ve
 * AllExceptionsFilter bunları 503'e çevirir.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({
      datasources: { db: { url: config.databaseUrl } },
      log: config.isProduction
        ? [{ emit: 'stdout', level: 'error' }]
        : [
            { emit: 'stdout', level: 'error' },
            { emit: 'stdout', level: 'warn' },
          ],
      errorFormat: config.isProduction ? 'minimal' : 'pretty',
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Veritabanı bağlantısı kuruldu.');
    } catch (error) {
      this.logger.error(
        'Veritabanına bağlanılamadı. Uygulama ayakta kalıyor; /health ucu durumu bildirecek.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Hafif bağlantı testi. Sağlık kontrolü tarafından kullanılır.
   * Sorgu başarısız olursa hata fırlatır; çağıran yakalar.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
