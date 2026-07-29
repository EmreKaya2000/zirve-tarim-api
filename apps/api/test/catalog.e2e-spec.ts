import { HttpStatus } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { PrismaClient, UserRole } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';

/**
 * Katalog taksonomisi uçtan uca testleri (Sprint 3).
 *
 * GERÇEK PostgreSQL üzerinde koşar: slug benzersizliği, kategori ağacı ve
 * döngü engeli yalnız gerçek veritabanında anlamlı biçimde doğrulanabilir.
 */
describe('Katalog (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaClient;

  const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

  const SUPER_ADMIN = {
    email: 'cat.super@zirvetarim.test',
    password: 'CatSuperSifre123',
    role: UserRole.SUPER_ADMIN,
  };

  const ADMIN = {
    email: 'cat.admin@zirvetarim.test',
    password: 'CatAdminSifre123',
    role: UserRole.ADMIN,
  };

  /** Test kayıtlarını ayırt etmek için ortak önek. */
  const PREFIX = 'E2ETest';

  let superToken = '';
  let adminToken = '';

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

    await cleanup();

    for (const user of [SUPER_ADMIN, ADMIN]) {
      await prisma.user.create({
        data: {
          email: user.email,
          passwordHash: await hash(user.password, ARGON2_OPTIONS),
          fullName: `E2E ${user.role}`,
          role: user.role,
          isActive: true,
        },
      });
    }

    superToken = await login(SUPER_ADMIN.email, SUPER_ADMIN.password);
    adminToken = await login(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  async function login(email: string, password: string): Promise<string> {
    const response = await api().post('/api/v1/auth/login').send({ email, password });

    expect(response.status).toBe(HttpStatus.OK);

    return response.body.data.accessToken as string;
  }

  /** Test verisini temizler. Denetim kaydı için RULE geçici kapatılır. */
  async function cleanup(): Promise<void> {
    await prisma.category.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.plant.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.brand.deleteMany({ where: { name: { startsWith: PREFIX } } });
    await prisma.unitType.deleteMany({ where: { name: { startsWith: PREFIX } } });

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
  describe('Yetkilendirme', () => {
    it('jetonsuz admin ucu 401 döner', async () => {
      await api().get('/api/v1/admin/plants').expect(HttpStatus.UNAUTHORIZED);
    });

    it('ADMIN rolü taksonomiyi yönetebilir', async () => {
      await api()
        .get('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(HttpStatus.OK);
    });

    it('public uçlar jeton İSTEMEZ', async () => {
      await api().get('/api/v1/public/categories/tree').expect(HttpStatus.OK);
      await api().get('/api/v1/public/plants').expect(HttpStatus.OK);
      await api().get('/api/v1/public/unit-types').expect(HttpStatus.OK);
    });

    it('ayar DEĞİŞTİRME yalnız SUPER_ADMIN yetkisindedir', async () => {
      const forbidden = await api()
        .patch('/api/v1/admin/settings/store.phone')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: '+90 111 111 11 11' });

      expect(forbidden.status).toBe(HttpStatus.FORBIDDEN);

      const allowed = await api()
        .patch('/api/v1/admin/settings/store.phone')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ value: '+90 222 222 22 22' });

      expect(allowed.status).toBe(HttpStatus.OK);
    });
  });

  // =========================================================================
  describe('Slug üretimi', () => {
    it('Türkçe karakterleri dönüştürür', async () => {
      const response = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Şeftali Ağacı` });

      expect(response.status).toBe(HttpStatus.CREATED);
      expect(response.body.data.slug).toBe('e2etest-seftali-agaci');
    });

    it('çakışan slug a sonek ekler', async () => {
      const first = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Kavun` });

      const second = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Kavun` });

      expect(first.body.data.slug).toBe('e2etest-kavun');
      expect(second.body.data.slug).toBe('e2etest-kavun-2');
    });

    it('istemciden gelen slug REDDEDİLİR (sunucu üretir)', async () => {
      const response = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Karpuz`, slug: 'elle-verilen-slug' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('ad değişmediğinde slug KORUNUR', async () => {
      const created = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Ayva` });

      const updated = await api()
        .patch(`/api/v1/admin/plants/${created.body.data.id}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ description: 'Açıklama değişti, ad aynı.' });

      expect(updated.body.data.slug).toBe(created.body.data.slug);
    });

    it('ad değiştiğinde slug YENİDEN üretilir', async () => {
      const created = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Erik` });

      const updated = await api()
        .patch(`/api/v1/admin/plants/${created.body.data.id}`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Kayısı` });

      expect(updated.body.data.slug).toBe('e2etest-kayisi');
    });
  });

  // =========================================================================
  describe('Ortak liste altyapısı', () => {
    it('sayfalama meta bilgisi döndürür', async () => {
      const response = await api()
        .get('/api/v1/admin/plants?page=1&limit=5')
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.status).toBe(HttpStatus.OK);
      expect(response.body.meta).toMatchObject({ page: 1, limit: 5 });
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });

    it('totalPages doğru hesaplanır', async () => {
      const response = await api()
        .get('/api/v1/admin/plants?limit=3')
        .set('Authorization', `Bearer ${superToken}`);

      const { total, limit, totalPages } = response.body.meta;

      expect(totalPages).toBe(Math.ceil(total / limit));
    });

    it('arama filtresi uygular', async () => {
      await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} BenzersizAramaTerimi` });

      const response = await api()
        .get('/api/v1/admin/plants?search=BenzersizAramaTerimi')
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.body.data).toHaveLength(1);
    });

    it('limit üst sınırını (100) aşan istek reddedilir', async () => {
      await api()
        .get('/api/v1/admin/plants?limit=500')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('whitelist dışı sortBy reddedilir', async () => {
      await api()
        .get('/api/v1/admin/plants?sortBy=passwordHash')
        .set('Authorization', `Bearer ${superToken}`)
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('aktiflik filtresi çalışır', async () => {
      const created = await api()
        .post('/api/v1/admin/plants')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} PasifBitki` });

      await api()
        .patch(`/api/v1/admin/plants/${created.body.data.id}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ isActive: false });

      const activeOnly = await api()
        .get(`/api/v1/admin/plants?isActive=true&search=PasifBitki`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(activeOnly.body.data).toHaveLength(0);

      const inactiveOnly = await api()
        .get(`/api/v1/admin/plants?isActive=false&search=PasifBitki`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(inactiveOnly.body.data).toHaveLength(1);
    });
  });

  // =========================================================================
  describe('Kategori ağacı', () => {
    let rootId = '';
    let childId = '';
    let grandChildId = '';

    beforeAll(async () => {
      const root = await api()
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Kök` });
      rootId = root.body.data.id;

      const child = await api()
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Çocuk`, parentId: rootId });
      childId = child.body.data.id;

      const grandChild = await api()
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} Torun`, parentId: childId });
      grandChildId = grandChild.body.data.id;
    });

    it('ağaç ucu hiyerarşiyi doğru kurar', async () => {
      const response = await api().get('/api/v1/public/categories/tree');

      expect(response.status).toBe(HttpStatus.OK);

      const root = findNode(response.body.data, `${PREFIX} Kök`);

      expect(root).toBeDefined();
      expect(root?.depth).toBe(0);
      expect(root?.children[0]?.name).toBe(`${PREFIX} Çocuk`);
      expect(root?.children[0]?.depth).toBe(1);
      expect(root?.children[0]?.children[0]?.name).toBe(`${PREFIX} Torun`);
      expect(root?.children[0]?.children[0]?.depth).toBe(2);
    });

    it('breadcrumb kökten kategoriye yolu döner', async () => {
      const response = await api()
        .get(`/api/v1/admin/categories/${grandChildId}/breadcrumb`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.body.data.map((item: { name: string }) => item.name)).toEqual([
        `${PREFIX} Kök`,
        `${PREFIX} Çocuk`,
        `${PREFIX} Torun`,
      ]);
    });

    describe('DÖNGÜ ENGELİ', () => {
      it('kategori kendisinin altına taşınamaz', async () => {
        const response = await api()
          .patch(`/api/v1/admin/categories/${rootId}`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ parentId: rootId });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
        expect(response.body.error.code).toBe('UNPROCESSABLE');
      });

      it('kategori kendi ÇOCUĞUNUN altına taşınamaz', async () => {
        const response = await api()
          .patch(`/api/v1/admin/categories/${rootId}`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ parentId: childId });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      });

      it('kategori kendi TORUNUNUN altına taşınamaz', async () => {
        const response = await api()
          .patch(`/api/v1/admin/categories/${rootId}`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ parentId: grandChildId });

        expect(response.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      });

      it('geçerli taşımaya izin verir', async () => {
        const sibling = await api()
          .post('/api/v1/admin/categories')
          .set('Authorization', `Bearer ${superToken}`)
          .send({ name: `${PREFIX} Kardeş` });

        const response = await api()
          .patch(`/api/v1/admin/categories/${sibling.body.data.id}`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ parentId: rootId });

        expect(response.status).toBe(HttpStatus.OK);
        expect(response.body.data.parentId).toBe(rootId);
      });

      it('bilinmeyen üst kategori 404 döner', async () => {
        const response = await api()
          .patch(`/api/v1/admin/categories/${childId}`)
          .set('Authorization', `Bearer ${superToken}`)
          .send({ parentId: '00000000-0000-4000-8000-000000000000' });

        expect(response.status).toBe(HttpStatus.NOT_FOUND);
      });
    });

    it('alt kategorisi olan kategori SİLİNEMEZ', async () => {
      const response = await api()
        .delete(`/api/v1/admin/categories/${rootId}`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(response.status).toBe(HttpStatus.CONFLICT);
      expect(response.body.error.code).toBe('CONFLICT');
    });

    it('pasife alınan kategorinin alt ağacı da pasife alınır', async () => {
      await api()
        .patch(`/api/v1/admin/categories/${childId}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ isActive: false });

      const grandChild = await prisma.category.findUnique({ where: { id: grandChildId } });

      expect(grandChild?.isActive).toBe(false);

      // Public ağaçta artık görünmemeli.
      const tree = await api().get('/api/v1/public/categories/tree');
      const root = findNode(tree.body.data, `${PREFIX} Kök`);

      expect(findNode(root === undefined ? [] : [root], `${PREFIX} Çocuk`)).toBeUndefined();

      await api()
        .patch(`/api/v1/admin/categories/${childId}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ isActive: true });
    });
  });

  // =========================================================================
  describe('Soft delete', () => {
    it('silinen kayıt listede görünmez ama veritabanında kalır', async () => {
      const created = await api()
        .post('/api/v1/admin/brands')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} SilinecekMarka` });

      const id = created.body.data.id;

      await api()
        .delete(`/api/v1/admin/brands/${id}`)
        .set('Authorization', `Bearer ${superToken}`)
        .expect(HttpStatus.NO_CONTENT);

      const list = await api()
        .get(`/api/v1/admin/brands?search=SilinecekMarka`)
        .set('Authorization', `Bearer ${superToken}`);

      expect(list.body.data).toHaveLength(0);

      // Kayıt fiziksel olarak DURUYOR.
      const inDatabase = await prisma.brand.findUnique({ where: { id } });

      expect(inDatabase).not.toBeNull();
      expect(inDatabase?.deletedAt).not.toBeNull();
    });
  });

  // =========================================================================
  describe('Birimler — allowsDecimal', () => {
    it('birim kodu benzersizdir', async () => {
      await api()
        .post('/api/v1/admin/unit-types')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          name: `${PREFIX} TestBirim`,
          code: 'tstb',
          measurementType: 'WEIGHT',
          allowsDecimal: true,
        })
        .expect(HttpStatus.CREATED);

      const duplicate = await api()
        .post('/api/v1/admin/unit-types')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          name: `${PREFIX} BaskaBirim`,
          code: 'tstb',
          measurementType: 'COUNT',
          allowsDecimal: false,
        });

      expect(duplicate.status).toBe(HttpStatus.CONFLICT);
      expect(duplicate.body.error.code).toBe('CONFLICT');
    });

    it('seed birimlerinde allowsDecimal doğru ayarlıdır', async () => {
      const response = await api().get('/api/v1/public/unit-types');
      const units = response.body.data as { code: string; allowsDecimal: boolean }[];

      const byCode = new Map(units.map((unit) => [unit.code, unit.allowsDecimal]));

      // Ağırlık ve hacim ondalıklı olabilir.
      expect(byCode.get('kg')).toBe(true);
      expect(byCode.get('lt')).toBe(true);
      // Sayılabilir ve ambalaj birimleri olamaz.
      expect(byCode.get('ad')).toBe(false);
      expect(byCode.get('cv')).toBe(false);
    });

    it('geçersiz birim kodu reddedilir', async () => {
      await api()
        .post('/api/v1/admin/unit-types')
        .set('Authorization', `Bearer ${superToken}`)
        .send({
          name: `${PREFIX} HataliKod`,
          code: 'KG BÜYÜK',
          measurementType: 'WEIGHT',
          allowsDecimal: true,
        })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });

  // =========================================================================
  describe('Ayarlar', () => {
    it('public uç yalnız isPublic=true ayarları döner', async () => {
      const response = await api().get('/api/v1/public/settings');
      const keys = (response.body.data as { key: string }[]).map((item) => item.key);

      expect(keys).toContain('store.phone');
      expect(keys).toContain('legal.productWarning');
      // Dahili ayarlar SIZMAMALI.
      expect(keys).not.toContain('sales.defaultTaxRate');
      expect(keys).not.toContain('inventory.allowNegativeStock');
    });

    it('public yanıtta dahili alanlar bulunmaz', async () => {
      const response = await api().get('/api/v1/public/settings');
      const body = JSON.stringify(response.body);

      expect(body).not.toContain('"group"');
      expect(body).not.toContain('"isPublic"');
      expect(body).not.toContain('"description"');
    });

    it('yasal uyarı metni seed ile yüklenmiştir', async () => {
      const response = await api().get('/api/v1/public/settings');
      const warning = (response.body.data as { key: string; value: string }[]).find(
        (item) => item.key === 'legal.productWarning',
      );

      expect(warning).toBeDefined();
      expect(warning?.value.length).toBeGreaterThan(100);
    });

    it('sayısal ayara metin yazılamaz', async () => {
      const response = await api()
        .patch('/api/v1/admin/settings/sales.defaultTaxRate')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ value: 'yirmi' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('boolean ayara geçersiz değer yazılamaz', async () => {
      const response = await api()
        .patch('/api/v1/admin/settings/inventory.allowNegativeStock')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ value: 'belki' });

      expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('bilinmeyen ayar anahtarı 404 döner', async () => {
      await api()
        .patch('/api/v1/admin/settings/boyle.bir.ayar.yok')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ value: 'x' })
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  // =========================================================================
  describe('Public taksonomi', () => {
    it('tek çağrıda tüm taksonomiyi döner', async () => {
      const response = await api().get('/api/v1/public/taxonomy');

      expect(response.status).toBe(HttpStatus.OK);
      expect(Array.isArray(response.body.data.categories)).toBe(true);
      expect(Array.isArray(response.body.data.brands)).toBe(true);
      expect(Array.isArray(response.body.data.unitTypes)).toBe(true);
    });

    it('include ile yalnız istenen bölümleri döner', async () => {
      const response = await api().get('/api/v1/public/taxonomy?include=brands,plants');

      expect(response.body.data.brands).toBeDefined();
      expect(response.body.data.plants).toBeDefined();
      expect(response.body.data.categories).toBeUndefined();
    });

    it('public listelerde PASİF kayıt bulunmaz', async () => {
      const created = await api()
        .post('/api/v1/admin/brands')
        .set('Authorization', `Bearer ${superToken}`)
        .send({ name: `${PREFIX} GizliMarka` });

      await api()
        .patch(`/api/v1/admin/brands/${created.body.data.id}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .send({ isActive: false });

      const response = await api().get('/api/v1/public/brands');
      const names = (response.body.data as { name: string }[]).map((item) => item.name);

      expect(names).not.toContain(`${PREFIX} GizliMarka`);
    });
  });
});

/** Ağaç düğümünün test tarafındaki şekli. */
interface TreeNode {
  name: string;
  depth: number;
  children: TreeNode[];
}

/** Ağaçta ada göre düğüm arar (derinlemesine). */
function findNode(nodes: TreeNode[], name: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) {
      return node;
    }

    const found = findNode(node.children, name);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}
