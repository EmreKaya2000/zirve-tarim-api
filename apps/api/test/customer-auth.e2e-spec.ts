import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { MailService, type MailMessage } from '../src/modules/mail/mail.service';
import { deleteProductsWithStockHistory } from './test-cleanup';

/**
 * Müşteri hesabı, sunucu sepeti ve talep geçmişi — uçtan uca (Sprint 11).
 *
 * EN KRİTİK TESTLER:
 *   - kayıt + mükerrer e-posta: yanıt AYNI olmalı (enumeration koruması)
 *   - refresh rotation ve yeniden kullanım tespiti
 *   - AUDIENCE AYRIMI: müşteri jetonu /admin'de, admin jetonu /customer'da GEÇERSİZ
 *   - merge kuralları: toplama, adım yuvarlama, azami aşımı, pasif atlama, idempotency
 *   - girişli talebin otomatik bağlanması
 *   - doğrulanmış e-postayla geçmiş talep bağlama / doğrulanmamışta BAĞLANMAMA
 *   - başkasının talebine erişimde 404 (403 DEĞİL)
 *
 * E-POSTA GERÇEKTEN GÖNDERİLMEZ: `MailService` sahte bir uygulamayla
 * değiştirilir ve gönderilen mesajlar bellekte tutulur. Jetonlar veritabanında
 * yalnız HASH'li durduğu için ham jetonu okumanın tek yolu e-posta gövdesidir —
 * bu da tam olarak gerçek kullanıcının izlediği yol.
 */
