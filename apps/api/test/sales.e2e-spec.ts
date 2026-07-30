import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';
import { FORBIDDEN_FINANCIAL_FIELDS } from '@zirve/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import { SaleCalculationService } from '../src/modules/sales/sale-calculation.service';
import { deleteProductsWithStockHistory } from './test-cleanup';

/**
 * Satış, ödeme, borç ve kâr zinciri uçtan uca testleri (Sprint 8).
 *
 * SPRİNTİN EN KRİTİK TESTLERİ:
 *   - kâr hesabı (indirimli / indirimsiz / çok kalemli)
 *   - kısmi ödeme -> PARTIALLY_PAID, tam ödeme -> PAID
 *   - fazla ödeme reddi, DRAFT/CANCELLED satışa ödeme reddi
 *   - SNAPSHOT DEĞİŞMEZLİĞİ (varyasyon fiyatı değişse eski kalem değişmez)
 *   - dönüşüm İDEMPOTENCY (eşzamanlı iki istek -> tek satış)
 *   - müşteri finans özeti doğruluğu
 *   - saklanan toplamların transaction tutarlılığı
 */
describe('Satış zinciri (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;
  let calculation: SaleCalculationService;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const SUPER = { email: 'sale.super@zirvetarim.test', password: 'SaleSuperSifre123' };
  const PREFIX = 'E2ESatis';

  let token = '';
  let customerId = '';
  let variantId = '';
  let productId = '';
  let secondVariantId = '';

  /** Test ürününün başlangıç fiyatları — snapshot testi bunlara dayanır. */
  const PURCHASE_PRICE = '100';
  const SALE_PRICE = '150';

  jest.setTimeout(180_000);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app, { apiPrefix: 'api/v1' });
    await app.init();

    calculation = app.get(SaleCalculationService);

    prisma = new PrismaClient();
    await prisma.$connect();

    await cleanup();

    await prisma.user.create({
      data: {
        email: SUPER.email,
        passwordHash: await hash(SUPER.password, ARGON2_OPTIONS),
        fullName: 'E2E Satış Yöneticisi',
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

  async function seedFixtures(): Promise<void> {
    const [unit, category] = await Promise.all([
      prisma.unitType.findFirst({ where: { code: 'kg' } }),
      prisma.category.findFirst({ where: { deletedAt: null } }),
    ]);

    expect(unit).not.toBeNull();
    expect(category).not.toBeNull();

    const product = await prisma.product.create({
      data: {
        name: `${PREFIX} Ürün`,
        slug: `e2e-satis-urun-${Date.now()}`,
        isActive: true,
        isPublished: true,
        categories: { create: { categoryId: (category as { id: string }).id, isPrimary: true } },
        variants: {
          create: [
            {
              sku: `${PREFIX}-V1`,
              unitTypeId: (unit as { id: string }).id,
              unitQuantity: '1',
              purchasePrice: PURCHASE_PRICE,
              salePrice: SALE_PRICE,
              minOrderQuantity: '1',
              quantityStep: '1',
              stockQuantity: '10000',
              isActive: true,
              isDefault: true,
              sortOrder: 0,
            },
            {
              sku: `${PREFIX}-V2`,
              unitTypeId: (unit as { id: string }).id,
              unitQuantity: '1',
              purchasePrice: '40',
              salePrice: '70',
              minOrderQuantity: '1',
              quantityStep: '1',
              stockQuantity: '10000',
              isActive: true,
              sortOrder: 1,
            },
          ],
        },
      },
      select: { id: true, variants: { select: { id: true, sku: true } } },
    });

    productId = product.id;
    variantId = (product.variants.find((v) => v.sku === `${PREFIX}-V1`) as { id: string }).id;
    secondVariantId = (product.variants.find((v) => v.sku === `${PREFIX}-V2`) as { id: string }).id;

    const customer = await api()
      .post('/api/v1/admin/customers')
      .set(auth())
      .send({
        fullName: `${PREFIX} Müşteri`,
        phone: '0532 900 00 01',
        city: 'Konya',
        district: 'Çumra',
        creditLimit: '100000',
      })
      .expect(HttpStatus.CREATED);

    customerId = customer.body.data.id;
  }

  async function cleanup(): Promise<void> {
    // Silme sırası FK'lara göre: ödemeler -> satışlar -> müşteriler.
    const customers = await prisma.customer.findMany({
      where: { OR: [{ fullName: { startsWith: PREFIX } }, { phone: { startsWith: '532900' } }] },
      select: { id: true },
    });
    const customerIds = customers.map((c) => c.id);

    if (customerIds.length > 0) {
      await prisma.payment.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.sale.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.inquiry.updateMany({
        where: { customerId: { in: customerIds } },
        data: { customerId: null },
      });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    }

    const inquiries = await prisma.inquiry.findMany({
      where: { contactName: { startsWith: PREFIX } },
      select: { id: true },
    });

    if (inquiries.length > 0) {
      const ids = inquiries.map((i) => i.id);
      await prisma.sale.deleteMany({ where: { inquiryId: { in: ids } } });
      await prisma.inquiry.deleteMany({ where: { id: { in: ids } } });
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

  /** Taslak satış oluşturur. */
  async function createSale(
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    const response = await api()
      .post('/api/v1/admin/sales')
      .set(auth())
      .send({
        customerId,
        saleDate: new Date().toISOString(),
        paymentType: 'CASH',
        items: [{ variantId, quantity: '10' }],
        ...overrides,
      });

    expect(response.status).toBe(HttpStatus.CREATED);

    return response.body.data;
  }

  /** Satışı onaylar. */
  const finalize = (saleId: string) =>
    api().post(`/api/v1/admin/sales/${saleId}/finalize`).set(auth());

  /** Satışa ödeme ekler. */
  const addPayment = (saleId: string, body: Record<string, unknown>) =>
    api()
      .post(`/api/v1/admin/sales/${saleId}/payments`)
      .set(auth())
      .send({ paymentDate: new Date().toISOString(), ...body });

  const getSale = async (saleId: string): Promise<Record<string, string>> => {
    const response = await api().get(`/api/v1/admin/sales/${saleId}`).set(auth());

    return response.body.data;
  };

  // =========================================================================
  /**
   * KDV KURALI (2026-07-30 kararı, şartname §9.1 "KDV bilgisi opsiyonel olabilir"):
   *
   *   oran > 0  -> satış fiyatı KDV DAHİLDİR, vergi ters hesapla ayrıştırılır
   *   oran = 0  -> kalem KDV'sizdir
   *
   * Bu bölüm uçtan uca doğrular: oran varyasyondan satış kalemine SNAPSHOT
   * olarak kopyalanır, `taxTotal` toplanır, `grandTotal` ETKİLENMEZ ve kâr
   * NET tutar üzerinden hesaplanır.
   */
  describe('KDV — girilirse dahil, girilmezse hariç', () => {
    let taxedVariantId = '';

    beforeAll(async () => {
      const unit = await prisma.unitType.findFirstOrThrow({ where: { code: 'ad' } });

      const variant = await prisma.productVariant.create({
        data: {
          productId,
          sku: `${PREFIX}-KDV`,
          unitTypeId: unit.id,
          unitQuantity: '1',
          purchasePrice: PURCHASE_PRICE,
          salePrice: SALE_PRICE,
          taxRate: '20',
          minOrderQuantity: '1',
          quantityStep: '1',
          stockQuantity: '10000',
          isActive: true,
          sortOrder: 2,
        },
        select: { id: true },
      });

      taxedVariantId = variant.id;
    });

    it('KDV oranı olmayan satışta taxTotal sıfırdır', async () => {
      const sale = await createSale();

      expect(sale.taxTotal).toBe('0');
    });

    it('oran girilmiş kalemde KDV ayrışır ama grandTotal DEĞİŞMEZ', async () => {
      // 10 x 150 = 1500 KDV dahil -> 1500 * 20 / 120 = 250 vergi
      const sale = await createSale({ items: [{ variantId: taxedVariantId, quantity: '10' }] });

      expect(sale.subtotal).toBe('1500');
      expect(sale.taxTotal).toBe('250');
      // Müşterinin ödediği tutar vergiden ETKİLENMEZ: vergi fiyatın içindedir.
      // Eklenseydi 1750 olurdu ve müşteriden vergi iki kez alınmış olurdu.
      expect(sale.grandTotal).toBe('1500');
    });

    it('kâr NET tutar üzerinden hesaplanır — KDV kâra yazılmaz', async () => {
      // net satış 1250, net maliyet 833.3333 -> kâr 416.6667
      // Ham fark 500 olurdu: kâr %20 şişerdi.
      const sale = await createSale({ items: [{ variantId: taxedVariantId, quantity: '10' }] });

      expect(sale.grossProfit).toBe('416.6667');
      expect(sale.grossProfit).not.toBe('500');
    });

    it('KDV oranı satış kalemine SNAPSHOT olarak yazılır', async () => {
      const sale = await createSale({ items: [{ variantId: taxedVariantId, quantity: '10' }] });

      const item = await prisma.saleItem.findFirstOrThrow({
        where: { saleId: sale.id as string },
        select: { taxRate: true, lineTax: true },
      });

      expect(item.taxRate.toString()).toBe('20');
      expect(item.lineTax.toString()).toBe('250');
    });

    /**
     * Kural 15/16: ürünün KDV oranı sonradan değişse bile GEÇMİŞ satış
     * değişmemelidir. Oran join'lenseydi eski faturaların vergisi bugünün
     * oranıyla yeniden hesaplanır ve muhasebe kaydı kendiliğinden değişirdi.
     */
    it('varyasyonun oranı sonradan değişse eski satış DEĞİŞMEZ', async () => {
      const sale = await createSale({ items: [{ variantId: taxedVariantId, quantity: '10' }] });

      await prisma.productVariant.update({
        where: { id: taxedVariantId },
        data: { taxRate: '1' },
      });

      const after = await getSale(sale.id as string);
      const item = await prisma.saleItem.findFirstOrThrow({
        where: { saleId: sale.id as string },
        select: { taxRate: true },
      });

      expect(item.taxRate.toString()).toBe('20');
      expect(after.taxTotal).toBe('250');

      // Sonraki testleri etkilememesi için geri al.
      await prisma.productVariant.update({
        where: { id: taxedVariantId },
        data: { taxRate: '20' },
      });
    });
  });

  // =========================================================================
  describe('KÂR HESABI', () => {
    it('indirimsiz tek kalem: (150-100) x 10 = 500', async () => {
      const sale = await createSale();

      expect(sale.subtotal).toBe('1500');
      expect(sale.grandTotal).toBe('1500');
      expect(sale.costTotal).toBe('1000');
      expect(sale.grossProfit).toBe('500');
      expect(sale.netProfit).toBe('500');
    });

    it('indirimli kalem: indirim doğrudan kârdan düşer', async () => {
      const sale = await createSale({
        items: [{ variantId, quantity: '10', discountAmount: '200' }],
      });

      expect(sale.subtotal).toBe('1500');
      expect(sale.discountTotal).toBe('200');
      expect(sale.grandTotal).toBe('1300');
      expect(sale.grossProfit).toBe('300');
    });

    it('çok kalemli satışta kârlar toplanır', async () => {
      // Kalem 1: (150-100) x 10 = 500
      // Kalem 2: (70-40)  x 20 = 600
      const sale = await createSale({
        items: [
          { variantId, quantity: '10' },
          { variantId: secondVariantId, quantity: '20' },
        ],
      });

      expect(sale.subtotal).toBe('2900');
      expect(sale.costTotal).toBe('1800');
      expect(sale.grossProfit).toBe('1100');
    });

    it('pazarlık fiyatı uygulanabilir ve kâr ona göre hesaplanır', async () => {
      // Liste 150 yerine 120'ye satış: (120-100) x 10 = 200
      const sale = await createSale({
        items: [{ variantId, quantity: '10', unitSalePrice: '120' }],
      });

      expect(sale.grandTotal).toBe('1200');
      expect(sale.grossProfit).toBe('200');
    });

    it('zararına satışta kâr NEGATİF döner', async () => {
      const sale = await createSale({
        items: [{ variantId, quantity: '10', unitSalePrice: '80' }],
      });

      expect(sale.grossProfit).toBe('-200');
    });

    it("ek maliyet netProfit'i düşürür, grandTotal'ı etkilemez", async () => {
      const sale = await createSale();

      const withCost = await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/additional-costs`)
        .set(auth())
        .send({ costType: 'SHIPPING', amount: '150', description: 'Nakliye' })
        .expect(HttpStatus.CREATED);

      expect(withCost.body.data.grandTotal).toBe('1500');
      expect(withCost.body.data.grossProfit).toBe('500');
      expect(withCost.body.data.additionalCostTotal).toBe('150');
      expect(withCost.body.data.netProfit).toBe('350');
    });

    it('ek maliyet kaldırılınca netProfit geri döner', async () => {
      const sale = await createSale();

      const added = await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/additional-costs`)
        .set(auth())
        .send({ costType: 'FREIGHT', amount: '200' })
        .expect(HttpStatus.CREATED);

      const costId = added.body.data.additionalCosts[0].id as string;

      const removed = await api()
        .delete(`/api/v1/admin/sales/${sale.id as string}/additional-costs/${costId}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(removed.body.data.additionalCostTotal).toBe('0');
      expect(removed.body.data.netProfit).toBe('500');
    });

    it('indirim satır tutarını aşarsa reddedilir', async () => {
      const response = await api()
        .post('/api/v1/admin/sales')
        .set(auth())
        .send({
          customerId,
          saleDate: new Date().toISOString(),
          paymentType: 'CASH',
          items: [{ variantId, quantity: '1', discountAmount: '99999' }],
        });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('items[0].discountAmount');
    });
  });

  // =========================================================================
  describe('ÖDEME VE DURUM GEÇİŞLERİ', () => {
    it('taslak satışa ödeme eklenemez', async () => {
      const sale = await createSale();
      const response = await addPayment(sale.id as string, { method: 'CASH', amount: '100' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('Taslak');
    });

    it('kısmi ödeme -> PARTIALLY_PAID', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      await addPayment(sale.id as string, { method: 'CASH', amount: '500' }).expect(
        HttpStatus.CREATED,
      );

      const updated = await getSale(sale.id as string);

      expect(updated.status).toBe('PARTIALLY_PAID');
      expect(updated.paidTotal).toBe('500');
      expect(updated.remainingTotal).toBe('1000');
    });

    it('tam ödeme -> PAID', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      await addPayment(sale.id as string, { method: 'CASH', amount: '1500' }).expect(
        HttpStatus.CREATED,
      );

      const updated = await getSale(sale.id as string);

      expect(updated.status).toBe('PAID');
      expect(updated.remainingTotal).toBe('0');
    });

    it('birden çok kısmi ödeme toplanır ve sonunda PAID olur', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      await addPayment(sale.id as string, { method: 'CASH', amount: '600' });
      await addPayment(sale.id as string, { method: 'BANK_TRANSFER', amount: '400' });

      let updated = await getSale(sale.id as string);
      expect(updated.status).toBe('PARTIALLY_PAID');
      expect(updated.paidTotal).toBe('1000');

      await addPayment(sale.id as string, { method: 'CASH', amount: '500' });

      updated = await getSale(sale.id as string);
      expect(updated.status).toBe('PAID');
      expect(updated.paidTotal).toBe('1500');
    });

    it('FAZLA ödeme reddedilir', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      const response = await addPayment(sale.id as string, { method: 'CASH', amount: '1500.01' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.message).toContain('kalan borcu aşamaz');
    });

    it('kısmi ödeme sonrası kalanı aşan ödeme reddedilir', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);
      await addPayment(sale.id as string, { method: 'CASH', amount: '1000' });

      const response = await addPayment(sale.id as string, { method: 'CASH', amount: '501' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('sıfır ve negatif tutar reddedilir', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      await addPayment(sale.id as string, { method: 'CASH', amount: '0' }).expect(
        HttpStatus.BAD_REQUEST,
      );
      await addPayment(sale.id as string, { method: 'CASH', amount: '-100' }).expect(
        HttpStatus.BAD_REQUEST,
      );
    });

    it('İPTAL edilmiş satışa ödeme eklenemez', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);
      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Müşteri vazgeçti' })
        .expect(HttpStatus.OK);

      const response = await addPayment(sale.id as string, { method: 'CASH', amount: '100' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('İptal');
    });

    it('çek ve senette vade tarihi zorunludur', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      await addPayment(sale.id as string, { method: 'CHECK', amount: '100' }).expect(
        HttpStatus.BAD_REQUEST,
      );

      await addPayment(sale.id as string, {
        method: 'CHECK',
        amount: '100',
        dueDate: new Date(Date.now() + 86_400_000).toISOString(),
      }).expect(HttpStatus.CREATED);
    });

    it('ödeme silinince borç yeniden doğar ve durum geri döner', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      const payment = await addPayment(sale.id as string, {
        method: 'CASH',
        amount: '1500',
      }).expect(HttpStatus.CREATED);

      expect((await getSale(sale.id as string)).status).toBe('PAID');

      await api()
        .delete(`/api/v1/admin/payments/${payment.body.data.id as string}`)
        .set(auth())
        .send({ reason: 'Yanlış tutar girildi' })
        .expect(HttpStatus.NO_CONTENT);

      const updated = await getSale(sale.id as string);

      expect(updated.status).toBe('CONFIRMED');
      expect(updated.paidTotal).toBe('0');
      expect(updated.remainingTotal).toBe('1500');
    });

    it('ödeme silmede gerekçe zorunludur', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);
      const payment = await addPayment(sale.id as string, { method: 'CASH', amount: '100' });

      await api()
        .delete(`/api/v1/admin/payments/${payment.body.data.id as string}`)
        .set(auth())
        .send({})
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('SATIŞ DURUM MAKİNESİ', () => {
    it('yalnız taslak satış düzenlenebilir', async () => {
      const sale = await createSale();

      await api()
        .patch(`/api/v1/admin/sales/${sale.id as string}`)
        .set(auth())
        .send({ note: 'Taslakta düzenleme' })
        .expect(HttpStatus.OK);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      const response = await api()
        .patch(`/api/v1/admin/sales/${sale.id as string}`)
        .set(auth())
        .send({ note: 'Onaylandıktan sonra' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.message).toContain('taslak');
    });

    it('kalem değişikliği toplamları yeniden hesaplar', async () => {
      const sale = await createSale();

      const updated = await api()
        .patch(`/api/v1/admin/sales/${sale.id as string}`)
        .set(auth())
        .send({ items: [{ variantId, quantity: '4' }] })
        .expect(HttpStatus.OK);

      expect(updated.body.data.grandTotal).toBe('600');
      expect(updated.body.data.grossProfit).toBe('200');
    });

    it('aynı satış iki kez onaylanamaz', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      const response = await finalize(sale.id as string);

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('iptalde gerekçe zorunludur', async () => {
      const sale = await createSale();

      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({})
        .expect(HttpStatus.BAD_REQUEST);

      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Yanlış müşteri' })
        .expect(HttpStatus.OK);
    });

    it('TAMAMI ÖDENMİŞ satış iptal edilemez', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);
      await addPayment(sale.id as string, { method: 'CASH', amount: '1500' });

      const response = await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Deneme' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].message).toContain('Önce ödemeyi silin');
    });

    it('vadeli satışta vade tarihi zorunludur', async () => {
      const response = await api()
        .post('/api/v1/admin/sales')
        .set(auth())
        .send({
          customerId,
          saleDate: new Date().toISOString(),
          paymentType: 'CREDIT',
          items: [{ variantId, quantity: '1' }],
        });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('dueDate');
    });

    it('satış SİLME ucu yoktur (Kural 4)', async () => {
      const sale = await createSale();

      await api()
        .delete(`/api/v1/admin/sales/${sale.id as string}`)
        .set(auth())
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  // =========================================================================
  describe('SNAPSHOT DEĞİŞMEZLİĞİ — Kural 5', () => {
    it('varyasyon fiyatı değişse eski satış kalemleri DEĞİŞMEZ', async () => {
      const sale = await createSale({ items: [{ variantId, quantity: '10' }] });

      expect(sale.grossProfit).toBe('500');

      // Varyasyonun alış ve satış fiyatı sonradan değiştirilir.
      await api()
        .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
        .set(auth())
        .send({ purchasePrice: '130', salePrice: '250' })
        .expect(HttpStatus.OK);

      const after = await getSale(sale.id as string);
      const item = (after as unknown as { items: Record<string, string>[] }).items[0];

      expect(item?.unitPurchasePrice).toBe('100');
      expect(item?.unitSalePrice).toBe('150');
      expect(item?.lineProfit).toBe('500');
      expect(after.grossProfit).toBe('500');

      // Fiyatları geri al: sonraki testler başlangıç fiyatlarına dayanıyor.
      await api()
        .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
        .set(auth())
        .send({ purchasePrice: PURCHASE_PRICE, salePrice: SALE_PRICE })
        .expect(HttpStatus.OK);
    });

    it('yeni satış GÜNCEL fiyatı kullanır', async () => {
      await api()
        .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
        .set(auth())
        .send({ purchasePrice: '120', salePrice: '200' })
        .expect(HttpStatus.OK);

      const sale = await createSale({ items: [{ variantId, quantity: '10' }] });

      // (200-120) x 10 = 800
      expect(sale.grandTotal).toBe('2000');
      expect(sale.grossProfit).toBe('800');

      await api()
        .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
        .set(auth())
        .send({ purchasePrice: PURCHASE_PRICE, salePrice: SALE_PRICE })
        .expect(HttpStatus.OK);
    });

    it('alış fiyatı İSTEMCİDEN alınmaz', async () => {
      // Gövdede unitPurchasePrice gönderilirse whitelist onu atar
      // (forbidNonWhitelisted ile 400 döner). Kâr manipüle edilemez.
      const response = await api()
        .post('/api/v1/admin/sales')
        .set(auth())
        .send({
          customerId,
          saleDate: new Date().toISOString(),
          paymentType: 'CASH',
          items: [{ variantId, quantity: '1', unitPurchasePrice: '1' }],
        });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('SAKLANAN TOPLAMLARIN TUTARLILIĞI', () => {
    it('her mutasyondan sonra saklanan toplamlar kalemlerle tutarlı', async () => {
      const sale = await createSale({
        items: [
          { variantId, quantity: '7', discountAmount: '50' },
          { variantId: secondVariantId, quantity: '3' },
        ],
      });
      const saleId = sale.id as string;

      const assertConsistent = async (label: string): Promise<void> => {
        const report = await calculation.verifyConsistency(prisma, saleId);

        expect(report.mismatches).toEqual([]);
        expect(report.isConsistent).toBe(true);
        expect(label).toBeDefined();
      };

      await assertConsistent('oluşturma');

      await api()
        .patch(`/api/v1/admin/sales/${saleId}`)
        .set(auth())
        .send({ items: [{ variantId, quantity: '9' }] })
        .expect(HttpStatus.OK);
      await assertConsistent('kalem güncelleme');

      await finalize(saleId).expect(HttpStatus.OK);
      await assertConsistent('onaylama');

      await addPayment(saleId, { method: 'CASH', amount: '400' }).expect(HttpStatus.CREATED);
      await assertConsistent('kısmi ödeme');

      await api()
        .post(`/api/v1/admin/sales/${saleId}/additional-costs`)
        .set(auth())
        .send({ costType: 'LABOR', amount: '75' })
        .expect(HttpStatus.CREATED);
      await assertConsistent('ek maliyet');

      const payment = await addPayment(saleId, { method: 'CASH', amount: '950' });
      await assertConsistent('tam ödeme');

      await api()
        .delete(`/api/v1/admin/payments/${payment.body.data.id as string}`)
        .set(auth())
        .send({ reason: 'Tutarlılık testi' })
        .expect(HttpStatus.NO_CONTENT);
      await assertConsistent('ödeme silme');
    });

    it('veritabanı kısıtı remainingTotal bozulmasını engeller', async () => {
      const sale = await createSale();

      // Kısıt: remainingTotal = grandTotal - paidTotal
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE sales SET "remainingTotal" = 1 WHERE id = '${sale.id as string}'`,
        ),
      ).rejects.toThrow();
    });

    it('veritabanı kısıtı ödemenin toplamı aşmasını engeller', async () => {
      const sale = await createSale();

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE sales SET "paidTotal" = 99999, "remainingTotal" = ${-99999 + 1500} WHERE id = '${sale.id as string}'`,
        ),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  describe('MÜŞTERİ FİNANS ÖZETİ', () => {
    it('taslak satış borç doğurmaz', async () => {
      const before = await financeSummary();
      await createSale();
      const after = await financeSummary();

      expect(after.totalSales).toBe(before.totalSales);
      expect(after.currentDebt).toBe(before.currentDebt);
    });

    it('onaylanan satış borcu artırır, ödeme azaltır', async () => {
      const before = await financeSummary();
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      const afterSale = await financeSummary();

      expect(diff(afterSale.totalSales, before.totalSales)).toBe('1500');
      expect(diff(afterSale.currentDebt, before.currentDebt)).toBe('1500');

      await addPayment(sale.id as string, { method: 'CASH', amount: '600' });

      const afterPayment = await financeSummary();

      expect(diff(afterPayment.totalPaid, before.totalPaid)).toBe('600');
      expect(diff(afterPayment.currentDebt, before.currentDebt)).toBe('900');
    });

    it('iptal edilen satış borçtan düşer', async () => {
      const before = await financeSummary();
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(diff((await financeSummary()).currentDebt, before.currentDebt)).toBe('1500');

      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Test iptali' })
        .expect(HttpStatus.OK);

      expect((await financeSummary()).currentDebt).toBe(before.currentDebt);
    });

    it('vadesi geçmiş borç ayrı raporlanır', async () => {
      const sale = await createSale({
        paymentType: 'CREDIT',
        // Vade GEÇMİŞTE: vadesi geçmiş borç sayılmalı.
        dueDate: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      });
      await finalize(sale.id as string).expect(HttpStatus.OK);

      const summary = await financeSummary();

      expect(new Prisma.Decimal(summary.overdueDebt ?? 0).greaterThanOrEqualTo(1500)).toBe(true);
    });

    it('borcu olan müşteri silinemez', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      const response = await api().delete(`/api/v1/admin/customers/${customerId}`).set(auth());

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.message).toContain('Borcu olan müşteri');
    });

    it('mükerrer telefon ENGELLEMEZ, uyarır (Sprint 7 şartı 2)', async () => {
      const response = await api()
        .post('/api/v1/admin/customers')
        .set(auth())
        .send({ fullName: `${PREFIX} Kopya`, phone: '0532 900 00 01' });

      // Aynı hattı paylaşan iki müşteri gerçek bir durumdur; kayıt açılır.
      expect(response.status).toBe(HttpStatus.CREATED);
      expect(response.body.data.warnings[0].code).toBe('DUPLICATE_PHONE');
      expect(response.body.data.warnings[0].field).toBe('phone');
    });
  });

  // =========================================================================
  describe('TALEP -> SATIŞ DÖNÜŞÜMÜ', () => {
    /** Dönüştürülebilir bir talep oluşturur. */
    async function createInquiry(): Promise<string> {
      const inquiry = await prisma.inquiry.create({
        data: {
          inquiryNumber: `TLP-2026-9${Math.floor(Math.random() * 100_000)
            .toString()
            .padStart(5, '0')}`,
          contactName: `${PREFIX} Talep Sahibi`,
          contactPhone: '5329000002',
          city: 'Konya',
          district: 'Çumra',
          consentAccepted: true,
          consentAt: new Date(),
          items: {
            create: {
              variantId,
              productId,
              productNameSnapshot: `${PREFIX} Ürün`,
              skuSnapshot: `${PREFIX}-V1`,
              unitTypeSnapshot: 'Kilogram',
              unitQuantitySnapshot: '1',
              quantity: '10',
            },
          },
        },
        select: { id: true },
      });

      return inquiry.id;
    }

    it('talep kalemleri satışa aktarılır ve müşteri oluşturulur', async () => {
      const inquiryId = await createInquiry();

      const response = await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH' })
        .expect(HttpStatus.CREATED);

      expect(response.body.data.status).toBe('DRAFT');
      expect(response.body.data.grandTotal).toBe('1500');
      expect(response.body.data.grossProfit).toBe('500');
      expect(response.body.data.customer.fullName).toContain(PREFIX);
      expect(response.body.data.inquiry.status).toBe('CONVERTED_TO_SALE');
    });

    it('talep durumu ve geçmişi güncellenir', async () => {
      const inquiryId = await createInquiry();

      await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH' })
        .expect(HttpStatus.CREATED);

      const inquiry = await api().get(`/api/v1/admin/inquiries/${inquiryId}`).set(auth());

      expect(inquiry.body.data.status).toBe('CONVERTED_TO_SALE');
      expect(inquiry.body.data.statusHistories[0].toStatus).toBe('CONVERTED_TO_SALE');
      expect(inquiry.body.data.statusHistories[0].note).toContain('SAT-');
    });

    it('miktar ve fiyat dönüşümde düzenlenebilir', async () => {
      const inquiryId = await createInquiry();

      const response = await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({
          paymentType: 'CASH',
          items: [{ variantId, quantity: '8', unitSalePrice: '140', discountAmount: '20' }],
        })
        .expect(HttpStatus.CREATED);

      // 8 x 140 = 1120 - 20 = 1100 | maliyet 800 | kâr 300
      expect(response.body.data.grandTotal).toBe('1100');
      expect(response.body.data.grossProfit).toBe('300');
    });

    it('mevcut müşteri seçilebilir', async () => {
      const inquiryId = await createInquiry();

      const response = await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH', customerId })
        .expect(HttpStatus.CREATED);

      expect(response.body.data.customer.id).toBe(customerId);
    });

    it('İDEMPOTENCY: ikinci dönüşüm denemesi reddedilir', async () => {
      const inquiryId = await createInquiry();

      await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH' })
        .expect(HttpStatus.CREATED);

      const second = await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH' });

      expect(second.status).toBe(HttpStatus.CONFLICT);
      expect(second.body.error.details[0].message).toContain('Mevcut satış');
    });

    it('İDEMPOTENCY: EŞZAMANLI istekler tek satış üretir', async () => {
      const inquiryId = await createInquiry();

      // Uygulama kontrolü tek başına yetmez; gerçek güvence
      // `sales.inquiryId` UNIQUE kısıtıdır.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          api()
            .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
            .set(auth())
            .send({ paymentType: 'CASH' }),
        ),
      );

      const created = responses.filter((r) => r.status === HttpStatus.CREATED);
      const conflicts = responses.filter((r) => r.status === HttpStatus.CONFLICT);

      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(7);

      const saleCount = await prisma.sale.count({ where: { inquiryId } });
      expect(saleCount).toBe(1);
    });

    it('iptal edilmiş talep dönüştürülemez', async () => {
      const inquiryId = await createInquiry();

      await prisma.inquiry.update({
        where: { id: inquiryId },
        data: { status: 'CANCELLED' },
      });

      const response = await api()
        .post(`/api/v1/admin/inquiries/${inquiryId}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('CONVERTED_TO_SALE durumu status ucundan set EDİLEMEZ', async () => {
      const inquiryId = await createInquiry();

      const response = await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}/status`)
        .set(auth())
        .send({ status: 'CONVERTED_TO_SALE' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('STOK ETKİSİ — Sprint 9 ile güncellendi', () => {
    /**
     * Sprint 8'de finalize stoğa DOKUNMUYORDU. Sprint 9'dan itibaren onay
     * stok düşürür, iptal geri ekler. Buradaki testler satış zincirinin
     * kendi kurallarının (kâr, ödeme, durum) stok adımı eklendikten sonra
     * DA aynı kaldığını doğrular; stok akışının kendi ayrıntılı testleri
     * `stock.e2e-spec.ts` içindedir.
     */
    const stockOf = async (id: string): Promise<string> =>
      (
        await prisma.productVariant.findUniqueOrThrow({
          where: { id },
          select: { stockQuantity: true },
        })
      ).stockQuantity.toString();

    it('onay stoğu düşürür, kâr ve toplamlar değişmez', async () => {
      const before = await stockOf(variantId);
      const sale = await createSale();

      // Taslak satış stoğu bloke etmez.
      expect(await stockOf(variantId)).toBe(before);

      await finalize(sale.id as string).expect(HttpStatus.OK);

      expect(diff(before, await stockOf(variantId))).toBe('10');

      const after = await getSale(sale.id as string);

      expect(after.grandTotal).toBe('1500');
      expect(after.grossProfit).toBe('500');
    });

    it('iptal stoğu geri ekler ve borcu kapatır', async () => {
      const before = await stockOf(variantId);
      const sale = await createSale();

      await finalize(sale.id as string).expect(HttpStatus.OK);
      await api()
        .post(`/api/v1/admin/sales/${sale.id as string}/cancel`)
        .set(auth())
        .send({ reason: 'Stok testi' })
        .expect(HttpStatus.OK);

      expect(await stockOf(variantId)).toBe(before);
    });

    it('yetersiz stokta finalize reddedilir; satış ve borç oluşmaz', async () => {
      const summaryBefore = await financeSummary();
      const sale = await createSale({ items: [{ variantId, quantity: '999999' }] });

      const response = await finalize(sale.id as string);

      expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(response.body.error.details[0].context.available).toBeDefined();

      expect((await getSale(sale.id as string)).status).toBe('DRAFT');
      expect((await financeSummary()).currentDebt).toBe(summaryBefore.currentDebt);
    });

    it('talepten dönüşen satış da onaylandığında stok düşer', async () => {
      const inquiry = await prisma.inquiry.create({
        data: {
          inquiryNumber: `TLP-2026-8${Math.floor(Math.random() * 100_000)
            .toString()
            .padStart(5, '0')}`,
          contactName: `${PREFIX} Stok Talebi`,
          contactPhone: '5329000003',
          city: 'Konya',
          district: 'Çumra',
          consentAccepted: true,
          consentAt: new Date(),
          items: {
            create: {
              variantId,
              productId,
              productNameSnapshot: `${PREFIX} Ürün`,
              skuSnapshot: `${PREFIX}-V1`,
              unitTypeSnapshot: 'Kilogram',
              unitQuantitySnapshot: '1',
              quantity: '6',
            },
          },
        },
        select: { id: true },
      });

      const before = await stockOf(variantId);

      const converted = await api()
        .post(`/api/v1/admin/inquiries/${inquiry.id}/convert-to-sale`)
        .set(auth())
        .send({ paymentType: 'CASH' })
        .expect(HttpStatus.CREATED);

      // Dönüşüm TASLAK üretir: stok henüz düşmez.
      expect(await stockOf(variantId)).toBe(before);

      await finalize(converted.body.data.id as string).expect(HttpStatus.OK);

      expect(diff(before, await stockOf(variantId))).toBe('6');
    });
  });

  // =========================================================================
  describe('KURAL 8 — finansal alan sızıntısı', () => {
    it('public ürün uçlarında finansal alan bulunmaz', async () => {
      const sale = await createSale();
      await finalize(sale.id as string).expect(HttpStatus.OK);

      for (const path of ['/api/v1/public/products?limit=50', '/api/v1/public/taxonomy']) {
        const response = await api().get(path);
        const body = JSON.stringify(response.body);

        for (const field of FORBIDDEN_FINANCIAL_FIELDS) {
          // Hata mesajında hangi uç/alan olduğu görünsün diye alan adı
          // beklentiye gömülüyor: Jest'in expect'i ikinci argüman almaz.
          expect({ path, field, leaked: body.includes(`"${field}"`) }).toEqual({
            path,
            field,
            leaked: false,
          });
        }
      }
    });

    it('satış ve ödeme uçları jetonsuz 401 döner', async () => {
      await api().get('/api/v1/admin/sales').expect(HttpStatus.UNAUTHORIZED);
      await api().get('/api/v1/admin/payments').expect(HttpStatus.UNAUTHORIZED);
      await api().get('/api/v1/admin/customers').expect(HttpStatus.UNAUTHORIZED);
    });

    it('YÖNETİM yanıtında kâr alanları BULUNUR', async () => {
      const response = await api().get('/api/v1/admin/sales?limit=1').set(auth());
      const body = JSON.stringify(response.body);

      expect(body).toContain('grossProfit');
      expect(body).toContain('netProfit');
    });
  });

  // =========================================================================
  describe('DENETİM GÜNLÜĞÜ', () => {
    it("finalize, ödeme, ek maliyet ve iptal audit log'a yazılır", async () => {
      const sale = await createSale();
      const saleId = sale.id as string;

      await finalize(saleId).expect(HttpStatus.OK);
      await addPayment(saleId, { method: 'CASH', amount: '500' }).expect(HttpStatus.CREATED);
      await api()
        .post(`/api/v1/admin/sales/${saleId}/additional-costs`)
        .set(auth())
        .send({ costType: 'COMMISSION', amount: '25' })
        .expect(HttpStatus.CREATED);
      await api()
        .post(`/api/v1/admin/sales/${saleId}/cancel`)
        .set(auth())
        .send({ reason: 'Denetim testi' })
        .expect(HttpStatus.OK);

      const logs = await prisma.auditLog.findMany({
        where: { entityId: saleId },
        select: { action: true, description: true },
      });

      const descriptions = logs.map((log) => log.description ?? '').join(' | ');

      expect(descriptions).toContain('Satış taslağı oluşturuldu');
      expect(descriptions).toContain('Satış onaylandı');
      expect(descriptions).toContain('Satış iptal edildi');

      const costLogs = await prisma.auditLog.findMany({
        where: { entityType: 'SaleAdditionalCost' },
        select: { description: true },
      });

      expect(costLogs.some((log) => (log.description ?? '').includes('Ek maliyet eklendi'))).toBe(
        true,
      );

      const paymentLogs = await prisma.auditLog.findMany({
        where: { entityType: 'Payment' },
        select: { description: true },
      });

      expect(paymentLogs.some((log) => (log.description ?? '').includes('Ödeme alındı'))).toBe(
        true,
      );
    });
  });

  /** Müşterinin güncel finans özetini çeker. */
  async function financeSummary(): Promise<Record<string, string>> {
    const response = await api()
      .get(`/api/v1/admin/customers/${customerId}/financial-summary`)
      .set(auth())
      .expect(HttpStatus.OK);

    return response.body.data;
  }

  /**
   * İki parasal metnin farkını Decimal ile hesaplar.
   *
   * `undefined` kabul eder: `financeSummary()` düz bir kayıt döndürdüğü
   * için TypeScript indeksli erişimi `string | undefined` sayar. Eksik
   * alan sıfır sayılır — yoksa test, asıl hatayı değil tip hatasını
   * rapor eder.
   */
  function diff(after: string | undefined, before: string | undefined): string {
    return new Prisma.Decimal(after ?? 0).minus(before ?? 0).toString();
  }
});
