import { join } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Uygulamanın ortamdan BAĞIMSIZ yapılandırması.
 *
 * NEDEN AYRI BİR DOSYA: bu ayarlar daha önce `main.ts` ile dört ayrı e2e
 * dosyasında kopyalanıyordu. Kopya yapılandırma sessizce ayrışır —
 * testler üretimde çalışmayan bir uygulamayı doğrulamış olur. Buradaki
 * her ayar hem `main.ts`'te hem testlerde AYNI şekilde uygulanır.
 *
 * Ortama bağlı olan (CORS, helmet, Swagger, dinlenen port) `main.ts`'te
 * kalır: testlerde ne gerekli ne de anlamlıdır.
 */
export function configureApp(app: NestExpressApplication, options: ConfigureOptions): void {
  // --- Global ön ek: /health BUNUN DIŞINDA tutulur ---
  //
  // Sürüm bilgisi ön ekin içindedir (api/v1). NestJS'in `enableVersioning`
  // mekanizması bilinçli olarak kullanılmıyor; ikisi birlikte /api/v1/v1
  // gibi çift sürüm üretir. v2 gerektiğinde API_PREFIX değiştirilecek.
  app.setGlobalPrefix(options.apiPrefix, { exclude: ['health'] });

  // --- Global doğrulama (Kural 11, K-75) ---
  app.useGlobalPipes(
    new ValidationPipe({
      // DTO'da tanımlı olmayan alanlar gövdeden atılır.
      whitelist: true,
      // ...ve varlıkları isteği doğrudan reddeder (yetki yükseltme denemeleri dahil).
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      // Üretimde ayrıntılı doğrulama mesajı sızdırılmaz.
      disableErrorMessages: false,
      validationError: {
        target: false,
        value: false,
      },
    }),
  );

  serveUploads(app);
}

export interface ConfigureOptions {
  /** API yol ön eki, ör. `api/v1`. */
  apiPrefix: string;
}

/** Yüklenen dosyaların diskteki kök dizini (LocalDiskStorage ile aynı). */
const UPLOAD_ROOT = 'uploads';

/** Yüklenen dosyaların public URL ön eki (LocalDiskStorage.getUrl ile aynı). */
const UPLOAD_PREFIX = '/uploads';

/** Görsel önbelleği: dosya adları UUID olduğu için içerik hiç değişmez. */
const UPLOAD_CACHE_SECONDS = 31_536_000;

/**
 * Yüklenen görselleri statik olarak sunar.
 *
 * Bu middleware `setGlobalPrefix`ten ETKİLENMEZ; URL'ler api/v1 önekini
 * içermez ve LocalDiskStorage.getUrl() ile birebir aynı olur.
 *
 * Üretimde bu işi Nginx/CDN devralır; o zaman burası kaldırılabilir.
 * Şimdilik kaldırılmamalı: aksi hâlde yüklenen her görsel 404 döner.
 */
function serveUploads(app: NestExpressApplication): void {
  app.useStaticAssets(join(process.cwd(), UPLOAD_ROOT), {
    prefix: UPLOAD_PREFIX,
    // Dizin listelemesi kapalı: yüklenmiş tüm dosyaların envanteri sızmasın.
    index: false,
    redirect: false,
    // Dosya adı UUID olduğundan içerik hiçbir zaman değişmez.
    immutable: true,
    maxAge: UPLOAD_CACHE_SECONDS * 1000,
    setHeaders: (res) => {
      // Tarayıcının içeriği MIME tipinden bağımsız yorumlamasını engeller —
      // yüklenen bir dosyanın HTML/JS gibi çalıştırılması riskini kapatır.
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Görseller kaynak sitede <img> ile gösterilir, indirilmez.
      res.setHeader('Content-Disposition', 'inline');
      // Helmet varsayılan olarak `same-origin` verir; web (3000) API'den
      // (4000) görsel çekemez ve <img> sessizce boş kalır. Ürün görselleri
      // zaten herkese açık olduğundan çapraz köken erişimi burada doğru.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}
