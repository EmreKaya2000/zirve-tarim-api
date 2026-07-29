/**
 * Prisma seed betiği.
 *
 * Çalıştırma:  pnpm prisma:seed
 *
 * İDEMPOTENT: `upsert` ve "varsa atla" kullanır; birden çok kez
 * çalıştırılabilir ve kayıt çoğaltmaz. Yöneticinin panelden yaptığı
 * değişiklikler EZİLMEZ — süper yöneticinin şifresi dahil.
 *
 * =============================================================================
 * SEED İKİ KÜMEYE AYRILMIŞTIR (Sprint 12 — prod-safe)
 * =============================================================================
 *
 * SİSTEM VERİSİ — daima yüklenir:
 *   ayarlar, süper yönetici, ölçü birimleri ve tarımsal referans taksonomisi
 *   (kategoriler, bitkiler, toprak türleri, yararlar, yan etkiler, kullanım
 *   dönemleri). Bunlar olmadan mağaza TEK ÜRÜN BİLE oluşturamaz: varyasyon bir
 *   ölçü birimi, ürün bir kategori ister.
 *
 * DEMO VERİSİ — yalnız izin verilirse:
 *   markalar, ürünler, ürün ilişkileri, müşteriler. Bunlar UYDURMA kayıtlardır
 *   ("AgroMax", "Ahmet Yılmaz — 25.000 TL kredi limiti"). Gerçek bir mağazanın
 *   kataloğuna ve müşteri listesine karışmaları kabul edilemez; kredi limitli
 *   sahte bir müşteri, ilk vadeli satışta gerçek bir finansal kayda dönüşür.
 *
 * KARAR: demo verisi `NODE_ENV=production` iken VARSAYILAN OLARAK YÜKLENMEZ.
 * Bilinçli olarak istenirse `SEED_DEMO_DATA=true` ile açılır (ör. üretim
 * yapılandırmasıyla çalışan bir tanıtım/staging ortamı) ve o durumda gürültülü
 * bir uyarı basılır. Varsayılanı "yükle" bırakmak, `prisma migrate deploy &&
 * prisma db seed` zincirini kuran ilk kişinin gerçek kataloğu kirletmesi
 * anlamına gelirdi — geri alması da elle silmekten başka yolu olmayan bir hata.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from '@node-rs/argon2';
import {
  Prisma,
  PrismaClient,
  StockMovementDirection,
  StockMovementType,
  UserRole,
} from '@prisma/client';

import {
  LEGAL_WARNING_TEXT,
  SEED_BENEFITS,
  SEED_BRANDS,
  SEED_CATEGORIES,
  SEED_CUSTOMERS,
  SEED_PLANTS,
  SEED_SIDE_EFFECTS,
  SEED_SOIL_TYPES,
  SEED_UNIT_TYPES,
  SEED_USAGE_PERIODS,
  type SeedCategory,
} from './seed-data/catalog';
import { SEED_PRODUCTS, SEED_PRODUCT_RELATIONS } from './seed-data/products';
import { slugify } from '../src/common/utils/slug.util';

const prisma = new PrismaClient();

/**
 * Örnek ürün görseli.
 *
 * Gerçek bir yükleme yapılmadığı için dosya depolama köküne KOPYALANIR;
 * yalnız veritabanı kaydı oluşturmak yetmez, o durumda görsel 404 döner.
 * Anahtar ve URL biçimi LocalDiskStorage ile birebir aynıdır.
 */
const PLACEHOLDER_SOURCE = join(__dirname, 'seed-data', 'assets', 'placeholder-product.png');

/** Yükleme kökü — LocalDiskStorage.UPLOAD_ROOT ile aynı olmalıdır. */
const UPLOAD_ROOT = 'uploads';

/** Depolama anahtarını public URL'ye çevirir (LocalDiskStorage.getUrl ile aynı). */
function storageKeyToUrl(storageKey: string): string {
  return `/${UPLOAD_ROOT}/${storageKey.split(/[\\/]/).join('/')}`;
}

/** Argon2id parametreleri — PasswordService ile birebir aynı olmalıdır. */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

