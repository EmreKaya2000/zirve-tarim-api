import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * GET /health e2e testi.
 *
 * PrismaService, davranışı kontrol edilebilir bir sahte ile değiştirilir.
 * Böylece hem "veritabanı ayakta" hem "veritabanı erişilemez" senaryoları
 * makineden bağımsız, deterministik biçimde doğrulanabilir.
 *
 * Bu test aynı zamanda SPEC §14 yanıt formatının sözleşme testidir:
 * ResponseInterceptor'ın sarmalaması ve /health ucunun global ön ek dışında
 * kalması burada kanıtlanır.
 */
describe('HealthController (e2e)', () => {
  let app: NestExpressApplication;
  let pingMock: jest.Mock<Promise<void>, []>;

  beforeAll(async () => {
    pingMock = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        ping: (): Promise<void> => pingMock(),
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        onModuleInit: jest.fn().mockResolvedValue(undefined),
        onModuleDestroy: jest.fn().mockResolvedValue(undefined),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();

    // Üretimle AYNI yapılandırma; testlerin gerçeği doğrulaması için şart.
    configureApp(app, { apiPrefix: 'api/v1' });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    pingMock.mockReset();
    pingMock.mockResolvedValue(undefined);
  });

  describe('veritabanı erişilebilir olduğunda', () => {
    it('200 döner ve genel durum ok olur', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(HttpStatus.OK);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          status: 'ok',
          environment: 'test',
          dependencies: {
            database: { status: 'up' },
          },
        },
      });
    });

    it('SPEC §14 başarılı yanıt formatına uyar', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('data');
      // meta yalnızca liste uçlarında bulunur; tekil yanıtta olmamalı.
      expect(response.body).not.toHaveProperty('meta');
    });

    it('beklenen tüm alanları doğru tiplerle döndürür', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(typeof data.status).toBe('string');
      expect(typeof data.timestamp).toBe('string');
      expect(typeof data.uptimeSeconds).toBe('number');
      expect(typeof data.version).toBe('string');
      expect(typeof data.environment).toBe('string');
      expect(typeof data.dependencies.database.status).toBe('string');
      expect(typeof data.dependencies.database.latencyMs).toBe('number');

      // timestamp geçerli bir ISO 8601 tarihi olmalı.
      expect(Number.isNaN(Date.parse(data.timestamp))).toBe(false);
      // UTC olarak saklanmalı (Kural 3).
      expect(data.timestamp.endsWith('Z')).toBe(true);
    });

    it('veritabanına gerçekten ping atar', async () => {
      await request(app.getHttpServer()).get('/health').expect(HttpStatus.OK);

      expect(pingMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('veritabanı erişilemez olduğunda', () => {
    beforeEach(() => {
      pingMock.mockRejectedValue(new Error("Can't reach database server at localhost:5432"));
    });

    it('503 döner ve genel durum error olur', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(HttpStatus.SERVICE_UNAVAILABLE);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          status: 'error',
          dependencies: {
            database: { status: 'down', latencyMs: null },
          },
        },
      });
    });

    it('üretim dışında hata ayrıntısını paylaşır', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(HttpStatus.SERVICE_UNAVAILABLE);

      expect(response.body.data.dependencies.database.message).toContain('database server');
    });
  });

  describe('yönlendirme', () => {
    it('global ön ek DIŞINDA, /health yolunda yayınlanır', async () => {
      await request(app.getHttpServer()).get('/health').expect(HttpStatus.OK);
      await request(app.getHttpServer()).get('/api/v1/health').expect(HttpStatus.NOT_FOUND);
    });

    it('bilinmeyen yol için standart hata formatı döner', async () => {
      const response = await request(app.getHttpServer())
        .get('/bulunmayan-yol')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'NOT_FOUND',
        },
      });
      expect(Array.isArray(response.body.error.details)).toBe(true);
      expect(typeof response.body.error.message).toBe('string');
    });
  });
});
