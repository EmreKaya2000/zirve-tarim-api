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
 * HASSAS ALAN SIZINTI TARAMASI — Sprint 12, güvenlik denetimi.
 *
 * NEDEN BU TEST VAR:
 *
 * Kural 8 "alış fiyatı, maliyet ve kâr public tarafa ASLA sızmaz" diyor ve bu
 * kural bugün AÇIK `select` tanımlarıyla korunuyor. Ama koruma her seçicinin
 * doğru yazılmış olmasına bağlı: birisi bir gün `select` yerine `include`
 * yazdığında, ya da yeni bir hassas kolon eklendiğinde, hiçbir test kırılmaz
 * ve sızıntı sessizce yayına çıkar.
 *
 * Bu paket o boşluğu kapatır: public ve müşteri uçlarının TAMAMINI gezip
 * yanıt ağacının HER DÜĞÜMÜNDE yasaklı anahtar arar. Yeni bir uç eklendiğinde
 * buraya da eklenmesi gerekir — liste bilinçli olarak ELLE tutulur, çünkü
 * otomatik rota keşfi hangi uçların gerçekten public olduğunu bilemez ve
 * yanlış bir varsayım testi sessizce boşa düşürürdü.
 *
 * TARAMA DEĞERE DEĞİL ANAHTARA BAKAR: bir alanın değeri tesadüfen doğru
 * görünebilir, ama anahtarın kendisi yanıtta hiç bulunmamalıdır.
 */