describe('Müşteri hesabı (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const PREFIX = 'E2EMusteri';
  const DOMAIN = 'e2e-musteri.test';

  const SUPER = { email: `cust.super@${DOMAIN}`, password: 'CustSuperSifre123' };
  const VALID_PASSWORD = 'Tarla2026sifre';

  /** Sahte posta kutusu — gönderilen her mesaj buraya düşer. */
  const outbox: MailMessage[] = [];

  const fakeMail = {
    send: async (message: MailMessage): Promise<boolean> => {
      outbox.push(message);

      return true;
    },
  };

  let adminToken = '';
  let kgVariantId = '';
  let pieceVariantId = '';
  let inactiveVariantId = '';
  let unpublishedVariantId = '';

  jest.setTimeout(240_000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Üretim kodu değişmeden e-posta gönderimi devre dışı bırakılır.
      .overrideProvider(MailService)
      .useValue(fakeMail)
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app, { apiPrefix: 'api/v1' });
    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();

    await cleanup();

    await prisma.user.create({
      data: {
        email: SUPER.email,
        passwordHash: await hash(SUPER.password, ARGON2_OPTIONS),
        fullName: 'E2E Müşteri Yöneticisi',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    const login = await api().post('/api/v1/auth/login').send(SUPER);
    adminToken = login.body.data.accessToken;

    await seedFixtures();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(() => {
    outbox.length = 0;
  });

  const api = () => request(app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${adminToken}` });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  // =========================================================================
  // YARDIMCILAR
  // =========================================================================

  let emailCounter = 0;

  /** Her test için çakışmayan bir adres üretir. */
  const freshEmail = (label: string): string => {
    emailCounter += 1;

    return `${label}.${emailCounter}@${DOMAIN}`;
  };

  const registerBody = (email: string, overrides: Record<string, unknown> = {}) => ({
    firstName: 'Ahmet',
    lastName: 'Yılmaz',
    email,
    phone: '0532 111 22 33',
    password: VALID_PASSWORD,
    consentAccepted: true,
    ...overrides,
  });

  /** Kayıt + giriş; hazır bir müşteri oturumu döndürür. */
  async function createAccount(
    label: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ email: string; accessToken: string; refreshToken: string; accountId: string }> {
    const email = freshEmail(label);

    const registered = await api()
      .post('/api/v1/customer-auth/register')
      .send(registerBody(email, overrides));

    expect(registered.status).toBe(HttpStatus.OK);

    const login = await api()
      .post('/api/v1/customer-auth/login')
      .send({ email, password: (overrides['password'] as string) ?? VALID_PASSWORD });

    expect(login.status).toBe(HttpStatus.OK);

    return {
      email,
      accessToken: login.body.data.accessToken,
      refreshToken: login.body.data.refreshToken,
      accountId: login.body.data.account.id,
    };
  }

  /**
   * Son gönderilen e-postadan jetonu ayıklar.
   *
   * Ham jeton veritabanında YOKTUR (yalnız SHA-256 özeti saklanır); testin de
   * gerçek kullanıcı gibi e-postadan okuması bu yüzden zorunlu — ve doğru.
   */
  function tokenFromLastMail(pathSegment: string): string {
    const message = [...outbox].reverse().find((mail) => mail.text.includes(pathSegment));

    expect(message).toBeDefined();

    const match = new RegExp(`${pathSegment}/([A-Za-z0-9_-]+)`).exec((message as MailMessage).text);

    expect(match).not.toBeNull();

    return (match as RegExpExecArray)[1] as string;
  }

  /** Doğrulama jetonunu e-postadan alıp kullanır. */
  async function verifyEmailOf(label = '/eposta-dogrula'): Promise<request.Response> {
    return api()
      .post('/api/v1/customer-auth/verify-email')
      .send({ token: tokenFromLastMail(label) });
  }

  async function seedFixtures(): Promise<void> {
    const [kg, piece] = await Promise.all([
      prisma.unitType.findFirst({ where: { code: 'kg' } }),
      prisma.unitType.findFirst({ where: { code: 'ad' } }),
    ]);
    const category = await prisma.category.findFirst({ where: { deletedAt: null } });

    expect(kg).not.toBeNull();
    expect(piece).not.toBeNull();
    expect(category).not.toBeNull();

    const categoryId = (category as { id: string }).id;

    // Yayında, kg birimli: asgari 5, adım 5, azami 100.
    const published = await prisma.product.create({
      data: {
        name: `${PREFIX} Gübre`,
        slug: `e2e-musteri-gubre-${Date.now()}`,
        isActive: true,
        isPublished: true,
        showPrice: true,
        categories: { create: { categoryId, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX}-KG-1`,
            unitTypeId: (kg as { id: string }).id,
            unitQuantity: '5',
            purchasePrice: '400',
            salePrice: '600',
            minOrderQuantity: '5',
            quantityStep: '5',
            maxOrderQuantity: '100',
            stockQuantity: '1000',
            isActive: true,
            isDefault: true,
          },
        },
      },
      select: { variants: { select: { id: true } } },
    });

    kgVariantId = (published.variants[0] as { id: string }).id;

    // Adet birimli, fiyatı GİZLİ ürün.
    const pieceProduct = await prisma.product.create({
      data: {
        name: `${PREFIX} Adet Ürün`,
        slug: `e2e-musteri-adet-${Date.now()}`,
        isActive: true,
        isPublished: true,
        showPrice: false,
        categories: { create: { categoryId, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX}-AD-1`,
            unitTypeId: (piece as { id: string }).id,
            unitQuantity: '1',
            purchasePrice: '100',
            salePrice: '150',
            minOrderQuantity: '1',
            quantityStep: '1',
            stockQuantity: '10',
            isActive: true,
            isDefault: true,
          },
        },
      },
      select: { variants: { select: { id: true } } },
    });

    pieceVariantId = (pieceProduct.variants[0] as { id: string }).id;

    // PASİF varyasyon.
    const withInactive = await prisma.product.create({
      data: {
        name: `${PREFIX} Pasif Varyasyon`,
        slug: `e2e-musteri-pasif-${Date.now()}`,
        isActive: true,
        isPublished: true,
        categories: { create: { categoryId, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX}-PASIF-1`,
            unitTypeId: (piece as { id: string }).id,
            unitQuantity: '1',
            purchasePrice: '10',
            salePrice: '20',
            minOrderQuantity: '1',
            quantityStep: '1',
            stockQuantity: '5',
            isActive: false,
          },
        },
      },
      select: { variants: { select: { id: true } } },
    });

    inactiveVariantId = (withInactive.variants[0] as { id: string }).id;

    // YAYINDA OLMAYAN ürün, aktif varyasyonla.
    const unpublished = await prisma.product.create({
      data: {
        name: `${PREFIX} Yayinda Degil`,
        slug: `e2e-musteri-yayinda-degil-${Date.now()}`,
        isActive: true,
        isPublished: false,
        categories: { create: { categoryId, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX}-GIZLI-1`,
            unitTypeId: (piece as { id: string }).id,
            unitQuantity: '1',
            purchasePrice: '10',
            salePrice: '20',
            minOrderQuantity: '1',
            quantityStep: '1',
            stockQuantity: '5',
            isActive: true,
          },
        },
      },
      select: { variants: { select: { id: true } } },
    });

    unpublishedVariantId = (unpublished.variants[0] as { id: string }).id;
  }

  async function cleanup(): Promise<void> {
    await prisma.inquiry.deleteMany({ where: { contactName: { startsWith: PREFIX } } });
    await prisma.inquiry.deleteMany({ where: { contactEmail: { endsWith: DOMAIN } } });

    // cart_items ve jeton tabloları CASCADE ile düşer.
    await prisma.customerAccount.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.customer.deleteMany({ where: { fullName: { startsWith: PREFIX } } });

    const products = await prisma.product.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });

    await deleteProductsWithStockHistory(
      prisma,
      products.map((p) => p.id),
    );

    await prisma.$executeRawUnsafe('ALTER TABLE audit_logs DISABLE RULE audit_logs_no_delete');
    try {
      await prisma.auditLog.deleteMany({ where: { user: { email: { endsWith: DOMAIN } } } });
      await prisma.auditLog.deleteMany({ where: { entityType: 'CustomerAccount' } });
      await prisma.auditLog.deleteMany({ where: { entityType: 'Inquiry', userId: null } });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE RULE audit_logs_no_delete');
    }
  }

  // =========================================================================
  describe('Kayıt', () => {
    it('hesap oluşturur ve doğrulama e-postası gönderir', async () => {
      const email = freshEmail('kayit');
      const response = await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.success).toBe(true);

      // JETON DÖNMEZ: yanıt biçimi mükerrer adresle aynı kalmalı.
      expect(response.body.data.accessToken).toBeUndefined();
      expect(response.body.data.refreshToken).toBeUndefined();

      const account = await prisma.customerAccount.findFirst({ where: { email } });

      expect(account).not.toBeNull();
      expect(account?.emailVerifiedAt).toBeNull();
      // Telefon normalleştirilmiş saklanır (DB CHECK'i de bunu zorluyor).
      expect(account?.phone).toBe('5321112233');

      const mail = outbox.find((message) => message.to === email);

      expect(mail?.subject).toContain('doğrula');
    });

    it('MÜKERRER e-postada AYNI genel yanıtı verir ve ikinci hesap açmaz', async () => {
      const email = freshEmail('mukerrer');

      const first = await api().post('/api/v1/customer-auth/register').send(registerBody(email));
      outbox.length = 0;

      const second = await api()
        .post('/api/v1/customer-auth/register')
        .send(registerBody(email, { firstName: 'Saldırgan' }));

      // Enumeration koruması: durum kodu ve gövde birebir aynı.
      expect(second.status).toBe(first.status);
      expect(second.body.data).toEqual(first.body.data);

      const count = await prisma.customerAccount.count({ where: { email } });

      expect(count).toBe(1);

      // Ad değişmemiş: ikinci istek mevcut hesaba DOKUNMAZ.
      const account = await prisma.customerAccount.findFirst({ where: { email } });

      expect(account?.firstName).toBe('Ahmet');

      // Adresin SAHİBİNE şifre sıfırlama bağlantısı gitmiş olmalı.
      const notice = outbox.find((message) => message.to === email);

      expect(notice?.subject).toContain('Şifre sıfırlama');
    });

    it('KVKK onayı olmadan reddeder', async () => {
      const response = await api()
        .post('/api/v1/customer-auth/register')
        .send(registerBody(freshEmail('onaysiz'), { consentAccepted: false }));

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.code).toBe('CONSENT_REQUIRED');
      expect(response.body.error.details[0].field).toBe('consentAccepted');
    });

    it('politikayı karşılamayan şifreyi WEAK_PASSWORD ile reddeder', async () => {
      const short = await api()
        .post('/api/v1/customer-auth/register')
        .send(registerBody(freshEmail('kisa'), { password: 'Kisa1' }));

      expect(short.status).toBe(HttpStatus.BAD_REQUEST);
      expect(short.body.error.code).toBe('WEAK_PASSWORD');

      // Yalnız harf: rakam yok.
      const noDigit = await api()
        .post('/api/v1/customer-auth/register')
        .send(registerBody(freshEmail('rakamsiz'), { password: 'sadeceharfler' }));

      expect(noDigit.body.error.code).toBe('WEAK_PASSWORD');

      // Yalnız rakam: harf yok.
      const noLetter = await api()
        .post('/api/v1/customer-auth/register')
        .send(registerBody(freshEmail('harfsiz'), { password: '12345678' }));

      expect(noLetter.body.error.code).toBe('WEAK_PASSWORD');
    });

    it('e-postayı büyük/küçük harften bağımsız tek hesapta tutar', async () => {
      const email = freshEmail('BuyukHarf');

      await api().post('/api/v1/customer-auth/register').send(registerBody(email.toUpperCase()));

      const account = await prisma.customerAccount.findFirst({
        where: { email: email.toLowerCase() },
      });

      expect(account).not.toBeNull();
    });
  });

  // =========================================================================
  describe('Giriş, yenileme ve çıkış', () => {
    it('doğru bilgilerle giriş yapar', async () => {
      const session = await createAccount('giris');

      expect(session.accessToken.length).toBeGreaterThan(0);

      const me = await api().get('/api/v1/customer-auth/me').set(bearer(session.accessToken));

      expect(me.status).toBe(HttpStatus.OK);
      expect(me.body.data.email).toBe(session.email);
      expect(me.body.data.isEmailVerified).toBe(false);
      expect(me.body.data.hasLinkedCustomer).toBe(false);
      // Kural 8: hassas alan sızmaz.
      expect(me.body.data.passwordHash).toBeUndefined();
    });

    it('yanlış şifre ve bilinmeyen adres AYNI hatayı verir', async () => {
      const session = await createAccount('hatali');

      const wrongPassword = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: session.email, password: 'YanlisSifre123' });

      const unknownEmail = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: freshEmail('yokboyle'), password: VALID_PASSWORD });

      expect(wrongPassword.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(unknownEmail.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('yenileme jetonu ROTASYONA girer: eskisi bir daha kullanılamaz', async () => {
      const session = await createAccount('rotation');

      const first = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(first.status).toBe(HttpStatus.OK);
      expect(first.body.data.refreshToken).not.toBe(session.refreshToken);

      // Yeni jeton çalışır.
      const second = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: first.body.data.refreshToken });

      expect(second.status).toBe(HttpStatus.OK);
    });

    it('iptal edilmiş jetonun yeniden kullanımı TÜM oturumları düşürür', async () => {
      const session = await createAccount('reuse');

      const rotated = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: session.refreshToken });

      const liveToken = rotated.body.data.refreshToken;

      // ESKİ (iptal edilmiş) jetonu tekrar kullan: sızma varsayılır.
      const reuse = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(reuse.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(reuse.body.error.code).toBe('INVALID_REFRESH_TOKEN');

      // Zincirin geçerli halkası da düşmüş olmalı.
      const afterReuse = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: liveToken });

      expect(afterReuse.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('çıkış jetonu iptal eder', async () => {
      const session = await createAccount('cikis');

      const logout = await api()
        .post('/api/v1/customer-auth/logout')
        .set(bearer(session.accessToken))
        .send({ refreshToken: session.refreshToken });

      expect(logout.status).toBe(HttpStatus.OK);

      const refresh = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(refresh.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('pasife alınan hesap giriş yapamaz ve jetonu geçersizleşir', async () => {
      const session = await createAccount('pasif');

      await prisma.customerAccount.update({
        where: { id: session.accountId },
        data: { isActive: false },
      });

      const me = await api().get('/api/v1/customer-auth/me').set(bearer(session.accessToken));

      expect(me.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(me.body.error.code).toBe('ACCOUNT_INACTIVE');

      const login = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: session.email, password: VALID_PASSWORD });

      expect(login.body.error.code).toBe('ACCOUNT_INACTIVE');
    });
  });

  // =========================================================================
  describe('AUDIENCE AYRIMI — iki kimlik alanı birbirine geçmez', () => {
    it('müşteri jetonu /admin/* uçlarında GEÇERSİZDİR', async () => {
      const session = await createAccount('audience.admin');

      const inquiries = await api().get('/api/v1/admin/inquiries').set(bearer(session.accessToken));

      expect(inquiries.status).toBe(HttpStatus.UNAUTHORIZED);

      const customers = await api().get('/api/v1/admin/customers').set(bearer(session.accessToken));

      expect(customers.status).toBe(HttpStatus.UNAUTHORIZED);

      const accounts = await api()
        .get('/api/v1/admin/customer-accounts')
        .set(bearer(session.accessToken));

      expect(accounts.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('admin jetonu /customer/* uçlarında GEÇERSİZDİR', async () => {
      const cart = await api().get('/api/v1/customer/cart').set(admin());

      expect(cart.status).toBe(HttpStatus.UNAUTHORIZED);

      const inquiries = await api().get('/api/v1/customer/inquiries').set(admin());

      expect(inquiries.status).toBe(HttpStatus.UNAUTHORIZED);

      const profile = await api().get('/api/v1/customer/profile').set(admin());

      expect(profile.status).toBe(HttpStatus.UNAUTHORIZED);

      const me = await api().get('/api/v1/customer-auth/me').set(admin());

      expect(me.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('jetonsuz istek müşteri uçlarında 401 alır', async () => {
      const cart = await api().get('/api/v1/customer/cart');

      expect(cart.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('admin jetonu kendi uçlarında ÇALIŞMAYA DEVAM EDER (regresyon)', async () => {
      const inquiries = await api().get('/api/v1/admin/inquiries').set(admin());

      expect(inquiries.status).toBe(HttpStatus.OK);
    });
  });

  // =========================================================================
  describe('Sepet', () => {
    it('boş sepet döner ve okuma isteği sepet satırı OLUŞTURMAZ', async () => {
      const session = await createAccount('sepet.bos');

      const cart = await api().get('/api/v1/customer/cart').set(bearer(session.accessToken));

      expect(cart.status).toBe(HttpStatus.OK);
      expect(cart.body.data.items).toHaveLength(0);
      expect(cart.body.data.itemCount).toBe(0);

      const rows = await prisma.cart.count({ where: { customerAccountId: session.accountId } });

      expect(rows).toBe(0);
    });

    it('kalem ekler, miktarı günceller, kaldırır ve boşaltır', async () => {
      const session = await createAccount('sepet.crud');
      const auth = bearer(session.accessToken);

      const added = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '10' });

      expect(added.status).toBe(HttpStatus.OK);
      expect(added.body.data.items).toHaveLength(1);
      expect(added.body.data.items[0].quantity).toBe('10');
      // Fiyatı gösterilen ürün: satır tutarı hesaplanır.
      expect(added.body.data.items[0].lineTotal).toBe('6000');
      expect(added.body.data.items[0].isAvailable).toBe(true);

      const itemId = added.body.data.items[0].id;

      const updated = await api()
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set(auth)
        .send({ quantity: '25' });

      expect(updated.body.data.items[0].quantity).toBe('25');

      const removed = await api().delete(`/api/v1/customer/cart/items/${itemId}`).set(auth);

      expect(removed.body.data.items).toHaveLength(0);

      await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '5' });

      const cleared = await api().delete('/api/v1/customer/cart').set(auth);

      expect(cleared.body.data.items).toHaveLength(0);
    });

    it('aynı varyasyon tekrar eklenince miktarlar TOPLANIR', async () => {
      const session = await createAccount('sepet.toplama');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '10' });

      const second = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '15' });

      expect(second.body.data.items).toHaveLength(1);
      expect(second.body.data.items[0].quantity).toBe('25');
    });

    it('sepet uçlarında miktar ihlali REDDEDİLİR (S6 kuralları aynen)', async () => {
      const session = await createAccount('sepet.miktar');
      const auth = bearer(session.accessToken);

      const belowMin = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '2' });

      expect(belowMin.status).toBe(HttpStatus.BAD_REQUEST);
      expect(belowMin.body.error.details[0].field).toBe('quantity');
      expect(belowMin.body.error.details[0].message).toContain('En az');

      const offStep = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '7' });

      expect(offStep.body.error.details[0].message).toContain('adımlarla');

      const aboveMax = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '200' });

      expect(aboveMax.body.error.details[0].message).toContain('En fazla');

      const decimal = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: pieceVariantId, quantity: '2.5' });

      expect(decimal.body.error.details[0].message).toContain('ondalık');
    });

    it('pasif varyasyon ve yayında olmayan ürün sepete EKLENEMEZ', async () => {
      const session = await createAccount('sepet.pasif');
      const auth = bearer(session.accessToken);

      const inactive = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: inactiveVariantId, quantity: '1' });

      expect(inactive.status).toBe(HttpStatus.BAD_REQUEST);
      expect(inactive.body.error.message).toContain('mevcut değil');

      const unpublished = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: unpublishedVariantId, quantity: '1' });

      expect(unpublished.body.error.message).toContain('satışta değil');
    });

    it('BAŞKASININ sepet kalemine erişim 404 döner', async () => {
      const owner = await createAccount('sepet.sahip');
      const other = await createAccount('sepet.digeri');

      const added = await api()
        .post('/api/v1/customer/cart/items')
        .set(bearer(owner.accessToken))
        .send({ productVariantId: kgVariantId, quantity: '5' });

      const itemId = added.body.data.items[0].id;

      const patch = await api()
        .patch(`/api/v1/customer/cart/items/${itemId}`)
        .set(bearer(other.accessToken))
        .send({ quantity: '10' });

      expect(patch.status).toBe(HttpStatus.NOT_FOUND);

      const remove = await api()
        .delete(`/api/v1/customer/cart/items/${itemId}`)
        .set(bearer(other.accessToken));

      expect(remove.status).toBe(HttpStatus.NOT_FOUND);

      // Sahibin sepeti bozulmamış olmalı.
      const ownerCart = await api().get('/api/v1/customer/cart').set(bearer(owner.accessToken));

      expect(ownerCart.body.data.items).toHaveLength(1);
      expect(ownerCart.body.data.items[0].quantity).toBe('5');
    });

    it('fiyatı gizli ürün tahmini tutara girmez', async () => {
      const session = await createAccount('sepet.gizlifiyat');
      const auth = bearer(session.accessToken);

      const response = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: pieceVariantId, quantity: '3' });

      expect(response.body.data.items[0].displayedPrice).toBeNull();
      expect(response.body.data.items[0].lineTotal).toBeNull();
      expect(response.body.data.estimatedTotal).toBe('0');
      expect(response.body.data.hasHiddenPrices).toBe(true);
    });

    it('yayından kalkan kalem SİLİNMEZ, işaretlenir', async () => {
      const session = await createAccount('sepet.yayindan');
      const auth = bearer(session.accessToken);

      const added = await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '5' });

      expect(added.body.data.items[0].isAvailable).toBe(true);

      await prisma.productVariant.update({
        where: { id: kgVariantId },
        data: { isActive: false },
      });

      try {
        const cart = await api().get('/api/v1/customer/cart').set(auth);

        expect(cart.body.data.items).toHaveLength(1);
        expect(cart.body.data.items[0].isAvailable).toBe(false);
        expect(cart.body.data.items[0].unavailableReason).not.toBeNull();
        // Talep edilemeyecek kalem tahmini tutara katılmaz.
        expect(cart.body.data.estimatedTotal).toBe('0');
      } finally {
        await prisma.productVariant.update({
          where: { id: kgVariantId },
          data: { isActive: true },
        });
      }
    });
  });

  // =========================================================================
  describe('SEPET BİRLEŞTİRME', () => {
    it('boş sunucu sepetine misafir sepetini taşır', async () => {
      const session = await createAccount('merge.bos');

      const response = await api()
        .post('/api/v1/customer/cart/merge')
        .set(bearer(session.accessToken))
        .send({ items: [{ productVariantId: kgVariantId, quantity: '10' }] });

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.addedCount).toBe(1);
      expect(response.body.data.mergedCount).toBe(0);
      expect(response.body.data.cart.items[0].quantity).toBe('10');
      expect(response.body.data.skippedItems).toHaveLength(0);
    });

    it('(a) aynı varyasyon iki sepette de varsa miktarlar TOPLANIR', async () => {
      const session = await createAccount('merge.toplama');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '10' });

      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({ items: [{ productVariantId: kgVariantId, quantity: '15' }] });

      expect(merged.body.data.mergedCount).toBe(1);
      expect(merged.body.data.addedCount).toBe(0);
      expect(merged.body.data.cart.items[0].quantity).toBe('25');
    });

    it('(b) toplam ızgaraya oturmuyorsa EN YAKIN geçerli miktara ayarlanır', async () => {
      const session = await createAccount('merge.adim');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '5' });

      // 5 + 3 = 8 -> ızgara 5, 10, 15... En yakın geçerli: 10.
      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({ items: [{ productVariantId: kgVariantId, quantity: '3' }] });

      expect(merged.body.data.cart.items[0].quantity).toBe('10');
      expect(merged.body.data.adjustedItems).toHaveLength(1);
      expect(merged.body.data.adjustedItems[0].requestedQuantity).toBe('8');
      expect(merged.body.data.adjustedItems[0].finalQuantity).toBe('10');
    });

    it('(b) azami aşımında üst sınırı AŞMAYAN en büyük geçerli miktara iner', async () => {
      const session = await createAccount('merge.azami');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '100' });

      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({ items: [{ productVariantId: kgVariantId, quantity: '50' }] });

      // 100 + 50 = 150 > azami 100 -> 100'e iner.
      expect(merged.body.data.cart.items[0].quantity).toBe('100');
      expect(merged.body.data.adjustedItems[0].finalQuantity).toBe('100');
    });

    it('(b) asgarinin altındaki miktar YUKARI, asgariye çekilir', async () => {
      const session = await createAccount('merge.asgari');

      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(bearer(session.accessToken))
        .send({ items: [{ productVariantId: kgVariantId, quantity: '1' }] });

      // Aşağı yuvarlanırsa 0 çıkar ve ürün kaybolurdu.
      expect(merged.body.data.cart.items[0].quantity).toBe('5');
    });

    it('(c) pasif varyasyon ve yayında olmayan ürün ATLANIR, nedeni döner', async () => {
      const session = await createAccount('merge.atlama');

      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(bearer(session.accessToken))
        .send({
          items: [
            { productVariantId: kgVariantId, quantity: '10' },
            { productVariantId: inactiveVariantId, quantity: '1' },
            { productVariantId: unpublishedVariantId, quantity: '1' },
            { productVariantId: '11111111-1111-4111-8111-111111111111', quantity: '1' },
          ],
        });

      expect(merged.status).toBe(HttpStatus.OK);
      // Geçerli kalem taşındı; geçersizler akışı DÜŞÜRMEDİ.
      expect(merged.body.data.cart.items).toHaveLength(1);
      expect(merged.body.data.skippedItems).toHaveLength(3);

      const reasons = merged.body.data.skippedItems.map((item: { reason: string }) => item.reason);

      expect(reasons).toContain('VARIANT_UNAVAILABLE');
      expect(reasons).toContain('PRODUCT_UNAVAILABLE');
      expect(reasons).toContain('VARIANT_NOT_FOUND');

      for (const skipped of merged.body.data.skippedItems) {
        expect(typeof skipped.message).toBe('string');
        expect(skipped.message.length).toBeGreaterThan(0);
      }
    });

    it('(d) İDEMPOTENT: aynı payload ikinci kez gönderilirse sepet DEĞİŞMEZ', async () => {
      const session = await createAccount('merge.idempotent');
      const auth = bearer(session.accessToken);
      const payload = { items: [{ productVariantId: kgVariantId, quantity: '10' }] };

      const first = await api().post('/api/v1/customer/cart/merge').set(auth).send(payload);

      expect(first.body.data.cart.items[0].quantity).toBe('10');
      expect(first.body.data.addedCount).toBe(1);

      const second = await api().post('/api/v1/customer/cart/merge').set(auth).send(payload);

      // TOPLAMA TEKRARLANMAZ: 10 kalır, 20 olmaz.
      expect(second.body.data.cart.items[0].quantity).toBe('10');
      expect(second.body.data.addedCount).toBe(0);
      expect(second.body.data.mergedCount).toBe(0);

      const third = await api().post('/api/v1/customer/cart/merge').set(auth).send(payload);

      expect(third.body.data.cart.items[0].quantity).toBe('10');
    });

    it('idempotency kalem SIRASINDAN bağımsızdır', async () => {
      const session = await createAccount('merge.sira');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({
          items: [
            { productVariantId: kgVariantId, quantity: '10' },
            { productVariantId: pieceVariantId, quantity: '2' },
          ],
        });

      const reversed = await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({
          items: [
            { productVariantId: pieceVariantId, quantity: '2' },
            { productVariantId: kgVariantId, quantity: '10' },
          ],
        });

      expect(reversed.body.data.addedCount).toBe(0);
      expect(reversed.body.data.mergedCount).toBe(0);

      const byVariant = new Map<string, string>(
        reversed.body.data.cart.items.map(
          (item: { productVariantId: string; quantity: string }) => [
            item.productVariantId,
            item.quantity,
          ],
        ),
      );

      expect(byVariant.get(kgVariantId)).toBe('10');
      expect(byVariant.get(pieceVariantId)).toBe('2');
    });

    it('FARKLI bir payload yeniden toplama yapar', async () => {
      const session = await createAccount('merge.farkli');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({ items: [{ productVariantId: kgVariantId, quantity: '10' }] });

      const different = await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({ items: [{ productVariantId: kgVariantId, quantity: '5' }] });

      expect(different.body.data.cart.items[0].quantity).toBe('15');
    });

    it('sepet boşaltıldıktan sonra aynı payload YENİDEN taşınabilir', async () => {
      const session = await createAccount('merge.temizlik');
      const auth = bearer(session.accessToken);
      const payload = { items: [{ productVariantId: kgVariantId, quantity: '10' }] };

      await api().post('/api/v1/customer/cart/merge').set(auth).send(payload);
      await api().delete('/api/v1/customer/cart').set(auth);

      const again = await api().post('/api/v1/customer/cart/merge').set(auth).send(payload);

      expect(again.body.data.cart.items[0].quantity).toBe('10');
      expect(again.body.data.addedCount).toBe(1);
    });

    it('misafir sepetinde aynı varyasyon iki kez varsa toplanır', async () => {
      const session = await createAccount('merge.mukerrer');

      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(bearer(session.accessToken))
        .send({
          items: [
            { productVariantId: kgVariantId, quantity: '10' },
            { productVariantId: kgVariantId, quantity: '15' },
          ],
        });

      expect(merged.body.data.cart.items).toHaveLength(1);
      expect(merged.body.data.cart.items[0].quantity).toBe('25');
    });

    it('boş liste yalnız sunucu sepetini döner', async () => {
      const session = await createAccount('merge.bosliste');
      const auth = bearer(session.accessToken);

      await api()
        .post('/api/v1/customer/cart/items')
        .set(auth)
        .send({ productVariantId: kgVariantId, quantity: '5' });

      const merged = await api().post('/api/v1/customer/cart/merge').set(auth).send({ items: [] });

      expect(merged.status).toBe(HttpStatus.OK);
      expect(merged.body.data.cart.items).toHaveLength(1);
      expect(merged.body.data.addedCount).toBe(0);
    });
  });

  // =========================================================================
  describe('Talep bağlama', () => {
    const inquiryBody = (
      items: unknown[],
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> => ({
      contactName: `${PREFIX} Talep Sahibi`,
      contactPhone: '0532 444 55 66',
      city: 'Konya',
      district: 'Çumra',
      preferredContact: 'PHONE',
      consentAccepted: true,
      items,
      ...overrides,
    });

    it('GİRİŞLİ müşterinin talebi otomatik olarak hesabına bağlanır', async () => {
      const session = await createAccount('talep.girisli');

      const created = await api()
        .post('/api/v1/public/inquiries')
        .set(bearer(session.accessToken))
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }]));

      expect(created.status).toBe(HttpStatus.CREATED);

      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiryNumber: created.body.data.inquiryNumber },
        select: { customerAccountId: true },
      });

      expect(inquiry?.customerAccountId).toBe(session.accountId);

      // "Taleplerim" listesinde görünür.
      const mine = await api().get('/api/v1/customer/inquiries').set(bearer(session.accessToken));

      expect(mine.status).toBe(HttpStatus.OK);
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0].inquiryNumber).toBe(created.body.data.inquiryNumber);
      expect(mine.body.data[0].itemCount).toBe(1);
      expect(mine.body.meta.total).toBe(1);
    });

    it('MİSAFİR talebi hiçbir hesaba bağlanmaz (S6 akışı bozulmadı)', async () => {
      const created = await api()
        .post('/api/v1/public/inquiries')
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }]));

      expect(created.status).toBe(HttpStatus.CREATED);

      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiryNumber: created.body.data.inquiryNumber },
        select: { customerAccountId: true },
      });

      expect(inquiry?.customerAccountId).toBeNull();
    });

    it('GEÇERSİZ jetonla gelen talep misafir talebi olarak kaydedilir', async () => {
      const created = await api()
        .post('/api/v1/public/inquiries')
        .set(bearer('gecersiz.jeton.degeri'))
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }]));

      // Süresi dolmuş bir oturum yüzünden talebin kaybolması kabul edilemez.
      expect(created.status).toBe(HttpStatus.CREATED);

      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiryNumber: created.body.data.inquiryNumber },
        select: { customerAccountId: true },
      });

      expect(inquiry?.customerAccountId).toBeNull();
    });

    it('ADMIN jetonuyla gönderilen talep bir müşteri hesabına bağlanmaz', async () => {
      const created = await api()
        .post('/api/v1/public/inquiries')
        .set(admin())
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }]));

      expect(created.status).toBe(HttpStatus.CREATED);

      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiryNumber: created.body.data.inquiryNumber },
        select: { customerAccountId: true },
      });

      expect(inquiry?.customerAccountId).toBeNull();
    });

    it('DOĞRULANMIŞ e-postayla geçmiş MİSAFİR talepleri hesaba bağlanır', async () => {
      const email = freshEmail('talep.gecmis');

      // 1) Misafir olarak, AYNI e-postayla iki talep gönder.
      const first = await api()
        .post('/api/v1/public/inquiries')
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }], { contactEmail: email }));

      const second = await api()
        .post('/api/v1/public/inquiries')
        .send(inquiryBody([{ variantId: pieceVariantId, quantity: '2' }], { contactEmail: email }));

      // 2) Başka bir e-postayla bir talep daha: BAĞLANMAMALI.
      const other = await api()
        .post('/api/v1/public/inquiries')
        .send(
          inquiryBody([{ variantId: kgVariantId, quantity: '5' }], {
            contactEmail: freshEmail('talep.baska'),
          }),
        );

      // 3) Aynı adresle kayıt ol ve giriş yap.
      outbox.length = 0;
      await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      const login = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email, password: VALID_PASSWORD });

      const auth = bearer(login.body.data.accessToken);

      // DOĞRULAMADAN ÖNCE: geçmiş talepler görünmüyor.
      const beforeVerify = await api().get('/api/v1/customer/inquiries').set(auth);

      expect(beforeVerify.body.data).toHaveLength(0);

      // 4) E-postayı doğrula.
      const verified = await verifyEmailOf();

      expect(verified.status).toBe(HttpStatus.OK);
      expect(verified.body.data.linkedInquiryCount).toBe(2);
      expect(verified.body.data.account.isEmailVerified).toBe(true);

      const afterVerify = await api().get('/api/v1/customer/inquiries').set(auth);

      const numbers = afterVerify.body.data.map(
        (item: { inquiryNumber: string }) => item.inquiryNumber,
      );

      expect(numbers).toHaveLength(2);
      expect(numbers).toContain(first.body.data.inquiryNumber);
      expect(numbers).toContain(second.body.data.inquiryNumber);
      expect(numbers).not.toContain(other.body.data.inquiryNumber);
    });

    it('e-posta DOĞRULANMADIKÇA geçmiş talep bağlanmaz', async () => {
      const email = freshEmail('talep.dogrulanmamis');

      await api()
        .post('/api/v1/public/inquiries')
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }], { contactEmail: email }));

      await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      const login = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email, password: VALID_PASSWORD });

      const mine = await api()
        .get('/api/v1/customer/inquiries')
        .set(bearer(login.body.data.accessToken));

      // Doğrulama yoksa bağ yok: başkasının adresiyle kayıt olan biri onun
      // talep geçmişini okuyamaz.
      expect(mine.body.data).toHaveLength(0);

      const linked = await prisma.inquiry.count({
        where: { contactEmail: email, customerAccountId: { not: null } },
      });

      expect(linked).toBe(0);
    });

    it('TELEFON eşleşmesiyle otomatik bağlama YAPILMAZ', async () => {
      const email = freshEmail('talep.telefon');

      // Talep, hesapla AYNI telefonla ama e-postasız gönderiliyor.
      const guest = await api()
        .post('/api/v1/public/inquiries')
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }]));

      await api()
        .post('/api/v1/customer-auth/register')
        .send(registerBody(email, { phone: '0532 444 55 66' }));

      const login = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email, password: VALID_PASSWORD });

      await verifyEmailOf();

      const mine = await api()
        .get('/api/v1/customer/inquiries')
        .set(bearer(login.body.data.accessToken));

      // SMS doğrulaması olmadığı için numara kimlik kanıtı sayılmaz.
      expect(mine.body.data).toHaveLength(0);

      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiryNumber: guest.body.data.inquiryNumber },
        select: { customerAccountId: true },
      });

      expect(inquiry?.customerAccountId).toBeNull();
    });

    it('BAŞKASININ talep numarasına erişim 404 döner (403 DEĞİL)', async () => {
      const owner = await createAccount('talep.sahibi');
      const other = await createAccount('talep.yabanci');

      const created = await api()
        .post('/api/v1/public/inquiries')
        .set(bearer(owner.accessToken))
        .send(inquiryBody([{ variantId: kgVariantId, quantity: '10' }]));

      const number = created.body.data.inquiryNumber;

      const mine = await api()
        .get(`/api/v1/customer/inquiries/${number}`)
        .set(bearer(owner.accessToken));

      expect(mine.status).toBe(HttpStatus.OK);
      expect(mine.body.data.items).toHaveLength(1);
      // Kural 8: yönetici alanları müşteri yanıtında YOK.
      expect(mine.body.data.internalNote).toBeUndefined();
      expect(mine.body.data.ipAddress).toBeUndefined();
      expect(mine.body.data.userAgent).toBeUndefined();
      expect(mine.body.data.assignedTo).toBeUndefined();
      expect(mine.body.data.customer).toBeUndefined();

      const foreign = await api()
        .get(`/api/v1/customer/inquiries/${number}`)
        .set(bearer(other.accessToken));

      // 403 "bu numara var ama senin değil" derdi; numaralar sıralı olduğu
      // için bu, mağazanın talep hacmini sızdırırdı.
      expect(foreign.status).toBe(HttpStatus.NOT_FOUND);

      const missing = await api()
        .get('/api/v1/customer/inquiries/TLP-2026-999999')
        .set(bearer(other.accessToken));

      // Var olmayan numarayla AYNI yanıt.
      expect(missing.status).toBe(foreign.status);
      expect(missing.body.error.code).toBe(foreign.body.error.code);
    });
  });

  // =========================================================================
  describe('Şifre sıfırlama', () => {
    it('bilinmeyen adres için de AYNI genel yanıtı verir', async () => {
      const session = await createAccount('sifirla.genel');

      const known = await api()
        .post('/api/v1/customer-auth/forgot-password')
        .send({ email: session.email });

      const unknown = await api()
        .post('/api/v1/customer-auth/forgot-password')
        .send({ email: freshEmail('hicyok') });

      expect(known.status).toBe(unknown.status);
      expect(known.body.data).toEqual(unknown.body.data);
    });

    it('şifreyi sıfırlar, oturumları düşürür ve jetonu TÜKETİR', async () => {
      const session = await createAccount('sifirla.akis');

      outbox.length = 0;
      await api().post('/api/v1/customer-auth/forgot-password').send({ email: session.email });

      const token = tokenFromLastMail('/sifre-sifirla');
      const newPassword = 'YeniSifre2026';

      const reset = await api()
        .post('/api/v1/customer-auth/reset-password')
        .send({ token, password: newPassword });

      expect(reset.status).toBe(HttpStatus.OK);

      // Eski şifre artık çalışmaz.
      const oldLogin = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: session.email, password: VALID_PASSWORD });

      expect(oldLogin.status).toBe(HttpStatus.UNAUTHORIZED);

      // Yeni şifre çalışır.
      const newLogin = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: session.email, password: newPassword });

      expect(newLogin.status).toBe(HttpStatus.OK);

      // Sıfırlama öncesi alınmış yenileme jetonu DÜŞMÜŞ olmalı.
      const staleRefresh = await api()
        .post('/api/v1/customer-auth/refresh')
        .send({ refreshToken: session.refreshToken });

      expect(staleRefresh.status).toBe(HttpStatus.UNAUTHORIZED);

      // Jeton TEK KULLANIMLIK.
      const replay = await api()
        .post('/api/v1/customer-auth/reset-password')
        .send({ token, password: 'BaskaSifre2026' });

      expect(replay.status).toBe(HttpStatus.BAD_REQUEST);
      expect(replay.body.error.code).toBe('INVALID_TOKEN');
    });

    it('uydurma jeton INVALID_TOKEN ile reddedilir', async () => {
      const response = await api()
        .post('/api/v1/customer-auth/reset-password')
        .send({ token: 'uydurma-jeton-degeri', password: 'GecerliSifre123' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('sıfırlamada da şifre politikası uygulanır', async () => {
      const session = await createAccount('sifirla.politika');

      outbox.length = 0;
      await api().post('/api/v1/customer-auth/forgot-password').send({ email: session.email });

      const response = await api()
        .post('/api/v1/customer-auth/reset-password')
        .send({ token: tokenFromLastMail('/sifre-sifirla'), password: 'kisa' });

      expect(response.body.error.code).toBe('WEAK_PASSWORD');
    });
  });

  // =========================================================================
  describe('E-posta doğrulama jetonu', () => {
    it('aynı jeton ikinci kez kullanılamaz', async () => {
      const email = freshEmail('dogrula.tek');

      outbox.length = 0;
      await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      const token = tokenFromLastMail('/eposta-dogrula');

      const first = await api().post('/api/v1/customer-auth/verify-email').send({ token });

      expect(first.status).toBe(HttpStatus.OK);

      const second = await api().post('/api/v1/customer-auth/verify-email').send({ token });

      expect(second.status).toBe(HttpStatus.BAD_REQUEST);
      expect(second.body.error.code).toBe('INVALID_TOKEN');
    });

    it('süresi dolmuş jeton reddedilir', async () => {
      const email = freshEmail('dogrula.suresi');

      outbox.length = 0;
      await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      const token = tokenFromLastMail('/eposta-dogrula');

      // `createdAt` DE geriye alınır: `chk_email_verification_tokens_expiry_after_creation`
      // kısıtı "son kullanma > üretim zamanı" şartını veritabanı seviyesinde
      // zorluyor. Yalnız `expiresAt`i geçmişe çekmek kısıta takılır — kısıtın
      // çalıştığının kanıtı da bu. Jetonu gerçekten YAŞLANDIRMAK gerekir.
      await prisma.emailVerificationToken.updateMany({
        where: { customerAccount: { email } },
        data: {
          createdAt: new Date(Date.now() - 48 * 3_600_000),
          expiresAt: new Date(Date.now() - 24 * 3_600_000),
        },
      });

      const response = await api().post('/api/v1/customer-auth/verify-email').send({ token });

      expect(response.body.error.code).toBe('INVALID_TOKEN');
    });

    it('veritabanında yalnız HASH saklanır, ham jeton saklanmaz', async () => {
      const email = freshEmail('dogrula.hash');

      outbox.length = 0;
      await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      const token = tokenFromLastMail('/eposta-dogrula');

      const stored = await prisma.emailVerificationToken.findFirst({
        where: { customerAccount: { email } },
        select: { tokenHash: true },
      });

      expect(stored?.tokenHash).not.toBe(token);
      expect(stored?.tokenHash).toHaveLength(64);
    });
  });

  // =========================================================================
  describe('Profil', () => {
    it('ad, soyad ve telefonu anında güncellerken telefonu normalleştirir', async () => {
      const session = await createAccount('profil.temel');

      const response = await api()
        .patch('/api/v1/customer/profile')
        .set(bearer(session.accessToken))
        .send({ firstName: 'Mehmet', lastName: 'Demir', phone: '+90 533 987 65 43' });

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.account.firstName).toBe('Mehmet');
      expect(response.body.data.account.fullName).toBe('Mehmet Demir');
      expect(response.body.data.account.phone).toBe('5339876543');
      expect(response.body.data.pendingEmail).toBeNull();
    });

    it('e-posta değişikliği YENİDEN DOĞRULAMA gerektirir', async () => {
      const session = await createAccount('profil.eposta');
      const auth = bearer(session.accessToken);
      const newEmail = freshEmail('profil.yeni');

      outbox.length = 0;

      const patch = await api()
        .patch('/api/v1/customer/profile')
        .set(auth)
        .send({ email: newEmail });

      expect(patch.status).toBe(HttpStatus.OK);
      expect(patch.body.data.pendingEmail).toBe(newEmail);
      // ADRES HENÜZ DEĞİŞMEDİ: yanlış yazılmış bir adres hesabı erişilemez
      // yapmasın.
      expect(patch.body.data.account.email).toBe(session.email);

      // Eski adresle giriş hâlâ çalışır.
      const oldLogin = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: session.email, password: VALID_PASSWORD });

      expect(oldLogin.status).toBe(HttpStatus.OK);

      // Doğrulama bağlantısı YENİ adrese gitmiş olmalı.
      const mail = outbox.find((message) => message.to === newEmail);

      expect(mail).toBeDefined();

      const verified = await verifyEmailOf();

      expect(verified.status).toBe(HttpStatus.OK);
      expect(verified.body.data.account.email).toBe(newEmail);

      // Artık yeni adresle giriş yapılır.
      const newLogin = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: newEmail, password: VALID_PASSWORD });

      expect(newLogin.status).toBe(HttpStatus.OK);
    });

    it('başka hesapta kullanılan adrese geçilemez', async () => {
      const taken = await createAccount('profil.dolu');
      const session = await createAccount('profil.catisma');

      const response = await api()
        .patch('/api/v1/customer/profile')
        .set(bearer(session.accessToken))
        .send({ email: taken.email });

      expect(response.status).toBe(HttpStatus.CONFLICT);
      expect(response.body.error.details[0].field).toBe('email');
    });
  });

  // =========================================================================
  describe('Yönetim — hesap ↔ müşteri kartı bağlama', () => {
    it('hesabı karta bağlar, bağı kaldırır ve geçmişi korur', async () => {
      const session = await createAccount('admin.baglama');

      const customer = await api()
        .post('/api/v1/admin/customers')
        .set(admin())
        .send({
          type: 'INDIVIDUAL',
          fullName: `${PREFIX} Kart Sahibi`,
          phone: '0532 777 88 99',
        });

      expect(customer.status).toBe(HttpStatus.CREATED);

      const customerId = customer.body.data.id;

      const linked = await api()
        .post(`/api/v1/admin/customer-accounts/${session.accountId}/link`)
        .set(admin())
        .send({ customerId });

      expect(linked.status).toBe(HttpStatus.CREATED);
      expect(linked.body.data.customer.id).toBe(customerId);

      // Müşteri kartı detayında hesap görünür.
      const detail = await api().get(`/api/v1/admin/customers/${customerId}`).set(admin());

      expect(detail.body.data.account.id).toBe(session.accountId);
      expect(detail.body.data.account.email).toBe(session.email);
      // Kural 8: hassas alan yönetim yanıtında da yok.
      expect(detail.body.data.account.passwordHash).toBeUndefined();

      // Müşteri profili yalnız BOOLEAN görür; kart kodu/borç sızmaz.
      const profile = await api().get('/api/v1/customer/profile').set(bearer(session.accessToken));

      expect(profile.body.data.hasLinkedCustomer).toBe(true);
      expect(profile.body.data.customerId).toBeUndefined();
      expect(profile.body.data.customer).toBeUndefined();

      // Bağ kaldırılır.
      const unlinked = await api()
        .post(`/api/v1/admin/customer-accounts/${session.accountId}/link`)
        .set(admin())
        .send({ customerId: null });

      expect(unlinked.body.data.customer).toBeNull();

      // Kart ve geçmişi yerinde.
      const stillThere = await prisma.customer.findUnique({ where: { id: customerId } });

      expect(stillThere).not.toBeNull();
    });

    it('bir kart İKİNCİ bir hesaba bağlanamaz', async () => {
      const first = await createAccount('admin.catisma1');
      const second = await createAccount('admin.catisma2');

      const customer = await api()
        .post('/api/v1/admin/customers')
        .set(admin())
        .send({
          type: 'INDIVIDUAL',
          fullName: `${PREFIX} Tek Kart`,
          phone: '0532 222 33 44',
        });

      const customerId = customer.body.data.id;

      await api()
        .post(`/api/v1/admin/customer-accounts/${first.accountId}/link`)
        .set(admin())
        .send({ customerId });

      const conflict = await api()
        .post(`/api/v1/admin/customer-accounts/${second.accountId}/link`)
        .set(admin())
        .send({ customerId });

      expect(conflict.status).toBe(HttpStatus.CONFLICT);
      expect(conflict.body.error.code).toBe('ACCOUNT_LINK_CONFLICT');
    });

    it('bağsız hesaplar filtrelenebilir ve telefonla aranabilir', async () => {
      const session = await createAccount('admin.arama');

      // ARAMA HESABIN KENDİ E-POSTASIYLA yapılır: bu paket onlarca hesabı AYNI
      // telefonla oluşturuyor ve yalnız telefonla arandığında sonuç varsayılan
      // sayfa boyutunu (20) aşabilir — aranan hesap ikinci sayfaya düşer ve
      // test, ürün hatası olmadan kırılır.
      const byEmail = await api()
        .get('/api/v1/admin/customer-accounts')
        .query({ linked: 'false', search: session.email })
        .set(admin());

      expect(byEmail.status).toBe(HttpStatus.OK);
      expect(byEmail.body.data.map((item: { id: string }) => item.id)).toContain(session.accountId);

      // TELEFON NORMALLEŞTİRMESİ ayrıca sınanır: yönetici numarayı boşluklu
      // yazar, veritabanında 10 haneli biçim durur.
      const byPhone = await api()
        .get('/api/v1/admin/customer-accounts')
        .query({ search: '0532 111 22 33', limit: 100 })
        .set(admin());

      expect(byPhone.status).toBe(HttpStatus.OK);
      expect(byPhone.body.meta.total).toBeGreaterThan(0);

      for (const account of byPhone.body.data) {
        expect(account.phone).toBe('5321112233');
      }
    });

    it('talep detayında hesap bağlantısı görünür ve elle bağlanabilir', async () => {
      const session = await createAccount('admin.talepbag');

      // Misafir talebi: hesaba bağlı değil.
      const created = await api()
        .post('/api/v1/public/inquiries')
        .send({
          contactName: `${PREFIX} Elle Baglanan`,
          contactPhone: '0532 999 00 11',
          city: 'Konya',
          district: 'Çumra',
          preferredContact: 'PHONE',
          consentAccepted: true,
          items: [{ variantId: kgVariantId, quantity: '10' }],
        });

      const inquiry = await prisma.inquiry.findUnique({
        where: { inquiryNumber: created.body.data.inquiryNumber },
        select: { id: true },
      });

      const inquiryId = (inquiry as { id: string }).id;

      const before = await api().get(`/api/v1/admin/inquiries/${inquiryId}`).set(admin());

      expect(before.body.data.customerAccount).toBeNull();

      const linked = await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(admin())
        .send({ customerAccountId: session.accountId });

      expect(linked.status).toBe(HttpStatus.OK);
      expect(linked.body.data.customerAccount.id).toBe(session.accountId);

      // Müşteri artık kendi listesinde görüyor.
      const mine = await api().get('/api/v1/customer/inquiries').set(bearer(session.accessToken));

      const numbers = mine.body.data.map((item: { inquiryNumber: string }) => item.inquiryNumber);

      expect(numbers).toContain(created.body.data.inquiryNumber);

      // Bağ kaldırılabilir.
      const unlinked = await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(admin())
        .send({ customerAccountId: null });

      expect(unlinked.body.data.customerAccount).toBeNull();
    });

    it('hesap bağlama işlemi denetim kaydına yazılır', async () => {
      const session = await createAccount('admin.audit');

      await api()
        .post(`/api/v1/admin/customer-accounts/${session.accountId}/link`)
        .set(admin())
        .send({ customerId: null });

      const log = await prisma.auditLog.findFirst({
        where: { action: 'ACCOUNT_LINKED', entityId: session.accountId },
      });

      expect(log).not.toBeNull();
    });

    it('kayıt ve giriş denetim kaydına yazılır', async () => {
      const session = await createAccount('admin.auditkayit');

      const created = await prisma.auditLog.findFirst({
        where: { action: 'CREATE', entityType: 'CustomerAccount', entityId: session.accountId },
      });

      const loggedIn = await prisma.auditLog.findFirst({
        where: { action: 'LOGIN', entityType: 'CustomerAccount', entityId: session.accountId },
      });

      expect(created).not.toBeNull();
      expect(loggedIn).not.toBeNull();
      // Şifre denetim kaydına ASLA sızmaz.
      expect(JSON.stringify(created?.newData)).not.toContain(VALID_PASSWORD);
    });

    it('e-posta doğrulaması EMAIL_VERIFIED olarak kaydedilir', async () => {
      const email = freshEmail('admin.auditdogrula');

      outbox.length = 0;
      await api().post('/api/v1/customer-auth/register').send(registerBody(email));
      await verifyEmailOf();

      const account = await prisma.customerAccount.findFirst({ where: { email } });

      const log = await prisma.auditLog.findFirst({
        where: { action: 'EMAIL_VERIFIED', entityId: (account as { id: string }).id },
      });

      expect(log).not.toBeNull();
    });
  });

  // =========================================================================
  describe('UÇTAN UCA: misafir sepeti -> kayıt -> doğrulama -> talep', () => {
    it('misafir sepeti kayıpsız taşınır ve talep Taleplerim de görünür', async () => {
      const email = freshEmail('e2e.tamakis');

      // 1) MİSAFİRKEN gönderilmiş bir talep (geçmiş).
      const pastGuest = await api()
        .post('/api/v1/public/inquiries')
        .send({
          contactName: `${PREFIX} Tam Akis`,
          contactPhone: '0532 333 44 55',
          contactEmail: email,
          city: 'Konya',
          district: 'Çumra',
          preferredContact: 'PHONE',
          consentAccepted: true,
          items: [{ variantId: pieceVariantId, quantity: '1' }],
        });

      expect(pastGuest.status).toBe(HttpStatus.CREATED);

      // 2) Misafir sepetine ürün ekle (localStorage'ı temsil eder).
      const guestCart = [
        { productVariantId: kgVariantId, quantity: '10' },
        { productVariantId: pieceVariantId, quantity: '2' },
        // Yayından kalkmış bir ürün: atlanmalı ama akışı düşürmemeli.
        { productVariantId: inactiveVariantId, quantity: '1' },
      ];

      // 3) Kayıt ol ve giriş yap.
      outbox.length = 0;
      await api().post('/api/v1/customer-auth/register').send(registerBody(email));

      const login = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email, password: VALID_PASSWORD });

      const auth = bearer(login.body.data.accessToken);

      // 4) Sepeti taşı.
      const merged = await api()
        .post('/api/v1/customer/cart/merge')
        .set(auth)
        .send({ items: guestCart });

      expect(merged.status).toBe(HttpStatus.OK);
      expect(merged.body.data.cart.items).toHaveLength(2);
      expect(merged.body.data.skippedItems).toHaveLength(1);
      expect(merged.body.data.skippedItems[0].reason).toBe('VARIANT_UNAVAILABLE');

      // 5) E-postayı doğrula: geçmiş misafir talebi hesaba taşınır.
      const verified = await verifyEmailOf();

      expect(verified.body.data.linkedInquiryCount).toBe(1);

      // 6) Sunucu sepetinden talep gönder.
      const cart = await api().get('/api/v1/customer/cart').set(auth);

      const items = cart.body.data.items.map(
        (item: { productVariantId: string; quantity: string }) => ({
          variantId: item.productVariantId,
          quantity: item.quantity,
        }),
      );

      const created = await api()
        .post('/api/v1/public/inquiries')
        .set(auth)
        .send({
          contactName: `${PREFIX} Tam Akis`,
          contactPhone: '0532 333 44 55',
          contactEmail: email,
          city: 'Konya',
          district: 'Çumra',
          preferredContact: 'PHONE',
          consentAccepted: true,
          items,
        });

      expect(created.status).toBe(HttpStatus.CREATED);
      expect(created.body.data._count.items).toBe(2);

      // 7) Taleplerim: geçmiş misafir talebi + yeni talep.
      const mine = await api().get('/api/v1/customer/inquiries').set(auth);

      const numbers = mine.body.data.map((item: { inquiryNumber: string }) => item.inquiryNumber);

      expect(numbers).toHaveLength(2);
      expect(numbers).toContain(pastGuest.body.data.inquiryNumber);
      expect(numbers).toContain(created.body.data.inquiryNumber);

      // 8) Detay okunabilir.
      const detail = await api()
        .get(`/api/v1/customer/inquiries/${created.body.data.inquiryNumber}`)
        .set(auth);

      expect(detail.status).toBe(HttpStatus.OK);
      expect(detail.body.data.items).toHaveLength(2);
      expect(detail.body.data.status).toBe('NEW');
    });
  });
});
