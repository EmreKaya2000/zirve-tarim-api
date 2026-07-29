import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

/**
 * Müşteri yönetimi uçtan uca testleri (Sprint 7).
 *
 * SPRİNTİN KRİTİK TESTLERİ:
 *   - CRUD ve soft delete sonrası listede görünmeme
 *   - TİP BAZLI zorunlu alanlar (bireysel: ad+soyad, kurumsal: firma adı)
 *   - arama (ad, firma, telefon) ve tip/aktiflik filtreleri
 *   - görüşme notu ekleme ve listeleme
 *   - MÜKERRER TELEFON UYARISI — engelleme DEĞİL
 *   - kalan borcun alan olarak tutulmaması (her zaman hesaplanır)
 *   - talep–müşteri eşleştirme
 */
describe('Müşteri yönetimi (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
  const SUPER = { email: 'customer.super@zirvetarim.test', password: 'MusteriSifre123' };
  const PREFIX = 'E2EMusteri';

  let token = '';

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
        fullName: 'E2E Müşteri Yöneticisi',
        role: UserRole.SUPER_ADMIN,
        isActive: true,
      },
    });

    token = (await api().post('/api/v1/auth/login').send(SUPER)).body.data.accessToken;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function cleanup(): Promise<void> {
    const customers = await prisma.customer.findMany({
      where: { OR: [{ fullName: { contains: PREFIX } }, { phone: { startsWith: '532940' } }] },
      select: { id: true },
    });
    const ids = customers.map((c) => c.id);

    if (ids.length > 0) {
      await prisma.customerNote.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.payment.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.sale.deleteMany({ where: { customerId: { in: ids } } });
      await prisma.inquiry.updateMany({
        where: { customerId: { in: ids } },
        data: { customerId: null },
      });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    }

    await prisma.inquiry.deleteMany({ where: { contactName: { startsWith: PREFIX } } });

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

  let phoneCounter = 0;

  /** Çakışmayan bir test telefonu üretir: 0532 940 00 NN. */
  function nextPhone(): string {
    phoneCounter += 1;

    return `0532 940 00 ${phoneCounter.toString().padStart(2, '0')}`;
  }

  interface TestCustomer {
    id: string;
    code: string;
    fullName: string;
    phone: string;
    warnings?: { code: string; field?: string }[];
  }

  async function createCustomer(overrides: Record<string, unknown> = {}): Promise<TestCustomer> {
    const response = await api()
      .post('/api/v1/admin/customers')
      .set(auth())
      .send({ fullName: `${PREFIX} Ahmet Yılmaz`, phone: nextPhone(), ...overrides });

    expect(response.status).toBe(HttpStatus.CREATED);

    return response.body.data;
  }

  // =========================================================================
  describe('CRUD', () => {
    it('bireysel müşteri oluşturulur ve kod atanır', async () => {
      const customer = await createCustomer({ city: 'Konya', district: 'Çumra' });

      expect(customer.code).toMatch(/^MUS-/);
      expect(customer.fullName).toBe(`${PREFIX} Ahmet Yılmaz`);
      // Telefon normalleştirilerek saklanır.
      expect(customer.phone).toMatch(/^5329400/);
    });

    it('detay ucu finans özetiyle döner', async () => {
      const customer = await createCustomer();

      const response = await api()
        .get(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(response.body.data.financeSummary.currentDebt).toBe('0');
      expect(response.body.data.financeSummary.saleCount).toBe(0);
    });

    it('güncelleme alanları değiştirir', async () => {
      const customer = await createCustomer();

      const response = await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ city: 'Ankara', creditLimit: '25000' })
        .expect(HttpStatus.OK);

      expect(response.body.data.city).toBe('Ankara');
      expect(response.body.data.creditLimit).toBe('25000');
    });

    it('devir bakiyesi güncelleme ucundan DEĞİŞTİRİLEMEZ', async () => {
      const customer = await createCustomer({ openingBalance: '500' });

      // Whitelist dışı alan: forbidNonWhitelisted 400 döndürür.
      await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ openingBalance: '9999' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('soft delete sonrası listede ve detayda görünmez', async () => {
      const customer = await createCustomer();

      await api()
        .delete(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .expect(HttpStatus.NO_CONTENT);

      await api()
        .get(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .expect(HttpStatus.NOT_FOUND);

      const list = await api()
        .get(`/api/v1/admin/customers?search=${encodeURIComponent(customer.code)}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(list.body.data).toHaveLength(0);

      // Kayıt SİLİNMEDİ, yalnız işaretlendi (Kural 4).
      const row = await prisma.customer.findUnique({ where: { id: customer.id } });
      expect(row?.deletedAt).not.toBeNull();
    });

    it('müşteri uçları jetonsuz 401 döner', async () => {
      await api().get('/api/v1/admin/customers').expect(HttpStatus.UNAUTHORIZED);
      await api().post('/api/v1/admin/customers').send({}).expect(HttpStatus.UNAUTHORIZED);
    });
  });

  // =========================================================================
  describe('TİP BAZLI ZORUNLU ALANLAR', () => {
    it('bireyselde ad ve soyad birlikte zorunludur', async () => {
      const response = await api()
        .post('/api/v1/admin/customers')
        .set(auth())
        .send({ type: 'INDIVIDUAL', fullName: 'Ahmet', phone: nextPhone() });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('fullName');
    });

    it('bireyselde iki kelimeli ad kabul edilir', async () => {
      const customer = await createCustomer({ type: 'INDIVIDUAL' });

      expect(customer.id).toBeDefined();
    });

    it('kurumsalda firma adı zorunludur', async () => {
      const response = await api()
        .post('/api/v1/admin/customers')
        .set(auth())
        .send({ type: 'CORPORATE', fullName: `${PREFIX} Yetkili Kişi`, phone: nextPhone() });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('companyName');
    });

    it('kurumsal müşteri firma adıyla oluşturulur', async () => {
      const customer = await createCustomer({
        type: 'CORPORATE',
        companyName: `${PREFIX} Tarım A.Ş.`,
        taxNumber: '1234567890',
      });

      expect(customer.id).toBeDefined();
    });

    it('BİREYSELDEN KURUMSALA geçişte firma adı aranır', async () => {
      const customer = await createCustomer({ type: 'INDIVIDUAL' });

      // Yalnız `type` gönderiliyor; kural mevcut değerlerle BİRLİKTE
      // değerlendirilmeli, yoksa firma adı boş bir kurumsal kayıt kalır.
      const response = await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ type: 'CORPORATE' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      expect(response.body.error.details[0].field).toBe('companyName');

      await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ type: 'CORPORATE', companyName: `${PREFIX} Ltd.` })
        .expect(HttpStatus.OK);
    });

    it('geçersiz telefon biçimi reddedilir', async () => {
      for (const phone of ['123', '0212 456 78 90', 'abc']) {
        const response = await api()
          .post('/api/v1/admin/customers')
          .set(auth())
          .send({ fullName: `${PREFIX} Ahmet Yılmaz`, phone });

        expect(response.status).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  // =========================================================================
  describe('MÜKERRER TELEFON — uyarı, engel değil', () => {
    it('aynı telefonla ikinci kayıt AÇILIR ve uyarı döner', async () => {
      const first = await createCustomer();

      const response = await api()
        .post('/api/v1/admin/customers')
        .set(auth())
        .send({ fullName: `${PREFIX} Mehmet Yılmaz`, phone: first.phone });

      expect(response.status).toBe(HttpStatus.CREATED);

      const warning = response.body.data.warnings[0];

      expect(warning.code).toBe('DUPLICATE_PHONE');
      expect(warning.field).toBe('phone');
      expect(warning.context.customerId).toBe(first.id);
      expect(warning.context.code).toBe(first.code);
    });

    it('çakışma yoksa uyarı alanı HİÇ bulunmaz', async () => {
      const customer = await createCustomer();

      expect(customer.warnings).toBeUndefined();
    });

    it('ön kontrol ucu formu kaydetmeden uyarır', async () => {
      const first = await createCustomer();

      const hit = await api()
        .get(`/api/v1/admin/customers/check-duplicate?phone=${encodeURIComponent(first.phone)}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(hit.body.data.isDuplicate).toBe(true);
      expect(hit.body.data.warning.context.code).toBe(first.code);

      // Kendi kaydı mükerrer sayılmaz.
      const self = await api()
        .get(
          `/api/v1/admin/customers/check-duplicate?phone=${encodeURIComponent(first.phone)}&excludeId=${first.id}`,
        )
        .set(auth())
        .expect(HttpStatus.OK);

      expect(self.body.data.isDuplicate).toBe(false);
      expect(self.body.data.warning).toBeNull();
    });

    it('güncellemede başka müşterinin numarası uyarı üretir ama kaydeder', async () => {
      const first = await createCustomer();
      const second = await createCustomer();

      const response = await api()
        .patch(`/api/v1/admin/customers/${second.id}`)
        .set(auth())
        .send({ phone: first.phone })
        .expect(HttpStatus.OK);

      expect(response.body.data.warnings[0].code).toBe('DUPLICATE_PHONE');
    });
  });

  // =========================================================================
  describe('ARAMA VE FİLTRELER', () => {
    it('ada, firmaya ve telefona göre arar', async () => {
      const individual = await createCustomer({ fullName: `${PREFIX} Zeynep Kaya` });
      const corporate = await createCustomer({
        type: 'CORPORATE',
        fullName: `${PREFIX} Yetkili`,
        companyName: `${PREFIX} Ova Tarım`,
      });

      const byName = await api()
        .get(`/api/v1/admin/customers?search=${encodeURIComponent('Zeynep Kaya')}`)
        .set(auth())
        .expect(HttpStatus.OK);
      expect(byName.body.data.map((c: { id: string }) => c.id)).toContain(individual.id);

      const byCompany = await api()
        .get(`/api/v1/admin/customers?search=${encodeURIComponent('Ova Tarım')}`)
        .set(auth())
        .expect(HttpStatus.OK);
      expect(byCompany.body.data.map((c: { id: string }) => c.id)).toContain(corporate.id);

      // Kullanıcı boşluklu/0'lı yazsa da normalleştirilmiş kayıt bulunur.
      const byPhone = await api()
        .get(`/api/v1/admin/customers?search=${encodeURIComponent(individual.phone)}`)
        .set(auth())
        .expect(HttpStatus.OK);
      expect(byPhone.body.data.map((c: { id: string }) => c.id)).toContain(individual.id);
    });

    it('tip filtresi uygulanır', async () => {
      const corporate = await createCustomer({
        type: 'CORPORATE',
        fullName: `${PREFIX} Kurumsal Yetkili`,
        companyName: `${PREFIX} Kurumsal A.Ş.`,
      });

      const response = await api()
        .get('/api/v1/admin/customers?type=CORPORATE&limit=100')
        .set(auth())
        .expect(HttpStatus.OK);

      const types = response.body.data.map((c: { type: string }) => c.type);

      expect(types.every((type: string) => type === 'CORPORATE')).toBe(true);
      expect(response.body.data.map((c: { id: string }) => c.id)).toContain(corporate.id);
    });

    it('aktiflik filtresi uygulanır', async () => {
      const customer = await createCustomer();

      await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ isActive: false })
        .expect(HttpStatus.OK);

      const active = await api()
        .get(`/api/v1/admin/customers?isActive=true&search=${encodeURIComponent(customer.code)}`)
        .set(auth())
        .expect(HttpStatus.OK);
      expect(active.body.data).toHaveLength(0);

      const passive = await api()
        .get(`/api/v1/admin/customers?isActive=false&search=${encodeURIComponent(customer.code)}`)
        .set(auth())
        .expect(HttpStatus.OK);
      expect(passive.body.data).toHaveLength(1);
    });
  });

  // =========================================================================
  describe('GÖRÜŞME NOTLARI', () => {
    it('not eklenir ve en yeni önce listelenir', async () => {
      const customer = await createCustomer();

      await api()
        .post(`/api/v1/admin/customers/${customer.id}/notes`)
        .set(auth())
        .send({ body: 'İlk görüşme: gübre fiyatı sordu.' })
        .expect(HttpStatus.CREATED);

      const second = await api()
        .post(`/api/v1/admin/customers/${customer.id}/notes`)
        .set(auth())
        .send({ body: 'İkinci görüşme: sipariş verdi.' })
        .expect(HttpStatus.CREATED);

      expect(second.body.data.createdBy.fullName).toBe('E2E Müşteri Yöneticisi');

      const list = await api()
        .get(`/api/v1/admin/customers/${customer.id}/notes`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(list.body.meta.total).toBe(2);
      expect(list.body.data[0].body).toContain('İkinci görüşme');
    });

    it('boş not reddedilir', async () => {
      const customer = await createCustomer();

      await api()
        .post(`/api/v1/admin/customers/${customer.id}/notes`)
        .set(auth())
        .send({ body: '   ' })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('notlar müşterinin `note` alanının üzerine YAZMAZ', async () => {
      const customer = await createCustomer({ note: 'Kapıda ödeme istiyor.' });

      await api()
        .post(`/api/v1/admin/customers/${customer.id}/notes`)
        .set(auth())
        .send({ body: 'Bugün aradı.' })
        .expect(HttpStatus.CREATED);

      const detail = await api()
        .get(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(detail.body.data.note).toBe('Kapıda ödeme istiyor.');
    });

    it('olmayan müşteriye not eklenemez', async () => {
      await api()
        .post('/api/v1/admin/customers/00000000-0000-4000-8000-000000000000/notes')
        .set(auth())
        .send({ body: 'Deneme' })
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  // =========================================================================
  describe('SATIŞ / ÖDEME / FİNANS SÖZLEŞMELERİ', () => {
    it('satışı olmayan müşteride listeler boş, özet sıfırdır', async () => {
      const customer = await createCustomer();

      const [sales, payments, summary] = await Promise.all([
        api().get(`/api/v1/admin/customers/${customer.id}/sales`).set(auth()),
        api().get(`/api/v1/admin/customers/${customer.id}/payments`).set(auth()),
        api().get(`/api/v1/admin/customers/${customer.id}/financial-summary`).set(auth()),
      ]);

      expect(sales.body.data).toEqual([]);
      expect(sales.body.meta.total).toBe(0);
      expect(payments.body.data).toEqual([]);
      expect(summary.body.data.totalSales).toBe('0');
      expect(summary.body.data.currentDebt).toBe('0');
      expect(summary.body.data.overdueDebt).toBe('0');
    });

    it('devir bakiyesi borca dahildir', async () => {
      const customer = await createCustomer({ openingBalance: '1500' });

      const summary = await api()
        .get(`/api/v1/admin/customers/${customer.id}/financial-summary`)
        .set(auth())
        .expect(HttpStatus.OK);

      expect(summary.body.data.currentDebt).toBe('1500');
      expect(summary.body.data.totalSales).toBe('0');
    });

    it('KALAN BORÇ customers tablosunda ALAN OLARAK TUTULMAZ (SPEC §8)', async () => {
      await createCustomer();

      const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'customers'`,
      );
      const names = columns.map((row) => row.column_name);

      // Bu adlarda bir kolon belirirse borç iki yerden okunur hâle gelir
      // ve er geç ayrışır.
      for (const forbidden of ['currentDebt', 'balance', 'totalDebt', 'remainingDebt']) {
        expect(names).not.toContain(forbidden);
      }

      // Devir bakiyesi ve limit AYRI şeylerdir; onlar girdi, borç türetilmiş.
      expect(names).toContain('openingBalance');
      expect(names).toContain('creditLimit');
    });
  });

  // =========================================================================
  describe('TALEP–MÜŞTERİ EŞLEŞTİRME', () => {
    async function createInquiry(): Promise<string> {
      const inquiry = await prisma.inquiry.create({
        data: {
          inquiryNumber: `TLP-2026-7${Math.floor(Math.random() * 100_000)
            .toString()
            .padStart(5, '0')}`,
          contactName: `${PREFIX} Talep Sahibi`,
          contactPhone: '5329409999',
          city: 'Konya',
          district: 'Çumra',
          consentAccepted: true,
          consentAt: new Date(),
        },
        select: { id: true },
      });

      return inquiry.id;
    }

    it('talep mevcut müşteriye bağlanır', async () => {
      const customer = await createCustomer();
      const inquiryId = await createInquiry();

      const response = await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(auth())
        .send({ customerId: customer.id })
        .expect(HttpStatus.OK);

      expect(response.body.data.customer.id).toBe(customer.id);
    });

    it('bağ kaldırılabilir', async () => {
      const customer = await createCustomer();
      const inquiryId = await createInquiry();

      await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(auth())
        .send({ customerId: customer.id })
        .expect(HttpStatus.OK);

      const response = await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(auth())
        .send({ customerId: null })
        .expect(HttpStatus.OK);

      expect(response.body.data.customer).toBeNull();
    });

    it('olmayan müşteriye bağlanamaz', async () => {
      const inquiryId = await createInquiry();

      await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(auth())
        .send({ customerId: '00000000-0000-4000-8000-000000000000' })
        .expect(HttpStatus.NOT_FOUND);
    });

    it('pasif müşteriye bağlanamaz', async () => {
      const customer = await createCustomer();
      const inquiryId = await createInquiry();

      await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ isActive: false })
        .expect(HttpStatus.OK);

      const response = await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(auth())
        .send({ customerId: customer.id });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('talebin İÇERİĞİ bu uçtan düzenlenemez', async () => {
      const inquiryId = await createInquiry();

      // Whitelist dışı alan: forbidNonWhitelisted reddeder.
      await api()
        .patch(`/api/v1/admin/inquiries/${inquiryId}`)
        .set(auth())
        .send({ contactName: 'Değiştirilmiş İsim' })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('DENETİM GÜNLÜĞÜ', () => {
    it('oluşturma, güncelleme, not ve silme kaydedilir', async () => {
      const customer = await createCustomer();

      await api()
        .patch(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .send({ city: 'Karaman' })
        .expect(HttpStatus.OK);

      await api()
        .post(`/api/v1/admin/customers/${customer.id}/notes`)
        .set(auth())
        .send({ body: 'Denetim testi notu' })
        .expect(HttpStatus.CREATED);

      await api()
        .delete(`/api/v1/admin/customers/${customer.id}`)
        .set(auth())
        .expect(HttpStatus.NO_CONTENT);

      const logs = await prisma.auditLog.findMany({
        where: { entityId: customer.id },
        select: { action: true, description: true },
      });

      const descriptions = logs.map((log) => log.description ?? '').join(' | ');

      expect(descriptions).toContain('Müşteri oluşturuldu');
      expect(descriptions).toContain('Müşteri güncellendi');
      expect(descriptions).toContain('Müşteri silindi');

      const noteLogs = await prisma.auditLog.findMany({
        where: { entityType: 'CustomerNote' },
        select: { description: true },
      });

      expect(noteLogs.some((log) => (log.description ?? '').includes('Müşteri notu eklendi'))).toBe(
        true,
      );
    });
  });
});