interface SeedSetting {
  key: string;
  value: string;
  valueType: 'string' | 'number' | 'boolean' | 'json';
  group: string;
  description: string;
  isPublic: boolean;
}

/**
 * Varsayılan sistem ayarları.
 *
 * DİKKAT: `isPublic = true` olan her ayar kimlik doğrulaması olmadan
 * dışarıya açılır. Hassas hiçbir değer public işaretlenmemelidir (Kural 8).
 */
const DEFAULT_SETTINGS: SeedSetting[] = [
  // --- Mağaza bilgileri (public) ---
  {
    key: 'store.name',
    value: 'Zirve Tarım',
    valueType: 'string',
    group: 'store',
    description: 'Mağazanın görünen adı.',
    isPublic: true,
  },
  {
    key: 'store.phone',
    value: '+90 000 000 00 00',
    valueType: 'string',
    group: 'store',
    description: 'Müşterilerin arayacağı mağaza telefonu.',
    isPublic: true,
  },
  {
    key: 'store.email',
    value: 'info@zirvetarim.example',
    valueType: 'string',
    group: 'store',
    description: 'İletişim e-posta adresi.',
    isPublic: true,
  },
  {
    key: 'store.address',
    value: 'Mağaza adresi henüz girilmedi.',
    valueType: 'string',
    group: 'store',
    description: 'Mağazanın açık adresi.',
    isPublic: true,
  },
  {
    key: 'store.workingHours',
    value: 'Pazartesi-Cumartesi 08:00-19:00',
    valueType: 'string',
    group: 'store',
    description: 'Çalışma saatleri metni.',
    isPublic: true,
  },
  {
    // Yalnız rakam ve ülke kodu; site "https://wa.me/<numara>" bağlantısını
    // bundan üretir. Boş bırakılırsa WhatsApp bağlantısı hiç gösterilmez.
    key: 'store.whatsapp',
    value: '905321234567',
    valueType: 'string',
    group: 'store',
    description: 'WhatsApp numarası (ülke kodu dahil, yalnız rakam).',
    isPublic: true,
  },
  {
    key: 'store.mapUrl',
    value: 'https://maps.google.com/?q=Zirve+Tarim',
    valueType: 'string',
    group: 'store',
    description: 'Harita/yol tarifi bağlantısı.',
    isPublic: true,
  },

  // --- Genel (dahili) ---
  {
    key: 'general.currency',
    value: 'TRY',
    valueType: 'string',
    group: 'general',
    description: 'Sistem para birimi. MVP kapsamında yalnız TRY desteklenir.',
    isPublic: false,
  },
  {
    key: 'general.requestNumberPrefix',
    value: 'TLP',
    valueType: 'string',
    group: 'general',
    description: 'Talep numarası ön eki. Örn. TLP-2026-000042',
    isPublic: false,
  },
  {
    key: 'general.saleNumberPrefix',
    value: 'SAT',
    valueType: 'string',
    group: 'general',
    description: 'Satış numarası ön eki. Örn. SAT-2026-000123',
    isPublic: false,
  },
  {
    // NOT: Satış ve ödeme ön ekleri şu anda KODDAKİ sabitlerden gelir
    // (@zirve/types -> SALE_NUMBER_PREFIX / PAYMENT_NUMBER_PREFIX); talep
    // ön eki ise bu ayardan okunur. Bu ayarlar üçünü de ayardan okuyacak
    // şekilde birleştirilene kadar DEĞERLERİ KODLA AYNI TUTULMALIDIR —
    // aksi hâlde yönetici ayarı değiştirir ve hiçbir şey olmaz.
    key: 'general.paymentNumberPrefix',
    value: 'ODM',
    valueType: 'string',
    group: 'general',
    description: 'Tahsilat numarası ön eki. Örn. ODM-2026-000871',
    isPublic: false,
  },

  // --- Satış (dahili) ---
  {
    key: 'sales.defaultTaxRate',
    value: '20.000',
    valueType: 'number',
    group: 'sales',
    description:
      'Yeni ürünler için varsayılan KDV oranı (yüzde). Kural 12 gereği kodda sabit yazılmaz.',
    isPublic: false,
  },
  {
    key: 'sales.taxIncluded',
    value: 'true',
    valueType: 'boolean',
    group: 'sales',
    description:
      'Ürün fiyatları KDV dahil mi? VARSAYIM V-03 — şartname bu noktada sessiz (§9.1 KDVyi opsiyonel bırakıyor), karar hâlâ yazılı onay bekliyor. Üretimde satış kaydı oluştuktan sonra DEĞİŞTİRİLMEMELİ: geçmiş tutarlar tutarsız kalır (docs/ARCHITECTURE.md R-13).',
    isPublic: false,
  },

  // --- Stok (dahili) ---
  {
    key: 'inventory.allowNegativeStock',
    value: 'false',
    valueType: 'boolean',
    group: 'inventory',
    description:
      'Negatif stoğa izin verilsin mi? Varsayılan false; yalnız SUPER_ADMIN değiştirebilir (docs/ARCHITECTURE.md §13.4).',
    isPublic: false,
  },
  {
    key: 'inventory.criticalStockWarning',
    value: 'true',
    valueType: 'boolean',
    group: 'inventory',
    description: 'Kritik stok eşiğinin altına düşen ürünler için uyarı gösterilsin mi?',
    isPublic: false,
  },

  // --- Yasal (public) ---
  {
    key: 'legal.productWarning',
    value: LEGAL_WARNING_TEXT,
    valueType: 'string',
    group: 'general',
    description:
      'Ürün detay sayfasında gösterilen bilgilendirme metni. İlk paragraf SPEC §4.7den birebir alındı ve zorunludur; kalan paragraflar ek güvenlik bilgisidir. Şartname metnin buradan düzenlenebilmesini şart koşuyor.',
    isPublic: true,
  },

  // --- SEO (public) ---
  {
    key: 'seo.defaultMetaTitle',
    value: 'Zirve Tarım — Ziraat ve Tarım Ürünleri',
    valueType: 'string',
    group: 'seo',
    description: 'Meta başlığı verilmemiş sayfalar için varsayılan başlık.',
    isPublic: true,
  },
  {
    key: 'seo.defaultMetaDescription',
    value: 'Zirai ilaç, gübre, tohum ve sulama ekipmanları. Ürünleri inceleyin, talebinizi iletin.',
    valueType: 'string',
    group: 'seo',
    description: 'Varsayılan meta açıklaması.',
    isPublic: true,
  },
];

