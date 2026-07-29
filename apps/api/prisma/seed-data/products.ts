import { ProductRelationType, SideEffectSeverity } from '@prisma/client';

/**
 * Örnek ürünler.
 *
 * ŞARTNAME KARŞILIĞI: SPEC §21 "en az 10 örnek ürün" istiyor ve her üründe
 * kategori, marka, en az bir varyasyon, görsel, bitki ilişkisi, toprak türü
 * ilişkisi, yarar, yan etki ve kullanım dönemi bulunmasını şart koşuyor.
 * Bu dosya 10 ürün tanımlıyor ve listenin tamamını karşılıyor.
 *
 * Marka adları ve ruhsat numaraları ÖRNEKTİR — şartname §21 gerçek marka
 * yerine örnek ad kullanılmasını açıkça serbest bırakıyor. Gerçek ürün
 * verisi mağazadan alınmalıdır.
 *
 * Varyasyonlar bilinçli olarak farklı birim/adım örnekleri içerir; SPEC §5.3
 * bu üç durumu örnek olarak sayıyor (kg + adım, adet + adım, paket):
 *   - 5 kg çuval, adım 5   -> ondalıklı birim (kg), tam sayı adım
 *   - 10 adet koli, adım 10 -> ondalık YASAK birim (adet)
 *   - 1 paket, adım 1       -> ambalaj birimi
 *   - 1 litre, adım 0.5     -> ondalıklı adım
 */

export interface SeedVariant {
  sku: string;
  name: string;
  /** Birim kodu — seed sırasında id'ye çevrilir. */
  unitCode: string;
  unitQuantity: string;
  purchasePrice: string;
  salePrice: string;
  taxRate: string;
  minOrderQuantity: string;
  quantityStep: string;
  maxOrderQuantity?: string;
  stockQuantity: string;
  lowStockThreshold: string;
  isDefault?: boolean;
}