describe('Hassas alan sızıntısı (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const PREFIX = 'E2ESizinti';
  const DOMAIN = 'e2e-sizinti.test';
  const SUPER = { email: `leak.super@${DOMAIN}`, password: 'LeakSuperSifre123' };
  const CUSTOMER_PASSWORD = 'Sizinti2026test';

  const outbox: MailMessage[] = [];
  const fakeMail = {
    send: async (message: MailMessage): Promise<boolean> => {
      outbox.push(message);

      return true;
    },
  };

  let adminToken = '';
  let customerToken = '';
  let productSlug = '';
  let categorySlug = '';
  let brandSlug = '';
  let plantSlug = '';
  let variantId = '';
  let inquiryNumber = '';

  jest.setTimeout(240_000);

  /**
   * PUBLIC YANITTA BULUNMASI YASAK anahtarlar.
   *
   * Her biri neden yasak:
   *   purchasePrice / unitPurchasePrice / unitCost / averageCost
   *     → alış fiyatı. Rakip kâr marjını hesaplar, müşteri pazarlık zemini
   *       kazanır (Kural 8).
   *   costTotal / lineCost / additionalCostTotal
   *     → maliyet toplamları.
   *   grossProfit / netProfit / lineProfit
   *     → kâr. Mağazanın en hassas ticari verisi.
   *   creditLimit / openingBalance
   *     → müşterinin kredi limiti ve devir bakiyesi.
   *   internalNote
   *     → yalnız personelin gördüğü not.
   *   passwordHash
   *     → kimlik. Sızması hesap devralmaya götürür.
   *   consentIpAddress / ipAddress / userAgent
   *     → talep sahibinin IP'si ve tarayıcı parmak izi (KVKK).
   *   failedLoginCount / lockedUntil
   *     → kaba kuvvet sayacı; saldırgana geri bildirim olur.
   *   tokenHash / replacedByTokenHash / refreshToken alanları
   *     → jeton izleri.
   */
  const FORBIDDEN_KEYS = [
    'purchasePrice',
    'unitPurchasePrice',
    'unitCost',
    'averageCost',
    'costTotal',
    'lineCost',
    'additionalCostTotal',
    'grossProfit',
    'netProfit',
    'lineProfit',
    'creditLimit',
    'openingBalance',
    'internalNote',
    'passwordHash',
    'consentIpAddress',
    'ipAddress',
    'userAgent',
    'failedLoginCount',
    'lockedUntil',
    'tokenHash',
    'replacedByTokenHash',
  ] as const;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
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
        fullName: 'E2E Sızıntı Yöneticisi',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    const login = await api().post('/api/v1/auth/login').send(SUPER);
    adminToken = login.body.data.accessToken;

    await seedFixtures();
    await createCustomerSession();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const customer = () => ({ Authorization: `Bearer ${customerToken}` });

  async function seedFixtures(): Promise<void> {
    const [kg, category, brand, plant] = await Promise.all([
      prisma.unitType.findFirst({ where: { code: 'kg' } }),
      prisma.category.findFirst({ where: { deletedAt: null } }),
      prisma.brand.findFirst({ where: { deletedAt: null } }),
      prisma.plant.findFirst({ where: { deletedAt: null } }),
    ]);

    expect(kg).not.toBeNull();
    expect(category).not.toBeNull();

    categorySlug = (category as { slug: string }).slug;
    brandSlug = (brand as { slug: string } | null)?.slug ?? '';
    plantSlug = (plant as { slug: string } | null)?.slug ?? '';

    // Alış fiyatı ve satış fiyatı FARKLI: sızıntı olsa değerinden de
    // anlaşılabilsin.
    const product = await prisma.product.create({
      data: {
        name: `${PREFIX} Gübre`,
        slug: `e2e-sizinti-gubre-${Date.now()}`,
        isActive: true,
        isPublished: true,
        showPrice: true,
        // Yalnız yöneticinin görmesi gereken not.
        description: 'Sızıntı taraması için ürün.',
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX}-KG-1`,
            unitTypeId: (kg as { id: string }).id,
            unitQuantity: '5',
            purchasePrice: '111.1111',
            salePrice: '999.9999',
            minOrderQuantity: '5',
            quantityStep: '5',
            maxOrderQuantity: '100',
            stockQuantity: '500',
            isActive: true,
            isDefault: true,
          },
        },
      },
      select: { slug: true, variants: { select: { id: true } } },
    });

    productSlug = product.slug;
    variantId = (product.variants[0] as { id: string }).id;
  }

  /** Müşteri hesabı + doğrulanmış e-posta + sepet + talep hazırlar. */
  async function createCustomerSession(): Promise<void> {
    const email = `leak.customer@${DOMAIN}`;

    outbox.length = 0;

    await api().post('/api/v1/customer-auth/register').send({
      firstName: 'Sızıntı',
      lastName: 'Testi',
      email,
      phone: '0532 555 66 77',
      password: CUSTOMER_PASSWORD,
      consentAccepted: true,
    });

    const login = await api()
      .post('/api/v1/customer-auth/login')
      .send({ email, password: CUSTOMER_PASSWORD });

    customerToken = login.body.data.accessToken;

    // Sepete kalem ekle: sepet yanıtı da taranacak.
    await api()
      .post('/api/v1/customer/cart/items')
      .set(customer())
      .send({ productVariantId: variantId, quantity: '10' });

    // Girişli talep gönder: "Taleplerim" yanıtları da taranacak.
    const inquiry = await api()
      .post('/api/v1/public/inquiries')
      .set(customer())
      .send({
        contactName: `${PREFIX} Talep`,
        contactPhone: '0532 555 66 77',
        contactEmail: email,
        city: 'Konya',
        district: 'Çumra',
        preferredContact: 'PHONE',
        consentAccepted: true,
        items: [{ variantId, quantity: '10' }],
      });

    inquiryNumber = inquiry.body.data.inquiryNumber;

    // Yönetici talebe İÇ NOT ekler: müşteri yanıtında görünmemeli.
    const found = await prisma.inquiry.findUnique({
      where: { inquiryNumber },
      select: { id: true },
    });

    await api()
      .patch(`/api/v1/admin/inquiries/${(found as { id: string }).id}/status`)
      .set({ Authorization: `Bearer ${adminToken}` })
      .send({ status: 'REVIEWING', internalNote: 'GIZLI-PERSONEL-NOTU' });
  }

  async function cleanup(): Promise<void> {
    await prisma.inquiry.deleteMany({ where: { contactName: { startsWith: PREFIX } } });
    await prisma.inquiry.deleteMany({ where: { contactEmail: { endsWith: DOMAIN } } });
    await prisma.customerAccount.deleteMany({ where: { email: { endsWith: DOMAIN } } });

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

  /**
   * Yanıt ağacında yasaklı anahtar arar.
   *
   * ÖZYİNELEMELİ: sızıntı en çok iç içe geçmiş ilişkilerde olur
   * (`product.variants[0].purchasePrice`). Yalnız üst düzey anahtarlara
   * bakan bir kontrol, korumak istediği asıl durumu kaçırırdı.
   *
   * @returns Bulunan ihlallerin yolları; temizse boş dizi.
   */
  function findForbiddenKeys(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
    }

    if (value === null || typeof value !== 'object') {
      return [];
    }

    const violations: string[] = [];

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) {
        violations.push(`${path}.${key}`);
      }

      violations.push(...findForbiddenKeys(child, `${path}.${key}`));
    }

    return violations;
  }

  /**
   * Bir yanıtı tarar ve ihlal varsa YOLUNU göstererek kırar.
   *
   * Uç adı karşılaştırılan nesneye KONULUR: Jest'in diff çıktısı hem hangi
   * ucun kırıldığını hem hangi alanın sızdığını gösterir. Yalnız
   * `expect(violations).toEqual([])` yazılsaydı, on beş ucu gezen bir döngüde
   * hangisinin patladığı belirsiz kalırdı.
   */
  function expectNoLeak(label: string, body: unknown): void {
    const violations = findForbiddenKeys(body);

    expect({ endpoint: label, violations }).toEqual({ endpoint: label, violations: [] });
  }

  /** Durum kodunu, hangi ucun kırıldığı görünecek biçimde doğrular. */
  function expectStatus(label: string, actual: number, expected: number): void {
    expect({ endpoint: label, status: actual }).toEqual({ endpoint: label, status: expected });
  }

  // =========================================================================
  describe('PUBLIC katalog uçları', () => {
    const publicEndpoints = (): { label: string; path: string }[] => [
      { label: 'ürün listesi', path: '/api/v1/public/products?limit=50' },
      // Fiyata göre sıralama AYRICA taranır: bu yol `minSalePrice` türetilmiş
      // alanını kullanıyor ve fiyatla ilgili bir kod yolunun hassas alan
      // sızdırması en olası yerdir.
      { label: 'ürün listesi (fiyat artan)', path: '/api/v1/public/products?sort=price-asc' },
      { label: 'ürün listesi (fiyat azalan)', path: '/api/v1/public/products?sort=price-desc' },
      { label: 'ürün listesi (öne çıkanlar)', path: '/api/v1/public/products?sort=featured' },
      { label: 'ürün listesi (stokta)', path: '/api/v1/public/products?inStock=true' },
      { label: 'ürün listesi (arama)', path: '/api/v1/public/products?search=gubre' },
      {
        label: 'ürün listesi (kategori)',
        path: `/api/v1/public/products?category=${categorySlug}`,
      },
      {
        label: 'ürün listesi (fiyat aralığı)',
        path: '/api/v1/public/products?minPrice=1&maxPrice=99999',
      },
      { label: 'ürün detayı', path: `/api/v1/public/products/${productSlug}` },
      { label: 'ilgili ürünler', path: `/api/v1/public/products/${productSlug}/related` },
      { label: 'kategori ağacı', path: '/api/v1/public/categories/tree' },
      { label: 'kategori detayı', path: `/api/v1/public/categories/${categorySlug}` },
      { label: 'marka listesi', path: '/api/v1/public/brands' },
      { label: 'bitki listesi', path: '/api/v1/public/plants' },
      { label: 'toprak türleri', path: '/api/v1/public/soil-types' },
      { label: 'yararlar', path: '/api/v1/public/benefits' },
      { label: 'yan etkiler', path: '/api/v1/public/side-effects' },
      { label: 'kullanım dönemleri', path: '/api/v1/public/usage-periods' },
      { label: 'ölçü birimleri', path: '/api/v1/public/unit-types' },
      { label: 'ayarlar', path: '/api/v1/public/settings' },
      { label: 'taksonomi', path: '/api/v1/public/taxonomy' },
    ];

    it('hiçbir public GET ucu hassas alan döndürmez', async () => {
      for (const endpoint of publicEndpoints()) {
        const response = await api().get(endpoint.path);

        expectStatus(`${endpoint.label} (${endpoint.path})`, response.status, 200);
        expectNoLeak(endpoint.label, response.body);
      }
    });

    it('marka ve bitki detayı hassas alan döndürmez', async () => {
      if (brandSlug !== '') {
        const brand = await api().get(`/api/v1/public/brands/${brandSlug}`);

        expectNoLeak('marka detayı', brand.body);
      }

      if (plantSlug !== '') {
        const plant = await api().get(`/api/v1/public/plants/${plantSlug}`);

        expectNoLeak('bitki detayı', plant.body);
      }
    });

    it('ürün detayı satış fiyatını verir ama ALIŞ fiyatını vermez', async () => {
      const response = await api().get(`/api/v1/public/products/${productSlug}`);
      const raw = JSON.stringify(response.body);

      // Pozitif kontrol: yanıt gerçekten fiyat taşıyor, boş değil.
      expect(raw).toContain('999.9999');
      // Negatif kontrol: alış fiyatı DEĞERİ hiçbir yerde yok.
      expect(raw).not.toContain('111.1111');
    });

    it('sepet doğrulama ve talep oluşturma yanıtları temiz', async () => {
      const validate = await api()
        .post('/api/v1/public/cart/validate')
        .send({ items: [{ variantId, quantity: '10' }] });

      expect(validate.status).toBe(200);
      expectNoLeak('sepet doğrulama', validate.body);
    });
  });

  // =========================================================================
  describe('MÜŞTERİ uçları', () => {
    it('profil, sepet ve taleplerim yanıtları hassas alan döndürmez', async () => {
      const endpoints = [
        { label: 'müşteri profili (me)', path: '/api/v1/customer-auth/me' },
        { label: 'müşteri profili', path: '/api/v1/customer/profile' },
        { label: 'müşteri sepeti', path: '/api/v1/customer/cart' },
        { label: 'taleplerim', path: '/api/v1/customer/inquiries' },
        { label: 'talep detayım', path: `/api/v1/customer/inquiries/${inquiryNumber}` },
      ];

      for (const endpoint of endpoints) {
        const response = await api().get(endpoint.path).set(customer());

        expectStatus(endpoint.label, response.status, 200);
        expectNoLeak(endpoint.label, response.body);
      }
    });

    it('müşteri talep detayı YÖNETİCİ İÇ NOTUNU içermez', async () => {
      const response = await api()
        .get(`/api/v1/customer/inquiries/${inquiryNumber}`)
        .set(customer());

      expect(response.status).toBe(200);
      // Anahtar taraması `internalNote`u yakalar; bu kontrol NOTUN METNİNİ
      // arar — alan adı değişse bile içerik sızmışsa yakalanır.
      expect(JSON.stringify(response.body)).not.toContain('GIZLI-PERSONEL-NOTU');
    });

    it('müşteri sepeti alış fiyatı DEĞERİNİ içermez', async () => {
      const response = await api().get('/api/v1/customer/cart').set(customer());
      const raw = JSON.stringify(response.body);

      expect(raw).toContain('999.9999');
      expect(raw).not.toContain('111.1111');
    });

    it('giriş ve kayıt yanıtları jeton izleri döndürmez', async () => {
      const login = await api()
        .post('/api/v1/customer-auth/login')
        .send({ email: `leak.customer@${DOMAIN}`, password: CUSTOMER_PASSWORD });

      expect(login.status).toBe(200);
      // `refreshToken` yanıtta OLMALI (istemci onu saklar); yasaklı olan
      // veritabanı izleri: tokenHash, replacedByTokenHash.
      expect(login.body.data.refreshToken).toBeDefined();
      expectNoLeak('müşteri girişi', login.body);
    });
  });

  // =========================================================================
  describe('Hata yanıtları', () => {
    it('404 ve doğrulama hataları yığın izi veya SQL sızdırmaz', async () => {
      const notFound = await api().get('/api/v1/public/products/hic-boyle-urun-yok');

      expect(notFound.status).toBe(404);

      const raw = JSON.stringify(notFound.body).toLowerCase();

      // Yığın izi, dosya yolu ve SQL parçası istemciye gitmemeli.
      expect(raw).not.toContain('at object');
      expect(raw).not.toContain('/users/');
      expect(raw).not.toContain('prisma.');
      expect(raw).not.toContain('select ');
      expect(notFound.body.error.stack).toBeUndefined();
    });

    it('geçersiz gövde alan bazlı hata verir, iç yapı sızdırmaz', async () => {
      const response = await api()
        .post('/api/v1/public/cart/validate')
        .send({ items: [{ variantId: 'uuid-degil', quantity: 'abc' }] });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain('/Users/');
    });
  });

  // =========================================================================
  describe('Tarama mekanizmasının kendisi', () => {
    it('yasaklı anahtarı GERÇEKTEN yakalar (negatif kontrol)', () => {
      // Bu test, taramanın çalıştığının kanıtıdır. Olmasa, `FORBIDDEN_KEYS`
      // listesi yanlış yazılmış olsa bile tüm testler yeşil görünürdü.
      const leaky = {
        data: [{ name: 'ürün', variants: [{ sku: 'X', purchasePrice: '100' }] }],
      };

      expect(findForbiddenKeys(leaky)).toEqual(['$.data[0].variants[0].purchasePrice']);
    });

    it('temiz gövdede ihlal bulmaz', () => {
      const clean = { data: [{ name: 'ürün', variants: [{ sku: 'X', salePrice: '100' }] }] };

      expect(findForbiddenKeys(clean)).toEqual([]);
    });
  });
});
