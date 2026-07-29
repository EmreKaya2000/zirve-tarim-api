import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

/**
 * Kimlik doğrulama uçtan uca testleri.
 *
 * GERÇEK PostgreSQL üzerinde koşar (docs/ARCHITECTURE.md §11.2): jeton
 * rotasyonu, iptal ve benzersizlik kısıtları yalnız gerçek veritabanında
 * anlamlı biçimde doğrulanabilir.
 *
 * Çalıştırma: docker compose up -d postgres && pnpm test:e2e
 */
describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

  const ACTIVE_ADMIN = {
    email: 'e2e.admin@zirvetarim.test',
    password: 'E2eAdminSifre123',
    fullName: 'E2E Yönetici',
    role: UserRole.ADMIN,
  };

  const SUPER_ADMIN = {
    email: 'e2e.super@zirvetarim.test',
    password: 'E2eSuperSifre123',
    fullName: 'E2E Süper Yönetici',
    role: UserRole.SUPER_ADMIN,
  };

  const INACTIVE_USER = {
    email: 'e2e.pasif@zirvetarim.test',
    password: 'E2ePasifSifre123',
    fullName: 'E2E Pasif Kullanıcı',
    role: UserRole.ADMIN,
  };

  jest.setTimeout(120_000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Üretimle AYNI yapılandırma; testlerin gerçeği doğrulaması için şart.
    configureApp(app, { apiPrefix: 'api/v1' });

    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();

    await seedUsers();
  });

  afterAll(async () => {
    await cleanupUsers();
    await prisma.$disconnect();
    await app.close();
  });

  /** Her testten önce temiz durum: kilitler sıfırlanır, jetonlar silinir. */
  beforeEach(async () => {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { contains: '@zirvetarim.test' } } },
    });
    await prisma.user.updateMany({
      where: { email: { contains: '@zirvetarim.test' } },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  });

  async function seedUsers(): Promise<void> {
    await cleanupUsers();

    for (const user of [ACTIVE_ADMIN, SUPER_ADMIN, INACTIVE_USER]) {
      await prisma.user.create({
        data: {
          email: user.email,
          passwordHash: await hash(user.password, ARGON2_OPTIONS),
          fullName: user.fullName,
          role: user.role,
          isActive: user.email !== INACTIVE_USER.email,
        },
      });
    }
  }

  /**
   * Test verisini temizler.
   *
   * `audit_logs` tablosu üretimde DEĞİŞMEZDİR: `audit_logs_no_delete` ve
   * `audit_logs_no_update` RULE'ları silme/güncelleme denemelerini sessizce
   * yok sayar (Kural 4). Bu, denetim geçmişi olan bir kullanıcının hard delete
   * edilememesi anlamına gelir — kasıtlı bir tasarımdır.
   *
   * Test temizliği için kurallar GEÇİCİ olarak devre dışı bırakılır. Bu,
   * yalnızca test veritabanında ve yalnızca bu yardımcıda yapılır; uygulama
   * kodunda böyle bir yol YOKTUR.
   */
  async function cleanupUsers(): Promise<void> {
    await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE RULE audit_logs_no_delete');

    try {
      await prisma.auditLog.deleteMany({
        where: { user: { email: { contains: '@zirvetarim.test' } } },
      });
      await prisma.user.deleteMany({ where: { email: { contains: '@zirvetarim.test' } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE RULE audit_logs_no_delete');
    }
  }

  const api = () => request(app.getHttpServer());

  async function login(email: string, password: string) {
    return api().post('/api/v1/auth/login').send({ email, password });
  }

  async function loginAs(user: { email: string; password: string }) {
    const response = await login(user.email, user.password);

    expect(response.status).toBe(HttpStatus.OK);

    return response.body.data as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: { id: string; email: string; role: string };
    };
  }

  // =========================================================================
  describe('POST /auth/login', () => {
    it('geçerli bilgilerle giriş yapar ve jeton çifti döner', async () => {
      const response = await login(ACTIVE_ADMIN.email, ACTIVE_ADMIN.password);

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.success).toBe(true);

      const data = response.body.data;

      expect(typeof data.accessToken).toBe('string');
      expect(typeof data.refreshToken).toBe('string');
      expect(data.tokenType).toBe('Bearer');
      expect(data.expiresIn).toBeGreaterThan(0);
      expect(data.user.email).toBe(ACTIVE_ADMIN.email);
      expect(data.user.role).toBe(UserRole.ADMIN);
    });

    it('yanıtta şifre veya hash ASLA bulunmaz', async () => {
      const response = await login(ACTIVE_ADMIN.email, ACTIVE_ADMIN.password);
      const body = JSON.stringify(response.body);

      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain(ACTIVE_ADMIN.password);
      expect(body).not.toContain('argon2');
    });

    it('lastLoginAt alanını günceller', async () => {
      await login(ACTIVE_ADMIN.email, ACTIVE_ADMIN.password);

      const user = await prisma.user.findFirst({ where: { email: ACTIVE_ADMIN.email } });

      expect(user?.lastLoginAt).not.toBeNull();
    });

    it('başarılı girişi denetim kaydına yazar', async () => {
      await login(ACTIVE_ADMIN.email, ACTIVE_ADMIN.password);

      const log = await prisma.auditLog.findFirst({
        where: { action: 'LOGIN', user: { email: ACTIVE_ADMIN.email } },
        orderBy: { createdAt: 'desc' },
      });

      expect(log).not.toBeNull();
    });

    it('yanlış şifreyi reddeder', async () => {
      const response = await login(ACTIVE_ADMIN.email, 'YanlisSifre123');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('bilinmeyen e-posta ile yanlış şifre AYNI hatayı döndürür (enumeration engeli)', async () => {
      const unknownEmail = await login('yok.boyle.biri@zirvetarim.test', 'HerhangiSifre123');
      const wrongPassword = await login(ACTIVE_ADMIN.email, 'YanlisSifre123');

      expect(unknownEmail.status).toBe(wrongPassword.status);
      expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it('PASİF kullanıcının girişini reddeder', async () => {
      const response = await login(INACTIVE_USER.email, INACTIVE_USER.password);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');
    });

    it('5 hatalı denemeden sonra hesabı kilitler', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(SUPER_ADMIN.email, 'SurekliYanlis123');
      }

      // Kilit sonrası DOĞRU şifre bile reddedilmelidir.
      const response = await login(SUPER_ADMIN.email, SUPER_ADMIN.password);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('geçersiz e-posta biçimini doğrulama hatasıyla reddeder', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: 'eposta-degil', password: 'HerhangiSifre123' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('DTO da tanımsız alan gönderilirse reddeder', async () => {
      const response = await api()
        .post('/api/v1/auth/login')
        .send({ email: ACTIVE_ADMIN.email, password: ACTIVE_ADMIN.password, role: 'SUPER_ADMIN' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('POST /auth/refresh — rotasyon', () => {
    it('geçerli jetonu yenisiyle değiştirir', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const response = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.refreshToken).not.toBe(session.refreshToken);
      expect(typeof response.body.data.accessToken).toBe('string');
    });

    it('KULLANILAN jeton bir daha kabul edilmez (tek kullanımlık)', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const first = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken });
      expect(first.status).toBe(HttpStatus.OK);

      const second = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(second.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(second.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('yeniden kullanım tespitinde TÜM oturumları düşürür', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      // Rotasyon: eski jeton iptal olur, yenisi verilir.
      const rotated = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken });
      const freshToken = rotated.body.data.refreshToken as string;

      // Saldırgan eski (iptal edilmiş) jetonu kullanmayı dener.
      await api().post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });

      // Sonuç: meşru kullanıcının GEÇERLİ jetonu da artık çalışmamalı.
      const afterBreach = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: freshToken });

      expect(afterBreach.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('bilinmeyen jetonu reddeder', async () => {
      const response = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'tamamen-uydurma-bir-jeton' });

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('süresi dolmuş jetonu reddeder', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      await prisma.refreshToken.updateMany({
        where: { user: { email: ACTIVE_ADMIN.email }, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('ham jeton veritabanında SAKLANMAZ (yalnız hash)', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const stored = await prisma.refreshToken.findFirst({
        where: { user: { email: ACTIVE_ADMIN.email }, revokedAt: null },
      });

      expect(stored).not.toBeNull();
      expect(stored?.tokenHash).not.toBe(session.refreshToken);
      expect(stored?.tokenHash).toHaveLength(64);
    });
  });

  // =========================================================================
  describe('POST /auth/logout', () => {
    it('jetonu iptal eder ve tekrar kullanılamaz hâle getirir', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const logout = await api()
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ refreshToken: session.refreshToken });

      expect(logout.status).toBe(HttpStatus.OK);

      const afterLogout = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(afterLogout.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('kimlik doğrulaması olmadan çağrılamaz', async () => {
      const response = await api().post('/api/v1/auth/logout').send({ refreshToken: 'herhangi' });

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // =========================================================================
  describe('GET /auth/me', () => {
    it('geçerli jetonla profili döner', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const response = await api()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.email).toBe(ACTIVE_ADMIN.email);
      expect(response.body.data.passwordHash).toBeUndefined();
    });

    it('jeton olmadan 401 döner', async () => {
      const response = await api().get('/api/v1/auth/me');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('bozuk jetonla 401 döner', async () => {
      const response = await api()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer bozuk.jeton.degeri');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('Bearer öneki olmadan 401 döner', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const response = await api().get('/api/v1/auth/me').set('Authorization', session.accessToken);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('kullanıcı PASİFE ALINDIĞINDA mevcut jeton geçersizleşir', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      await prisma.user.update({
        where: { email: ACTIVE_ADMIN.email },
        data: { isActive: false },
      });

      const response = await api()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(response.body.error.code).toBe('ACCOUNT_INACTIVE');

      await prisma.user.update({
        where: { email: ACTIVE_ADMIN.email },
        data: { isActive: true },
      });
    });
  });

  // =========================================================================
  describe('Yetkilendirme — /admin/users', () => {
    it('jetonsuz erişimi 401 ile reddeder', async () => {
      const response = await api().get('/api/v1/admin/users');

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('ADMIN rolünü 403 ile reddeder (SUPER_ADMIN gerekir)', async () => {
      const session = await loginAs(ACTIVE_ADMIN);

      const response = await api()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(HttpStatus.FORBIDDEN);
      expect(response.body.error.code).toBe('FORBIDDEN');
    });

    it('SUPER_ADMIN rolüne izin verir ve sayfalanmış liste döner', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(HttpStatus.OK);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.meta).toMatchObject({ page: 1, limit: 20 });
    });

    it('liste yanıtında passwordHash bulunmaz', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    });
  });

  // =========================================================================
  describe('Kullanıcı yönetimi iş kuralları', () => {
    it('SUPER_ADMIN yeni kullanıcı oluşturabilir', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          email: 'e2e.yeni@zirvetarim.test',
          fullName: 'Yeni Kullanıcı',
          password: 'YeniKullanici123',
          role: 'ADMIN',
        });

      expect(response.status).toBe(HttpStatus.CREATED);
      expect(response.body.data.email).toBe('e2e.yeni@zirvetarim.test');
      expect(response.body.data.isActive).toBe(true);
    });

    it('aynı e-posta ile ikinci kullanıcıyı reddeder', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          email: ACTIVE_ADMIN.email,
          fullName: 'Kopya Kullanıcı',
          password: 'KopyaSifre123',
          role: 'ADMIN',
        });

      expect(response.status).toBe(HttpStatus.CONFLICT);
      expect(response.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('zayıf şifreyi reddeder', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          email: 'e2e.zayif@zirvetarim.test',
          fullName: 'Zayıf Şifre',
          password: 'kisa',
          role: 'ADMIN',
        });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('kullanıcı pasife alınınca oturumları düşer', async () => {
      const superSession = await loginAs(SUPER_ADMIN);
      const victimSession = await loginAs(ACTIVE_ADMIN);

      const deactivate = await api()
        .patch(`/api/v1/admin/users/${victimSession.user.id}/status`)
        .set('Authorization', `Bearer ${superSession.accessToken}`)
        .send({ isActive: false });

      expect(deactivate.status).toBe(HttpStatus.OK);

      const refreshAttempt = await api()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: victimSession.refreshToken });

      expect(refreshAttempt.status).toBe(HttpStatus.UNAUTHORIZED);

      await prisma.user.update({
        where: { email: ACTIVE_ADMIN.email },
        data: { isActive: true },
      });
    });

    it('kullanıcı kendi hesabını pasife alamaz', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .patch(`/api/v1/admin/users/${session.user.id}/status`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ isActive: false });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(response.body.error.code).toBe('SELF_ACTION_FORBIDDEN');
    });

    it('geçersiz UUID için 400 döner', async () => {
      const session = await loginAs(SUPER_ADMIN);

      const response = await api()
        .get('/api/v1/admin/users/uuid-degil')
        .set('Authorization', `Bearer ${session.accessToken}`);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