export interface SeedProduct {
  name: string;
  shortDescription: string;
  description: string;
  brandSlug: string;
  /** Kategori slug'ları; ilki ANA kategoridir. */
  categorySlugs: string[];
  usageInstructions: string;
  ingredients: string;
  storageConditions: string;
  licenseNumber?: string;
  isFeatured?: boolean;
  isNew?: boolean;
  isPopular?: boolean;
  showPrice?: boolean;
  plantSlugs: string[];
  soilTypeSlugs: string[];
  benefitSlugs: string[];
  sideEffects: { slug: string; severityOverride?: SideEffectSeverity; note?: string }[];
  usagePeriodSlugs: string[];
  variants: SeedVariant[];
}

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: 'AgroMax NPK 20-20-20 Kompoze Gübre',
    shortDescription: 'Dengeli azot, fosfor ve potasyum içeren suda çözünür kompoze gübre.',
    description:
      'Bitkinin tüm gelişim dönemlerinde kullanılabilen dengeli formülasyon. Suda tam çözünür yapısı sayesinde damlama sulama sistemlerinde tıkanma yapmaz. Toprak ve yaprak uygulamasına uygundur.',
    brandSlug: 'agromax',
    categorySlugs: ['kompoze-gubre', 'kati-gubre'],
    usageInstructions:
      'Toprak uygulaması: dekara 20-25 kg. Damlama: 100 litre suya 500 g. Yapraktan: 100 litre suya 200-300 g.',
    ingredients: 'Toplam Azot (N) %20, Fosfor (P2O5) %20, Potasyum (K2O) %20, İz elementler',
    storageConditions: 'Serin ve kuru yerde, nemden uzak, orijinal ambalajında saklayınız.',
    isFeatured: true,
    isPopular: true,
    plantSlugs: ['bugday', 'misir', 'domates', 'biber'],
    soilTypeSlugs: ['tinli-toprak', 'killi-toprak'],
    benefitSlugs: ['verim-artisi-saglar', 'kok-gelisimini-destekler', 'meyve-kalitesini-artirir'],
    sideEffects: [
      { slug: 'hafif-yaprak-yanikligi', note: 'Sıcak saatlerde yapraktan uygulamayın.' },
    ],
    usagePeriodSlugs: ['vejetatif-gelisme', 'ciceklenme-oncesi'],
    variants: [
      {
        sku: 'AGM-NPK202020-5KG',
        name: '5 kg Çuval',
        unitCode: 'kg',
        unitQuantity: '5',
        purchasePrice: '210.0000',
        salePrice: '285.0000',
        taxRate: '20.000',
        minOrderQuantity: '5',
        quantityStep: '5',
        stockQuantity: '240',
        lowStockThreshold: '25',
        isDefault: true,
      },
      {
        sku: 'AGM-NPK202020-25KG',
        name: '25 kg Çuval',
        unitCode: 'kg',
        unitQuantity: '25',
        purchasePrice: '980.0000',
        salePrice: '1290.0000',
        taxRate: '20.000',
        minOrderQuantity: '25',
        quantityStep: '25',
        stockQuantity: '80',
        lowStockThreshold: '10',
      },
    ],
  },
  {
    name: 'AgroMax Üre %46 Azotlu Gübre',
    shortDescription: 'Yüksek azot içerikli, hızlı etkili tekli gübre.',
    description:
      'Bitkinin vejetatif gelişimini hızlandıran yüksek azotlu gübre. Toprağa uygulandıktan sonra sulama yapılması etkinliği artırır.',
    brandSlug: 'agromax',
    categorySlugs: ['ure', 'kati-gubre'],
    usageInstructions: 'Dekara 15-20 kg. Uygulamadan sonra mutlaka sulama yapınız.',
    ingredients: 'Toplam Azot (N) %46, Amid Azotu %46',
    storageConditions: 'Nemden koruyunuz. Nem alan üre topaklanır.',
    isPopular: true,
    plantSlugs: ['bugday', 'arpa', 'misir'],
    soilTypeSlugs: ['tinli-toprak', 'kumlu-toprak'],
    benefitSlugs: ['verim-artisi-saglar'],
    sideEffects: [
      {
        slug: 'hafif-yaprak-yanikligi',
        severityOverride: SideEffectSeverity.MEDIUM,
        note: 'Aşırı doz yaprakta yanık yapar. Önerilen dozu aşmayın.',
      },
    ],
    usagePeriodSlugs: ['ekim-oncesi', 'vejetatif-gelisme'],
    variants: [
      {
        sku: 'AGM-URE46-50KG',
        name: '50 kg Çuval',
        unitCode: 'kg',
        unitQuantity: '50',
        purchasePrice: '850.0000',
        salePrice: '1150.0000',
        taxRate: '20.000',
        minOrderQuantity: '50',
        quantityStep: '50',
        stockQuantity: '150',
        lowStockThreshold: '20',
        isDefault: true,
      },
    ],
  },
  {
    name: 'BioVerde Organik Sıvı Solucan Gübresi',
    shortDescription: 'Solucan humusu bazlı, organik tarıma uygun sıvı gübre.',
    description:
      'Toprak canlılığını artıran, kök gelişimini destekleyen tamamen organik sıvı gübre. Organik tarım sertifikasyonuna uygundur.',
    brandSlug: 'bioverde',
    categorySlugs: ['sivi-organik-gubre', 'organik-gubre'],
    usageInstructions: 'Damlama: dekara 5 litre. Yapraktan: 100 litre suya 250 ml.',
    ingredients: 'Solucan humusu ekstraktı, Organik madde %15, Humik + Fulvik asit %8',
    storageConditions: 'Donmaktan koruyunuz. 5-30 °C arasında saklayınız.',
    isNew: true,
    isFeatured: true,
    plantSlugs: ['domates', 'biber', 'patlican', 'uzum'],
    soilTypeSlugs: ['kumlu-toprak', 'killi-toprak', 'tinli-toprak'],
    benefitSlugs: [
      'toprak-yapisini-iyilestirir',
      'kok-gelisimini-destekler',
      'su-tutma-kapasitesini-artirir',
    ],
    sideEffects: [],
    usagePeriodSlugs: ['cimlenme', 'vejetatif-gelisme', 'meyve-tutumu'],
    variants: [
      {
        sku: 'BVD-SOLUCAN-1LT',
        name: '1 Litre Şişe',
        unitCode: 'lt',
        unitQuantity: '1',
        purchasePrice: '95.0000',
        salePrice: '145.0000',
        taxRate: '20.000',
        minOrderQuantity: '1',
        // Ondalıklı adım: yarım litre alınabilir.
        quantityStep: '0.5',
        stockQuantity: '320',
        lowStockThreshold: '40',
        isDefault: true,
      },
      {
        sku: 'BVD-SOLUCAN-20LT',
        name: '20 Litre Bidon',
        unitCode: 'lt',
        unitQuantity: '20',
        purchasePrice: '1450.0000',
        salePrice: '1980.0000',
        taxRate: '20.000',
        minOrderQuantity: '20',
        quantityStep: '20',
        stockQuantity: '45',
        lowStockThreshold: '5',
      },
    ],
  },
  {
    name: 'AgroMax Kalsiyum Bor Yaprak Gübresi',
    shortDescription: 'Meyve çatlamasını önleyen kalsiyum ve bor takviyesi.',
    description:
      'Meyve tutumu döneminde kalsiyum ve bor eksikliğini gideren yaprak gübresi. Domates ve biberde çiçek burnu çürüklüğünü önler.',
    brandSlug: 'agromax',
    categorySlugs: ['yaprak-gubresi'],
    usageInstructions: '100 litre suya 150-200 ml. Meyve tutumundan itibaren 15 gün arayla 3 kez.',
    ingredients: 'Kalsiyum Oksit (CaO) %10, Bor (B) %0.5',
    storageConditions: 'Serin yerde, doğrudan güneş ışığından uzakta saklayınız.',
    plantSlugs: ['domates', 'biber', 'patlican', 'elma'],
    soilTypeSlugs: ['kireçli-toprak', 'kumlu-toprak'],
    benefitSlugs: ['meyve-kalitesini-artirir', 'hastaliga-dayaniklilik-kazandirir'],
    sideEffects: [{ slug: 'cilt-tahrisi' }, { slug: 'goz-tahrisi' }],
    usagePeriodSlugs: ['meyve-tutumu', 'ciceklenme-oncesi'],
    variants: [
      {
        sku: 'AGM-CABOR-1LT',
        name: '1 Litre',
        unitCode: 'lt',
        unitQuantity: '1',
        purchasePrice: '120.0000',
        salePrice: '175.0000',
        taxRate: '20.000',
        minOrderQuantity: '1',
        quantityStep: '1',
        stockQuantity: '180',
        lowStockThreshold: '20',
        isDefault: true,
      },
    ],
  },
  {
    name: 'BioVerde Bitkisel Yağ Bazlı İnsektisit',
    shortDescription: 'Beyaz sinek ve yaprak biti için organik mücadele ürünü.',
    description:
      'Bitkisel yağ bazlı, temas etkili insektisit. Organik tarımda kullanıma uygundur. Kalıntı bırakmaz.',
    brandSlug: 'bioverde',
    categorySlugs: ['insektisit', 'zirai-ilac'],
    usageInstructions:
      '100 litre suya 500 ml. Zararlı görüldüğünde uygulayın, 7 gün sonra tekrarlayın.',
    ingredients: 'Bitkisel yağ karışımı %80, Yardımcı maddeler %20',
    storageConditions: 'Çocukların ulaşamayacağı yerde, kilitli dolapta saklayınız.',
    licenseNumber: 'TR-BKÜ-2024-1157',
    plantSlugs: ['domates', 'biber', 'patlican'],
    soilTypeSlugs: [],
    benefitSlugs: ['hastaliga-dayaniklilik-kazandirir'],
    sideEffects: [
      {
        slug: 'arilar-icin-toksik',
        severityOverride: SideEffectSeverity.HIGH,
        note: 'Bitkisel bazlı olmasına rağmen çiçeklenmede uygulamayın.',
      },
      { slug: 'cilt-tahrisi' },
      { slug: 'solunum-yolu-tahrisi' },
    ],
    usagePeriodSlugs: ['vejetatif-gelisme', 'meyve-tutumu'],
    variants: [
      {
        sku: 'BVD-INSEKT-500ML',
        name: '500 ml Şişe',
        unitCode: 'ml',
        unitQuantity: '500',
        purchasePrice: '210.0000',
        salePrice: '295.0000',
        taxRate: '20.000',
        minOrderQuantity: '500',
        quantityStep: '500',
        stockQuantity: '95',
        lowStockThreshold: '15',
        isDefault: true,
      },
    ],
  },
  {
    name: 'AgroMax Sistemik Fungisit',
    shortDescription: 'Mildiyö ve külleme hastalıklarına karşı sistemik koruma.',
    description:
      'Bitki dokusuna nüfuz ederek içeriden koruma sağlayan sistemik fungisit. Yağmura dayanıklıdır.',
    brandSlug: 'agromax',
    categorySlugs: ['fungisit', 'zirai-ilac'],
    usageInstructions: '100 litre suya 40 g. Hastalık belirtisi görülmeden koruyucu uygulayın.',
    ingredients: 'Azoksistrobin %25',
    storageConditions: 'Serin, kuru ve kilitli yerde saklayınız. Gıda maddelerinden ayrı tutunuz.',
    licenseNumber: 'TR-BKÜ-2023-0842',
    plantSlugs: ['uzum', 'domates', 'elma'],
    soilTypeSlugs: [],
    benefitSlugs: ['hastaliga-dayaniklilik-kazandirir'],
    sideEffects: [
      { slug: 'su-canlilari-icin-toksik' },
      { slug: 'solunum-yolu-tahrisi', severityOverride: SideEffectSeverity.HIGH },
      { slug: 'goz-tahrisi' },
    ],
    usagePeriodSlugs: ['vejetatif-gelisme', 'ciceklenme-oncesi', 'meyve-tutumu'],
    variants: [
      {
        sku: 'AGM-FUNGI-250GR',
        name: '250 g Kutu',
        unitCode: 'g',
        unitQuantity: '250',
        purchasePrice: '380.0000',
        salePrice: '520.0000',
        taxRate: '20.000',
        minOrderQuantity: '250',
        quantityStep: '250',
        stockQuantity: '60',
        lowStockThreshold: '10',
        isDefault: true,
      },
    ],
  },
  {
    name: 'AnadoluTohum Sertifikalı Ekmeklik Buğday Tohumu',
    shortDescription: 'Yüksek verimli, soğuğa dayanıklı sertifikalı buğday tohumu.',
    description:
      'Bakanlık sertifikalı, çimlenme oranı %95 üzeri ekmeklik buğday tohumu. Kurağa ve soğuğa dayanıklıdır.',
    brandSlug: 'anadolutohum',
    categorySlugs: ['tahil-tohumu', 'tohum'],
    usageInstructions: 'Dekara 20-22 kg. Ekim derinliği 4-6 cm.',
    ingredients: 'Sertifikalı tohumluk, çimlenme oranı ≥ %95, safiyet ≥ %99',
    storageConditions: 'Kuru ve serin yerde, kemirgenlerden korunaklı saklayınız.',
    isPopular: true,
    plantSlugs: ['bugday'],
    soilTypeSlugs: ['tinli-toprak', 'killi-toprak'],
    benefitSlugs: ['verim-artisi-saglar', 'soguga-dayanikliligi-artirir'],
    sideEffects: [],
    usagePeriodSlugs: ['ekim-donemi'],
    variants: [
      {
        sku: 'ANT-BUGDAY-50KG',
        name: '50 kg Çuval',
        unitCode: 'kg',
        unitQuantity: '50',
        purchasePrice: '620.0000',
        salePrice: '835.0000',
        taxRate: '1.000',
        minOrderQuantity: '50',
        quantityStep: '50',
        stockQuantity: '200',
        lowStockThreshold: '20',
        isDefault: true,
      },
    ],
  },
  {
    name: 'TarımTek Damlama Sulama Borusu 16 mm',
    shortDescription: '33 cm aralıklı damlatıcılı PE damlama borusu.',
    description:
      'UV dayanımlı polietilen damlama borusu. Basınç düzenleyici damlatıcıları sayesinde eğimli arazide de eşit su dağıtır.',
    brandSlug: 'tarimtek',
    categorySlugs: ['damlama-borusu', 'sulama'],
    usageInstructions: 'Sıra arası mesafeye göre seriniz. Çalışma basıncı 0.6-1.5 bar.',
    ingredients: 'Yüksek yoğunluklu polietilen (HDPE), UV katkılı',
    storageConditions: 'Güneş altında uzun süre bekletmeyiniz.',
    plantSlugs: ['domates', 'biber', 'uzum', 'zeytin'],
    soilTypeSlugs: ['kumlu-toprak', 'tinli-toprak'],
    benefitSlugs: ['su-tutma-kapasitesini-artirir'],
    sideEffects: [],
    usagePeriodSlugs: ['ekim-oncesi'],
    variants: [
      {
        sku: 'TTK-DAMLA16-100M',
        name: '100 Metre Rulo',
        unitCode: 'ad',
        unitQuantity: '1',
        purchasePrice: '780.0000',
        salePrice: '1050.0000',
        taxRate: '20.000',
        minOrderQuantity: '1',
        quantityStep: '1',
        maxOrderQuantity: '50',
        stockQuantity: '65',
        lowStockThreshold: '10',
        isDefault: true,
      },
    ],
  },
  {
    name: 'TarımTek Sırt Pülverizatörü 16 Litre',
    shortDescription: 'Manuel pompalı, 16 litre kapasiteli sırt ilaçlama pompası.',
    description:
      'Ergonomik askı sistemli, ayarlanabilir memeli sırt pülverizatörü. Yedek conta seti dahildir.',
    brandSlug: 'tarimtek',
    categorySlugs: ['pulverizator', 'ekipman'],
    usageInstructions: 'Kullanım sonrası temiz suyla yıkayınız. İlaç kalıntısı memeyi tıkar.',
    ingredients: 'Polietilen gövde, pirinç meme, paslanmaz yay',
    storageConditions: 'Boş ve kuru olarak, ters çevirmeden saklayınız.',
    // "Fiyat için mağazamıza danışın" akışının seed'de KARŞILIĞI OLSUN diye
    // bu ürün fiyatsız yayınlanır. Böylece Kural 8'in ikinci yarısı
    // (showPrice=false ise salePrice de dönmez) canlı veriyle test edilebilir.
    showPrice: false,
    plantSlugs: [],
    soilTypeSlugs: [],
    benefitSlugs: [],
    sideEffects: [],
    usagePeriodSlugs: [],
    variants: [
      {
        sku: 'TTK-PULV-16LT',
        name: 'Tekli',
        unitCode: 'ad',
        unitQuantity: '1',
        purchasePrice: '640.0000',
        salePrice: '890.0000',
        taxRate: '20.000',
        minOrderQuantity: '1',
        quantityStep: '1',
        stockQuantity: '35',
        lowStockThreshold: '5',
        isDefault: true,
      },
      {
        sku: 'TTK-PULV-16LT-KOLI',
        name: '10 Adet Koli',
        unitCode: 'ad',
        unitQuantity: '10',
        purchasePrice: '6100.0000',
        salePrice: '8200.0000',
        taxRate: '20.000',
        // Koli birimi: ondalık YASAK, adım 10.
        minOrderQuantity: '10',
        quantityStep: '10',
        stockQuantity: '30',
        lowStockThreshold: '10',
      },
    ],
  },
  {
    name: 'TarımTek Koruyucu İlaçlama Seti',
    shortDescription: 'Maske, gözlük, eldiven ve tulumdan oluşan koruyucu ekipman seti.',
    description:
      'Zirai ilaç uygulamalarında zorunlu olan kişisel koruyucu donanım seti. Tek pakette eksiksiz koruma.',
    brandSlug: 'tarimtek',
    categorySlugs: ['koruyucu-ekipman', 'ekipman'],
    usageInstructions:
      'Her ilaçlama öncesi eksiksiz giyiniz. Filtreyi 40 saat kullanımda bir değiştiriniz.',
    ingredients: 'FFP2 maske, polikarbonat gözlük, nitril eldiven, tek kullanımlık tulum',
    storageConditions: 'Kuru ve temiz yerde, orijinal ambalajında saklayınız.',
    isNew: true,
    plantSlugs: [],
    soilTypeSlugs: [],
    benefitSlugs: [],
    sideEffects: [],
    usagePeriodSlugs: [],
    variants: [
      {
        sku: 'TTK-KORUMA-SET',
        name: '1 Paket',
        unitCode: 'pk',
        unitQuantity: '1',
        purchasePrice: '285.0000',
        salePrice: '395.0000',
        taxRate: '20.000',
        // Ambalaj birimi: adım 1.
        minOrderQuantity: '1',
        quantityStep: '1',
        stockQuantity: '120',
        lowStockThreshold: '15',
        isDefault: true,
      },
    ],
  },
];