async function seedSettings(): Promise<void> {
  console.log(`  Ayarlar yükleniyor (${DEFAULT_SETTINGS.length} kayıt)...`);

  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      // Mevcut kaydın DEĞERİ ezilmez — yönetici panelden değiştirmiş olabilir.
      // Yalnız üstveri (tip, grup, açıklama, görünürlük) güncellenir.
      update: {
        valueType: setting.valueType,
        group: setting.group,
        description: setting.description,
        isPublic: setting.isPublic,
      },
      create: setting,
    });
  }

  const total = await prisma.setting.count();
  console.log(`  Ayarlar tamam. Toplam kayıt: ${total}`);
}

/**
 * İlk SUPER_ADMIN kullanıcısını oluşturur.
 *
 * Bilgiler ortam değişkenlerinden okunur — depoya asla girmez.
 * Kullanıcı zaten varsa ŞİFRESİ EZİLMEZ: yönetici değiştirmiş olabilir ve
 * seed'in tekrar çalışması güvenlik ayarını geri almamalıdır.
 */
async function seedSuperAdmin(): Promise<void> {
  const email = (process.env['SEED_SUPER_ADMIN_EMAIL'] ?? 'admin@zirvetarim.local')
    .trim()
    .toLowerCase();
  const password = process.env['SEED_SUPER_ADMIN_PASSWORD'] ?? 'ZirveTarim2026';
  const fullName = process.env['SEED_SUPER_ADMIN_NAME'] ?? 'Sistem Yöneticisi';

  const existing = await prisma.user.findFirst({ where: { email } });

  if (existing !== null) {
    console.log(`  Süper yönetici zaten mevcut: ${email} (şifre değiştirilmedi)`);
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log(`  Süper yönetici oluşturuldu: ${email}`);

  if (password === 'ZirveTarim2026') {
    console.warn(
      '  UYARI: Varsayılan seed şifresi kullanıldı. İlk girişten sonra mutlaka değiştirin.',
    );
  }
}

/**
 * Katalog taksonomisini yükler.
 *
 * Tüm kayıtlar `slug` üzerinden upsert edilir: seed birden çok kez
 * çalıştırılabilir ve mevcut kayıtları çoğaltmaz. Yöneticinin panelden
 * yaptığı içerik değişiklikleri EZİLMEZ — yalnız kayıt yoksa oluşturulur.
 */
async function seedCatalogTaxonomy(): Promise<void> {
  console.log('  Katalog taksonomisi yükleniyor...');

  await seedCategoryTree(SEED_CATEGORIES, null, 0);
  const categoryCount = await prisma.category.count();
  console.log(`    Kategoriler: ${categoryCount}`);

  for (const plant of SEED_PLANTS) {
    await prisma.plant.upsert({
      where: { slug: slugify(plant.name) },
      update: {},
      create: { ...plant, slug: slugify(plant.name) },
    });
  }
  console.log(`    Bitkiler: ${await prisma.plant.count()}`);

  for (const soilType of SEED_SOIL_TYPES) {
    await prisma.soilType.upsert({
      where: { slug: slugify(soilType.name) },
      update: {},
      create: { ...soilType, slug: slugify(soilType.name) },
    });
  }
  console.log(`    Toprak türleri: ${await prisma.soilType.count()}`);

  for (const unit of SEED_UNIT_TYPES) {
    const { conversionFactor, ...rest } = unit;

    await prisma.unitType.upsert({
      where: { slug: slugify(unit.name) },
      update: {},
      create: {
        ...rest,
        slug: slugify(unit.name),
        // Kural 2: katsayı float'a uğratılmadan doğrudan Decimal'e verilir.
        conversionFactor:
          conversionFactor === undefined ? null : new Prisma.Decimal(conversionFactor),
      },
    });
  }
  console.log(`    Birimler: ${await prisma.unitType.count()}`);

  for (const period of SEED_USAGE_PERIODS) {
    await prisma.usagePeriod.upsert({
      where: { slug: slugify(period.name) },
      update: {},
      create: { ...period, slug: slugify(period.name) },
    });
  }
  console.log(`    Kullanım dönemleri: ${await prisma.usagePeriod.count()}`);

  for (const benefit of SEED_BENEFITS) {
    await prisma.benefit.upsert({
      where: { slug: slugify(benefit.name) },
      update: {},
      create: { ...benefit, slug: slugify(benefit.name) },
    });
  }
  console.log(`    Yararlar: ${await prisma.benefit.count()}`);

  for (const sideEffect of SEED_SIDE_EFFECTS) {
    await prisma.sideEffect.upsert({
      where: { slug: slugify(sideEffect.name) },
      update: {},
      create: { ...sideEffect, slug: slugify(sideEffect.name) },
    });
  }
  console.log(`    Yan etkiler: ${await prisma.sideEffect.count()}`);
}

/**
 * Kategori ağacını özyinelemeli olarak yükler.
 *
 * Slug çakışmalarını önlemek için alt kategorilerin slug'ı üst kategori
 * adıyla önekLENMEZ; bunun yerine çakışma hâlinde sonek eklenir. Böylece
 * "Sıvı Gübre" -> `sivi-gubre` gibi temiz ve okunabilir adresler kalır.
 */
async function seedCategoryTree(
  nodes: SeedCategory[],
  parentId: string | null,
  depth: number,
): Promise<void> {
  for (const [index, node] of nodes.entries()) {
    const slug = await uniqueCategorySlug(node.name);

    const existing = await prisma.category.findFirst({
      where: { name: node.name, parentId },
      select: { id: true },
    });

    const category =
      existing ??
      (await prisma.category.create({
        data: {
          name: node.name,
          slug,
          parentId,
          description: node.description ?? null,
          icon: node.icon ?? null,
          sortOrder: index + 1,
          isActive: true,
        },
        select: { id: true },
      }));

    if (node.children !== undefined && node.children.length > 0) {
      await seedCategoryTree(node.children, category.id, depth + 1);
    }
  }
}

/** Kategori için benzersiz slug üretir; çakışırsa sonek ekler. */
async function uniqueCategorySlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  while ((await prisma.category.findUnique({ where: { slug: candidate } })) !== null) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Örnek ürünleri yükler.
 *
 * SKU üzerinden idempotent: varyasyonun SKU'su zaten varsa ürün atlanır.
 * Böylece seed tekrar çalıştırıldığında kopya ürün oluşmaz.
 */
/**
 * Örnek görseli depolama köküne ÜRÜNE ÖZEL bir adla kopyalar.
 *
 * Tek bir paylaşılan dosya kullanılmaz: yönetici bir ürünün görselini
 * sildiğinde UploadsService dosyayı diskten de siler ve aynı dosyayı
 * gösteren diğer ürünlerin görselleri kırılırdı. Her kayıt kendi
 * dosyasına sahiptir — gerçek yüklemelerle aynı davranış.
 *
 * Kopyalama idempotent'tir: hedef varsa üzerine yazılır.
 */
async function copyPlaceholderImage(slug: string): Promise<{ key: string; size: number }> {
  const folder = join('products', 'seed');
  const key = join(folder, `${slug}.png`);
  const absoluteFolder = join(process.cwd(), UPLOAD_ROOT, folder);

  await mkdir(absoluteFolder, { recursive: true });
  await copyFile(PLACEHOLDER_SOURCE, join(process.cwd(), UPLOAD_ROOT, key));

  const info = await stat(join(process.cwd(), UPLOAD_ROOT, key));

  return { key, size: info.size };
}

async function seedProducts(): Promise<void> {
  console.log('  Ürünler yükleniyor...');

  // Slug -> id eşlemeleri tek seferde çekilir; her ürün için ayrı sorgu N+1 olurdu.
  const [categories, brands, plants, soilTypes, benefits, sideEffects, usagePeriods, unitTypes] =
    await Promise.all([
      prisma.category.findMany({ select: { id: true, slug: true } }),
      prisma.brand.findMany({ select: { id: true, slug: true } }),
      prisma.plant.findMany({ select: { id: true, slug: true } }),
      prisma.soilType.findMany({ select: { id: true, slug: true } }),
      prisma.benefit.findMany({ select: { id: true, slug: true } }),
      prisma.sideEffect.findMany({ select: { id: true, slug: true } }),
      prisma.usagePeriod.findMany({ select: { id: true, slug: true } }),
      prisma.unitType.findMany({ select: { id: true, code: true } }),
    ]);

  const idBySlug = (rows: { id: string; slug: string }[]): Map<string, string> =>
    new Map(rows.map((row) => [row.slug, row.id]));

  const categoryId = idBySlug(categories);
  const brandId = idBySlug(brands);
  const plantId = idBySlug(plants);
  const soilTypeId = idBySlug(soilTypes);
  const benefitId = idBySlug(benefits);
  const sideEffectId = idBySlug(sideEffects);
  const usagePeriodId = idBySlug(usagePeriods);
  const unitTypeId = new Map(unitTypes.map((unit) => [unit.code, unit.id]));

  let created = 0;
  let skipped = 0;

  for (const item of SEED_PRODUCTS) {
    const firstSku = item.variants[0]?.sku;

    if (firstSku === undefined) {
      continue;
    }

    const existing = await prisma.productVariant.findUnique({ where: { sku: firstSku } });

    if (existing !== null) {
      skipped += 1;
      continue;
    }

    const slug = await uniqueProductSlug(item.name);

    const resolvedCategories = item.categorySlugs
      .map((categorySlug, index) => {
        const id = categoryId.get(categorySlug);

        return id === undefined ? undefined : { categoryId: id, isPrimary: index === 0 };
      })
      .filter((value): value is { categoryId: string; isPrimary: boolean } => value !== undefined);

    if (resolvedCategories.length === 0) {
      console.warn(`    UYARI: "${item.name}" için kategori bulunamadı, atlandı.`);
      continue;
    }

    // Dosya işlemi işlemin (transaction) DIŞINDA: veritabanı geri alınabilir
    // ama disk yazımı alınamaz. Kayıt oluşmazsa geride yalnız kullanılmayan
    // bir dosya kalır — ters durumda kırık bir görsel kaydı kalırdı.
    const placeholder = await copyPlaceholderImage(slug);

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: item.name,
          slug,
          shortDescription: item.shortDescription,
          description: item.description,
          brandId: brandId.get(item.brandSlug) ?? null,
          usageInstructions: item.usageInstructions,
          ingredients: item.ingredients,
          storageConditions: item.storageConditions,
          licenseNumber: item.licenseNumber ?? null,
          isActive: true,
          isPublished: true,
          showPrice: item.showPrice ?? true,
          isFeatured: item.isFeatured ?? false,
          isNew: item.isNew ?? false,
          isPopular: item.isPopular ?? false,
          metaTitle: item.name,
          metaDesc: item.shortDescription,
          // Aranabilir metin: ProductsService ile AYNI mantık.
          // Türk kullanıcılar aksansız yazar; "gubre" araması "Gübre"
          // ürününü bulmalıdır (bkz. Product.searchText açıklaması).
          searchText: [item.name, item.shortDescription, item.ingredients, item.brandSlug]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .map((value) => slugify(value, 2000))
            .join(' '),
          categories: { create: resolvedCategories },
          images: {
            create: {
              storageKey: placeholder.key,
              url: storageKeyToUrl(placeholder.key),
              altText: `${item.name} ürün görseli`,
              originalName: 'placeholder-product.png',
              mimeType: 'image/png',
              sizeBytes: placeholder.size,
              width: 800,
              height: 800,
              isPrimary: true,
              sortOrder: 0,
            },
          },
          plants: {
            create: item.plantSlugs
              .map((value) => plantId.get(value))
              .filter((value): value is string => value !== undefined)
              .map((id) => ({ plantId: id })),
          },
          soilTypes: {
            create: item.soilTypeSlugs
              .map((value) => soilTypeId.get(value))
              .filter((value): value is string => value !== undefined)
              .map((id) => ({ soilTypeId: id })),
          },
          benefits: {
            create: item.benefitSlugs
              .map((value, index) => {
                const id = benefitId.get(value);

                return id === undefined ? undefined : { benefitId: id, sortOrder: index };
              })
              .filter(
                (value): value is { benefitId: string; sortOrder: number } => value !== undefined,
              ),
          },
          sideEffects: {
            create: item.sideEffects
              .map((effect, index) => {
                const id = sideEffectId.get(effect.slug);

                return id === undefined
                  ? undefined
                  : {
                      sideEffectId: id,
                      severityOverride: effect.severityOverride ?? null,
                      note: effect.note ?? null,
                      sortOrder: index,
                    };
              })
              .filter((value) => value !== undefined),
          },
          usagePeriods: {
            create: item.usagePeriodSlugs
              .map((value) => usagePeriodId.get(value))
              .filter((value): value is string => value !== undefined)
              .map((id) => ({ usagePeriodId: id })),
          },
        },
        select: { id: true },
      });

      for (const [index, variant] of item.variants.entries()) {
        const unitId = unitTypeId.get(variant.unitCode);

        if (unitId === undefined) {
          console.warn(`    UYARI: "${variant.unitCode}" birimi bulunamadı, varyasyon atlandı.`);
          continue;
        }

        const initialStock = new Prisma.Decimal(variant.stockQuantity);

        const created = await tx.productVariant.create({
          data: {
            productId: product.id,
            unitTypeId: unitId,
            sku: variant.sku,
            name: variant.name,
            // Kural 2: fiyat ve miktar float'a UĞRATILMADAN Decimal'e verilir.
            unitQuantity: new Prisma.Decimal(variant.unitQuantity),
            purchasePrice: new Prisma.Decimal(variant.purchasePrice),
            salePrice: new Prisma.Decimal(variant.salePrice),
            taxRate: new Prisma.Decimal(variant.taxRate),
            minOrderQuantity: new Prisma.Decimal(variant.minOrderQuantity),
            quantityStep: new Prisma.Decimal(variant.quantityStep),
            maxOrderQuantity:
              variant.maxOrderQuantity === undefined
                ? null
                : new Prisma.Decimal(variant.maxOrderQuantity),
            // Stok DOĞRUDAN yazılmaz — aşağıdaki INITIAL hareketiyle eklenir.
            stockQuantity: 0,
            lowStockThreshold: new Prisma.Decimal(variant.lowStockThreshold),
            isDefault: variant.isDefault ?? false,
            isActive: true,
            sortOrder: index,
          },
          select: { id: true, sku: true },
        });

        // Seed verisi de "stok yalnız hareketle değişir" kuralına uyar
        // (Sprint 9, K-55). Uymasaydı geliştirme veritabanı, geçmişte
        // karşılığı olmayan stoklarla açılır ve zincir tutarlılığını
        // doğrulayan her kontrol daha ilk üründe yanlış alarm verirdi.
        if (initialStock.greaterThan(0)) {
          await tx.productVariant.update({
            where: { id: created.id },
            data: { stockQuantity: initialStock },
          });

          await tx.stockMovement.create({
            data: {
              variantId: created.id,
              productId: product.id,
              type: StockMovementType.INITIAL,
              direction: StockMovementDirection.IN,
              quantity: initialStock,
              previousStock: 0,
              newStock: initialStock,
              unitCost: new Prisma.Decimal(variant.purchasePrice),
              description: `Açılış stoğu (seed): ${created.sku}`,
              // Seed bir kullanıcı adına çalışmaz; hareket "sistem" kaydıdır.
              createdById: null,
            },
          });
        }
      }

      // Türetilmiş fiyat aralığı (ProductPricingService ile aynı mantık).
      const aggregate = await tx.productVariant.aggregate({
        where: { productId: product.id, isActive: true, deletedAt: null },
        _min: { salePrice: true },
        _max: { salePrice: true },
      });

      await tx.product.update({
        where: { id: product.id },
        data: {
          minSalePrice: aggregate._min.salePrice,
          maxSalePrice: aggregate._max.salePrice,
        },
      });
    });

    created += 1;
  }

  console.log(`    Ürünler: ${created} oluşturuldu, ${skipped} zaten mevcut`);
}

