import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { deleteProductsWithStockHistory } from './test-cleanup';

/**
 * Talep modülü uçtan uca testleri (Sprint 6).
 *
 * En kritik testler:
 *   - miktar/adım/ondalık ihlalinde ALAN BAZLI hata (SPEC §15)
 *   - pasif varyasyon ve yayından kalkmış ürün reddi
 *   - consentAccepted=false reddi (KVKK)
 *   - EŞZAMANLI isteklerde talep numarası tekilliği
 *   - geçersiz durum geçişi reddi ve durum geçmişi kaydı
 */
describe('Talepler (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const SUPER = { email: 'inq.super@zirvetarim.test', password: 'InqSuperSifre123' };
  const PREFIX = 'E2ETalep';

  let token = '';
  let kgVariantId = '';
  let pieceVariantId = '';
  let inactiveVariantId = '';
  let unpublishedVariantId = '';
  let kgRules = { min: '0', step: '0' };

  jest.setTimeout(180_000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
        fullName: 'E2E Talep Yöneticisi',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    const login = await api().post('/api/v1/auth/login').send(SUPER);
    token = login.body.data.accessToken;

    await seedFixtures();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  /**
   * Rate limit atlatma.
   *
   * `POST /public/inquiries` saatte 5 istekle sınırlı. Testler bundan
   * fazlasını gönderiyor; her istek AYRI bir istemci IP'siyle gider.
   * Sınırın kendisi ayrı bir testte doğrulanır.
   */
  let ipCounter = 0;
  const freshIp = (): string => {
    ipCounter += 1;

    return `172.16.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
  };

  const postInquiry = (body: Record<string, unknown>) =>
    api().post('/api/v1/public/inquiries').set('X-Forwarded-For', freshIp()).send(body);

  const validateCart = (items: unknown[]) =>
    api().post('/api/v1/public/cart/validate').set('X-Forwarded-For', freshIp()).send({ items });

  /** Geçerli bir talep gövdesi kurar. */
  const inquiryBody = (
    items: unknown[],
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    contactName: `${PREFIX} Müşteri`,
    contactPhone: '0532 111 22 33',
    city: 'Konya',
    district: 'Çumra',
    preferredContact: 'PHONE',
    consentAccepted: true,
    items,
    ...overrides,
  });

  async function seedFixtures(): Promise<void> {
    const [kg, piece] = await Promise.all([
      prisma.unitType.findFirst({ where: { code: 'kg' } }),
      prisma.unitType.findFirst({ where: { code: 'ad' } }),
    ]);
    const category = await prisma.category.findFirst({ where: { deletedAt: null } });

    expect(kg).not.toBeNull();
    expect(piece).not.toBeNull();
    expect(category).not.toBeNull();

    // Yayında, kg birimli, 50 kg adımlı ürün.
    const published = await prisma.product.create({
      data: {
        name: `${PREFIX} Gübre`,
        slug: `e2e-talep-gubre-${Date.now()}`,
        isActive: true,
        isPublished: true,
        showPrice: true,
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX}-KG-1`,
            unitTypeId: (kg as { id: string }).id,
            unitQuantity: '50',
            purchasePrice: '400',
            salePrice: '600',
            minOrderQuantity: '50',
            quantityStep: '50',
            maxOrderQuantity: '500',
            stockQuantity: '1000',
            isActive: true,
            isDefault: true,
          },
        },
      },
      select: {
        id: true,
        variants: { select: { id: true, minOrderQuantity: true, quantityStep: true } },
      },
    });

    const kgVariant = published.variants[0] as {
      id: string;
      minOrderQuantity: unknown;
      quantityStep: unknown;
    };
    kgVariantId = kgVariant.id;
    kgRules = { min: String(kgVariant.minOrderQuantity), step: String(kgVariant.quantityStep) };

    // Ondalık kabul etmeyen birim (adet).
    const pieceProduct = await prisma.product.create({
      data: {
        name: `${PREFIX} Adet Ürün`,
        slug: `e2e-talep-adet-${Date.now()}`,
        isActive: true,
        isPublished: true,
        showPrice: false,
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
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
        slug: `e2e-talep-pasif-var-${Date.now()}`,
        isActive: true,
        isPublished: true,
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
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
        slug: `e2e-talep-yayinda-degil-${Date.now()}`,
        isActive: true,
        isPublished: false,
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
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
    const inquiries = await prisma.inquiry.findMany({
      where: { contactName: { startsWith: PREFIX } },
      select: { id: true },
    });

    if (inquiries.length > 0) {
      await prisma.inquiry.deleteMany({ where: { id: { in: inquiries.map((i) => i.id) } } });
    }

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
      await prisma.auditLog.deleteMany({
        where: { user: { email: { contains: '@zirvetarim.test' } } },
      });
      await prisma.auditLog.deleteMany({ where: { entityType: 'Inquiry', userId: null } });
      await prisma.user.deleteMany({ where: { email: { contains: '@zirvetarim.test' } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE RULE audit_logs_no_delete');
    }
  }

  // =========================================================================
  describe('Miktar kuralları — alan bazlı hata (SPEC §15)', () => {
    it('asgari miktarın altı reddedilir ve alan bildirilir', async () => {
      const response = await validateCart([{ variantId: kgVariantId, quantity: '10' }]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('items[0].quantity');
      expect(response.body.error.details[0].message).toContain('En az');
    });

    it('adım ihlali reddedilir', async () => {
      // min 50, step 50 -> 60 geçersiz.
      const response = await validateCart([{ variantId: kgVariantId, quantity: '60' }]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('items[0].quantity');
      expect(response.body.error.details[0].message).toContain('adımlarla');
    });

    it('azami miktarın üstü reddedilir', async () => {
      const response = await validateCart([{ variantId: kgVariantId, quantity: '1000' }]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('En fazla');
    });

    it('ondalık kabul etmeyen birimde ondalık miktar reddedilir', async () => {
      const response = await validateCart([{ variantId: pieceVariantId, quantity: '2.5' }]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('ondalık');
    });

    it('geçerli miktar kabul edilir ve tutar hesaplanır', async () => {
      const response = await validateCart([{ variantId: kgVariantId, quantity: '100' }]);

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.items).toHaveLength(1);
      expect(Number(response.body.data.estimatedTotal)).toBe(600 * 100);
    });

    it('birden fazla hata TEK SEFERDE bildirilir', async () => {
      const response = await validateCart([
        { variantId: kgVariantId, quantity: '10' },
        { variantId: pieceVariantId, quantity: '2.5' },
      ]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details).toHaveLength(2);
      expect(response.body.error.details[1].field).toBe('items[1].quantity');
    });

    it('aynı varyasyon iki kez gönderilirse miktarlar toplanır', async () => {
      const response = await validateCart([
        { variantId: kgVariantId, quantity: '50' },
        { variantId: kgVariantId, quantity: '50' },
      ]);

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.items).toHaveLength(1);
      expect(Number(response.body.data.items[0].quantity)).toBe(100);
    });
  });

  // =========================================================================
  describe('Yayın durumu kontrolleri', () => {
    it('pasif varyasyon reddedilir', async () => {
      const response = await validateCart([{ variantId: inactiveVariantId, quantity: '1' }]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('mevcut değil');
    });

    it('yayında olmayan ürün reddedilir', async () => {
      const response = await validateCart([{ variantId: unpublishedVariantId, quantity: '1' }]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('satışta değil');
    });

    it('olmayan varyasyon reddedilir', async () => {
      const response = await validateCart([
        { variantId: '00000000-0000-4000-8000-000000000000', quantity: '1' },
      ]);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('bulunamadı');
    });
  });

  // =========================================================================
  describe('KVKK onayı', () => {
    it('consentAccepted=false ise talep REDDEDİLİR', async () => {
      const response = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }], {
          consentAccepted: false,
        }),
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(
        response.body.error.details.some(
          (detail: { field?: string }) => detail.field === 'consentAccepted',
        ),
      ).toBe(true);
    });

    it('onay alanı hiç gönderilmezse reddedilir', async () => {
      const body = inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]);
      delete body.consentAccepted;

      const response = await postInquiry(body);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('onaylı talepte onay zamanı ve IP saklanır', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );

      expect(created.status).toBe(HttpStatus.CREATED);

      const detail = await api()
        .get(`/api/v1/admin/inquiries/${created.body.data.id}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(detail.body.data.consentAccepted).toBe(true);
      expect(detail.body.data.consentAt).toBeDefined();
      expect(detail.body.data.ipAddress).not.toBeNull();
    });
  });

  // =========================================================================
  describe('İletişim bilgisi doğrulaması', () => {
    it('geçersiz telefon reddedilir', async () => {
      const response = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }], {
          contactPhone: '12345',
        }),
      );

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('farklı yazımlı telefon aynı biçimde saklanır', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }], {
          contactPhone: '+90 532 999 88 77',
        }),
      );

      expect(created.status).toBe(HttpStatus.CREATED);

      const detail = await api().get(`/api/v1/admin/inquiries/${created.body.data.id}`).set(auth());

      expect(detail.body.data.contactPhone).toBe('5329998877');
    });

    it('boş kalem listesi reddedilir', async () => {
      const response = await postInquiry(inquiryBody([]));

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('Fiyat snapshot — Kural 5 ve Kural 8', () => {
    it('showPrice=false üründe fiyat snapshot NULL kalır', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: pieceVariantId, quantity: '1' }]),
      );

      expect(created.status).toBe(HttpStatus.CREATED);
      expect(Number(created.body.data.estimatedTotal)).toBe(0);

      const detail = await api().get(`/api/v1/admin/inquiries/${created.body.data.id}`).set(auth());

      const item = detail.body.data.items[0];

      // Müşteri fiyatı hiç görmedi; kayda fiyat yazmak yanılgı üretir.
      expect(item.displayedPriceSnapshot).toBeNull();
      expect(item.lineTotal).toBeNull();
    });

    it('fiyatı gösterilen üründe snapshot alınır', async () => {
      const created = await postInquiry(inquiryBody([{ variantId: kgVariantId, quantity: '50' }]));

      const detail = await api().get(`/api/v1/admin/inquiries/${created.body.data.id}`).set(auth());

      const item = detail.body.data.items[0];

      expect(Number(item.displayedPriceSnapshot)).toBe(600);
      expect(Number(item.lineTotal)).toBe(600 * 50);
      expect(item.productNameSnapshot).toContain(PREFIX);
      expect(item.skuSnapshot).toBe(`${PREFIX}-KG-1`);
    });
  });

  // =========================================================================
  describe('Talep numarası', () => {
    it('TLP-YYYY-NNNNNN biçiminde üretilir', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );

      expect(created.body.data.inquiryNumber).toMatch(/^[A-Z]{2,6}-\d{4}-\d{6,}$/);
    });

    it('EŞZAMANLI isteklerde numara çakışmaz', async () => {
      // Numara üretimi sayaç satırını kilitler; kilit olmadan bu test
      // aynı numarayı iki kez üretir ve unique kısıtı isteği düşürür.
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          postInquiry(inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }])),
        ),
      );

      const numbers = responses
        .filter((response) => response.status === HttpStatus.CREATED)
        .map((response) => response.body.data.inquiryNumber as string);

      expect(numbers).toHaveLength(10);
      expect(new Set(numbers).size).toBe(10);
    });
  });

  // =========================================================================
  describe('Durum yönetimi', () => {
    let inquiryId = '';

    beforeEach(async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );

      inquiryId = created.body.data.id;
    });

    const patch = (body: Record<string, unknown>) =>
      api().patch(`/api/v1/admin/inquiries/${inquiryId}/status`).set(auth()).send(body);

    it('yeni talep NEW durumunda başlar ve ilk geçmiş kaydı oluşur', async () => {
      const detail = await api().get(`/api/v1/admin/inquiries/${inquiryId}`).set(auth());

      expect(detail.body.data.status).toBe('NEW');
      expect(detail.body.data.statusHistories).toHaveLength(1);
      expect(detail.body.data.statusHistories[0].fromStatus).toBeNull();
      expect(detail.body.data.statusHistories[0].toStatus).toBe('NEW');
      // Public talepte değiştiren yönetici yoktur.
      expect(detail.body.data.statusHistories[0].changedBy).toBeNull();
    });

    it('geçersiz geçiş reddedilir', async () => {
      const response = await patch({ status: 'QUOTED' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('status');
    });

    it('CONVERTED_TO_SALE bu uçtan set EDİLEMEZ', async () => {
      await patch({ status: 'REVIEWING' }).expect(HttpStatus.OK);
      await patch({ status: 'CONTACTED' }).expect(HttpStatus.OK);
      await patch({ status: 'QUOTED' }).expect(HttpStatus.OK);
      await patch({ status: 'APPROVED' }).expect(HttpStatus.OK);

      // APPROVED -> CONVERTED_TO_SALE geçiş tablosunda GEÇERLİ; buna rağmen
      // uç reddeder çünkü satış kaydı olmadan dönüşüm sayılmaz.
      const response = await patch({ status: 'CONVERTED_TO_SALE' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.message).toContain('satış oluşturma');
    });

    it('iptal ve red için gerekçe zorunludur', async () => {
      const withoutNote = await patch({ status: 'CANCELLED' });

      expect(withoutNote.status).toBe(HttpStatus.BAD_REQUEST);
      expect(withoutNote.body.error.details[0].field).toBe('note');

      const withNote = await patch({ status: 'CANCELLED', note: 'Müşteri vazgeçti' });

      expect(withNote.status).toBe(HttpStatus.OK);
    });

    it('her değişiklik geçmişe eski ve yeni durumla yazılır', async () => {
      await patch({ status: 'REVIEWING' }).expect(HttpStatus.OK);
      const response = await patch({ status: 'CONTACTED', note: 'Telefonla görüşüldü' });

      expect(response.status).toBe(HttpStatus.OK);

      const histories = response.body.data.statusHistories;

      expect(histories).toHaveLength(3);
      // En yeni kayıt başta.
      expect(histories[0].fromStatus).toBe('REVIEWING');
      expect(histories[0].toStatus).toBe('CONTACTED');
      expect(histories[0].note).toBe('Telefonla görüşüldü');
      expect(histories[0].changedBy.fullName).toBe('E2E Talep Yöneticisi');
    });

    it('CONTACTED durumunda ilk temas tarihi damgalanır', async () => {
      await patch({ status: 'REVIEWING' }).expect(HttpStatus.OK);
      const response = await patch({ status: 'CONTACTED' });

      expect(response.body.data.contactedAt).not.toBeNull();
    });

    it('uç durumdan çıkış engellenir ve kapanış tarihi yazılır', async () => {
      const cancelled = await patch({ status: 'CANCELLED', note: 'Vazgeçildi' });

      expect(cancelled.status).toBe(HttpStatus.OK);
      expect(cancelled.body.data.closedAt).not.toBeNull();

      const reopen = await patch({ status: 'REVIEWING' });

      expect(reopen.status).toBe(HttpStatus.BAD_REQUEST);
      expect(reopen.body.error.message).toContain('değiştirilemez');
    });

    it('aynı duruma geçiş reddedilir', async () => {
      const response = await patch({ status: 'NEW' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.message).toContain('zaten bu durumda');
    });

    it('bilinmeyen durum değeri reddedilir', async () => {
      const response = await patch({ status: 'BOYLE_BIR_DURUM_YOK' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('Yönetim listesi', () => {
    it('durum filtresi çalışır', async () => {
      const response = await api().get('/api/v1/admin/inquiries?status=NEW').set(auth());

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.every((item: { status: string }) => item.status === 'NEW')).toBe(
        true,
      );
    });

    it('talep numarasıyla arama çalışır', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );
      const number = created.body.data.inquiryNumber as string;

      const response = await api()
        .get(`/api/v1/admin/inquiries?search=${encodeURIComponent(number)}`)
        .set(auth());

      expect(response.body.meta.total).toBeGreaterThanOrEqual(1);
      expect(
        response.body.data.some((item: { inquiryNumber: string }) => item.inquiryNumber === number),
      ).toBe(true);
    });

    it('telefonla arama farklı yazımda da bulur', async () => {
      await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }], {
          contactPhone: '0533 444 55 66',
        }),
      );

      const response = await api()
        .get('/api/v1/admin/inquiries?search=' + encodeURIComponent('+90 533 444 55 66'))
        .set(auth());

      expect(response.body.meta.total).toBeGreaterThanOrEqual(1);
    });

    it('durum sayaçları döner', async () => {
      const response = await api().get('/api/v1/admin/inquiries/counts').set(auth());

      expect(response.status).toBe(HttpStatus.OK);
      expect(typeof response.body.data).toBe('object');
    });

    it('geçersiz sıralama alanı reddedilir', async () => {
      await api()
        .get('/api/v1/admin/inquiries?sortBy=contactPhone')
        .set(auth())
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('Yetkilendirme', () => {
    it('talep oluşturma jeton İSTEMEZ', async () => {
      const response = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );

      expect(response.status).toBe(HttpStatus.CREATED);
    });

    it('yönetim listesi jetonsuz 401 döner', async () => {
      await api().get('/api/v1/admin/inquiries').expect(HttpStatus.UNAUTHORIZED);
    });

    it('durum değiştirme jetonsuz 401 döner', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );

      await api()
        .patch(`/api/v1/admin/inquiries/${created.body.data.id}/status`)
        .send({ status: 'REVIEWING' })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('talep SİLME ucu yoktur (Kural 4)', async () => {
      const created = await postInquiry(
        inquiryBody([{ variantId: kgVariantId, quantity: kgRules.min }]),
      );

      await api()
        .delete(`/api/v1/admin/inquiries/${created.body.data.id}`)
        .set(auth())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  // =========================================================================
  // RATE LİMİT BURADA TEST EDİLEMEZ.
  //
  // ThrottlerModule test ortamında bilinçli olarak devre dışıdır
  // (app.module.ts -> `skipIf: () => config.isTest`); aksi hâlde bu dosyadaki
  // onlarca talep isteği sınıra çarpıp testleri kırardı.
  //
  // Sınır değerleri birim testte doğrulanır (inquiry-status.spec.ts) ve
  // davranış geliştirme ortamında elle teyit edildi: aynı IP'den 6. istek
  // 429 döner. Buraya çalışmayan bir test yazmak, yeşil ama anlamsız bir
  // güvence olurdu.
});
