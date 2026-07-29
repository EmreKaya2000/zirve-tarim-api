import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { setupSwagger } from './bootstrap/swagger';
import { AppConfig } from './config/app.config';

/** İstek gövdesi için azami boyut. Dosya yüklemeleri ayrı sınırla yönetilir. */
const BODY_LIMIT = '1mb';

/**
 * Boşta kalan keep-alive bağlantısının kapatılma süresi (ms).
 *
 * NEDEN AYARLANIYOR — reverse proxy arkasındaki klasik 502:
 * Node'un varsayılanı 5 saniyedir. Önündeki proxy (nginx, ALB) tipik olarak
 * 60 saniye keep-alive tutar. Node bağlantıyı proxy'den ÖNCE kapatırsa,
 * proxy tam o anda o bağlantı üzerinden bir istek göndermiş olabilir ve
 * istemci 502 alır. Kural: uygulamanın keep-alive süresi proxy'nin
 * süresinden BÜYÜK olmalıdır.
 *
 * `KEEP_ALIVE_TIMEOUT` ile ortamdan ayarlanabilir (turbo.json'da tanımlı).
 */
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * Kapanışta açık isteklerin tamamlanması için beklenecek azami süre (ms).
 *
 * Bu süre dolduğunda süreç zorla sonlandırılır. Sonsuz beklemek, tek bir
 * takılı isteğin konteyner yeniden başlatmasını süresiz bloke etmesi
 * demektir; orkestratör de sonunda SIGKILL gönderir ve o noktada hiçbir
 * temizlik yapılamaz. Kendi süremizi koymak, kapanışın KONTROLLÜ olmasını
 * sağlar.
 *
 * Docker'ın varsayılan `stop_grace_period` 10 saniyedir; 15 saniyelik bir
 * sınır ondan uzun olurdu, bu yüzden compose dosyalarında süre 30 saniyeye
 * çıkarılmıştır.
 */
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Log seviyesi yapılandırmadan okunmadan önce güvenli bir varsayılan.
    logger: ['error', 'warn', 'log'],
    bufferLogs: true,
  });

  const config = app.get(AppConfig);
  const logger = new Logger('Bootstrap');

  app.useLogger(resolveLogLevels(config.logLevel));

  // --- Güvenlik başlıkları (§11.1) ---
  app.use(
    helmet({
      // Swagger UI satır içi script/stil kullandığı için üretim dışında gevşetilir.
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // --- CORS: whitelist, joker yok ---
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    maxAge: 86_400,
  });

  // Reverse proxy arkasında gerçek istemci IP'sinin okunabilmesi için
  // (rate limit ve audit log doğru IP'yi görsün).
  app.set('trust proxy', 1);

  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

  // Ortamdan bağımsız yapılandırma — e2e testleriyle AYNI kaynaktan gelir,
  // böylece testler üretimde çalışan uygulamayı doğrular.
  configureApp(app, { apiPrefix: config.apiPrefix });

  /**
   * SIGTERM/SIGINT geldiğinde Nest'in yaşam döngüsü kancalarını çalıştırır:
   * `onModuleDestroy` → `PrismaService.$disconnect()`. Bağlantı havuzu
   * düzgün kapanır, veritabanında yarım kalan oturum bırakılmaz.
   */
  app.enableShutdownHooks();

  setupSwagger(app, config);

  await app.listen(config.port, '0.0.0.0');

  configureKeepAlive(app, logger);
  installGracefulShutdown(app, logger);

  logger.log(`Ortam           : ${config.nodeEnv}`);
  logger.log(`API             : http://localhost:${config.port}/${config.apiPrefix}`);
  logger.log(`Sağlık kontrolü : http://localhost:${config.port}/health`);

  if (config.swaggerEnabled) {
    logger.log(`Swagger         : http://localhost:${config.port}/${config.swaggerPath}`);
  }
}