/**
 * Örnek müşteriler.
 *
 * Satış modülünün elle denenebilmesi için gerekli: müşteri olmadan satış
 * oluşturulamaz. SATIŞ VE ÖDEME SEED EDİLMEZ — finansal kayıt üretmek
 * geliştirme verisiyle gerçek veriyi karıştırma riski taşır ve raporları
 * baştan kirletir.
 */
async function seedCustomers(): Promise<void> {
  console.log('  Müşteriler yükleniyor...');

  let created = 0;
  let skipped = 0;

  for (const item of SEED_CUSTOMERS) {
    const existing = await prisma.customer.findFirst({ where: { phone: item.phone } });

    if (existing !== null) {
      skipped += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const year = new Date().getUTCFullYear();

      // Numara üreteciyle AYNI mantık: sayaç satırı kilitlenir.
      const rows = await tx.$queryRaw<{ lastValue: number }[]>`
        INSERT INTO "number_sequences" ("id", "scope", "year", "lastValue", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), 'CUSTOMER', ${year}, 1, NOW(), NOW())
        ON CONFLICT ("scope", "year")
        DO UPDATE SET "lastValue" = "number_sequences"."lastValue" + 1, "updatedAt" = NOW()
        RETURNING "lastValue"
      `;

      const value = rows[0]?.lastValue ?? 1;
      const code = `MUS-${year}-${String(value).padStart(6, '0')}`;

      await tx.customer.create({
        data: {
          code,
          type: item.type,
          fullName: item.fullName,
          companyName: item.companyName ?? null,
          phone: item.phone,
          city: item.city,
          district: item.district,
          creditLimit: new Prisma.Decimal(item.creditLimit),
        },
      });
    });

    created += 1;
  }

  console.log(`    Müşteriler: ${created} oluşturuldu, ${skipped} zaten mevcut`);
}

