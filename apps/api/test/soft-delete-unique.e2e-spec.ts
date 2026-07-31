import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';

import { AppConfigModule } from '../src/config/config.module';
import { PrismaModule } from '../src/infra/prisma/prisma.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * SOFT DELETE x UNIQUE — partial unique index sözleşme testi (Bölüm 0.4).
 *
 * NEDEN BU TEST VAR
 * Bu tablolar soft delete kullanır. Tam bir UNIQUE kısıtı SİLİNMİŞ kaydın
 * slug/sku/e-postasını da rezerve tutuyordu: "kimyasal-gubre" ürününü silen
 * kullanıcı aynı slug ile yenisini oluşturamıyor, aldığı hata "bu slug
 * kullanımda" diyor — ama listede öyle bir kayıt görünmüyordu. Hatanın sebebi
 * kullanıcıya görünmezdi.
 *
 * Kısıt `WHERE "deletedAt" IS NULL` ile daraltıldı. Bu testin iki yönü var ve
 * İKİSİ DE gerekli:
 *   1. Silinmiş kaydın değeri YENİDEN KULLANILABİLİR (yeni davranış).
 *   2. Yaşayan kayıtlar arasında teklik HÂLÂ ZORUNLU (eski güvence korunur).
 * Yalnız birincisini test etmek, kısıtı tamamen düşürmüş olsak da geçerdi.
 *
 * Ayrıca belge numaralarının BİLEREK dışarıda bırakıldığı doğrulanır: silinmiş
 * bir belgenin numarası sonsuza kadar rezervedir, aksi hâlde aynı numara iki
 * kayda işaret eder ve denetim izi bozulur.
 *
 * Prisma katmanı üzerinden değil, doğrudan veritabanına yazarak ölçer:
 * güvence veritabanı index'indedir, servis kontrolü yalnız anlaşılır hata
 * mesajı içindir.
 */
describe('Soft delete × unique (e2e)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;

  /** Testin ürettiği kayıtları ayırt etmek için ortak ön ek. */
  const PREFIX = `zz-partial-unique-${Date.now()}`;

  /**
   * Talep numarası için AYRI, BİÇİME UYGUN değer.
   *
   * `inquiryNumber` iki kısıta tabi ve keyfi bir test öneki ikisine de takılır:
   *   - VarChar(32)
   *   - chk_inquiries_number_format: `^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$`
   * Bu yüzden gerçek biçim kullanılır. Yıl olarak 2099 seçildi: sayaç o yıla
   * hiç gelmediği için test verisi gerçek numaralarla çakışmaz.
   */
  const TEST_INQUIRY_NUMBER = 'TLP-2099-900001';

  beforeAll(async () => {
    /*
     * AppConfigModule ZORUNLU: PrismaService, DATABASE_URL'i AppConfig'ten
     * alir. Yalnız PrismaModule verilirse Nest "AppConfig at index [0] is
     * available in the PrismaModule module" diye reddeder. AppModule yerine
     * bu iki modül: test veritabanına yazmak için tüm uygulamayı ayağa
     * kaldırmak gereksiz ve yavaş.
     */
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.usagePeriod.deleteMany({ where: { slug: { startsWith: PREFIX } } });
    await prisma.inquiry.deleteMany({ where: { inquiryNumber: { startsWith: 'TLP-2099-' } } });
    await moduleRef.close();
  });

  describe('insan tarafından yazılan tanımlayıcılar (slug)', () => {
    it('SİLİNMİŞ kaydın slug’ı yeniden kullanılabilir', async () => {
      const slug = `${PREFIX}-yeniden-kullanim`;

      const first = await prisma.usagePeriod.create({
        data: { name: 'Silinecek Dönem', slug },
      });

      await prisma.usagePeriod.update({
        where: { id: first.id },
        data: { deletedAt: new Date() },
      });

      // Eski davranışta bu satır UNIQUE ihlaliyle patlıyordu.
      const second = await prisma.usagePeriod.create({
        data: { name: 'Aynı Slug, Yeni Kayıt', slug },
      });

      expect(second.id).not.toBe(first.id);

      const living = await prisma.usagePeriod.findMany({
        where: { slug, deletedAt: null },
      });

      expect(living).toHaveLength(1);
      expect(living[0]?.id).toBe(second.id);
    });

    it('YAŞAYAN iki kayıt aynı slug’ı alamaz — teklik korunur', async () => {
      const slug = `${PREFIX}-teklik`;

      await prisma.usagePeriod.create({ data: { name: 'İlk', slug } });

      /*
       * Bu beklenti kısıtın HÂLÂ var olduğunu kanıtlar. Olmasaydı partial
       * index'i tamamen düşürmüş olurduk ve önceki test yine geçerdi.
       */
      await expect(
        prisma.usagePeriod.create({ data: { name: 'İkinci', slug } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('aynı slug birden çok SİLİNMİŞ kayıtta bulunabilir', async () => {
      const slug = `${PREFIX}-cok-silinmis`;
      const now = new Date();

      const a = await prisma.usagePeriod.create({ data: { name: 'A', slug } });

      await prisma.usagePeriod.update({ where: { id: a.id }, data: { deletedAt: now } });

      const b = await prisma.usagePeriod.create({ data: { name: 'B', slug } });

      await prisma.usagePeriod.update({ where: { id: b.id }, data: { deletedAt: now } });

      const all = await prisma.usagePeriod.findMany({ where: { slug } });

      expect(all).toHaveLength(2);
      expect(all.every((row) => row.deletedAt !== null)).toBe(true);
    });
  });

  describe('belge numaraları — BİLEREK dışarıda', () => {
    it('SİLİNMİŞ talebin numarası yeniden kullanılamaz', async () => {
      const inquiryNumber = TEST_INQUIRY_NUMBER;

      const first = await prisma.inquiry.create({
        data: {
          inquiryNumber,
          contactName: 'Test Kayıt',
          contactPhone: '5550000000',
          city: 'Konya',
          district: 'Selçuklu',
          // chk_inquiries_consent: onay tarihi varsa onay da verilmiş olmalı.
          consentAccepted: true,
          consentAt: new Date(),
        },
      });

      await prisma.inquiry.update({
        where: { id: first.id },
        data: { deletedAt: new Date() },
      });

      /*
       * Slug'ın tersine BURADA yeniden kullanım YASAK. Bir belge numarasının
       * iki kayda işaret etmesi denetim izini bozar ve sayaç mantığıyla
       * çelişir; bu yüzden `inquiries."inquiryNumber"` tam unique bırakıldı.
       */
      await expect(
        prisma.inquiry.create({
          data: {
            inquiryNumber,
            contactName: 'İkinci Kayıt',
            contactPhone: '5550000001',
            city: 'Konya',
            district: 'Selçuklu',
            consentAccepted: true,
            consentAt: new Date(),
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });
  });
});
