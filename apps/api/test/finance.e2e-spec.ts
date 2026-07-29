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
 * Finans dashboard'u ve raporlar (Sprint 10).
 *
 * ============================================================
 * FİKSTÜR — bütün beklentiler bu tablodan çıkar
 * ============================================================
 * Varyasyon: alış 60, satış 100. Her satış 10 adet => 1000 ciro,
 * 600 maliyet, 400 brüt kâr.
 *
 *   S1  CONFIRMED       vade 40 gün önce   ödeme yok    kalan 1000
 *   S2  PARTIALLY_PAID  vade 10 gün önce   ödeme 400    kalan  600
 *   S3  PAID            vade gelecek       ödeme 1000   kalan    0
 *   S4  CANCELLED       (onaylanıp iptal edildi)     raporlara GİRMEZ
 *   S5  DRAFT           (hiç onaylanmadı)            raporlara GİRMEZ
 *
 * Beklenen toplamlar:
 *   raporlanabilir satış  : 3 adet, ciro 3000, maliyet 1800, brüt kâr 1200
 *   tahsilat              : 1400
 *   vadesi geçmiş         : 1600 (S1 + S2), 2 satış, 1 müşteri
 *   yaşlandırma           : 31-60 -> 1000, 0-30 -> 600
 *
 * ============================================================
 * NEDEN TÜM SATIŞLAR SİLİNEREK BAŞLANIYOR
 * ============================================================
 * Raporlar GLOBAL toplar — tarih aralığındaki her satışı sayarlar,
 * "bu testin satışlarını" değil. Başka bir paketten artakalan tek bir
 * satış bile rakamları kaydırır ve testi belirsiz kılar. Seed satış
 * üretmediği için tabloyu boşaltmak güvenlidir.
 */