/** Ürünler arası örnek ilişkileri yükler. */
async function seedProductRelations(): Promise<void> {
  const variants = await prisma.productVariant.findMany({
    select: { sku: true, productId: true },
  });
  const productIdBySku = new Map(variants.map((variant) => [variant.sku, variant.productId]));

  let created = 0;

  for (const relation of SEED_PRODUCT_RELATIONS) {
    const sourceId = productIdBySku.get(relation.sourceSku);
    const targetId = productIdBySku.get(relation.targetSku);

    if (sourceId === undefined || targetId === undefined || sourceId === targetId) {
      continue;
    }

    // SİMETRİK türlerde kanonik sıra zorunludur (DB CHECK).
    const symmetric = ['COMPATIBLE', 'INCOMPATIBLE', 'SIMILAR'].includes(relation.type);
    const [a, b] = symmetric && sourceId > targetId ? [targetId, sourceId] : [sourceId, targetId];

    const existing = await prisma.productRelation.findFirst({
      where: { sourceProductId: a, targetProductId: b, type: relation.type },
    });

    if (existing !== null) {
      continue;
    }

    await prisma.productRelation.create({
      data: {
        sourceProductId: a,
        targetProductId: b,
        type: relation.type,
        note: relation.note ?? null,
      },
    });

    created += 1;
  }

  console.log(`    Ürün ilişkileri: ${created} oluşturuldu`);
}

