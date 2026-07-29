import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { FORBIDDEN_PUBLIC_FIELDS } from '@zirve/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { deleteProductsWithStockHistory } from './test-cleanup';

/**
 * Ürün modülü uçtan uca testleri (Sprint 4).
 *
 * En kritik testler:
 *   - purchasePrice SIZINTI testi (Kural 8)
 *   - allowsDecimal doğrulaması ("2,5 adet" reddedilmeli)
 *   - tek ana kategori kuralı
 *   - simetrik ilişkinin iki yönden görünmesi (güvenlik)
 */
describe('Ürünler (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const SUPER = { email: 'prod.super@zirvetarim.test', password: 'ProdSuperSifre123' };
  const PREFIX = 'E2EUrun';

  let token = '';
  let categoryId = '';
  let secondCategoryId = '';
  let kgUnitId = '';
  let adetUnitId = '';

  jest.setTimeout(180_000);

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

    await cleanup();

    await prisma.user.create({
      data: {
        email: SUPER.email,
        passwordHash: await hash(SUPER.password, ARGON2_OPTIONS),
        fullName: 'E2E Ürün Yöneticisi',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    const login = await api().post('/api/v1/auth/login').send(SUPER);
    token = login.body.data.accessToken;

    // Seed'den gelen taksonomi kullanılır; yoksa test anlamsız olurdu.
    const categories = await prisma.category.findMany({ take: 2, where: { deletedAt: null } });
    categoryId = categories[0]?.id ?? '';
    secondCategoryId = categories[1]?.id ?? '';

    const kg = await prisma.unitType.findFirst({ where: { code: 'kg' } });
    const adet = await prisma.unitType.findFirst({ where: { code: 'ad' } });
    kgUnitId = kg?.id ?? '';
    adetUnitId = adet?.id ?? '';

    expect(categoryId).not.toBe('');
    expect(kgUnitId).not.toBe('');
    expect(adetUnitId).not.toBe('');
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function cleanup(): Promise<void> {
    const products = await prisma.product.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { id: true },
    });
    const ids = products.map((product) => product.id);

    if (ids.length > 0) {
      await prisma.productRelation.deleteMany({
        where: { OR: [{ sourceProductId: { in: ids } }, { targetProductId: { in: ids } }] },
      });
    }

    await deleteProductsWithStockHistory(prisma, ids);

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

  /** Benzersiz SKU üretir; her testin kendi kodu olsun. */
  let skuCounter = 0;

  function nextSku(label: string): string {
    skuCounter += 1;

    return `${PREFIX.toUpperCase()}-${label}-${skuCounter}`;
  }

  /** Geçerli bir varyasyon gövdesi. */
  function variantBody(sku: string, overrides: Record<string, unknown> = {}) {
    return {
      sku,
      unitTypeId: kgUnitId,
      unitQuantity: '5',
      purchasePrice: '100.0000',
      salePrice: '150.0000',
      minOrderQuantity: '5',
      quantityStep: '5',
      stockQuantity: '100',
      ...overrides,
    };
  }

  /**
   * Test ürünü oluşturur.
   *
   * VARSAYILAN OLARAK BİR VARYASYON GÖNDERİR: SPEC §15.3 gereği ürün en az bir
   * aktif varyasyonla doğmak zorundadır, varyasyonsuz istek 422 döner. Kuralın
   * KENDİSİNİ test eden senaryolar `POST`u elle atar.
   */
  async function createProduct(name: string, extra: Record<string, unknown> = {}) {
    const response = await api()
      .post('/api/v1/admin/products')
      .set(auth())
      .send({
        name: `${PREFIX} ${name}`,
        categories: [{ categoryId, isPrimary: true }],
        variants: [variantBody(nextSku('URUN'))],
        ...extra,
      });

    expect(response.status).toBe(HttpStatus.CREATED);

    return response.body.data as { id: string; slug: string };
  }

  /** Ürüne geçerli bir varyasyon ekler. */
  async function addVariant(
    productId: string,
    sku: string,
    overrides: Record<string, unknown> = {},
  ) {
    return api()
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set(auth())
      .send(variantBody(sku, overrides));
  }

  // =========================================================================
  describe('SIZINTI TESTİ — Kural 8', () => {
    // Bu testler sessiz bir güvenlik hatasını yakalar: yeni bir hassas alan
    // eklendiğinde public yanıta sızarsa kimse hata almaz, veri usulca akar.
    it.each([
      ['/api/v1/public/products?limit=50', 'liste'],
      ['/api/v1/public/taxonomy', 'taksonomi'],
      ['/api/v1/public/settings', 'ayarlar'],
    ])('%s yanıtında yasaklı alan yok (%s)', async (url) => {
      const response = await api().get(url);
      const body = JSON.stringify(response.body);

      for (const field of FORBIDDEN_PUBLIC_FIELDS) {
        expect(body).not.toContain(`"${field}"`);
      }
    });

    it('ürün DETAYINDA da yasaklı alan yok', async () => {
      const list = await api().get('/api/v1/public/products?limit=1');
      const slug = list.body.data[0]?.slug as string | undefined;

      expect(slug).toBeDefined();

      const detail = await api().get(`/api/v1/public/products/${slug}`);
      const body = JSON.stringify(detail.body);

      for (const field of FORBIDDEN_PUBLIC_FIELDS) {
        expect(body).not.toContain(`"${field}"`);
      }
    });

    it('YÖNETİM yanıtında purchasePrice BULUNUR', async () => {
      const response = await api().get('/api/v1/admin/products?limit=1').set(auth());

      expect(JSON.stringify(response.body)).toContain('purchasePrice');
    });

    it('showPrice=false olan üründe salePrice gizlenir', async () => {
      const product = await createProduct('Gizli Fiyat', { showPrice: false });
      await addVariant(product.id, `${PREFIX.toUpperCase()}-GIZLI-1`);

      await api()
        .patch(`/api/v1/admin/products/${product.id}`)
        .set(auth())
        .send({ isPublished: true })
        .expect(HttpStatus.OK);

      const detail = await api().get(`/api/v1/public/products/${product.slug}`);

      expect(detail.status).toBe(HttpStatus.OK);
      expect(detail.body.data.showPrice).toBe(false);
      expect(detail.body.data.variants[0]?.salePrice).toBeUndefined();
    });
  });

  // =========================================================================
  describe('Kategori kuralları', () => {
    it('kategorisiz ürün reddedilir', async () => {
      const response = await api()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({ name: `${PREFIX} Kategorisiz`, categories: [] });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('İKİ ana kategori reddedilir', async () => {
      const response = await api()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({
          name: `${PREFIX} Iki Ana`,
          categories: [
            { categoryId, isPrimary: true },
            { categoryId: secondCategoryId, isPrimary: true },
          ],
          variants: [variantBody(nextSku('IKIANA'))],
        });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(response.body.error.code).toBe('UNPROCESSABLE');
    });

    it('aynı kategori iki kez eklenemez', async () => {
      const response = await api()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({
          name: `${PREFIX} Yinelenen Kategori`,
          categories: [
            { categoryId, isPrimary: true },
            { categoryId, isPrimary: false },
          ],
          variants: [variantBody(nextSku('YINKAT'))],
        });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('çoklu kategori + tek ana kategori kabul edilir', async () => {
      const response = await api()
        .post('/api/v1/admin/products')
        .set(auth())
        .send({
          name: `${PREFIX} Coklu Kategori`,
          categories: [
            { categoryId, isPrimary: true },
            { categoryId: secondCategoryId, isPrimary: false },
          ],
          variants: [variantBody(nextSku('COKKAT'))],
        });

      expect(response.status).toBe(HttpStatus.CREATED);
      expect(response.body.data.categories).toHaveLength(2);
    });
  });

  // =========================================================================
  describe('Yayın kuralı', () => {
    /**
     * Varyasyonsuz ürün ARTIK API'DEN OLUŞTURULAMAZ (SPEC §15.3), bu yüzden
     * yayın muhafızı ancak ESKİ VERİ ile test edilebilir: kayıt doğrudan
     * veritabanına yazılır.
     *
     * Test silinmiyor çünkü muhafız hâlâ gerekli: kural sıkılaştırılmadan önce
     * oluşmuş varyasyonsuz ürünler üretim veritabanında durabilir ve onların
     * yayına alınması yine engellenmelidir.
     */
    it('varyasyonsuz ESKİ ürün YAYINA alınamaz', async () => {
      const legacy = await prisma.product.create({
        data: {
          name: `${PREFIX} Eski Varyasyonsuz`,
          slug: `e2eurun-eski-varyasyonsuz-${Date.now()}`,
          categories: { create: [{ categoryId, isPrimary: true }] },
        },
        select: { id: true },
      });

      const response = await api()
        .patch(`/api/v1/admin/products/${legacy.id}`)
        .set(auth())
        .send({ isPublished: true });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('aktif varyasyonu olan ürün yayına alınabilir', async () => {
      const product = await createProduct('Yayinlanabilir');

      const response = await api()
        .patch(`/api/v1/admin/products/${product.id}`)
        .set(auth())
        .send({ isPublished: true });

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.data.isPublished).toBe(true);
    });

    it('yayınlanmamış ürün PUBLIC listede görünmez', async () => {
      await createProduct('Gizli Urun');

      const response = await api().get(`/api/v1/public/products?search=Gizli Urun&limit=50`);

      expect(response.body.meta.total).toBe(0);
    });
  });

  // =========================================================================
  /**
   * SPEC §15.3 — "Ürünün en az bir aktif varyasyonu olmalıdır."
   *
   * Kural bir DEĞİŞMEZDİR, yalnız yayınlama ön koşulu değil. Bu yüzden İKİ yol
   * birden kapalı olmalı: varyasyonsuz ürün OLUŞTURULAMAZ ve var olan ürünün
   * son aktif varyasyonu KALDIRILAMAZ. Biri açık kalsa katalogda sessizce
   * satılamaz ürünler birikirdi — kural sıkılaştırılmadan önceki durum buydu.
   */
  describe('En az bir aktif varyasyon kuralı (SPEC §15.3)', () => {
    describe('oluşturmada', () => {
      it('varyasyon alanı hiç gönderilmezse reddedilir', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Varyasyonsuz Istek`,
            categories: [{ categoryId, isPrimary: true }],
          });

        expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      });

      it('boş varyasyon dizisi reddedilir', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Bos Varyasyon`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [],
          });

        expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      });

      /** Adet yetmez: hepsi pasifse ürün yine satılamaz. */
      it('varyasyonların TAMAMI pasifse reddedilir', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Hepsi Pasif`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [variantBody(nextSku('PASIF'), { isActive: false })],
          });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect(response.body.error.details[0].field).toBe('variants');

        const found = await prisma.product.findFirst({
          where: { name: `${PREFIX} Hepsi Pasif`, deletedAt: null },
        });

        expect(found).toBeNull();
      });

      it('biri aktif biri pasif varyasyonla oluşur', async () => {
        const product = await createProduct('Karisik Aktiflik', {
          variants: [
            variantBody(nextSku('KARISIK-A')),
            variantBody(nextSku('KARISIK-P'), { isActive: false }),
          ],
        });

        const variants = await prisma.productVariant.findMany({
          where: { productId: product.id, deletedAt: null },
        });

        expect(variants).toHaveLength(2);
        expect(variants.filter((item) => item.isActive)).toHaveLength(1);
      });
    });

    describe('son aktif varyasyonun korunması', () => {
      it('tek aktif varyasyon SİLİNEMEZ', async () => {
        const product = await createProduct('Tek Aktif Silme');
        const variant = await prisma.productVariant.findFirstOrThrow({
          where: { productId: product.id },
        });

        const response = await api()
          .delete(`/api/v1/admin/products/${product.id}/variants/${variant.id}`)
          .set(auth());

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect(response.body.error.details[0].field).toBe('variantId');

        // Gerçekten silinmemiş olmalı.
        const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });

        expect(after.deletedAt).toBeNull();
        expect(after.isActive).toBe(true);
      });

      it('tek aktif varyasyon PASİFE ALINAMAZ', async () => {
        const product = await createProduct('Tek Aktif Pasif');
        const variant = await prisma.productVariant.findFirstOrThrow({
          where: { productId: product.id },
        });

        const response = await api()
          .patch(`/api/v1/admin/products/${product.id}/variants/${variant.id}`)
          .set(auth())
          .send({ isActive: false });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect(response.body.error.details[0].field).toBe('isActive');

        const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });

        expect(after.isActive).toBe(true);
      });

      it('iki aktif varyasyondan biri silinebilir', async () => {
        const product = await createProduct('Iki Aktif', {
          variants: [variantBody(nextSku('IKI-1')), variantBody(nextSku('IKI-2'))],
        });

        const variants = await prisma.productVariant.findMany({
          where: { productId: product.id, deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        });

        await api()
          .delete(`/api/v1/admin/products/${product.id}/variants/${variants[1]?.id}`)
          .set(auth())
          .expect(HttpStatus.NO_CONTENT);

        const remaining = await prisma.productVariant.findMany({
          where: { productId: product.id, deletedAt: null, isActive: true },
        });

        expect(remaining).toHaveLength(1);
      });

      /**
       * PASİF varyasyon her zaman silinebilir.
       *
       * Muhafız yalnız AKTİF varyasyonu koruyor; aksi hâlde eski verideki
       * aktif varyasyonu olmayan ürünlerde yönetici hiçbir şey silemez hâle
       * gelir ve kilitlenirdi.
       */
      it('pasif varyasyon serbestçe silinebilir', async () => {
        const product = await createProduct('Pasif Silme', {
          variants: [
            variantBody(nextSku('PSIL-A')),
            variantBody(nextSku('PSIL-P'), { isActive: false }),
          ],
        });

        const passive = await prisma.productVariant.findFirstOrThrow({
          where: { productId: product.id, isActive: false },
        });

        await api()
          .delete(`/api/v1/admin/products/${product.id}/variants/${passive.id}`)
          .set(auth())
          .expect(HttpStatus.NO_CONTENT);
      });

      /**
       * Varsayılan varyasyon silinince sıradaki devralır.
       *
       * Ürün kartı varsayılanın fiyatını gösterir; varsayılansız ürün kartsız
       * kalırdı. Eskiden bu boşluk görünmüyordu çünkü son aktif varyasyon da
       * silinebildiği için ürün zaten yayından düşüyordu.
       */
      it('varsayılan silinince sıradaki varsayılan olur', async () => {
        const product = await createProduct('Varsayilan Devir', {
          variants: [variantBody(nextSku('VDEV-1')), variantBody(nextSku('VDEV-2'))],
        });

        const defaultVariant = await prisma.productVariant.findFirstOrThrow({
          where: { productId: product.id, isDefault: true },
        });

        await api()
          .delete(`/api/v1/admin/products/${product.id}/variants/${defaultVariant.id}`)
          .set(auth())
          .expect(HttpStatus.NO_CONTENT);

        const defaults = await prisma.productVariant.findMany({
          where: { productId: product.id, isDefault: true, deletedAt: null },
        });

        expect(defaults).toHaveLength(1);
        expect(defaults[0]?.id).not.toBe(defaultVariant.id);
      });
    });
  });

  // =========================================================================
  /**
   * Ürünle BİRLİKTE varyasyon oluşturma.
   *
   * Yönetim formu artık varyasyonları ürünle aynı istekte gönderiyor. Bu
   * bölümün asıl konusu ATOMİKLİK: varyasyonlardan biri geçersizse ürün de
   * kaydedilmemelidir. Aksi hâlde form her hatada arkada "varyasyonsuz ürün"
   * bırakır ve o ürün SPEC §15.3'e göre satılabilir değildir.
   */
  describe('Ürünle birlikte varyasyon oluşturma', () => {
    /** Geçerli bir varyasyon gövdesi üretir. */
    function variantPayload(sku: string, overrides: Record<string, unknown> = {}) {
      return {
        sku,
        unitTypeId: kgUnitId,
        unitQuantity: '5',
        purchasePrice: '100.0000',
        salePrice: '150.0000',
        minOrderQuantity: '5',
        quantityStep: '5',
        stockQuantity: '40',
        ...overrides,
      };
    }

    it('tek istekte ürün ve varyasyonları oluşur', async () => {
      const product = await createProduct('Birlikte Tek', {
        variants: [variantPayload(`${PREFIX.toUpperCase()}-BIRL-1`)],
      });

      const variants = await prisma.productVariant.findMany({
        where: { productId: product.id, deletedAt: null },
      });

      expect(variants).toHaveLength(1);
      expect(variants[0]?.sku).toBe(`${PREFIX.toUpperCase()}-BIRL-1`);
      // Başlangıç stoğu hareket üzerinden yazılır; alan da güncel olmalı.
      expect(variants[0]?.stockQuantity.toString()).toBe('40');
    });

    it('başlangıç stoğu INITIAL hareketi olarak kaydedilir', async () => {
      const product = await createProduct('Birlikte Stok', {
        variants: [variantPayload(`${PREFIX.toUpperCase()}-BIRL-STOK`, { stockQuantity: '25' })],
      });

      const variant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });
      const movements = await prisma.stockMovement.findMany({
        where: { variantId: variant.id },
      });

      expect(movements).toHaveLength(1);
      expect(movements[0]?.type).toBe('INITIAL');
      expect(movements[0]?.quantity.toString()).toBe('25');
    });

    it('birden fazla varyasyon sırayla yazılır ve ilki VARSAYILAN olur', async () => {
      const product = await createProduct('Birlikte Coklu', {
        variants: [
          variantPayload(`${PREFIX.toUpperCase()}-COK-1`),
          variantPayload(`${PREFIX.toUpperCase()}-COK-2`, { unitQuantity: '25' }),
          variantPayload(`${PREFIX.toUpperCase()}-COK-3`, { unitQuantity: '50' }),
        ],
      });

      const variants = await prisma.productVariant.findMany({
        where: { productId: product.id, deletedAt: null },
        orderBy: { sortOrder: 'asc' },
      });

      expect(variants).toHaveLength(3);
      expect(variants.map((item) => item.sku)).toEqual([
        `${PREFIX.toUpperCase()}-COK-1`,
        `${PREFIX.toUpperCase()}-COK-2`,
        `${PREFIX.toUpperCase()}-COK-3`,
      ]);
      // Formdaki sıra korunmalı.
      expect(variants.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
      // Yalnız ilki varsayılan.
      expect(variants.filter((item) => item.isDefault)).toHaveLength(1);
      expect(variants[0]?.isDefault).toBe(true);
    });

    it('isDefault işaretli varyasyon varsayılan olur, ilki değil', async () => {
      const product = await createProduct('Birlikte Varsayilan', {
        variants: [
          variantPayload(`${PREFIX.toUpperCase()}-VARS-1`),
          variantPayload(`${PREFIX.toUpperCase()}-VARS-2`, { isDefault: true }),
        ],
      });

      const defaults = await prisma.productVariant.findMany({
        where: { productId: product.id, isDefault: true, deletedAt: null },
      });

      expect(defaults).toHaveLength(1);
      expect(defaults[0]?.sku).toBe(`${PREFIX.toUpperCase()}-VARS-2`);
    });

    // -----------------------------------------------------------------------
    /**
     * ATOMİKLİK — bu bölümün en önemli testleri.
     *
     * Her senaryoda ikinci varyasyon geçersizdir. Beklenti yalnız "istek
     * reddedildi" değil, ÜRÜNÜN DE OLUŞMAMASI. Varyasyonlar istemciden
     * sırayla POST edilseydi bu testlerin hepsi arkada yetim ürün bırakırdı.
     */
    describe('atomiklik', () => {
      /** Verilen adla ürün var mı? */
      async function productExists(name: string): Promise<boolean> {
        const found = await prisma.product.findFirst({
          where: { name: `${PREFIX} ${name}`, deletedAt: null },
          select: { id: true },
        });

        return found !== null;
      }

      it('geçersiz varyasyon ürünü de geri alır', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Atomik Negatif`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [
              variantPayload(`${PREFIX.toUpperCase()}-ATOM-1`),
              // Negatif satış fiyatı — SPEC §15.4.
              variantPayload(`${PREFIX.toUpperCase()}-ATOM-2`, { salePrice: '-5.0000' }),
            ],
          });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        await expect(productExists('Atomik Negatif')).resolves.toBe(false);
      });

      it('adet biriminde ondalıklı miktar ürünü de geri alır', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Atomik Ondalik`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [
              variantPayload(`${PREFIX.toUpperCase()}-ATOMOND-1`, {
                unitTypeId: adetUnitId,
                unitQuantity: '2.5',
                minOrderQuantity: '1',
                quantityStep: '1',
                stockQuantity: '10',
              }),
            ],
          });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        await expect(productExists('Atomik Ondalik')).resolves.toBe(false);
      });

      it('başka üründe kullanılan SKU ürünü de geri alır', async () => {
        const existing = await createProduct('Atomik SKU Sahibi', {
          variants: [variantPayload(`${PREFIX.toUpperCase()}-ATOMSKU`)],
        });

        expect(existing.id).not.toBe('');

        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Atomik SKU Cakisan`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [variantPayload(`${PREFIX.toUpperCase()}-ATOMSKU`)],
          });

        expect(response.status).toBe(HttpStatus.CONFLICT);
        await expect(productExists('Atomik SKU Cakisan')).resolves.toBe(false);
      });

      /**
       * AYNI İSTEKTE tekrar eden SKU.
       *
       * Kontrol devam eden transaction üzerinden yapılmalıdır: dış bağlantıdan
       * bakılsaydı henüz commit edilmemiş ilk varyasyon görünmez ve çakışma
       * ancak veritabanı kısıtından ham bir hata olarak dönerdi.
       */
      it('aynı istekte tekrar eden SKU reddedilir', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Atomik Tekrar SKU`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [
              variantPayload(`${PREFIX.toUpperCase()}-TEKRAR`),
              variantPayload(`${PREFIX.toUpperCase()}-TEKRAR`, { unitQuantity: '25' }),
            ],
          });

        expect(response.status).toBe(HttpStatus.CONFLICT);
        await expect(productExists('Atomik Tekrar SKU')).resolves.toBe(false);
      });

      it('büyük/küçük harf farkıyla tekrar eden SKU da reddedilir', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Atomik Harf SKU`,
            categories: [{ categoryId, isPrimary: true }],
            variants: [
              variantPayload(`${PREFIX.toUpperCase()}-HARF`),
              variantPayload(`${PREFIX.toUpperCase()}-HARF`.toLowerCase()),
            ],
          });

        expect(response.status).toBe(HttpStatus.CONFLICT);
        await expect(productExists('Atomik Harf SKU')).resolves.toBe(false);
      });
    });

    // -----------------------------------------------------------------------
    describe('yayın kuralı oluşturmada', () => {
      it('aktif varyasyonla birlikte gelen ürün YAYINA alınabilir', async () => {
        const product = await createProduct('Birlikte Yayin', {
          isPublished: true,
          variants: [variantPayload(`${PREFIX.toUpperCase()}-YAY-1`)],
        });

        const created = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });

        expect(created.isPublished).toBe(true);
      });

      /*
       * "Varyasyonsuz ürün yayına alınamaz" senaryosu ARTIK BURADA DEĞİL:
       * varyasyon oluşturmada zorunlu olduğu için o istek yayın kuralına
       * gelmeden reddediliyor. Karşılığı "En az bir aktif varyasyon kuralı"
       * bölümünde.
       */
      it('yalnız PASİF varyasyon gönderilirse reddedilir', async () => {
        const response = await api()
          .post('/api/v1/admin/products')
          .set(auth())
          .send({
            name: `${PREFIX} Birlikte Yayin Pasif`,
            categories: [{ categoryId, isPrimary: true }],
            isPublished: true,
            variants: [variantPayload(`${PREFIX.toUpperCase()}-YAYPAS`, { isActive: false })],
          });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      });
    });
  });

  // =========================================================================
  describe('Varyasyon doğrulamaları', () => {
    let productId = '';

    beforeAll(async () => {
      productId = (await createProduct('Varyasyon Testleri')).id;
    });

    it('SKU benzersizdir', async () => {
      const sku = `${PREFIX.toUpperCase()}-UNIQ-1`;

      const first = await addVariant(productId, sku);

      expect(first.status).toBe(HttpStatus.CREATED);

      const duplicate = await addVariant(productId, sku);

      expect(duplicate.status).toBe(HttpStatus.CONFLICT);
      expect(duplicate.body.error.code).toBe('CONFLICT');
    });

    it('negatif satış fiyatı reddedilir', async () => {
      const response = await addVariant(productId, `${PREFIX.toUpperCase()}-NEG-1`, {
        salePrice: '-10',
      });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('negatif alış fiyatı reddedilir', async () => {
      const response = await addVariant(productId, `${PREFIX.toUpperCase()}-NEG-2`, {
        purchasePrice: '-5',
      });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('sıfır veya negatif minOrderQuantity reddedilir', async () => {
      const zero = await addVariant(productId, `${PREFIX.toUpperCase()}-MIN-1`, {
        minOrderQuantity: '0',
      });

      expect(zero.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('sıfır quantityStep reddedilir', async () => {
      const response = await addVariant(productId, `${PREFIX.toUpperCase()}-STEP-1`, {
        quantityStep: '0',
      });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('maxOrderQuantity < minOrderQuantity reddedilir', async () => {
      const response = await addVariant(productId, `${PREFIX.toUpperCase()}-MAX-1`, {
        minOrderQuantity: '10',
        maxOrderQuantity: '5',
      });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    describe('allowsDecimal — en kritik miktar kuralı', () => {
      it('kg biriminde ONDALIKLI miktar KABUL edilir', async () => {
        const response = await addVariant(productId, `${PREFIX.toUpperCase()}-DEC-OK`, {
          unitTypeId: kgUnitId,
          unitQuantity: '2.5',
          minOrderQuantity: '2.5',
          quantityStep: '2.5',
        });

        expect(response.status).toBe(HttpStatus.CREATED);
      });

      it('adet biriminde ondalıklı AMBALAJ miktarı reddedilir', async () => {
        const response = await addVariant(productId, `${PREFIX.toUpperCase()}-DEC-NO1`, {
          unitTypeId: adetUnitId,
          unitQuantity: '2.5',
        });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect(JSON.stringify(response.body)).toContain('ondalıklı olamaz');
      });

      it('adet biriminde ondalıklı ADIM reddedilir', async () => {
        const response = await addVariant(productId, `${PREFIX.toUpperCase()}-DEC-NO2`, {
          unitTypeId: adetUnitId,
          unitQuantity: '1',
          minOrderQuantity: '1',
          quantityStep: '0.5',
        });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      });

      it('adet biriminde ondalıklı STOK reddedilir', async () => {
        const response = await addVariant(productId, `${PREFIX.toUpperCase()}-DEC-NO3`, {
          unitTypeId: adetUnitId,
          unitQuantity: '1',
          minOrderQuantity: '1',
          quantityStep: '1',
          stockQuantity: '10.5',
        });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      });
    });

    /**
     * "İlk varyasyon varsayılan olur" kuralı artık ÜRÜNLE BİRLİKTE gelen
     * varyasyonda görünür: ürün en az bir varyasyonla doğduğu için (SPEC §15.3)
     * ilk varyasyon her zaman o oluyor. Sonradan eklenen varyasyon varsayılanı
     * devralmamalıdır — yönetici açıkça istemedikçe ürün kartı değişmemeli.
     */
    it('ilk varyasyon otomatik VARSAYILAN olur, sonradan eklenen olmaz', async () => {
      const product = await createProduct('Ilk Varyasyon Varsayilan');

      const firstVariant = await prisma.productVariant.findFirstOrThrow({
        where: { productId: product.id },
      });

      expect(firstVariant.isDefault).toBe(true);

      const added = await addVariant(product.id, `${PREFIX.toUpperCase()}-DEF-1`);

      expect(added.body.data.isDefault).toBe(false);

      // İlki varsayılan kalmalı.
      const firstAfter = await prisma.productVariant.findUniqueOrThrow({
        where: { id: firstVariant.id },
      });

      expect(firstAfter.isDefault).toBe(true);
    });

    it('yeni varsayılan işaretlenince eskisi kalkar', async () => {
      const product = await createProduct('Varsayilan Degisimi');
      const first = await addVariant(product.id, `${PREFIX.toUpperCase()}-DEF-A`);
      const second = await addVariant(product.id, `${PREFIX.toUpperCase()}-DEF-B`, {
        isDefault: true,
      });

      expect(second.body.data.isDefault).toBe(true);

      const firstAfter = await prisma.productVariant.findUnique({
        where: { id: first.body.data.id },
      });

      expect(firstAfter?.isDefault).toBe(false);
    });
  });

  // =========================================================================
  describe('Ürün ilişkileri', () => {
    let productA = { id: '', slug: '' };
    let productB = { id: '', slug: '' };

    beforeAll(async () => {
      productA = await createProduct('Iliski A');
      productB = await createProduct('Iliski B');
    });

    it('ürün KENDİSİYLE ilişkilendirilemez', async () => {
      const response = await api()
        .post(`/api/v1/admin/products/${productA.id}/relations`)
        .set(auth())
        .send({ targetProductId: productA.id, type: 'SIMILAR' });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('INCOMPATIBLE gerekçesiz eklenemez', async () => {
      const response = await api()
        .post(`/api/v1/admin/products/${productA.id}/relations`)
        .set(auth())
        .send({ targetProductId: productB.id, type: 'INCOMPATIBLE' });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(JSON.stringify(response.body)).toContain('gerekçe');
    });

    it('SİMETRİK ilişki İKİ YÖNDEN de görünür (güvenlik kuralı)', async () => {
      await api()
        .post(`/api/v1/admin/products/${productA.id}/relations`)
        .set(auth())
        .send({
          targetProductId: productB.id,
          type: 'INCOMPATIBLE',
          note: 'Tank karışımında çökelme yapar.',
        })
        .expect(HttpStatus.CREATED);

      // A'nın sayfasında görünmeli.
      const fromA = await api().get(`/api/v1/admin/products/${productA.id}/relations`).set(auth());

      expect(fromA.body.data.some((r: { type: string }) => r.type === 'INCOMPATIBLE')).toBe(true);

      // B'nin sayfasında DA görünmeli — bu ayrışırsa çiftçi uyarıyı kaçırır.
      const fromB = await api().get(`/api/v1/admin/products/${productB.id}/relations`).set(auth());

      expect(fromB.body.data.some((r: { type: string }) => r.type === 'INCOMPATIBLE')).toBe(true);
    });

    it('aynı simetrik ilişki ters yönde tekrar eklenemez', async () => {
      const response = await api()
        .post(`/api/v1/admin/products/${productB.id}/relations`)
        .set(auth())
        .send({
          targetProductId: productA.id,
          type: 'INCOMPATIBLE',
          note: 'Tekrar deneme.',
        });

      expect(response.status).toBe(HttpStatus.CONFLICT);
    });

    it('YÖNLÜ ilişki yalnız KAYNAK üründe görünür', async () => {
      await api()
        .post(`/api/v1/admin/products/${productA.id}/relations`)
        .set(auth())
        .send({ targetProductId: productB.id, type: 'ALTERNATIVE' })
        .expect(HttpStatus.CREATED);

      const fromA = await api()
        .get(`/api/v1/admin/products/${productA.id}/relations?type=ALTERNATIVE`)
        .set(auth());

      expect(fromA.body.data).toHaveLength(1);

      // B'de GÖRÜNMEMELİ: "A yerine B" ifadesi "B yerine A" demek değildir.
      const fromB = await api()
        .get(`/api/v1/admin/products/${productB.id}/relations?type=ALTERNATIVE`)
        .set(auth());

      expect(fromB.body.data).toHaveLength(0);
    });
  });

  // =========================================================================
  describe('Public filtreler', () => {
    it('kategori filtresi ALT KATEGORİLERİ de kapsar', async () => {
      const parent = await api().get('/api/v1/public/products?category=gubre&limit=50');
      const child = await api().get('/api/v1/public/products?category=kati-gubre&limit=50');

      // Üst kategori, alt kategorinin ürünlerini de içermelidir.
      expect(parent.body.meta.total).toBeGreaterThanOrEqual(child.body.meta.total);
      expect(child.body.meta.total).toBeGreaterThan(0);
    });

    it('Türkçe arama AKSANDAN BAĞIMSIZ çalışır', async () => {
      const withAccent = await api().get('/api/v1/public/products?search=Gübre&limit=50');
      const without = await api().get('/api/v1/public/products?search=gubre&limit=50');
      const upper = await api().get('/api/v1/public/products?search=GÜBRE&limit=50');

      expect(without.body.meta.total).toBe(withAccent.body.meta.total);
      expect(upper.body.meta.total).toBe(withAccent.body.meta.total);
      expect(withAccent.body.meta.total).toBeGreaterThan(0);
    });

    it('fiyata göre artan sıralama doğrudur', async () => {
      const response = await api().get('/api/v1/public/products?sort=price-asc&limit=10');
      const prices = (response.body.data as { variants: { salePrice: string }[] }[])
        .map((product) => Number(product.variants[0]?.salePrice ?? 0))
        .filter((price) => price > 0);

      const sorted = [...prices].sort((a, b) => a - b);

      expect(prices).toEqual(sorted);
    });

    it('marka filtresi çoklu değeri destekler', async () => {
      const single = await api().get('/api/v1/public/products?brand=agromax&limit=50');
      const multi = await api().get('/api/v1/public/products?brand=agromax,bioverde&limit=50');

      expect(multi.body.meta.total).toBeGreaterThan(single.body.meta.total);
    });

    it('geçersiz sıralama değeri reddedilir', async () => {
      await api().get('/api/v1/public/products?sort=rastgele').expect(HttpStatus.BAD_REQUEST);
    });

    it('bilinmeyen kategori boş sonuç döner', async () => {
      const response = await api().get('/api/v1/public/products?category=boyle-kategori-yok');

      expect(response.body.meta.total).toBe(0);
    });
  });

  // =========================================================================
  /**
   * Görsellerin yalnız veritabanında kaydı olması yetmez: URL gerçekten
   * açılmalıdır. Bu testler olmadan "kayıt var ama dosya 404" durumu
   * ancak tarayıcıda fark edilirdi.
   */
  describe('Yüklenen görsellerin sunulması', () => {
    it('yüklenen görsel URL üzerinden erişilebilir', async () => {
      const image = await prisma.productImage.findFirst({ select: { url: true } });

      if (image === null) {
        throw new Error('Seed görseli bulunamadı; seed çalıştırılmamış olabilir.');
      }

      const response = await api().get(image.url).expect(HttpStatus.OK);

      expect(response.headers['content-type']).toContain('image/');
      // Tarayıcı içeriği MIME tipinden bağımsız yorumlamamalı.
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      // Web (3000) ile API (4000) farklı köken; helmet varsayılanı engellerdi.
      expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
    });

    it('dizin listelemesi kapalıdır', async () => {
      await api().get('/uploads/products/seed/').expect(HttpStatus.NOT_FOUND);
    });

    it('dizin geçişi denemesi dosya sızdırmaz', async () => {
      await api().get('/uploads/../package.json').expect(HttpStatus.NOT_FOUND);
    });

    it('olmayan görsel standart hata formatı döner', async () => {
      const response = await api()
        .get('/uploads/products/seed/boyle-bir-dosya-yok.png')
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    });
  });

  // =========================================================================
  describe('Yetkilendirme', () => {
    it('jetonsuz ürün oluşturma 401 döner', async () => {
      await api()
        .post('/api/v1/admin/products')
        .send({ name: 'x', categories: [] })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('public uçlar jeton istemez', async () => {
      await api().get('/api/v1/public/products').expect(HttpStatus.OK);
    });
  });
});
