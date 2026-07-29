import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import type { AppConfig } from '../config/app.config';

/**
 * OpenAPI dokümantasyonunu kurar.
 *
 * Bu şema aynı zamanda `packages/types` için istemci tipi üretiminin
 * kaynağıdır (API-first — docs/ARCHITECTURE.md §4.3).
 * Üretimde varsayılan olarak kapalıdır (§11.1).
 */
export function setupSwagger(app: INestApplication, config: AppConfig): void {
  if (!config.swaggerEnabled) {
    return;
  }

  const documentConfig = new DocumentBuilder()
    .setTitle('Zirve Tarım API')
    .setDescription(
      [
        'Ziraat mağazası katalog, talep ve satış yönetim sistemi.',
        '',
        '**Yanıt formatı (SPEC §14)**',
        '',
        '- Başarılı: `{ "success": true, "data": ..., "meta": { page, limit, total, totalPages } }`',
        '- Hata: `{ "success": false, "error": { "code", "message", "details": [] } }`',
        '',
        '`meta` yalnızca liste uçlarında bulunur.',
        '',
        "**Para alanları**: Tüm parasal ve miktar değerleri JSON'da **string** olarak taşınır",
        '(ör. `"12450.5000"`). Gerekçe: docs/ARCHITECTURE.md §13.6.',
        '',
        '**Yetkilendirme**: `/admin/*` uçları JWT + rol ister (Sprint 2).',
        'Public uçlar hassas alan (alış fiyatı, maliyet, kâr) döndürmez.',
      ].join('\n'),
    )
    .setVersion('0.1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Access token. `Authorization: Bearer <token>`',
      },
      'access-token',
    )
    .addTag('Health', 'Sistem sağlık kontrolü')
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);

  SwaggerModule.setup(config.swaggerPath, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
    customSiteTitle: 'Zirve Tarım API',
  });
}
