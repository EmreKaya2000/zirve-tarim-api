import { MeasurementType, SideEffectSeverity } from '@prisma/client';

/**
 * Katalog taksonomisi başlangıç verisi.
 *
 * ŞARTNAME KARŞILIĞI: SPEC §21 seed verisini şu asgari kümeyle tanımlıyor —
 * kategoriler (Gübre, Tohum, Tarım ilaçları, Bitki besleme, Toprak
 * düzenleyiciler, Sulama), en az 3 marka, 9 bitki, 4 toprak türü ve 10 birim.
 * Bu dosya o kümeyi karşılıyor ve üzerine çıkıyor: kategori ağacı alt
 * seviyeler içeriyor, yarar/yan etki/kullanım dönemi katalogları da eklendi
 * (SPEC §5.5, §5.6, §11).
 *
 * İçerik ziraat mağazacılığı pratiğinden türetildi; şartname marka ve ürün
 * adlarının örnek olmasını açıkça serbest bırakıyor (§21).
 */

/** Kategori ağacı. `children` ile hiyerarşi kurulur. */
export interface SeedCategory {
  name: string;
  description?: string;
  icon?: string;
  children?: SeedCategory[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: 'Gübre',
    icon: 'sprout',
    description: 'Bitki besleme ürünleri. Toprak ve yaprak uygulamaları.',
    children: [
      {
        name: 'Katı Gübre',
        description: 'Granül ve toz formda, toprağa uygulanan gübreler.',
        children: [
          { name: 'Kompoze Gübre', description: 'NPK dengeli karışımlar (15-15-15, 20-20-20).' },
          { name: 'Üre', description: 'Yüksek azot içerikli tekli gübre.' },
          {
            name: 'Amonyum Sülfat',
            description: 'Azot ve kükürt içerir; kireçli toprakta etkili.',
          },
        ],
      },
      {
        name: 'Sıvı Gübre',
        description: 'Damlama ve sprey uygulamalarına uygun sıvı formlar.',
        children: [
          { name: 'Damlama Gübresi', description: 'Sulama suyuyla verilen çözünür gübreler.' },
          { name: 'Sıvı Organik Gübre', description: 'Organik kaynaklı sıvı besin çözeltileri.' },
        ],
      },
      {
        name: 'Yaprak Gübresi',
        description: 'Yapraktan hızlı emilim sağlayan besin takviyeleri.',
      },
      {
        name: 'Taban Gübresi',
        description: 'Ekim öncesi toprağa karıştırılan temel gübreler.',
      },
      {
        name: 'Organik Gübre',
        description: 'Hayvan gübresi, kompost ve solucan gübresi.',
      },
    ],
  },
  {
    name: 'Zirai İlaç',
    icon: 'shield',
    description: 'Bitki koruma ürünleri. Bakanlık ruhsatlı.',
    children: [
      { name: 'Herbisit', description: 'Yabancı ot mücadelesi.' },
      { name: 'İnsektisit', description: 'Zararlı böcek mücadelesi.' },
      { name: 'Fungisit', description: 'Mantari hastalık mücadelesi.' },
      { name: 'Akarisit', description: 'Kırmızı örümcek ve akar mücadelesi.' },
    ],
  },
  {
    name: 'Tohum',
    icon: 'wheat',
    description: 'Sertifikalı tohumluk çeşitleri.',
    children: [
      { name: 'Tahıl Tohumu', description: 'Buğday, arpa, yulaf.' },
      { name: 'Sebze Tohumu', description: 'Domates, biber, patlıcan, salatalık.' },
      { name: 'Yem Bitkisi Tohumu', description: 'Yonca, fiğ, korunga.' },
    ],
  },
  {
    name: 'Sulama',
    icon: 'droplets',
    description: 'Damlama ve yağmurlama sulama malzemeleri.',
    children: [
      { name: 'Damlama Borusu', description: 'Damlatıcılı ve düz PE borular.' },
      { name: 'Bağlantı Parçaları', description: 'Vana, dirsek, ekleme parçaları.' },
      { name: 'Filtre ve Pompa', description: 'Disk filtre, hidrosiklon, dalgıç pompa.' },
    ],
  },
  {
    name: 'Ekipman',
    icon: 'wrench',
    description: 'Uygulama ve koruyucu ekipmanlar.',
    children: [
      { name: 'Pülverizatör', description: 'Sırt ve motorlu ilaçlama pompaları.' },
      { name: 'Koruyucu Ekipman', description: 'Maske, eldiven, tulum, gözlük.' },
      { name: 'El Aletleri', description: 'Budama makası, tırmık, bel.' },
    ],
  },
  {
    name: 'Toprak Düzenleyici',
    icon: 'layers',
    description: 'Toprak yapısını ve pH dengesini iyileştiren ürünler.',
  },
];