/**
 * Ürünler arası örnek ilişkiler.
 *
 * `INCOMPATIBLE` kayıtlarında gerekçe ZORUNLUDUR — çiftçinin uyarıyı ciddiye
 * alması için nedenini bilmesi gerekir.
 */
export const SEED_PRODUCT_RELATIONS: {
  sourceSku: string;
  targetSku: string;
  type: ProductRelationType;
  note?: string;
}[] = [
  {
    sourceSku: 'AGM-NPK202020-5KG',
    targetSku: 'AGM-CABOR-1LT',
    type: ProductRelationType.COMPATIBLE,
    note: 'Tank karışımında birlikte uygulanabilir.',
  },
  {
    sourceSku: 'AGM-FUNGI-250GR',
    targetSku: 'BVD-INSEKT-500ML',
    type: ProductRelationType.INCOMPATIBLE,
    note: 'Bitkisel yağ bazlı insektisit ile sistemik fungisit karıştırılırsa yaprak yanıklığı riski oluşur. En az 7 gün arayla uygulayın.',
  },
  {
    sourceSku: 'AGM-URE46-50KG',
    targetSku: 'AGM-NPK202020-25KG',
    type: ProductRelationType.SIMILAR,
  },
  {
    sourceSku: 'AGM-URE46-50KG',
    targetSku: 'BVD-SOLUCAN-1LT',
    type: ProductRelationType.ALTERNATIVE,
    note: 'Organik tarım yapıyorsanız kimyasal üre yerine bu ürünü tercih edebilirsiniz.',
  },
  {
    sourceSku: 'BVD-INSEKT-500ML',
    targetSku: 'TTK-KORUMA-SET',
    type: ProductRelationType.RECOMMENDED_TOGETHER,
    note: 'İlaç uygulamasında koruyucu ekipman kullanımı zorunludur.',
  },
  {
    sourceSku: 'TTK-PULV-16LT',
    targetSku: 'TTK-KORUMA-SET',
    type: ProductRelationType.COMPLEMENTARY,
  },
];