/**
 * Keep-alive sürelerini reverse proxy ile uyumlu hâle getirir.
 *
 * `headersTimeout` DAİMA `keepAliveTimeout`tan BÜYÜK olmalıdır. Aksi hâlde
 * Node, başlıkları henüz tamamlanmamış bir isteği zaman aşımına düşürürken
 * bağlantıyı da kapatır ve istemci sebebini anlamadan bağlantı hatası alır.
 * Node bu ilişkiyi kendi kendine kurmaz; elle ayarlanması gerekir.
 */
function configureKeepAlive(app: NestExpressApplication, logger: Logger): void {
  const raw = Number(process.env['KEEP_ALIVE_TIMEOUT'] ?? DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  const keepAliveTimeout = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_KEEP_ALIVE_TIMEOUT_MS;

  const server = app.getHttpServer();

  server.keepAliveTimeout = keepAliveTimeout;
  // 1 saniye pay: eşitlik durumunda yarış oluşabilir.
  server.headersTimeout = keepAliveTimeout + 1_000;

  logger.log(`Keep-alive      : ${keepAliveTimeout} ms`);
}

/**
 * SIGTERM/SIGINT'te KONTROLLÜ kapanış kurar.
 *
 * `enableShutdownHooks()` Nest'in modül yaşam döngüsünü çalıştırır (Prisma
 * bağlantısı kapanır) ama iki şeyi YAPMAZ ve ikisi de üretimde önemlidir:
 *
 *   1. AÇIK İSTEKLERİN TAMAMLANMASINI SINIRLAMAK. `app.close()` sunucuyu
 *      kapatır ve açık isteklerin bitmesini bekler; takılı tek bir istek
 *      kapanışı süresiz bloke edebilir. Orkestratör sonunda SIGKILL gönderir
 *      ve o noktada hiçbir temizlik yapılamaz. Kendi zaman sınırımızı koymak
 *      kapanışın bizim kontrolümüzde kalmasını sağlar.
 *
 *   2. İKİNCİ SİNYALİ YOK SAYMAK. Kubernetes ve Docker kapanış yavaş
 *      görünürse sinyali tekrar gönderebilir; her sinyalde kapanışı yeniden
 *      başlatmak `app.close()`u iki kez çağırır ve hata üretir.
 */
function installGracefulShutdown(app: NestExpressApplication, logger: Logger): void {
  let isShuttingDown = false;

  const shutdown = (signal: string): void => {
    if (isShuttingDown) {
      logger.warn(`${signal} yok sayıldı: kapanış zaten sürüyor.`);

      return;
    }

    isShuttingDown = true;
    logger.log(`${signal} alındı. Açık istekler tamamlanıyor...`);

    // Zaman sınırı: bu süre dolarsa süreç zorla sonlandırılır.
    const timer = setTimeout(() => {
      logger.error(
        `Kapanış ${SHUTDOWN_TIMEOUT_MS} ms içinde tamamlanmadı; süreç zorla sonlandırılıyor.`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // `unref`: sayaç sürecin canlı kalmasına SEBEP OLMAMALI. Aksi hâlde
    // kapanış temiz bittiğinde bile süreç 15 saniye daha ayakta kalırdı.
    timer.unref();

    void app
      .close()
      .then(() => {
        clearTimeout(timer);
        logger.log('Kapanış tamamlandı.');
        process.exit(0);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        logger.error(
          'Kapanış sırasında hata oluştu.',
          error instanceof Error ? error.stack : String(error),
        );
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

/** LOG_LEVEL değerini Nest'in beklediği seviye dizisine çevirir. */
function resolveLogLevels(
  level: 'fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose',
): ('fatal' | 'error' | 'warn' | 'log' | 'debug' | 'verbose')[] {
  const order = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;
  const index = order.indexOf(level);

  return [...order.slice(0, index + 1)];
}

void bootstrap().catch((error: unknown) => {
  // Bootstrap hatası (ör. env doğrulaması) sessizce yutulmamalı.
  console.error('Uygulama başlatılamadı:');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