/** Markalar. SPEC §21 "en az 3 örnek marka" istiyor ve örnek ad kullanılmasını serbest bırakıyor; gerçek marka listesi mağazadan alınmalı. */
export const SEED_BRANDS = [
  {
    name: 'AgroMax',
    country: 'Türkiye',
    description: 'Gübre ve bitki besleme ürünleri üreticisi.',
    sortOrder: 1,
  },
  {
    name: 'TarımTek',
    country: 'Türkiye',
    description: 'Sulama sistemleri ve tarım ekipmanları.',
    sortOrder: 2,
  },
  {
    name: 'BioVerde',
    country: 'İtalya',
    description: 'Organik tarım girdileri ve biyolojik mücadele ürünleri.',
    sortOrder: 3,
  },
  {
    name: 'AnadoluTohum',
    country: 'Türkiye',
    description: 'Sertifikalı tohumluk üretimi.',
    sortOrder: 4,
  },
];

/** 9 bitki türü. */
export const SEED_PLANTS = [
  { name: 'Buğday', latinName: 'Triticum aestivum', sortOrder: 1 },
  { name: 'Arpa', latinName: 'Hordeum vulgare', sortOrder: 2 },
  { name: 'Mısır', latinName: 'Zea mays', sortOrder: 3 },
  { name: 'Domates', latinName: 'Solanum lycopersicum', sortOrder: 4 },
  { name: 'Biber', latinName: 'Capsicum annuum', sortOrder: 5 },
  { name: 'Patlıcan', latinName: 'Solanum melongena', sortOrder: 6 },
  { name: 'Üzüm', latinName: 'Vitis vinifera', sortOrder: 7 },
  { name: 'Zeytin', latinName: 'Olea europaea', sortOrder: 8 },
  { name: 'Elma', latinName: 'Malus domestica', sortOrder: 9 },
];

/** 4 toprak türü. */
export const SEED_SOIL_TYPES = [
  {
    name: 'Killi Toprak',
    phRange: '6.0 - 7.5',
    description: 'Su tutma kapasitesi yüksek, ağır yapılı toprak. Drenaj sorunu olabilir.',
    sortOrder: 1,
  },
  {
    name: 'Kumlu Toprak',
    phRange: '5.5 - 7.0',
    description: 'Drenajı hızlı, besin tutma kapasitesi düşük. Sık ve az gübreleme gerektirir.',
    sortOrder: 2,
  },
  {
    name: 'Tınlı Toprak',
    phRange: '6.0 - 7.0',
    description: 'Kum, kil ve mil dengeli. Tarım için en uygun toprak yapısı.',
    sortOrder: 3,
  },
  {
    name: 'Kireçli Toprak',
    phRange: '7.5 - 8.5',
    description: 'Yüksek pH; demir ve çinko alımını zorlaştırır. Asitleyici gübre gerekir.',
    sortOrder: 4,
  },
];

/**
 * Ölçü birimleri.
 *
 * `allowsDecimal` KRİTİK: "2.5 kg" geçerli, "2.5 adet" değildir.
 * Satış ve stok modülleri (Sprint 5) miktar doğrulamasında bunu kullanır.
 */
export const SEED_UNIT_TYPES = [
  {
    name: 'Kilogram',
    code: 'kg',
    measurementType: MeasurementType.WEIGHT,
    allowsDecimal: true,
    conversionFactor: '1',
    sortOrder: 1,
  },
  {
    name: 'Gram',
    code: 'g',
    measurementType: MeasurementType.WEIGHT,
    allowsDecimal: true,
    conversionFactor: '0.001',
    sortOrder: 2,
  },
  {
    name: 'Litre',
    code: 'lt',
    measurementType: MeasurementType.VOLUME,
    allowsDecimal: true,
    conversionFactor: '1',
    sortOrder: 3,
  },
  {
    name: 'Mililitre',
    code: 'ml',
    measurementType: MeasurementType.VOLUME,
    allowsDecimal: true,
    conversionFactor: '0.001',
    sortOrder: 4,
  },
  {
    name: 'Adet',
    code: 'ad',
    measurementType: MeasurementType.COUNT,
    allowsDecimal: false,
    conversionFactor: '1',
    sortOrder: 5,
  },
  {
    name: 'Paket',
    code: 'pk',
    measurementType: MeasurementType.PACKAGING,
    allowsDecimal: false,
    sortOrder: 6,
  },
  {
    name: 'Kutu',
    code: 'kt',
    measurementType: MeasurementType.PACKAGING,
    allowsDecimal: false,
    sortOrder: 7,
  },
  {
    name: 'Çuval',
    code: 'cv',
    measurementType: MeasurementType.PACKAGING,
    allowsDecimal: false,
    sortOrder: 8,
  },
  {
    name: 'Şişe',
    code: 'ss',
    measurementType: MeasurementType.PACKAGING,
    allowsDecimal: false,
    sortOrder: 9,
  },
  {
    name: 'Bidon',
    code: 'bd',
    measurementType: MeasurementType.PACKAGING,
    allowsDecimal: false,
    sortOrder: 10,
  },
];