/** Ürün için benzersiz slug üretir. */
async function uniqueProductSlug(name: string): Promise<string> {
  const base = slugify(name, 250);
  let candidate = base;
  let suffix = 2;

  while ((await prisma.product.findUnique({ where: { slug: candidate } })) !== null) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

/**
 * Demo markalar.
 *
 * Taksonomiden AYRI tutuldu: kategoriler ve bitkiler gerçek tarımsal referans
 * verisidir, marka adları ise uydurmadır. Aynı fonksiyonda kalsalardı
 * üretimde ya ikisi birden yüklenir ya ikisi birden atlanırdı.
 */
async function seedDemoBrands(): Promise<void> {
  for (const brand of SEED_BRANDS) {
    await prisma.brand.upsert({
      where: { slug: slugify(brand.name) },
      update: {},
      create: { ...brand, slug: slugify(brand.name) },
    });
  }

  console.log(`    Markalar: ${await prisma.brand.count()}`);
}

/**
 * Demo verisi yüklenecek mi?
 *
 * Karar sırası:
 *   1. `SEED_DEMO_DATA` açıkça verildiyse ona uyulur (operatörün niyeti).
 *   2. Verilmediyse: üretim DIŞINDA yüklenir, üretimde YÜKLENMEZ.
 */
function shouldSeedDemoData(): boolean {
  const raw = process.env['SEED_DEMO_DATA']?.trim().toLowerCase();

  if (raw !== undefined && raw !== '') {
    return ['1', 'true', 'yes', 'on'].includes(raw);
  }

  return process.env['NODE_ENV'] !== 'production';
}

async function main(): Promise<void> {
  const isProduction = process.env['NODE_ENV'] === 'production';
  const withDemo = shouldSeedDemoData();

  console.log('Seed başlıyor...');
  console.log(`  Ortam: ${process.env['NODE_ENV'] ?? 'development'}`);

  // --- SİSTEM VERİSİ: daima ---
  await seedSettings();
  await seedSuperAdmin();
  await seedCatalogTaxonomy();

  // --- DEMO VERİSİ: koşullu ---
  if (!withDemo) {
    console.log('  Demo verisi ATLANDI (markalar, ürünler, müşteriler).');
    console.log('  Bilinçli olarak yüklemek için: SEED_DEMO_DATA=true');
    console.log('Seed tamamlandı.');

    return;
  }

  if (isProduction) {
    // Gürültülü olması bilinçli: bu satırı üretim log'unda görmek, birinin
    // gerçek kataloğa sahte ürün yüklediğini fark etmesini sağlar.
    console.warn('');
    console.warn('  ============================================================');
    console.warn('  UYARI: NODE_ENV=production ve SEED_DEMO_DATA=true');
    console.warn('  Uydurma markalar, ürünler ve KREDİ LİMİTLİ müşteriler');
    console.warn('  yükleniyor. Gerçek bir mağaza veritabanında bu istenmez.');
    console.warn('  ============================================================');
    console.warn('');
  }

  console.log('  Demo verisi yükleniyor...');
  await seedDemoBrands();
  await seedProducts();
  await seedProductRelations();
  await seedCustomers();

  console.log('Seed tamamlandı.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed başarısız:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