describe('Finans ve raporlar (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const SUPER = { email: 'finance.super@zirvetarim.test', password: 'FinansSifre123' };
  const PREFIX = 'E2EFinans';

  const UNIT_PURCHASE = '60';
  const UNIT_SALE = '100';
  const QUANTITY = '10';

  let token = '';
  let customerId = '';
  let variantId = '';
  let productId = '';
  let categoryId = '';

  /** Fikstür satışlarının kimlikleri. */
  const sale: Record<'s1' | 's2' | 's3' | 's4' | 's5', string> = {
    s1: '',
    s2: '',
    s3: '',
    s4: '',
    s5: '',
  };

  jest.setTimeout(240_000);

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
        fullName: 'E2E Finans Yöneticisi',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    token = (await api().post('/api/v1/auth/login').send(SUPER)).body.data.accessToken;

    await seedFixtures();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function cleanup(): Promise<void> {
    // Bkz. dosya başlığı: raporlar global topladığı için satış/ödeme
    // tablosu tamamen boşaltılır.
    await prisma.payment.deleteMany({});
    await prisma.sale.deleteMany({});

    await prisma.customer.deleteMany({
      where: { OR: [{ fullName: { contains: PREFIX } }, { phone: { startsWith: '532950' } }] },
    });

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

  async function seedFixtures(): Promise<void> {
    const [unit, category] = await Promise.all([
      prisma.unitType.findFirst({ where: { code: 'kg' } }),
      prisma.category.findFirst({ where: { deletedAt: null } }),
    ]);

    categoryId = (category as { id: string }).id;

    const product = await prisma.product.create({
      data: {
        name: `${PREFIX} Ürün`,
        slug: `e2e-finans-urun-${Date.now()}`,
        isActive: true,
        isPublished: true,
        categories: { create: { categoryId, isPrimary: true } },
        variants: {
          create: {
            sku: `${PREFIX.toUpperCase()}-V1`,
            unitTypeId: (unit as { id: string }).id,
            unitQuantity: '1',
            purchasePrice: UNIT_PURCHASE,
            salePrice: UNIT_SALE,
            minOrderQuantity: '1',
            quantityStep: '1',
            stockQuantity: '100000',
            isActive: true,
            isDefault: true,
          },
        },
      },
      select: { id: true, variants: { select: { id: true } } },
    });

    productId = product.id;
    variantId = (product.variants[0] as { id: string }).id;

    const customer = await api()
      .post('/api/v1/admin/customers')
      .set(auth())
      .send({
        fullName: `${PREFIX} Ali Veli`,
        phone: '0532 950 00 01',
        creditLimit: '100000',
      })
      .expect(HttpStatus.CREATED);

    customerId = customer.body.data.id;

    // --- S1: vadesi 40 gün geçmiş, ödemesiz ---
    sale.s1 = await createSale({ paymentType: 'CREDIT', dueDate: daysFromNow(-40) });
    await finalize(sale.s1);

    // --- S2: vadesi 10 gün geçmiş, 400 kısmi ödeme ---
    sale.s2 = await createSale({ paymentType: 'CREDIT', dueDate: daysFromNow(-10) });
    await finalize(sale.s2);
    await addPayment(sale.s2, '400', 'CASH');

    // --- S3: tamamı ödenmiş ---
    sale.s3 = await createSale({ paymentType: 'CASH' });
    await finalize(sale.s3);
    await addPayment(sale.s3, '1000', 'BANK_TRANSFER');

    // --- S4: onaylanıp İPTAL edildi ---
    sale.s4 = await createSale({ paymentType: 'CASH' });
    await finalize(sale.s4);
    await api()
      .post(`/api/v1/admin/sales/${sale.s4}/cancel`)
      .set(auth())
      .send({ reason: 'Fikstür: iptal senaryosu' })
      .expect(HttpStatus.OK);

    // --- S5: taslak kaldı ---
    sale.s5 = await createSale({ paymentType: 'CASH' });
  }

  async function createSale(overrides: Record<string, unknown>): Promise<string> {
    const response = await api()
      .post('/api/v1/admin/sales')
      .set(auth())
      .send({
        customerId,
        saleDate: new Date().toISOString(),
        items: [{ variantId, quantity: QUANTITY }],
        ...overrides,
      });

    expect(response.status).toBe(HttpStatus.CREATED);

    return response.body.data.id as string;
  }

  async function finalize(saleId: string): Promise<void> {
    await api().post(`/api/v1/admin/sales/${saleId}/finalize`).set(auth()).expect(HttpStatus.OK);
  }

  async function addPayment(saleId: string, amount: string, method: string): Promise<void> {
    await api()
      .post(`/api/v1/admin/sales/${saleId}/payments`)
      .set(auth())
      .send({ method, amount, paymentDate: new Date().toISOString() })
      .expect(HttpStatus.CREATED);
  }

  function daysFromNow(days: number): string {
    return new Date(Date.now() + days * 86_400_000).toISOString();
  }

  const get = (path: string) => api().get(`/api/v1/admin/finance${path}`).set(auth());

  // =========================================================================
  describe('DASHBOARD', () => {
    it('bu ayki satış, tahsilat ve kâr doğru', async () => {
      const response = await get('/dashboard').expect(HttpStatus.OK);
      const { month } = response.body.data;

      expect(month.saleCount).toBe(3);
      expect(month.salesTotal).toBe('3000');
      expect(month.grossProfit).toBe('1200');
      expect(month.paymentCount).toBe(2);
      expect(month.paymentsTotal).toBe('1400');
    });

    it('borç toplamları doğru', async () => {
      const response = await get('/dashboard').expect(HttpStatus.OK);
      const { debt } = response.body.data;

      // 3000 satış - 1400 tahsilat = 1600 (devir bakiyesi 0).
      expect(debt.totalDebt).toBe('1600');
      expect(debt.openSalesDebt).toBe('1600');
      expect(debt.overdueDebt).toBe('1600');
      expect(debt.overdueSaleCount).toBe(2);
    });

    it('katalog ve talep sayaçları döner', async () => {
      const response = await get('/dashboard').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(data.catalog.activeProducts).toBeGreaterThan(0);
      expect(data.catalog.activeCustomers).toBeGreaterThan(0);
      expect(typeof data.inquiries.pending).toBe('number');
      expect(typeof data.criticalStockCount).toBe('number');
    });

    it('son işlem listeleri TASLAK satışı içermez', async () => {
      const response = await get('/dashboard').expect(HttpStatus.OK);
      const ids = (response.body.data.recent.sales as { id: string }[]).map((row) => row.id);

      expect(ids).not.toContain(sale.s5);
      expect(ids).toContain(sale.s1);
    });

    it('yaklaşan vadeler yalnız 7 gün içindekileri getirir', async () => {
      // Vadesi 3 gün sonra olan, ödenmemiş bir satış eklenir.
      const upcoming = await createSale({ paymentType: 'CREDIT', dueDate: daysFromNow(3) });
      await finalize(upcoming);

      const response = await get('/dashboard').expect(HttpStatus.OK);
      const ids = (response.body.data.upcomingDueSales as { id: string }[]).map((row) => row.id);

      expect(ids).toContain(upcoming);
      // Vadesi GEÇMİŞ satış "yaklaşan" değildir.
      expect(ids).not.toContain(sale.s1);

      // Fikstürü eski hâline döndür: sonraki testler 3 satış bekliyor.
      await api()
        .post(`/api/v1/admin/sales/${upcoming}/cancel`)
        .set(auth())
        .send({ reason: 'Fikstür temizliği' })
        .expect(HttpStatus.OK);
    });

    it('son 12 ayın serisi tam uzunlukta ve bu ay doğru', async () => {
      const response = await get('/dashboard').expect(HttpStatus.OK);
      const series = response.body.data.monthlySeries as {
        month: string;
        sales: string;
        payments: string;
        profit: string;
      }[];

      expect(series).toHaveLength(12);

      // Boş aylar da döner; grafik düşüşü gizlemesin.
      const current = series[series.length - 1];
      const expectedMonth = new Date().toISOString().slice(0, 7);

      expect(current?.month).toBe(expectedMonth);
      expect(current?.sales).toBe('3000');
      expect(current?.payments).toBe('1400');
      expect(current?.profit).toBe('1200');
    });
  });

  // =========================================================================
  describe('CANCELLED VE DRAFT HARİÇ (şart 7)', () => {
    it('iptal edilen satış satış raporuna girmez', async () => {
      const response = await get('/sales-report').expect(HttpStatus.OK);

      expect(response.body.data.saleCount).toBe(3);
      expect(response.body.data.grandTotal).toBe('3000');
    });

    it('taslak satış finansal toplamlara girmez', async () => {
      // S5 taslak; 4 satış oluşturuldu ama yalnız 3'ü sayılıyor.
      const total = await prisma.sale.count({ where: { customerId } });

      expect(total).toBeGreaterThan(3);

      const response = await get('/profit-report').expect(HttpStatus.OK);
      expect(response.body.data.saleCount).toBe(3);
    });

    it('iptal edilen satış kâr raporunun ürün kırılımına girmez', async () => {
      const response = await get('/profit-report').expect(HttpStatus.OK);
      const row = (response.body.data.byProduct as { key: string; quantity: string }[]).find(
        (item) => item.key === productId,
      );

      // 3 satış x 10 adet = 30; iptal ve taslak sayılsaydı 50 olurdu.
      expect(row?.quantity).toBe('30');
    });

    it('iptal edilen satış aylık seriye girmez', async () => {
      const response = await get('/charts').expect(HttpStatus.OK);
      const series = response.body.data.monthly as { month: string; sales: string }[];
      const current = series[series.length - 1];

      expect(current?.sales).toBe('3000');
    });
  });

  // =========================================================================
  describe('SATIŞ RAPORU', () => {
    it('toplamlar ve ortalama doğru', async () => {
      const response = await get('/sales-report').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(data.grandTotal).toBe('3000');
      expect(data.costTotal).toBe('1800');
      expect(data.grossProfit).toBe('1200');
      expect(data.paidTotal).toBe('1400');
      expect(data.remainingTotal).toBe('1600');
      expect(data.averageSale).toBe('1000');
    });

    it('durum kırılımı verir', async () => {
      const response = await get('/sales-report').expect(HttpStatus.OK);
      const byStatus = Object.fromEntries(
        (response.body.data.byStatus as { status: string; count: number }[]).map((row) => [
          row.status,
          row.count,
        ]),
      );

      expect(byStatus['CONFIRMED']).toBe(1);
      expect(byStatus['PARTIALLY_PAID']).toBe(1);
      expect(byStatus['PAID']).toBe(1);
      expect(byStatus['CANCELLED']).toBeUndefined();
      expect(byStatus['DRAFT']).toBeUndefined();
    });

    it('tarih aralığı dışındaki satışlar sayılmaz', async () => {
      const from = new Date(Date.now() - 400 * 86_400_000).toISOString();
      const to = new Date(Date.now() - 300 * 86_400_000).toISOString();

      const response = await get(`/sales-report?dateFrom=${from}&dateTo=${to}`).expect(
        HttpStatus.OK,
      );

      expect(response.body.data.saleCount).toBe(0);
      expect(response.body.data.grandTotal).toBe('0');
    });
  });

  // =========================================================================
  describe('TAHSİLAT RAPORU', () => {
    it('yöntem kırılımı doğru', async () => {
      const response = await get('/payment-report').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(data.paymentCount).toBe(2);
      expect(data.totalAmount).toBe('1400');

      const byMethod = Object.fromEntries(
        (data.byMethod as { method: string; total: string }[]).map((row) => [
          row.method,
          row.total,
        ]),
      );

      expect(byMethod['CASH']).toBe('400');
      expect(byMethod['BANK_TRANSFER']).toBe('1000');
    });
  });

  // =========================================================================
  describe('KÂR RAPORU', () => {
    it('brüt kâr ve marj doğru', async () => {
      const response = await get('/profit-report').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(data.revenue).toBe('3000');
      expect(data.cost).toBe('1800');
      expect(data.grossProfit).toBe('1200');
      // 1200 / 3000 = %40
      expect(data.marginPercent).toBe('40');
    });

    it('ürün kırılımı doğru', async () => {
      const response = await get('/profit-report').expect(HttpStatus.OK);
      const row = (response.body.data.byProduct as Record<string, string>[]).find(
        (item) => item['key'] === productId,
      );

      expect(row?.['revenue']).toBe('3000');
      expect(row?.['cost']).toBe('1800');
      expect(row?.['profit']).toBe('1200');
      expect(row?.['marginPercent']).toBe('40');
    });

    it('kategori kırılımı ANA kategoriden gelir ve ciroyu aşmaz', async () => {
      const response = await get('/profit-report').expect(HttpStatus.OK);
      const rows = response.body.data.byCategory as Record<string, string>[];
      const row = rows.find((item) => item['key'] === categoryId);

      expect(row?.['revenue']).toBe('3000');

      // Ürün birden çok kategoride olsa bile toplam ciroyu aşmamalı.
      const sum = rows.reduce((total, item) => total + Number(item['revenue']), 0);
      expect(sum).toBe(3000);
    });
  });

  // =========================================================================
  describe('ALACAKLAR VE YAŞLANDIRMA', () => {
    it('müşteri bazlı borç ve kovalar doğru', async () => {
      const response = await get('/receivables').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(data.totalDebt).toBe('1600');

      const row = (data.customers as Record<string, never>[]).find(
        (item) => (item as unknown as { customerId: string }).customerId === customerId,
      ) as unknown as { totalDebt: string; buckets: Record<string, string> };

      expect(row.totalDebt).toBe('1600');
      // S1 vadesi 40 gün geçmiş -> 31-60; S2 10 gün -> 0-30.
      expect(row.buckets['DAYS_31_60']).toBe('1000');
      expect(row.buckets['DAYS_0_30']).toBe('600');
      expect(row.buckets['DAYS_90_PLUS']).toBe('0');
      expect(row.buckets['NOT_DUE']).toBe('0');
    });

    it('tamamı ödenmiş satış alacaklara girmez', async () => {
      const response = await get('/receivables').expect(HttpStatus.OK);
      const buckets = response.body.data.buckets as Record<string, string>;

      // S3 (1000, tamamı ödendi) hiçbir kovada olmamalı.
      const total = Object.values(buckets).reduce((sum, value) => sum + Number(value), 0);
      expect(total).toBe(1600);
    });
  });

  // =========================================================================
  describe('VADESİ GEÇENLER', () => {
    it('yalnız vadesi geçmiş ve kalanı olan satışlar listelenir', async () => {
      const response = await get('/overdue').expect(HttpStatus.OK);
      const data = response.body.data;

      expect(data.saleCount).toBe(2);
      expect(data.customerCount).toBe(1);
      expect(data.totalOverdue).toBe('1600');

      const ids = (data.items as { id: string }[]).map((row) => row.id);

      expect(ids).toContain(sale.s1);
      expect(ids).toContain(sale.s2);
      expect(ids).not.toContain(sale.s3);
      expect(ids).not.toContain(sale.s4);
    });

    it('gecikme gün sayısı sunucuda hesaplanır', async () => {
      const response = await get('/overdue').expect(HttpStatus.OK);
      const items = response.body.data.items as { id: string; daysOverdue: number }[];

      const first = items.find((row) => row.id === sale.s1);
      const second = items.find((row) => row.id === sale.s2);

      expect(first?.daysOverdue).toBe(40);
      expect(second?.daysOverdue).toBe(10);
    });

    it('minDaysOverdue filtresi uygulanır', async () => {
      const response = await get('/overdue?minDaysOverdue=30').expect(HttpStatus.OK);
      const ids = (response.body.data.items as { id: string }[]).map((row) => row.id);

      expect(ids).toContain(sale.s1);
      expect(ids).not.toContain(sale.s2);
    });
  });

  // =========================================================================
  describe('GRAFİK SERİLERİ', () => {
    it('en çok satan ürünler ve en borçlu müşteriler döner', async () => {
      const response = await get('/charts').expect(HttpStatus.OK);
      const data = response.body.data;

      const product = (data.topProducts as Record<string, string>[]).find(
        (row) => row['productId'] === productId,
      );
      expect(product?.['revenue']).toBe('3000');

      const debtor = (data.topDebtors as Record<string, string>[]).find(
        (row) => row['customerId'] === customerId,
      );
      expect(debtor?.['debt']).toBe('1600');
    });

    it('kategori dağılımı kâr raporuyla AYNI hesabı verir', async () => {
      const [charts, profit] = await Promise.all([
        get('/charts').expect(HttpStatus.OK),
        get('/profit-report').expect(HttpStatus.OK),
      ]);

      expect(charts.body.data.byCategory).toEqual(profit.body.data.byCategory);
    });
  });

  // =========================================================================
  describe('GÜVENLİK', () => {
    it('finans uçları jetonsuz 401 döner', async () => {
      for (const path of [
        '/dashboard',
        '/receivables',
        '/overdue',
        '/sales-report',
        '/payment-report',
        '/profit-report',
        '/charts',
      ]) {
        await api().get(`/api/v1/admin/finance${path}`).expect(HttpStatus.UNAUTHORIZED);
      }
    });

    it('geçersiz tarih reddedilir', async () => {
      await get('/sales-report?dateFrom=abc').expect(HttpStatus.BAD_REQUEST);
    });
  });
});