/** 7 kullanım dönemi — takvimsel sırayla. */
export const SEED_USAGE_PERIODS = [
  {
    name: 'Ekim Öncesi',
    description: 'Toprak hazırlığı ve taban gübrelemesi dönemi.',
    sortOrder: 1,
  },
  { name: 'Ekim Dönemi', description: 'Tohum ekimi ve çıkış öncesi uygulamalar.', sortOrder: 2 },
  { name: 'Çimlenme', description: 'Tohumun çimlenip fide oluşturduğu dönem.', sortOrder: 3 },
  {
    name: 'Vejetatif Gelişme',
    description: 'Gövde ve yaprak gelişiminin hızlandığı dönem. Azot ihtiyacı yüksektir.',
    sortOrder: 4,
  },
  {
    name: 'Çiçeklenme Öncesi',
    description: 'Çiçek tomurcuklarının oluştuğu kritik dönem. Fosfor ve potasyum önemlidir.',
    sortOrder: 5,
  },
  {
    name: 'Meyve Tutumu',
    description: 'Döllenme sonrası meyve oluşumu. Kalsiyum ve bor takviyesi yapılır.',
    sortOrder: 6,
  },
  {
    name: 'Hasat Öncesi',
    description: 'Olgunlaşma dönemi. İlaç kalıntı süresine DİKKAT edilmelidir.',
    sortOrder: 7,
  },
];

/** Örnek yararlar. */
export const SEED_BENEFITS = [
  { name: 'Kök Gelişimini Destekler', icon: 'sprout', sortOrder: 1 },
  { name: 'Verim Artışı Sağlar', icon: 'trending-up', sortOrder: 2 },
  { name: 'Hastalığa Dayanıklılık Kazandırır', icon: 'shield-check', sortOrder: 3 },
  { name: 'Meyve Kalitesini Artırır', icon: 'apple', sortOrder: 4 },
  { name: 'Soğuğa Dayanıklılığı Artırır', icon: 'snowflake', sortOrder: 5 },
  { name: 'Toprak Yapısını İyileştirir', icon: 'layers', sortOrder: 6 },
  { name: 'Su Tutma Kapasitesini Artırır', icon: 'droplets', sortOrder: 7 },
  { name: 'Çiçeklenmeyi Teşvik Eder', icon: 'flower', sortOrder: 8 },
];

/** Örnek yan etkiler — ciddiyet seviyeleriyle. */
export const SEED_SIDE_EFFECTS = [
  {
    name: 'Cilt Tahrişi',
    severity: SideEffectSeverity.MEDIUM,
    description: 'Doğrudan temas hâlinde ciltte kızarıklık ve kaşıntı yapabilir.',
    precaution: 'Uygulama sırasında koruyucu eldiven ve uzun kollu tulum kullanın.',
    sortOrder: 1,
  },
  {
    name: 'Göz Tahrişi',
    severity: SideEffectSeverity.MEDIUM,
    description: 'Sıçrama hâlinde gözde yanma ve tahrişe yol açabilir.',
    precaution: 'Koruyucu gözlük takın. Temas hâlinde 15 dakika bol suyla yıkayın.',
    sortOrder: 2,
  },
  {
    name: 'Solunum Yolu Tahrişi',
    severity: SideEffectSeverity.HIGH,
    description: 'Buhar veya tozunun solunması öksürük ve nefes darlığı yapabilir.',
    precaution: 'Uygun filtreli maske kullanın; kapalı alanda uygulamayın.',
    sortOrder: 3,
  },
  {
    name: 'Arılar İçin Toksik',
    severity: SideEffectSeverity.CRITICAL,
    description: 'Bal arıları ve diğer tozlaşma yapan böcekler için öldürücüdür.',
    precaution:
      'Çiçeklenme döneminde UYGULAMAYIN. Uygulamayı arıların aktif olmadığı akşam saatlerinde yapın.',
    sortOrder: 4,
  },
  {
    name: 'Su Canlıları İçin Toksik',
    severity: SideEffectSeverity.CRITICAL,
    description: 'Yüzey sularına karışması balık ve diğer su canlılarını öldürür.',
    precaution: 'Su kaynaklarına en az 20 metre mesafe bırakın. Boş ambalajı asla suya atmayın.',
    sortOrder: 5,
  },
  {
    name: 'Hafif Yaprak Yanıklığı',
    severity: SideEffectSeverity.LOW,
    description: 'Aşırı dozda veya sıcak saatlerde uygulanırsa yaprakta yanık oluşabilir.',
    precaution: 'Önerilen dozu aşmayın; serin saatlerde uygulayın.',
    sortOrder: 6,
  },
];

