import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { deleteProductsWithStockHistory } from './test-cleanup';

/**
 * Stok yönetimi uçtan uca testleri (Sprint 9).
 *
 * SPRİNTİN EN KRİTİK TESTLERİ:
 *   - satış onayı stoğu düşürür ve SALE hareketi yazar
 *   - iptal SALE_CANCEL ile stoğu geri ekler
 *   - yetersiz stokta finalize REDDEDİLİR ve eksik kalemler listelenir
 *   - EŞZAMANLI iki finalize'da yalnız biri geçer (satır kilidi)
 *   - previousStock/newStock ZİNCİRİ tutarlıdır
 *   - stok yalnız hareketle değişir (varyasyon ucundan yazılamaz)
 */
describe('Stok yönetimi (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const SUPER = { email: 'stock.super@zirvetarim.test', password: 'StokSuperSifre123' };
  const STAFF = { email: 'stock.admin@zirvetarim.test', password: 'StokAdminSifre123' };
  const PREFIX = 'E2EStok';

  let token = '';
  let adminToken = '';
  let productId = '';
  let unitTypeId = '';
  let customerId = '';

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

    await prisma.user.createMany({
      data: [
        {
          email: SUPER.email,
          passwordHash: await hash(SUPER.password, ARGON2_OPTIONS),
          fullName: 'E2E Stok Süper Yöneticisi',
          role: UserRole.SUPER_ADMIN,
          isActive: true,
        },
        {
          email: STAFF.email,
          passwordHash: await hash(STAFF.password, ARGON2_OPTIONS),
          fullName: 'E2E Stok Yöneticisi',
          role: UserRole.ADMIN,
          isActive: true,
        },
      ],
    });

    token = (await api().post('/api/v1/auth/login').send(SUPER)).body.data.accessToken;
    adminToken = (await api().post('/api/v1/auth/login').send(STAFF)).body.data.accessToken;

    await seedFixtures();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const staffAuth = () => ({ Authorization: `Bearer ${adminToken}` });

  async function seedFixtures(): Promise<void> {
    const [unit, category] = await Promise.all([
      prisma.unitType.findFirst({ where: { code: 'kg' } }),
      prisma.category.findFirst({ where: { deletedAt: null } }),
    ]);

    expect(unit).not.toBeNull();
    expect(category).not.toBeNull();

    unitTypeId = (unit as { id: string }).id;

    const product = await prisma.product.create({
      data: {
        name: `${PREFIX} Ürün`,
        slug: `e2e-stok-urun-${Date.now()}`,
        isActive: true,
        isPublished: true,
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
      },
      select: { id: true },
    });

    productId = product.id;

    const customer = await api()
      .post('/api/v1/admin/customers')
      .set(auth())
      .send({ fullName: `${PREFIX} Müşteri`, phone: '0532 910 00 01', creditLimit: '1000000' })
      .expect(HttpStatus.CREATED);

    customerId = customer.body.data.id;
  }

  async function cleanup(): Promise<void> {
    const customers = await prisma.customer.findMany({
      where: { OR: [{ fullName: { startsWith: PREFIX } }, { phone: { startsWith: '532910' } }] },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);

    if (customerIds.length > 0) {
      await prisma.payment.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.sale.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
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
      await prisma.user.deleteMany({ where: { email: { contains: '@zirvetarim.test' } } });
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE audit_logs ENABLE RULE audit_logs_no_delete');
    }
  }

  // =========================================================================
  // YARDIMCILAR
  // =========================================================================

  let skuCounter = 0;

  /** Testlerin kullandığı varyasyon alanları. */
  interface TestVariant {
    id: string;
    sku: string;
    stockQuantity: string;
    trackStock: boolean;
  }

  /** Belirtilen başlangıç stoğuyla bir varyasyon oluşturur (API üzerinden). */
  async function createVariant(overrides: Record<string, unknown> = {}): Promise<TestVariant> {
    skuCounter += 1;

    const response = await api()
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set(auth())
      .send({
        sku: `${PREFIX.toUpperCase()}-${skuCounter}`,
        unitTypeId,
        unitQuantity: '1',
        purchasePrice: '100',
        salePrice: '150',
        stockQuantity: '100',
        ...overrides,
      });

    expect(response.status).toBe(HttpStatus.CREATED);

    return response.body.data;
  }

  /** Varyasyonun güncel stoğunu okur. */
  async function stockOf(variantId: string): Promise<string> {
    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true },
    });

    return variant.stockQuantity.toString();
  }

  /** Varyasyonun hareketlerini eskiden yeniye döndürür. */
  async function movementsOf(variantId: string) {
    return prisma.stockMovement.findMany({
      where: { variantId },
      orderBy: { createdAt: 'asc' },
      select: {
        type: true,
        direction: true,
        quantity: true,
        previousStock: true,
        newStock: true,
        referenceType: true,
        referenceId: true,
        description: true,
        createdById: true,
      },
    });
  }

  /** Taslak satış oluşturur. */
  async function createSale(items: Record<string, unknown>[]): Promise<Record<string, unknown>> {
    const response = await api().post('/api/v1/admin/sales').set(auth()).send({
      customerId,
      saleDate: new Date().toISOString(),
      paymentType: 'CASH',
      items,
    });

    expect(response.status).toBe(HttpStatus.CREATED);

    return response.body.data;
  }

  const finalize = (saleId: string) =>
    api().post(`/api/v1/admin/sales/${saleId}/finalize`).set(auth());

  const adjust = (body: Record<string, unknown>) =>
    api().post('/api/v1/admin/stock/adjustment').set(auth()).send(body);

  // =========================================================================
  describe('VARYASYON OLUŞTURMA — açılış stoğu', () => {
    it('başlangıç stoğu INITIAL hareketi üretir', async () => {
      const variant = await createVariant({ stockQuantity: '250' });

      expect(variant.stockQuantity).toBe('250');

      const movements = await movementsOf(variant.id);

      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({
        type: 'INITIAL',
        direction: 'IN',
        referenceType: null,
      });
      expect(movements[0]?.quantity.toString()).toBe('250');
      expect(movements[0]?.previousStock.toString()).toBe('0');
      expect(movements[0]?.newStock.toString()).toBe('250');
      expect(movements[0]?.createdById).not.toBeNull();
    });

    it('başlangıç stoğu 0 ise hareket yazılmaz', async () => {
      const variant = await createVariant({ stockQuantity: '0' });

      expect(await movementsOf(variant.id)).toHaveLength(0);
      expect(await stockOf(variant.id)).toBe('0');
    });

    it('stok, varyasyon güncelleme ucundan DEĞİŞTİRİLEMEZ', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      const response = await api()
        .patch(`/api/v1/admin/products/${productId}/variants/${variant.id}`)
        .set(auth())
        .send({ stockQuantity: '9999' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('stockQuantity');
      expect(await stockOf(variant.id)).toBe('10');
    });

    it('diğer alanların güncellenmesi stoğu bozmaz', async () => {
      const variant = await createVariant({ stockQuantity: '77' });

      await api()
        .patch(`/api/v1/admin/products/${productId}/variants/${variant.id}`)
        .set(auth())
        .send({ salePrice: '199', lowStockThreshold: '5' })
        .expect(HttpStatus.OK);

      expect(await stockOf(variant.id)).toBe('77');
    });
  });

  // =========================================================================
  describe('SATIŞ ENTEGRASYONU', () => {
    it('finalize stoğu düşürür ve SALE hareketi yazar', async () => {
      const variant = await createVariant({ stockQuantity: '100' });
      const sale = await createSale([{ variantId: variant.id, quantity: '30' }]);

      // TASLAK satış stoğu bloke ETMEZ.
      expect(await stockOf(variant.id)).toBe('100');

      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(await stockOf(variant.id)).toBe('70');

      const movements = await movementsOf(variant.id);
      const sold = movements[movements.length - 1];

      expect(sold).toMatchObject({
        type: 'SALE',
        direction: 'OUT',
        referenceType: 'SALE',
        referenceId: sale.id,
      });
      expect(sold?.quantity.toString()).toBe('30');
      expect(sold?.previousStock.toString()).toBe('100');
      expect(sold?.newStock.toString()).toBe('70');
      expect(sold?.description).toContain('SAT-');
    });

    it('çok kalemli satışta her kalem için ayrı hareket yazılır', async () => {
      const first = await createVariant({ stockQuantity: '50' });
      const second = await createVariant({ stockQuantity: '80' });

      const sale = await createSale([
        { variantId: first.id, quantity: '10' },
        { variantId: second.id, quantity: '25' },
      ]);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(await stockOf(first.id)).toBe('40');
      expect(await stockOf(second.id)).toBe('55');

      const linked = await prisma.stockMovement.count({
        where: { referenceType: 'SALE', referenceId: sale.id as string },
      });

      expect(linked).toBe(2);
    });

    it('AYNI varyasyon iki kalemde geçerse stok TOPLAM kadar düşer', async () => {
      const variant = await createVariant({ stockQuantity: '100' });

      const sale = await createSale([
        { variantId: variant.id, quantity: '30' },
        { variantId: variant.id, quantity: '25', unitSalePrice: '140' },
      ]);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(await stockOf(variant.id)).toBe('45');
    });

    it('iptal SALE_CANCEL ile stoğu geri ekler', async () => {
      const variant = await createVariant({ stockQuantity: '100' });
      const sale = await createSale([{ variantId: variant.id, quantity: '40' }]);

      await finalize(sale.id as string).expect(HttpStatus.OK);
      expect(await stockOf(variant.id)).toBe('60');

      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Müşteri vazgeçti' })
        .expect(HttpStatus.OK);

      expect(await stockOf(variant.id)).toBe('100');

      const movements = await movementsOf(variant.id);
      const returned = movements[movements.length - 1];

      expect(returned).toMatchObject({
        type: 'SALE_CANCEL',
        direction: 'IN',
        referenceType: 'SALE',
        referenceId: sale.id,
      });
      expect(returned?.previousStock.toString()).toBe('60');
      expect(returned?.newStock.toString()).toBe('100');
    });

    it('TASLAK satış iptali stok hareketi ÜRETMEZ', async () => {
      const variant = await createVariant({ stockQuantity: '100' });
      const sale = await createSale([{ variantId: variant.id, quantity: '40' }]);

      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Yanlış giriş' })
        .expect(HttpStatus.OK);

      // Hiç düşmemiş stok geri eklenirse envanter şişer.
      expect(await stockOf(variant.id)).toBe('100');
      expect(await movementsOf(variant.id)).toHaveLength(1); // yalnız INITIAL
    });

    it('stok takibi KAPALI varyasyonda hareket yazılmaz ve satış geçer', async () => {
      const variant = await createVariant({ stockQuantity: '0', trackStock: false });
      const sale = await createSale([{ variantId: variant.id, quantity: '9999' }]);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(await movementsOf(variant.id)).toHaveLength(0);
    });
  });

  // =========================================================================
  describe('YETERSİZ STOK — negatif stok engelli (§13.4)', () => {
    it('yetersiz stokta finalize REDDEDİLİR ve satış DRAFT kalır', async () => {
      const variant = await createVariant({ stockQuantity: '5' });
      const sale = await createSale([{ variantId: variant.id, quantity: '10' }]);

      const response = await finalize(sale.id as string);

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');

      // Transaction geri alındı: ne durum ne stok değişti.
      const after = await prisma.sale.findUniqueOrThrow({
        where: { id: sale.id as string },
        select: { status: true, confirmedAt: true },
      });

      expect(after.status).toBe('DRAFT');
      expect(after.confirmedAt).toBeNull();
      expect(await stockOf(variant.id)).toBe('5');
      expect(await movementsOf(variant.id)).toHaveLength(1); // yalnız INITIAL
    });

    it('hata yanıtı EKSİK KALEMLERİN TAMAMINI ve mevcut stokları listeler', async () => {
      const first = await createVariant({ stockQuantity: '2' });
      const second = await createVariant({ stockQuantity: '80' });
      const third = await createVariant({ stockQuantity: '1' });

      const sale = await createSale([
        { variantId: first.id, quantity: '10' },
        { variantId: second.id, quantity: '5' },
        { variantId: third.id, quantity: '4' },
      ]);

      const response = await finalize(sale.id as string);

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);

      const details = response.body.error.details as {
        field: string;
        message: string;
        context: Record<string, string>;
      }[];

      // İlk eksik kalemde durulmaz; yeterli olan kalem listede yer almaz.
      expect(details).toHaveLength(2);

      const byVariant = new Map(details.map((detail) => [detail.context.variantId, detail]));

      expect(byVariant.get(first.id)?.context).toMatchObject({
        sku: first.sku,
        requested: '10',
        available: '2',
        missing: '8',
      });
      expect(byVariant.get(third.id)?.context).toMatchObject({
        requested: '4',
        available: '1',
        missing: '3',
      });
      expect(byVariant.has(second.id)).toBe(false);

      // Mesaj insan içindir; makine `context`'i okur.
      expect(byVariant.get(first.id)?.message).toContain(first.sku);
      expect(details.every((detail) => detail.field.startsWith('items['))).toBe(true);

      // Hiçbir kalem düşmedi.
      expect(await stockOf(second.id)).toBe('80');
    });

    it('stoğun TAMAMI satılabilir (sınır dahil)', async () => {
      const variant = await createVariant({ stockQuantity: '12' });
      const sale = await createSale([{ variantId: variant.id, quantity: '12' }]);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(await stockOf(variant.id)).toBe('0');
    });

    it('veritabanı kısıtı negatif stoğu son savunmada engeller', async () => {
      const variant = await createVariant({ stockQuantity: '3' });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE product_variants SET "stockQuantity" = -1 WHERE id = '${variant.id}'`,
        ),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  describe('EŞZAMANLILIK — satır kilidi (K-66)', () => {
    it('EŞZAMANLI iki finalize aşırı satış yapamaz', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      // İki satışın toplamı stoğu aşıyor: 8 + 8 > 10.
      const [first, second] = await Promise.all([
        createSale([{ variantId: variant.id, quantity: '8' }]),
        createSale([{ variantId: variant.id, quantity: '8' }]),
      ]);

      const responses = await Promise.all([
        finalize(first.id as string),
        finalize(second.id as string),
      ]);

      const succeeded = responses.filter((r) => r.status === HttpStatus.OK);
      const rejected = responses.filter((r) => r.status === HttpStatus.UNPROCESSABLE_ENTITY);

      // Kilit olmasaydı iki transaction da "10 var" okur ve ikisi de geçerdi.
      expect(succeeded).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.body.error.code).toBe('INSUFFICIENT_STOCK');

      expect(await stockOf(variant.id)).toBe('2');

      const saleMovements = await prisma.stockMovement.count({
        where: { variantId: variant.id, type: 'SALE' },
      });

      expect(saleMovements).toBe(1);
    });

    it('EŞZAMANLI beş finalize stoğu tam olarak tüketir', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      const sales = await Promise.all(
        Array.from({ length: 5 }, () => createSale([{ variantId: variant.id, quantity: '4' }])),
      );

      const responses = await Promise.all(sales.map((sale) => finalize(sale.id as string)));
      const succeeded = responses.filter((r) => r.status === HttpStatus.OK);

      // 10 / 4 -> en fazla iki satış geçebilir.
      expect(succeeded).toHaveLength(2);
      expect(await stockOf(variant.id)).toBe('2');
    });
  });

  // =========================================================================
  describe('ZİNCİR TUTARLILIĞI — previousStock / newStock', () => {
    it('hareket zinciri kesintisiz ilerler', async () => {
      const variant = await createVariant({ stockQuantity: '100' });

      const sale = await createSale([{ variantId: variant.id, quantity: '30' }]);
      await finalize(sale.id as string).expect(HttpStatus.OK);

      await adjust({
        variantId: variant.id,
        type: 'PURCHASE',
        quantity: '50',
        description: 'Tedarikçiden mal girişi',
      }).expect(HttpStatus.CREATED);

      await adjust({
        variantId: variant.id,
        type: 'WASTE',
        quantity: '5',
        description: 'Çuval yırtıldı',
      }).expect(HttpStatus.CREATED);

      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'İade' })
        .expect(HttpStatus.OK);

      const movements = await movementsOf(variant.id);

      expect(movements.map((m) => m.type)).toEqual([
        'INITIAL',
        'SALE',
        'PURCHASE',
        'WASTE',
        'SALE_CANCEL',
      ]);

      // Her hareketin previousStock'u bir öncekinin newStock'una eşit olmalı;
      // ilk hareket sıfırdan başlar.
      let expectedPrevious = new Prisma.Decimal(0);

      for (const movement of movements) {
        expect(movement.previousStock.toString()).toBe(expectedPrevious.toString());

        const computed =
          movement.direction === 'IN'
            ? movement.previousStock.plus(movement.quantity)
            : movement.previousStock.minus(movement.quantity);

        expect(movement.newStock.toString()).toBe(computed.toString());
        expectedPrevious = movement.newStock;
      }

      // Zincirin son halkası varyasyonun güncel stoğudur.
      expect(await stockOf(variant.id)).toBe(expectedPrevious.toString());
      expect(await stockOf(variant.id)).toBe('145');
    });

    it('veritabanı kısıtı tutarsız zinciri reddeder', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO stock_movements (id, "variantId", "productId", type, direction, quantity, "previousStock", "newStock", "createdAt")
           VALUES (gen_random_uuid(), '${variant.id}', '${productId}', 'MANUAL_IN', 'IN', 5, 10, 99, NOW())`,
        ),
      ).rejects.toThrow();
    });

    it('hareket kaydı GÜNCELLENEMEZ ve SİLİNEMEZ (K-63)', async () => {
      const variant = await createVariant({ stockQuantity: '10' });
      const [movement] = await prisma.stockMovement.findMany({ where: { variantId: variant.id } });

      expect(movement).toBeDefined();

      // RULE ... DO INSTEAD NOTHING: işlem hata vermez, hiçbir satırı etkilemez.
      const updated = await prisma.$executeRawUnsafe(
        `UPDATE stock_movements SET quantity = 1 WHERE id = '${movement?.id ?? ''}'`,
      );
      const deleted = await prisma.$executeRawUnsafe(
        `DELETE FROM stock_movements WHERE id = '${movement?.id ?? ''}'`,
      );

      expect(updated).toBe(0);
      expect(deleted).toBe(0);

      const still = await prisma.stockMovement.findUnique({ where: { id: movement?.id ?? '' } });

      expect(still?.quantity.toString()).toBe('10');
    });
  });

  // =========================================================================
  describe('STOK DÜZELTME UCU', () => {
    it('giriş hareketi stoğu artırır', async () => {
      const variant = await createVariant({ stockQuantity: '20' });

      const response = await adjust({
        variantId: variant.id,
        type: 'MANUAL_IN',
        quantity: '15',
        description: 'Depoda bulundu',
      }).expect(HttpStatus.CREATED);

      expect(response.body.data.direction).toBe('IN');
      expect(response.body.data.previousStock).toBe('20');
      expect(response.body.data.newStock).toBe('35');
      expect(await stockOf(variant.id)).toBe('35');
    });

    it('çıkış hareketi stoğu azaltır', async () => {
      const variant = await createVariant({ stockQuantity: '20' });

      await adjust({
        variantId: variant.id,
        type: 'MANUAL_OUT',
        quantity: '8',
        description: 'Numune verildi',
      }).expect(HttpStatus.CREATED);

      expect(await stockOf(variant.id)).toBe('12');
    });

    it('mevcudu aşan çıkış REDDEDİLİR', async () => {
      const variant = await createVariant({ stockQuantity: '4' });

      const response = await adjust({
        variantId: variant.id,
        type: 'DAMAGE',
        quantity: '9',
        description: 'Depo su aldı',
      });

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(await stockOf(variant.id)).toBe('4');
    });

    it('AÇIKLAMA zorunludur', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      await adjust({ variantId: variant.id, type: 'MANUAL_IN', quantity: '1' }).expect(
        HttpStatus.BAD_REQUEST,
      );
      await adjust({
        variantId: variant.id,
        type: 'MANUAL_IN',
        quantity: '1',
        description: '   ',
      }).expect(HttpStatus.BAD_REQUEST);
    });

    it('SATIŞ hareketleri elle girilemez', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      for (const type of ['SALE', 'SALE_CANCEL']) {
        const response = await adjust({
          variantId: variant.id,
          type,
          quantity: '1',
          description: 'Elle satış denemesi',
        });

        expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      }
    });

    it('sıfır ve negatif miktar reddedilir', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      await adjust({
        variantId: variant.id,
        type: 'MANUAL_IN',
        quantity: '0',
        description: 'Sıfır',
      }).expect(HttpStatus.BAD_REQUEST);

      await adjust({
        variantId: variant.id,
        type: 'MANUAL_IN',
        quantity: '-5',
        description: 'Negatif',
      }).expect(HttpStatus.BAD_REQUEST);
    });

    it('SAYIM DÜZELTMESİ: miktar sayılan stoktur, fark hesaplanır', async () => {
      const variant = await createVariant({ stockQuantity: '30' });

      // Sayımda 24 çıktı -> 6 birim eksik.
      const shortage = await adjust({
        variantId: variant.id,
        type: 'INVENTORY_ADJUSTMENT',
        quantity: '24',
        description: 'Yıl sonu sayımı',
      }).expect(HttpStatus.CREATED);

      expect(shortage.body.data.direction).toBe('OUT');
      expect(shortage.body.data.quantity).toBe('6');
      expect(await stockOf(variant.id)).toBe('24');

      // Sayımda 31 çıktı -> 7 birim fazla.
      const surplus = await adjust({
        variantId: variant.id,
        type: 'INVENTORY_ADJUSTMENT',
        quantity: '31',
        description: 'Tekrar sayım',
      }).expect(HttpStatus.CREATED);

      expect(surplus.body.data.direction).toBe('IN');
      expect(surplus.body.data.quantity).toBe('7');
      expect(await stockOf(variant.id)).toBe('31');
    });

    it('sayım kayıtlı stokla aynıysa hareket yazılmaz', async () => {
      const variant = await createVariant({ stockQuantity: '30' });

      const response = await adjust({
        variantId: variant.id,
        type: 'INVENTORY_ADJUSTMENT',
        quantity: '30',
        description: 'Fark yok',
      });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(await movementsOf(variant.id)).toHaveLength(1);
    });

    it('FİRE, HASAR ve SAYIM yalnız SUPER_ADMIN tarafından girilebilir', async () => {
      const variant = await createVariant({ stockQuantity: '50' });

      for (const type of ['WASTE', 'DAMAGE', 'INVENTORY_ADJUSTMENT']) {
        const response = await api()
          .post('/api/v1/admin/stock/adjustment')
          .set(staffAuth())
          .send({ variantId: variant.id, type, quantity: '5', description: 'Yetki denemesi' });

        expect(response.status).toBe(HttpStatus.FORBIDDEN);
      }

      // ADMIN sıradan giriş/çıkış yapabilir.
      await api()
        .post('/api/v1/admin/stock/adjustment')
        .set(staffAuth())
        .send({
          variantId: variant.id,
          type: 'PURCHASE',
          quantity: '5',
          description: 'Alış girişi',
        })
        .expect(HttpStatus.CREATED);
    });

    it('düzeltme audit log’a yazılır', async () => {
      const variant = await createVariant({ stockQuantity: '10' });

      const response = await adjust({
        variantId: variant.id,
        type: 'MANUAL_OUT',
        quantity: '3',
        description: 'Denetim testi',
      }).expect(HttpStatus.CREATED);

      const logs = await prisma.auditLog.findMany({
        where: { entityId: response.body.data.id as string },
        select: { action: true, description: true },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe('STOCK_ADJUST');
      expect(logs[0]?.description).toContain('Denetim testi');
    });

    it('stok takibi kapalı varyasyona düzeltme yapılamaz', async () => {
      const variant = await createVariant({ stockQuantity: '0', trackStock: false });

      const response = await adjust({
        variantId: variant.id,
        type: 'MANUAL_IN',
        quantity: '5',
        description: 'Takip kapalı',
      });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('LİSTELER', () => {
    it('stok listesi varyasyon bazlıdır ve filtrelenebilir', async () => {
      const variant = await createVariant({ stockQuantity: '42' });

      const response = await api()
        .get(`/api/v1/admin/stock?productId=${productId}&search=${variant.sku}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].sku).toBe(variant.sku);
      expect(response.body.data[0].stockQuantity).toBe('42');
      expect(response.body.data[0].product.id).toBe(productId);
      expect(response.body.meta.lowStockCount).toBeDefined();
    });

    it('kritik stok listesi eşiğin altındakileri getirir', async () => {
      const critical = await createVariant({ stockQuantity: '5', lowStockThreshold: '10' });
      const healthy = await createVariant({ stockQuantity: '500', lowStockThreshold: '10' });

      const response = await api()
        .get('/api/v1/admin/stock/low-stock?limit=100')
        .set(auth())
        .expect(HttpStatus.OK);

      const skus = (response.body.data as { sku: string }[]).map((row) => row.sku);

      expect(skus).toContain(critical.sku);
      expect(skus).not.toContain(healthy.sku);
    });

    it('eşitlik de kritik sayılır (stok = eşik)', async () => {
      const variant = await createVariant({ stockQuantity: '10', lowStockThreshold: '10' });

      const response = await api()
        .get(`/api/v1/admin/stock/low-stock?limit=100&search=${variant.sku}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(response.body.data).toHaveLength(1);
    });

    it('hareket geçmişi tipe, varyasyona ve belgeye göre filtrelenir', async () => {
      const variant = await createVariant({ stockQuantity: '100' });
      const sale = await createSale([{ variantId: variant.id, quantity: '10' }]);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      const byVariant = await api()
        .get(`/api/v1/admin/stock/movements?variantId=${variant.id}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(byVariant.body.data).toHaveLength(2);
      expect(byVariant.body.data[0].previousStock).toBeDefined();
      expect(byVariant.body.data[0].newStock).toBeDefined();

      const byType = await api()
        .get(`/api/v1/admin/stock/movements?variantId=${variant.id}&type=SALE`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(byType.body.data).toHaveLength(1);
      expect(byType.body.data[0].type).toBe('SALE');

      const byReference = await api()
        .get(`/api/v1/admin/stock/movements?referenceType=SALE&referenceId=${sale.id as string}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(byReference.body.data).toHaveLength(1);
      expect(byReference.body.data[0].variant.sku).toBe(variant.sku);
    });

    it('stok uçları jetonsuz 401 döner', async () => {
      await api().get('/api/v1/admin/stock').expect(HttpStatus.UNAUTHORIZED);
      await api().get('/api/v1/admin/stock/low-stock').expect(HttpStatus.UNAUTHORIZED);
      await api().get('/api/v1/admin/stock/movements').expect(HttpStatus.UNAUTHORIZED);
      await api().post('/api/v1/admin/stock/adjustment').send({}).expect(HttpStatus.UNAUTHORIZED);
    });

    it('public ürün yanıtında stok hareketi ve maliyet bulunmaz', async () => {
      const response = await api().get('/api/v1/public/products?limit=20').expect(HttpStatus.OK);
      const body = JSON.stringify(response.body);

      expect(body).not.toContain('previousStock');
      expect(body).not.toContain('purchasePrice');
      expect(body).not.toContain('unitCost');
    });
  });
});