/**
 * Ürün detayındaki yasal uyarı metni.
 *
 * İLK PARAGRAF ŞARTNAMEDEN BİREBİR ALINDI (SPEC §4.7). Şartname bu cümleyi
 * ürün detayında "açık bir bilgilendirme alanı" olarak zorunlu tutuyor;
 * kelimesi değiştirilmemelidir.
 *
 * Kalan paragraflar EK bilgidir: Türkiye'deki bitki koruma ürünleri
 * mevzuatının genel gereklerinden türetildi. Şartname bunları istemiyor ama
 * silinmedi — koruyucu ekipman, kalıntı süresi ve saklama koşulları zirai
 * ilaç satan bir vitrinde gerçek bir güvenlik değeri taşır ve şartnamenin
 * asgari metnini daraltmıyor, genişletiyor.
 *
 * HUKUKİ AÇIDAN BAĞLAYICI DEĞİLDİR. Şartname §4.7 metnin admin tarafından
 * düzenlenebilmesini şart koşuyor; mağaza `legal.productWarning` ayarından
 * kendi metnini girebilir ve ek paragrafları kaldırabilir.
 */
export const LEGAL_WARNING_TEXT = [
  // --- SPEC §4.7, birebir ---
  'Ürünün kullanım koşulları ürüne, bitkiye, uygulama dönemine ve yerel mevzuata göre değişebilir.',
  'Kullanım öncesinde ürün etiketi ve yetkili uzman önerileri dikkate alınmalıdır.',
  '',
  // --- Ek bilgi (şartname zorunlu kılmıyor) ---
  'Bitki koruma ürünleri (zirai ilaçlar) yalnızca etiketinde belirtilen bitki ve zararlılar için,',
  'belirtilen dozda kullanılmalıdır. Kullanmadan önce ürün etiketini ve güvenlik bilgi formunu mutlaka okuyun.',
  '',
  'Uygulama sırasında koruyucu ekipman (eldiven, maske, gözlük, tulum) kullanılması zorunludur.',
  'Son ilaçlama ile hasat arasındaki bekleme süresine (kalıntı süresi) kesinlikle uyunuz.',
  '',
  'Ürünleri çocukların ve hayvanların ulaşamayacağı, serin ve kuru bir yerde, orijinal ambalajında saklayın.',
  'Boş ambalajları başka amaçla kullanmayın ve çevreye atmayın; usulüne uygun şekilde imha edin.',
  '',
  'Bu sitede yer alan bilgiler genel bilgilendirme amaçlıdır ve reçete niteliği taşımaz.',
  'Uygulama öncesinde ziraat mühendisinize veya tarım danışmanınıza başvurunuz.',
].join('\n');

/**
 * Örnek müşteriler.
 *
 * Telefonlar NORMALLEŞTİRİLMİŞ biçimde (10 hane) verilir: servis katmanı
 * da bu biçimde saklar, seed ile uygulama arasında fark olmasın.
 */
export const SEED_CUSTOMERS: {
  type: 'INDIVIDUAL' | 'CORPORATE';
  fullName: string;
  companyName?: string;
  phone: string;
  city: string;
  district: string;
  creditLimit: string;
}[] = [
  {
    type: 'INDIVIDUAL',
    fullName: 'Ahmet Yılmaz',
    phone: '5321110001',
    city: 'Konya',
    district: 'Çumra',
    creditLimit: '25000.0000',
  },
  {
    type: 'INDIVIDUAL',
    fullName: 'Ayşe Demir',
    phone: '5321110002',
    city: 'Konya',
    district: 'Karatay',
    creditLimit: '10000.0000',
  },
  {
    type: 'CORPORATE',
    fullName: 'Mustafa Kaya',
    companyName: 'Kaya Tarım Ltd. Şti.',
    phone: '5321110003',
    city: 'Aksaray',
    district: 'Merkez',
    creditLimit: '150000.0000',
  },
];
