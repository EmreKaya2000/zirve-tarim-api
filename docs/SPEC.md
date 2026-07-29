# TARIMSAL ÜRÜN KATALOĞU, TALEP YÖNETİMİ VE FİNANS TAKİP SİSTEMİ — ŞARTNAME (SPEC)

> **Sürüm:** v1.0 — 2026-07-29 tarihinde sağlandı.
> Bu doküman projenin bağlayıcı şartnamesidir. Sprint prompt'ları bu dokümana `SPEC §<bölüm>` formatında referans verir. Değişiklikler versiyonlanır.

Sistem; profesyonel, ölçeklenebilir, güvenli, test edilebilir ve ileride mobil uygulamalara bağlanabilecek şekilde tasarlanıp geliştirilecektir. Proje yalnızca çalışan bir demo olarak değil, gerçek hayatta kullanılabilecek bir yazılım ürünü olarak ele alınmalıdır.

Kodlamaya başlamadan önce gereksinimler analiz edilmeli, eksik veya çelişkili noktalar tespit edilmeli ve kritik belirsizlikler listelenmelidir. Ancak gereksiz sorularla geliştirme durdurulmamalı; makul varsayımlar yapılmalı ve bu varsayımlar açıkça belirtilmelidir.

## 1. PROJE TANIMI

Bu proje, tarımsal ürünler satan fiziksel bir ziraat mağazası için geliştirilecektir.

Mağazada aşağıdaki ürün grupları bulunabilir:

- Gübreler
- Tohumlar
- Bitki besleme ürünleri
- Tarım ilaçları
- Toprak düzenleyiciler
- Organik ürünler
- Sulama ürünleri
- Tarımsal yardımcı ürünler
- Adet, kilogram, litre, paket, kutu veya farklı boyutlarla satılan ürünler

Sistem iki temel bölümden oluşacaktır:

1. Alıcıların ürünleri inceleyebileceği halka açık web sitesi
2. Ürün, müşteri, talep, satış, borç, ödeme, stok ve finans yönetiminin yapılacağı admin paneli

İlk MVP sürümünde müşteriler için üyelik ve giriş sistemi zorunlu değildir. Ancak mimari ileride aşağıdaki özelliklerin eklenmesine uygun olmalıdır:

- Müşteri üyeliği
- Müşteri girişi
- Mobil uygulama
- iOS uygulaması
- Android uygulaması
- Sipariş geçmişi
- Müşterinin kendi borçlarını görüntülemesi
- Bildirim sistemi
- Online satış
- Online ödeme
- Mağazadan teslim alma
- Mobil uygulamadan talep oluşturma

İlk sürümde online ödeme ve doğrudan internetten satış yapılmayacaktır. Kullanıcı ürünleri sepete ekleyebilecek ancak ödeme yapamayacaktır. Sepet, satın alma işlemi yerine mağazaya gönderilen bir ürün talebi olarak çalışacaktır.

## 2. TEMEL TEKNOLOJİ MİMARİSİ

Proje API-first mimariyle geliştirilecektir.

### Backend

- Node.js
- TypeScript
- NestJS
- REST API
- Swagger / OpenAPI
- JWT tabanlı authentication
- Role-based authorization
- Class Validator
- Class Transformer
- Prisma ORM
- PostgreSQL
- Redis (ilk aşamada zorunlu değil ancak mimari uygun olmalı)
- Docker
- Docker Compose

Express yerine NestJS tercih edilmelidir. Backend tamamen frontend ve mobil uygulamalardan bağımsız bir REST API olarak geliştirilmelidir.

### Web frontend

- Next.js
- TypeScript
- App Router
- React
- Tailwind CSS
- Shadcn UI
- React Hook Form
- Zod
- TanStack Query
- Axios veya merkezi bir API istemcisi
- Responsive tasarım
- Mobil öncelikli tasarım
- SEO uyumlu ürün ve kategori sayfaları

Next.js kullanılarak hem halka açık ürün kataloğu hem de admin paneli geliştirilebilir. Aşağıdaki iki yaklaşımdan profesyonel olanı seçilmelidir:

- Tek Next.js projesinde public site ve admin paneli
- Monorepo içerisinde ayrı web ve admin uygulamaları

Bu proje için önerilen yapı:

- `apps/api`
- `apps/web`
- `packages/ui`
- `packages/types`
- `packages/config`

Monorepo için Turborepo veya Nx kullanılabilir.

### Mobil uygulama

Mobil uygulama MVP kapsamında geliştirilmeyecektir. Ancak ileride kullanılacak teknoloji:

- React Native
- Expo
- TypeScript

Mobil uygulama, web uygulamasının kullandığı REST API'yi kullanmalıdır. Backend hiçbir şekilde yalnızca web arayüzüne özel tasarlanmamalıdır.

### Veritabanı

- PostgreSQL
- Prisma ORM
- Migration sistemi
- Seed sistemi
- UUID primary key
- UTC tarih saklama
- Soft delete gereken tablolarda `deletedAt`
- Tüm temel tablolarda `createdAt` ve `updatedAt`

Para alanları için floating point kullanılmamalıdır. Para değerleri:

- PostgreSQL `numeric` veya Prisma `Decimal`
- Para birimi ilk aşamada `TRY`
- Gelecekte farklı para birimlerine uygun yapı

## 3. KULLANICI ROLLERİ

İlk MVP sürümünde aşağıdaki roller bulunacaktır.

### Admin

Tüm sisteme erişebilir. Admin aşağıdaki işlemleri yapabilir:

- Ürün oluşturma
- Ürün güncelleme
- Ürün silme veya pasife alma
- Ürün görsellerini yönetme
- Kategori yönetme
- Marka yönetme
- Bitki yönetme
- Toprak türü yönetme
- Yarar yönetme
- Yan etki yönetme
- Kullanım dönemlerini yönetme
- Ürün varyasyonlarını yönetme
- Stok yönetme
- Gelen talepleri görüntüleme
- Talepleri durumlandırma
- Müşteri oluşturma
- Müşteri güncelleme
- Satış kaydı oluşturma
- Müşterinin aldığı ürünleri görüntüleme
- Borç kaydı oluşturma
- Ödeme kaydı oluşturma
- Kalan borcu görüntüleme
- Vadesi gelen borçları görüntüleme
- Kâr raporlarını görüntüleme
- Finans özetlerini görüntüleme

### Public kullanıcı / alıcı

İlk MVP sürümünde giriş yapmadan aşağıdaki işlemleri gerçekleştirebilir:

- Ana sayfayı görüntüleme
- Kategorileri görüntüleme
- Markaları görüntüleme
- Bitkileri görüntüleme
- Ürünleri listeleme
- Ürün arama
- Ürün filtreleme
- Ürün detayını görüntüleme
- Ürün görsellerini görüntüleme
- Ürünün kullanılabileceği bitkileri görüntüleme
- Uygun toprak türlerini görüntüleme
- Kullanım alanlarını görüntüleme
- Kullanım zamanlarını görüntüleme
- Yararları görüntüleme
- Yan etkileri ve uyarıları görüntüleme
- Ürün varyasyonlarını görüntüleme
- Sepete ürün ekleme
- Sepet miktarını güncelleme
- Sepetten ürün çıkarma
- Sepeti mağazaya talep olarak gönderme

### Customer (ileride)

İleride aşağıdaki rol eklenebilir:

- Kayıt olma
- Giriş yapma
- Profil yönetimi
- Talep geçmişi
- Borç görüntüleme
- Ödeme geçmişi
- Favori ürünler
- Tekrar talep oluşturma
- Mobil bildirim alma

Bu rol MVP kapsamına dahil edilmemelidir ancak veritabanı ve servis mimarisi ileride eklenebilir olmalıdır.

## 4. HALKA AÇIK WEB SİTESİ

### 4.1 Ana sayfa

Ana sayfada aşağıdaki alanlar yer almalıdır:

- Logo
- Arama alanı
- Kategori menüsü
- Öne çıkan ürünler
- Yeni eklenen ürünler
- Popüler ürünler
- Markalar
- Bitkilere göre ürünler
- Mağaza iletişim bilgileri
- Adres
- Telefon
- WhatsApp bağlantısı
- Çalışma saatleri
- Harita bağlantısı
- Talep sepeti
- Mobil uyumlu navigasyon

### 4.2 Kategori yapısı

Her ürün en az bir kategoriye bağlı olmak zorundadır. Ürünlerin birden fazla kategorisi olabilir.

Örnek kategoriler:

- Gübre
- Tohum
- Tarım ilacı
- Bitki besleme
- Toprak düzenleyici
- Sulama
- Organik ürünler

Kategori yapısı hiyerarşik olabilmelidir. Örnek:

- Gübre
  - Katı gübre
  - Sıvı gübre
  - Yaprak gübresi
  - Taban gübresi

Kategori tablosunda `parentId` alanı bulunmalıdır.

Kategori sayfalarında: kategori adı, açıklama, görsel, alt kategoriler, kategoriye bağlı ürünler, filtreler ve sıralama bulunmalıdır.

### 4.3 Marka yapısı

Admin ayrı bir marka kaydı oluşturabilir. Marka alanları:

- Marka adı
- Slug
- Logo
- Açıklama
- Web sitesi (opsiyonel)
- Aktiflik durumu

Bir ürün bir markaya bağlı olabilir. MVP'de marka zorunlu olmayabilir.

### 4.4 Bitki yapısı

Admin sistemde bitkiler oluşturabilir. Örnek: Buğday, Arpa, Mısır, Domates, Biber, Patates, Ayçiçeği, Elma, Üzüm.

Bitki alanları:

- Ad
- Slug
- Açıklama
- Görsel
- Aktiflik durumu

Bir ürün birden fazla bitkide kullanılabilir. Bir bitkiye birden fazla ürün bağlanabilir. Bu nedenle ürün-bitki ilişkisi many-to-many olmalıdır.

### 4.5 Toprak türleri

Admin sistemde toprak türleri tanımlayabilir. Örnek: Killi toprak, Kumlu toprak, Tınlı toprak, Kireçli toprak, Tuzlu toprak, Organik maddece zengin toprak.

Bir ürün birden fazla toprak türüyle ilişkilendirilebilir. Toprak türü seçimi ürün için zorunlu olmayabilir.

### 4.6 Ürün listeleme

Ürün listeleme sayfasında aşağıdaki filtreler bulunmalıdır:

- Kategori
- Alt kategori
- Marka
- Bitki
- Toprak türü
- Ürün birimi
- Aktif ürünler
- Stokta olanlar
- Fiyat aralığı (ürün fiyatı public olarak gösterilecekse)
- Arama kelimesi

Sıralama seçenekleri:

- En yeni
- Ada göre
- Fiyata göre artan
- Fiyata göre azalan
- Popülerlik
- Öne çıkanlar

### 4.7 Ürün detay sayfası

Ürün detayında aşağıdaki bilgiler gösterilmelidir:

- Ürün adı
- Slug
- Marka
- Kategori veya kategoriler
- Ana görsel
- Birden fazla ürün görseli
- Kısa açıklama
- Detaylı açıklama
- İçerik bilgisi
- Kullanım alanı
- Kullanım şekli
- Kullanım zamanı
- Uygun bitkiler
- Uygun toprak türleri
- Yararlar
- Yan etkiler
- Uyarılar
- Saklama koşulları
- Ürün varyasyonları
- Satış birimi
- Minimum talep miktarı
- Miktar artırma adımı
- Stok bilgisi (gösterilecekse)
- Talep sepetine ekleme alanı
- Benzer ürünler
- Aynı kategorideki ürünler
- Aynı markadaki ürünler

Tarımsal ürünlerde yanlış kullanım riskine karşı ürün detayında açık bir bilgilendirme alanı bulunmalıdır:

> "Ürünün kullanım koşulları ürüne, bitkiye, uygulama dönemine ve yerel mevzuata göre değişebilir. Kullanım öncesinde ürün etiketi ve yetkili uzman önerileri dikkate alınmalıdır."

Bu metni gerektiğinde admin düzenleyebilmelidir.

## 5. ÜRÜN YÖNETİMİ

Admin ürün oluştururken aşağıdaki alanları yönetebilmelidir.

### 5.1 Temel ürün bilgileri

- Ürün adı
- Slug
- Ürün kodu
- Barkod (opsiyonel)
- Marka
- Kategoriler
- Ana kategori
- Kısa açıklama
- Detaylı açıklama
- İçerik bilgisi
- Kullanım alanı
- Kullanım şekli
- Kullanım zamanı
- Saklama koşulları
- Uyarılar
- Aktif / pasif
- Öne çıkan ürün
- Yeni ürün
- Popüler ürün
- Public olarak gösterilsin mi
- Fiyat public gösterilsin mi

Kategori seçimi zorunlu olmalıdır. Marka, bitki, toprak türü, yarar ve yan etki alanları opsiyonel olabilir.

### 5.2 Ürün görselleri

Bir ürüne birden fazla fotoğraf eklenebilmelidir. Her görsel için:

- Dosya URL'si
- Alternatif metin
- Sıralama
- Ana görsel olup olmadığı
- Aktiflik durumu

Görseller sürükle-bırak ile sıralanabilmelidir. Dosya yükleme için başlangıçta yerel geliştirme ortamı kullanılabilir. Canlı ortam için aşağıdaki sistemlerden birine uygun abstraction tasarlanmalıdır:

- AWS S3
- Cloudflare R2
- MinIO
- Supabase Storage

### 5.3 Ürün varyasyonları

Ürün varyasyon sistemi esnek olmalıdır. Örnek varyasyonlar: 1 kg, 5 kg, 25 kg, 500 ml, 1 litre, 5 litre, 1 adet, 10 adet, 50 adet, küçük boy, orta boy, büyük boy, 1 paket, 1 kutu.

Her varyasyon için:

- Varyasyon adı
- SKU
- Barkod
- Birim türü
- Birim miktarı
- Paket açıklaması
- Alış fiyatı
- Satış fiyatı
- Minimum talep miktarı
- Miktar artırma adımı
- Maksimum talep miktarı (opsiyonel)
- Stok miktarı
- Kritik stok seviyesi
- Aktiflik durumu
- Varsayılan varyasyon olup olmadığı

Örnekler:

- Kilogram ile satılan ürün: birim türü kilogram, minimum miktar 5, artış adımı 5 → seçilebilir miktarlar: 5, 10, 15, 20 kg
- Adet ile satılan ürün: birim türü adet, minimum miktar 10, artış adımı 10 → seçilebilir miktarlar: 10, 20, 30, 40 adet
- Paket olarak satılan ürün: birim türü paket, minimum miktar 1, artış adımı 1

Minimum miktar ve artış adımı ürün ana kaydında değil, varyasyon seviyesinde tutulmalıdır.

### 5.4 Birim türleri

Birim türleri ayrı tabloda yönetilmelidir. Örnek birimler: Kilogram, Gram, Litre, Mililitre, Adet, Paket, Kutu, Çuval, Şişe, Bidon, Metre, Santimetre, Boyut.

Alanlar:

- Ad
- Kısa kod
- Ölçüm tipi
- Ondalıklı miktara izin veriliyor mu
- Aktiflik durumu

Örneğin kilogram ve litre ondalıklı olabilir, adet ondalıklı olmamalıdır.

### 5.5 Yararlar

Admin yarar kayıtları oluşturabilir. Örnek:

- Kök gelişimini destekler
- Verimi artırmaya yardımcı olur
- Bitki gelişimini destekler
- Besin eksikliğini azaltır
- Hastalıklara karşı direnci destekler

Ürün-yarar ilişkisi many-to-many olmalıdır. Her ilişki için opsiyonel özel açıklama eklenebilmelidir.

### 5.6 Yan etkiler ve uyarılar

Admin yan etki veya risk kayıtları oluşturabilir. Örnek:

- Fazla kullanımda yaprak yanığı riski
- Hassas bitkilerde kullanılmamalıdır
- Belirli ürünlerle karıştırılmamalıdır
- Koruyucu ekipman kullanılmalıdır

Ürün-yan etki ilişkisi many-to-many olmalıdır. Her ilişki için önem seviyesi, ürüne özel açıklama ve görünürlük tutulabilir.

### 5.7 Birlikte kullanılabilecek ürünler

Bir ürün başka ürünlerle ilişkilendirilebilir. İlişki türleri:

- Birlikte kullanılabilir
- Birlikte kullanılması önerilir
- Birlikte kullanılmamalıdır
- Alternatif ürün
- Tamamlayıcı ürün
- Benzer ürün

Bu ilişki ürünün kendisiyle kurulamaz. Çift yönlü ilişkilerin nasıl yönetileceği tanımlanmalıdır.

## 6. TALEP SEPETİ

Sistem online satış yapmayacaktır. Sepet, satın alma sepeti değil, ürün talep listesi olarak çalışacaktır.

### 6.1 Sepete ürün ekleme

Kullanıcı:

- Ürün varyasyonu seçer
- Miktar seçer
- Minimum miktarın altında seçim yapamaz
- Miktar artırma adımına uymayan değer giremez
- Ürünü sepete ekler
- Sepette miktarı değiştirebilir
- Sepetten ürünü silebilir

Sepet, giriş yapmayan kullanıcı için local storage veya güvenli session mekanizmasıyla tutulabilir.

### 6.2 Talep gönderme

Kullanıcı sepeti göndermeden önce aşağıdaki bilgileri girmelidir:

- Ad
- Soyad
- Telefon
- E-posta (opsiyonel)
- İl
- İlçe
- Adres (opsiyonel)
- Açıklama veya not
- Tercih edilen iletişim yöntemi
- KVKK veya iletişim izni onayı
- Talebin mağazadan teslim alınacağı bilgisi

Talep gönderildiğinde sistem bir talep numarası üretmelidir. Örnek: `TLP-2026-000001`

Talep gönderildiğinde admin paneline düşmelidir.

### 6.3 Talep durumları

Talep durumları:

- Yeni
- İnceleniyor
- Müşteriyle iletişime geçildi
- Hazırlanıyor
- Hazır
- Tamamlandı
- İptal edildi
- Satışa dönüştürüldü

Durum değişiklikleri geçmiş olarak saklanmalıdır. Talep durumu değiştiğinde; değiştiren admin, eski durum, yeni durum, açıklama ve tarih saklanmalıdır.

### 6.4 Talebi satışa dönüştürme

Admin talebi satışa dönüştürebilmelidir. Dönüşüm sırasında:

- Mevcut müşteri seçilebilir
- Yeni müşteri oluşturulabilir
- Talep ürünleri satışa aktarılabilir
- Ürün miktarları değiştirilebilir
- Satış fiyatları değiştirilebilir
- İndirim uygulanabilir
- Vadeli veya peşin satış seçilebilir
- Vade tarihi girilebilir

Talep satışa dönüştürüldüğünde çift satış oluşmaması için transaction kullanılmalıdır.

## 7. ADMIN PANELİ

Admin paneli mobil responsive olmalıdır.

### 7.1 Dashboard

Dashboard üzerinde aşağıdaki bilgiler gösterilmelidir:

- Toplam aktif ürün
- Toplam kategori
- Toplam marka
- Toplam müşteri
- Yeni talepler
- Bekleyen talepler
- Bu ayki satış
- Bu ayki tahsilat
- Toplam açık borç
- Vadesi geçmiş borç
- Bu ayki brüt kâr
- Kritik stok ürünleri
- Son satışlar
- Son ödemeler
- Son talepler
- Yaklaşan vadeler

Grafikler:

- Aylık satış grafiği
- Aylık tahsilat grafiği
- Aylık kâr grafiği
- En çok satılan ürünler
- En çok borcu olan müşteriler
- Kategori bazlı satış dağılımı

### 7.2 Admin kullanıcıları

Admin kullanıcıları için: ad, soyad, e-posta, telefon, şifre hash, rol, aktiflik durumu, son giriş zamanı tutulmalıdır.

İlk aşamada yalnızca `SUPER_ADMIN` ve `ADMIN` rolleri yeterlidir. Ancak ileride şu roller eklenebilir: Ürün yöneticisi, Finans yöneticisi, Satış personeli, Depo personeli.

Yetki sistemi modül ve aksiyon bazlı geliştirilebilir olmalıdır.

## 8. MÜŞTERİ YÖNETİMİ

Admin müşterileri sisteme ekleyebilmelidir. Müşteri alanları:

- Müşteri tipi (Bireysel / Kurumsal)
- Ad
- Soyad
- Firma adı
- Telefon
- Alternatif telefon
- E-posta
- Vergi numarası
- Vergi dairesi
- İl
- İlçe
- Adres
- Not
- Aktiflik durumu

Müşteri detay sayfasında gösterilmesi gerekenler:

- Genel bilgiler
- Toplam satış
- Toplam borç
- Toplam ödeme
- Kalan borç
- Vadesi geçmiş borç
- Satın aldığı ürünler
- Satış geçmişi
- Ödeme geçmişi
- Borç hareketleri
- Açık satışlar
- Notlar

Müşterinin toplam borcu doğrudan customer tablosunda manuel alan olarak tutulmamalıdır. Kalan borç satışlar ve ödemeler üzerinden hesaplanmalıdır. Performans gerekirse özet alanlar veya materialized view kullanılabilir.

## 9. SATIŞ VE FİNANS MODÜLÜ

Finans modülü admin panelinin ayrı bir bölümü olacaktır.

### 9.1 Satış oluşturma

Admin manuel satış oluşturabilmelidir. Satış oluştururken:

- Müşteri seçilir
- Satış tarihi girilir
- Ürün veya varyasyon seçilir
- Miktar girilir
- Birim satış fiyatı girilir
- İndirim girilebilir
- KDV bilgisi opsiyonel olabilir
- Peşin veya vadeli satış seçilir
- Vade tarihi girilebilir
- İlk ödeme girilebilir
- Satış notu eklenebilir

Satış numarası otomatik üretilmelidir. Örnek: `SAT-2026-000001`

### 9.2 Satış kalemleri

Her satış birden fazla ürün içerebilir. Satış kaleminde aşağıdaki alanlar saklanmalıdır:

- Ürün
- Ürün varyasyonu
- Ürün adı snapshot
- Varyasyon adı snapshot
- SKU snapshot
- Birim tipi snapshot
- Miktar
- Satış anındaki alış fiyatı
- Satış anındaki satış fiyatı
- İndirim
- Satır toplamı
- Satır maliyeti
- Satır kârı

Ürün fiyatı sonradan değişse bile eski satış kayıtları değişmemelidir. Bu nedenle satış anındaki fiyatlar snapshot olarak tutulmalıdır.

### 9.3 Satış durumları

- Taslak
- Kesinleşti
- Kısmi ödendi
- Ödendi
- İptal edildi
- İade edildi (ileride)

MVP'de iade zorunlu değildir ancak mimari destekleyebilir.

### 9.4 Ödemeler

Bir satışa birden fazla ödeme eklenebilmelidir. Ödeme alanları:

- Satış
- Müşteri
- Ödeme tarihi
- Tutar
- Ödeme yöntemi (Nakit / Havale / EFT / Kredi kartı / Diğer)
- Açıklama
- İşlem referansı
- Ödemeyi kaydeden admin

Ödeme numarası üretilebilir. Örnek: `ODM-2026-000001`

Bir satışın toplam ödemesi satış tutarını aşmamalıdır. Fazla ödeme ve müşteri bakiyesi ileride ayrı bir özellik olabilir.

### 9.5 Borç hesaplama

Her satış için:

- Ana borç = satış net toplamı
- Ödenen = ödeme kayıtlarının toplamı
- Kalan borç = net toplam − toplam ödeme

Müşteri için: toplam satış, toplam ödeme, kalan borç ve vadesi geçmiş borç hesaplanmalıdır. Borç hesabı tek bir manuel alana bağlı olmamalıdır.

### 9.6 Kâr hesaplama

Kâr otomatik hesaplanmalıdır.

- Satır brüt kârı: `(birim satış fiyatı − birim alış fiyatı) × miktar − satır indirimi`
- Satış brüt kârı: satış kalemlerinin brüt kâr toplamı

Admin gerektiğinde satışa ek maliyet ekleyebilmelidir. Örnek: nakliye, kargo, komisyon, işçilik, diğer maliyetler.

- Net kâr: `Brüt kâr − ek maliyetler`

Kâr doğrudan elle girilen tek bir alan olmamalıdır. Ancak manuel düzeltme yapılacaksa; düzeltme tutarı, düzeltme nedeni, işlemi yapan admin ve tarih audit log ile tutulmalıdır.

## 10. STOK YÖNETİMİ

Stok ürün varyasyonu seviyesinde tutulmalıdır. Her varyasyonun ayrı stoğu olmalıdır.

Örnek: Ürün "X marka gübre", varyasyon "5 kg", stok "12 paket".

Stok hareketleri ayrı tabloda tutulmalıdır. Stok hareket türleri:

- İlk stok
- Satın alma
- Manuel giriş
- Satış
- Satış iptali
- Fire
- Hasar
- Sayım farkı
- Manuel çıkış
- İade (ileride)

Her stok hareketinde şunlar tutulmalıdır:

- Ürün varyasyonu
- Hareket tipi
- Miktar
- Önceki stok
- Sonraki stok
- Referans tipi
- Referans kimliği
- Açıklama
- İşlemi yapan admin
- Tarih

Stok sadece `stockQuantity` alanı güncellenerek izlenmemelidir. Hareket geçmişi korunmalıdır.

Satış kesinleştirildiğinde stok azaltılmalıdır. Satış iptalinde stok geri eklenmelidir. Bu işlemler transaction ile yapılmalıdır.

## 11. VERİTABANI TASARIMI

Aşağıdaki tablolar oluşturulmalıdır.

### Kimlik ve yetkilendirme

**users:** id, firstName, lastName, email, phone, passwordHash, role, isActive, lastLoginAt, createdAt, updatedAt, deletedAt

**refresh_tokens:** id, userId, tokenHash, expiresAt, revokedAt, createdAt

### Katalog tabloları

**categories:** id, parentId, name, slug, description, imageUrl, sortOrder, isActive, createdAt, updatedAt, deletedAt

**brands:** id, name, slug, description, logoUrl, websiteUrl, isActive, createdAt, updatedAt, deletedAt

**plants:** id, name, slug, description, imageUrl, isActive, createdAt, updatedAt, deletedAt

**soil_types:** id, name, slug, description, isActive, createdAt, updatedAt, deletedAt

**benefits:** id, name, slug, description, isActive, createdAt, updatedAt, deletedAt

**side_effects:** id, name, slug, description, severity, isActive, createdAt, updatedAt, deletedAt

**usage_periods:** id, name, slug, description, isActive, createdAt, updatedAt, deletedAt

Örnek kullanım dönemleri: Ekim öncesi, Ekim sırasında, Çimlenme dönemi, Vejetatif gelişim, Çiçeklenme, Meyve gelişimi, Hasat sonrası.

**unit_types:** id, name, code, measurementType, allowsDecimal, isActive, createdAt, updatedAt

**products:** id, name, slug, productCode, barcode, brandId, shortDescription, description, composition, usageInstructions, usageArea, storageConditions, warnings, isActive, isFeatured, isNew, isPopular, isPublic, showPrice, createdAt, updatedAt, deletedAt

**product_categories:** productId, categoryId, isPrimary

Bir ürünün en az bir kategorisi olmalıdır. Bir ürünün yalnızca bir ana kategorisi olmalıdır.

**product_images:** id, productId, imageUrl, altText, sortOrder, isPrimary, isActive, createdAt, updatedAt

**product_variants:** id, productId, name, sku, barcode, unitTypeId, unitAmount, packageDescription, purchasePrice, salePrice, currency, minOrderQuantity, quantityStep, maxOrderQuantity, stockQuantity, lowStockThreshold, isDefault, isActive, createdAt, updatedAt, deletedAt

**product_plants:** productId, plantId, customDescription

**product_soil_types:** productId, soilTypeId, customDescription

**product_benefits:** productId, benefitId, customDescription

**product_side_effects:** productId, sideEffectId, customDescription, severityOverride

**product_usage_periods:** productId, usagePeriodId, customDescription

**product_relations:** id, sourceProductId, targetProductId, relationType, description, createdAt

### Talep tabloları

**inquiries:** id, inquiryNumber, customerId (nullable), firstName, lastName, phone, email, city, district, address, note, preferredContactMethod, status, consentAccepted, createdAt, updatedAt

**inquiry_items:** id, inquiryId, productId, productVariantId, productNameSnapshot, variantNameSnapshot, quantity, unitTypeSnapshot, displayedPriceSnapshot, note, createdAt

**inquiry_status_histories:** id, inquiryId, oldStatus, newStatus, note, changedByUserId, createdAt

### Müşteri tabloları

**customers:** id, customerType, firstName, lastName, companyName, phone, alternatePhone, email, taxNumber, taxOffice, city, district, address, note, isActive, createdAt, updatedAt, deletedAt

**customer_notes:** id, customerId, note, createdByUserId, createdAt, updatedAt

### Satış ve finans tabloları

**sales:** id, saleNumber, customerId, inquiryId (nullable), saleDate, dueDate, status, paymentType, subtotal, discountTotal, taxTotal, grandTotal, paidTotal, remainingTotal, grossProfit, additionalCostTotal, netProfit, note, createdByUserId, finalizedAt, createdAt, updatedAt, deletedAt

`paidTotal`, `remainingTotal`, `grossProfit` ve `netProfit` alanlarının saklanması durumunda bunlar transaction içinde tutarlı güncellenmelidir. Alternatif olarak sorgu sırasında hesaplanabilir. Hangisinin daha doğru olduğu değerlendirilip gerekçelendirilmelidir.

**sale_items:** id, saleId, productId, productVariantId, productNameSnapshot, variantNameSnapshot, skuSnapshot, unitTypeSnapshot, quantity, unitPurchasePrice, unitSalePrice, discountAmount, lineSubtotal, lineTotal, lineCost, lineProfit, createdAt

**payments:** id, paymentNumber, saleId, customerId, paymentDate, amount, paymentMethod, referenceNumber, note, receivedByUserId, createdAt, updatedAt, deletedAt

**sale_additional_costs:** id, saleId, costType, description, amount, createdByUserId, createdAt, updatedAt

### Stok tabloları

**stock_movements:** id, productVariantId, movementType, quantity, previousStock, newStock, referenceType, referenceId, description, createdByUserId, createdAt

### Sistem tabloları

**settings:** id, key, value, valueType, isPublic, createdAt, updatedAt

**audit_logs:** id, userId, action, entityType, entityId, oldData, newData, ipAddress, userAgent, createdAt

## 12. ENUM TANIMLARI

**UserRole:** SUPER_ADMIN, ADMIN, PRODUCT_MANAGER, FINANCE_MANAGER, SALES_STAFF, STOCK_STAFF
(MVP'de yalnızca SUPER_ADMIN ve ADMIN kullanılabilir.)

**InquiryStatus:** NEW, REVIEWING, CONTACTED, PREPARING, READY, COMPLETED, CANCELLED, CONVERTED_TO_SALE

**SaleStatus:** DRAFT, FINALIZED, PARTIALLY_PAID, PAID, CANCELLED, REFUNDED

**PaymentType:** CASH, CREDIT

**PaymentMethod:** CASH, BANK_TRANSFER, EFT, CREDIT_CARD, OTHER

**CustomerType:** INDIVIDUAL, CORPORATE

**ProductRelationType:** COMPATIBLE, RECOMMENDED_TOGETHER, INCOMPATIBLE, ALTERNATIVE, COMPLEMENTARY, SIMILAR

**SideEffectSeverity:** LOW, MEDIUM, HIGH, CRITICAL

**StockMovementType:** INITIAL, PURCHASE, MANUAL_IN, SALE, SALE_CANCEL, WASTE, DAMAGE, INVENTORY_ADJUSTMENT, MANUAL_OUT, RETURN

**MeasurementType:** WEIGHT, VOLUME, COUNT, LENGTH, PACKAGE, SIZE, OTHER

## 13. API MODÜLLERİ

NestJS içerisinde aşağıdaki modüller oluşturulmalıdır:

AuthModule, UsersModule, CategoriesModule, BrandsModule, PlantsModule, SoilTypesModule, BenefitsModule, SideEffectsModule, UsagePeriodsModule, UnitTypesModule, ProductsModule, ProductVariantsModule, ProductRelationsModule, InquiriesModule, CustomersModule, SalesModule, PaymentsModule, StockModule, FinanceModule, ReportsModule, SettingsModule, UploadsModule, AuditLogsModule, HealthModule.

Her modülde: Controller, Service, DTO, Entity veya Prisma mapping, Validation, Authorization, Unit test ve gerekli integration test bulunmalıdır.

## 14. ÖRNEK REST API ENDPOINTLERİ

### Auth

- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

### Categories

- `GET /categories`
- `GET /categories/tree`
- `GET /categories/:slug`
- `POST /admin/categories`
- `PATCH /admin/categories/:id`
- `DELETE /admin/categories/:id`

### Products

- `GET /products`
- `GET /products/:slug`
- `GET /products/:id/related`
- `POST /admin/products`
- `PATCH /admin/products/:id`
- `DELETE /admin/products/:id`
- `POST /admin/products/:id/images`
- `DELETE /admin/products/:id/images/:imageId`
- `POST /admin/products/:id/variants`
- `PATCH /admin/products/:id/variants/:variantId`

### Inquiries

- `POST /inquiries`
- `GET /admin/inquiries`
- `GET /admin/inquiries/:id`
- `PATCH /admin/inquiries/:id/status`
- `POST /admin/inquiries/:id/convert-to-sale`

### Customers

- `GET /admin/customers`
- `POST /admin/customers`
- `GET /admin/customers/:id`
- `PATCH /admin/customers/:id`
- `GET /admin/customers/:id/financial-summary`
- `GET /admin/customers/:id/sales`
- `GET /admin/customers/:id/payments`

### Sales

- `GET /admin/sales`
- `POST /admin/sales`
- `GET /admin/sales/:id`
- `PATCH /admin/sales/:id`
- `POST /admin/sales/:id/finalize`
- `POST /admin/sales/:id/cancel`
- `POST /admin/sales/:id/payments`

### Finance

- `GET /admin/finance/dashboard`
- `GET /admin/finance/receivables`
- `GET /admin/finance/overdue`
- `GET /admin/finance/profit-report`
- `GET /admin/finance/sales-report`
- `GET /admin/finance/payment-report`

### Stock

- `GET /admin/stock`
- `GET /admin/stock/low-stock`
- `GET /admin/stock/movements`
- `POST /admin/stock/adjustment`

Tüm liste endpointlerinde pagination, search, filtering ve sorting desteklenmelidir.

Standart response formatı:

Başarılı response örneği:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 120,
    "totalPages": 6
  }
}
```

Hata response örneği:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Gönderilen bilgiler geçersiz.",
    "details": []
  }
}
```

## 15. İŞ KURALLARI

Aşağıdaki kurallar backend seviyesinde zorunlu tutulmalıdır:

1. Her ürün en az bir kategoriye bağlı olmalıdır.
2. Bir ürünün en fazla bir ana kategorisi olabilir.
3. Ürünün en az bir aktif varyasyonu olmalıdır.
4. Alış ve satış fiyatı negatif olamaz.
5. Minimum talep miktarı sıfırdan büyük olmalıdır.
6. Miktar artırma adımı sıfırdan büyük olmalıdır.
7. Adet biriminde ondalıklı miktar girilemez.
8. Talep miktarı minimum miktardan düşük olamaz.
9. Talep miktarı artış adımına uygun olmalıdır.
10. Ödeme tutarı sıfırdan büyük olmalıdır.
11. Ödeme, satışın kalan borcunu aşamaz.
12. İptal edilmiş satışa ödeme eklenemez.
13. Kesinleşmemiş satış stoktan düşmemelidir.
14. Kesinleşmiş satış iptal edilirse stok geri alınmalıdır.
15. Ürün fiyatları değiştiğinde eski satış kayıtları değişmemelidir.
16. Satış kalemlerinde alış ve satış fiyatları snapshot olarak saklanmalıdır.
17. Bir ürün kendisiyle ilişkilendirilemez.
18. Pasif ürün public sitede gösterilmemelidir.
19. Pasif varyasyon sepete eklenememelidir.
20. Satış ve stok işlemleri transaction içinde gerçekleştirilmelidir.
21. Finansal kayıtlar hard delete edilmemelidir.
22. Finansal değişiklikler audit log ile izlenmelidir.
23. Slug alanları benzersiz olmalıdır.
24. SKU alanı benzersiz olmalıdır.
25. Talep ve satış numaraları benzersiz olmalıdır.

## 16. FRONTEND SAYFALARI

### Public site

- `/`
- `/urunler`
- `/urunler/[slug]`
- `/kategoriler`
- `/kategori/[slug]`
- `/markalar`
- `/marka/[slug]`
- `/bitkiler`
- `/bitki/[slug]`
- `/talep-sepeti`
- `/talep-basarili/[inquiryNumber]`
- `/hakkimizda`
- `/iletisim`
- `/kvkk`
- `/gizlilik`
- `/kullanim-kosullari`

### Admin panel

- `/admin/login`
- `/admin`
- `/admin/urunler`
- `/admin/urunler/yeni`
- `/admin/urunler/[id]`
- `/admin/kategoriler`
- `/admin/markalar`
- `/admin/bitkiler`
- `/admin/toprak-turleri`
- `/admin/yararlar`
- `/admin/yan-etkiler`
- `/admin/kullanim-donemleri`
- `/admin/birimler`
- `/admin/talepler`
- `/admin/talepler/[id]`
- `/admin/musteriler`
- `/admin/musteriler/[id]`
- `/admin/satislar`
- `/admin/satislar/yeni`
- `/admin/satislar/[id]`
- `/admin/odemeler`
- `/admin/stok`
- `/admin/stok-hareketleri`
- `/admin/finans`
- `/admin/finans/alacaklar`
- `/admin/finans/vadesi-gecenler`
- `/admin/raporlar`
- `/admin/ayarlar`
- `/admin/kullanicilar`

## 17. ADMIN ÜRÜN FORMU

Ürün oluşturma ve düzenleme ekranı sekmeli tasarlanmalıdır.

**Sekme 1 — Temel bilgiler:** Ürün adı, ürün kodu, barkod, marka, kategoriler, ana kategori, kısa açıklama, detaylı açıklama.

**Sekme 2 — Görseller:** Çoklu görsel yükleme, ana görsel seçimi, sıralama, silme.

**Sekme 3 — Varyasyonlar (dinamik tablo veya kart yapısı):** Varyasyon adı, SKU, birim, birim miktarı, alış fiyatı, satış fiyatı, minimum miktar, artış adımı, maksimum miktar, stok, kritik stok, aktiflik.

**Sekme 4 — Tarımsal bilgiler:** Bitkiler, toprak türleri, kullanım dönemleri, kullanım şekli, içerik, saklama koşulları.

**Sekme 5 — Yararlar ve uyarılar:** Yararlar, yan etkiler, uyarılar, ürüne özel açıklamalar.

**Sekme 6 — İlişkili ürünler:** Benzer ürünler, tamamlayıcı ürünler, birlikte kullanılabilir ürünler, birlikte kullanılmaması gereken ürünler.

**Sekme 7 — Yayın ayarları:** Aktif, public, fiyatı göster, öne çıkan, yeni, popüler, SEO başlığı, SEO açıklaması.

## 18. GÜVENLİK

Aşağıdaki güvenlik önlemleri uygulanmalıdır:

- Şifreler Argon2 veya bcrypt ile hashlenmeli
- JWT access token kısa ömürlü olmalı
- Refresh token hashlenerek saklanmalı
- Role guard kullanılmalı
- Rate limiting uygulanmalı
- Helmet kullanılmalı
- CORS kontrollü yapılandırılmalı
- Girdi validasyonu yapılmalı
- SQL injection Prisma ile engellenmeli
- XSS önlemleri alınmalı
- Dosya türü ve dosya boyutu doğrulanmalı
- Admin endpointleri authentication gerektirmeli
- Public endpointlerde hassas finans alanları dönmemeli
- Finans verileri loglara açık şekilde yazılmamalı
- Environment secret'ları repository'ye eklenmemeli
- `.env.example` oluşturulmalı
- Audit log uygulanmalı
- Kritik işlemlerde transaction kullanılmalı

## 19. TEST STRATEJİSİ

### Backend

- Jest
- Unit test
- Integration test
- E2E test
- Test database
- Factory veya fixture yapısı

Özellikle test edilmesi gereken senaryolar: ürün oluşturma, çoklu kategori bağlama, varyasyon oluşturma, minimum miktar kontrolü, miktar artış adımı kontrolü, talep oluşturma, talebi satışa dönüştürme, satış kesinleştirme, stok düşürme, kısmi ödeme, tam ödeme, kalan borç hesaplama, vadesi geçmiş borç, satış iptali, stok geri ekleme, kâr hesaplama, yetkisiz admin erişimi.

### Frontend

- Vitest
- React Testing Library
- Playwright

Kritik akışlar: ürün listeleme, ürün filtreleme, ürün detay, sepete ekleme, talep gönderme, admin login, ürün oluşturma, satış oluşturma, ödeme ekleme.

## 20. DEVOPS VE ÇALIŞTIRMA

Oluşturulması gereken dosyalar:

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- Prisma migration
- Seed dosyası
- README
- Kurulum dokümantasyonu
- API dokümantasyonu
- Postman collection veya Bruno collection

Docker Compose içerisinde: PostgreSQL, API, Web, opsiyonel Redis, opsiyonel MinIO bulunmalıdır.

Komutlar:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm format
pnpm prisma:migrate
pnpm prisma:seed
```

CI için GitHub Actions yapılandırması: install, lint, type check, test, build.

## 21. SEED VERİLERİ

Örnek seed verileri oluşturulmalıdır.

**Kategoriler:** Gübre, Tohum, Tarım ilaçları, Bitki besleme, Toprak düzenleyiciler, Sulama ürünleri.

**Markalar:** En az 3 örnek marka (gerçek marka yerine örnek marka isimleri kullanılabilir).

**Bitkiler:** Buğday, Arpa, Mısır, Domates, Biber, Patates, Ayçiçeği, Elma, Üzüm.

**Toprak türleri:** Killi toprak, Kumlu toprak, Tınlı toprak, Kireçli toprak.

**Birimler:** Kilogram, Gram, Litre, Mililitre, Adet, Paket, Kutu, Çuval, Şişe, Bidon.

**Ürünler:** En az 10 örnek ürün. Her üründe: kategori, marka, en az bir varyasyon, görsel placeholder, bitki ilişkisi, toprak türü ilişkisi, yarar, yan etki ve kullanım dönemi bulunmalıdır.

## 22. KOD KALİTESİ

Uyulması gereken standartlar:

- TypeScript strict mode
- `any` kullanımından kaçınılmalı
- SOLID prensipleri
- Clean architecture yaklaşımı
- Controller içinde iş mantığı yazılmamalı
- Tekrarlanan kodlar servis veya utility katmanına taşınmalı
- Merkezi hata yönetimi
- Merkezi logging
- DTO validation
- Repository erişimi servis katmanında tutulmalı
- Domain iş kuralları açık şekilde ayrılmalı
- Naming convention tutarlı olmalı
- Fonksiyonlar küçük ve tek sorumluluklu olmalı
- Karmaşık iş kuralları için açıklayıcı yorum eklenmeli
- Gereksiz yorum eklenmemeli
- Magic number kullanılmamalı
- Enum veya sabit kullanılmalı
- Tarih ve para hesaplamalarında güvenli kütüphaneler kullanılmalı
- Para hesapları JavaScript floating point ile yapılmamalı
- Decimal kullanılmalı

## 23. GELİŞTİRME SIRASI

Proje aşağıdaki sırayla geliştirilmelidir.

**Faz 1 — Proje kurulumu:** Monorepo, NestJS API, Next.js web, PostgreSQL bağlantısı, Prisma kurulumu, Docker kurulumu, lint ve format ayarları, ortak TypeScript config, environment yönetimi.

**Faz 2 — Authentication:** Admin kullanıcı modeli, login, JWT, refresh token, role guard, ilk admin seed.

**Faz 3 — Katalog yönetimi:** Kategori, marka, bitki, toprak türü, yarar, yan etki, kullanım dönemi, birim türü.

**Faz 4 — Ürün yönetimi:** Ürün CRUD, görseller, varyasyonlar, ürün ilişkileri, filtreleme, arama, public ürün sayfaları.

**Faz 5 — Talep sepeti:** Public sepet, minimum miktar kontrolü, artış adımı kontrolü, talep formu, admin talep listesi, talep durum geçmişi.

**Faz 6 — Müşteri yönetimi:** Müşteri CRUD, müşteri detay, müşteri geçmişi, finans özeti.

**Faz 7 — Satış ve ödeme:** Satış oluşturma, satış kalemleri, peşin ve vadeli satış, ödeme ekleme, borç hesaplama, kâr hesaplama, talebi satışa dönüştürme.

**Faz 8 — Stok:** Stok hareketleri, satışta stok düşme, satış iptalinde stok geri alma, kritik stok, stok raporları.

**Faz 9 — Dashboard ve raporlar:** Finans dashboard, satış raporu, ödeme raporu, borç raporu, vadesi geçmiş borçlar, kâr raporu, en çok satılan ürünler.

**Faz 10 — Test ve yayın:** Unit testler, integration testler, E2E testler, güvenlik kontrolleri, Docker production build, CI/CD, README, deployment dokümantasyonu.

## 24. MVP KAPSAMI

İlk sürümde kesinlikle bulunması gereken özellikler:

- Admin girişi
- Kategori yönetimi
- Marka yönetimi
- Bitki yönetimi
- Toprak türü yönetimi
- Ürün yönetimi
- Çoklu ürün görseli
- Ürün varyasyonları
- Alış fiyatı
- Satış fiyatı
- Minimum talep miktarı
- Miktar artırma adımı
- Public ürün listeleme
- Public ürün detay
- Kategori bazlı listeleme
- Ürün arama
- Talep sepeti
- Talep gönderme
- Admin talep yönetimi
- Müşteri yönetimi
- Satış kaydı
- Satış ürünleri
- Vadeli satış
- Ödeme kaydı
- Ana borç
- Ödenen borç
- Kalan borç
- Kâr hesaplama
- Stok takibi
- Mobil responsive tasarım

MVP dışında bırakılabilecek özellikler:

- Müşteri üyeliği
- Müşteri girişi
- Online ödeme
- Kargo entegrasyonu
- Fatura entegrasyonu
- SMS entegrasyonu
- Push notification
- Mobil uygulama
- Çoklu mağaza
- Çoklu depo
- İade yönetimi
- Kampanya sistemi
- Kupon sistemi
- Favoriler
- Yorumlar
- Puanlama

Ancak mimari bu özelliklerin ileride eklenmesini zorlaştırmamalıdır.

## 25. BEKLENEN ÇIKTILAR

Kod yazılmadan önce aşağıdaki çıktılar üretilmelidir:

1. Gereksinim analizi
2. Varsayımlar
3. MVP kapsamı
4. MVP dışı kapsam
5. Sistem mimarisi
6. Monorepo klasör yapısı
7. Backend modül yapısı
8. Frontend sayfa yapısı
9. Veritabanı ER diyagramı
10. Prisma schema taslağı
11. API endpoint listesi
12. Rol ve yetki matrisi
13. Kritik iş kuralları
14. Talep akışı
15. Satış akışı
16. Ödeme ve borç hesaplama akışı
17. Stok hareket akışı
18. Güvenlik planı
19. Test planı
20. Geliştirme fazları

Bu çıktılar sunulduktan sonra proje aşamalı olarak kodlanmaya başlanır.

Her fazın başında: yapılacak işler, etkilenecek dosyalar, veritabanı değişiklikleri, API değişiklikleri ve test senaryoları listelenmelidir.

Her fazın sonunda: yapılanlar özetlenmeli, çalıştırma komutları verilmeli, test sonuçları belirtilmeli, eksik kalanlar belirtilmeli ve bir sonraki faz belirtilmelidir.

## 26. DOSYA YAPISI ÖNERİSİ

```text
agri-store-platform/
├── apps/
│   ├── api/
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── common/
│   │   │   │   ├── decorators/
│   │   │   │   ├── filters/
│   │   │   │   ├── guards/
│   │   │   │   ├── interceptors/
│   │   │   │   ├── pipes/
│   │   │   │   ├── constants/
│   │   │   │   ├── enums/
│   │   │   │   └── utils/
│   │   │   ├── config/
│   │   │   ├── database/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── categories/
│   │   │   │   ├── brands/
│   │   │   │   ├── plants/
│   │   │   │   ├── soil-types/
│   │   │   │   ├── benefits/
│   │   │   │   ├── side-effects/
│   │   │   │   ├── usage-periods/
│   │   │   │   ├── unit-types/
│   │   │   │   ├── products/
│   │   │   │   ├── product-variants/
│   │   │   │   ├── inquiries/
│   │   │   │   ├── customers/
│   │   │   │   ├── sales/
│   │   │   │   ├── payments/
│   │   │   │   ├── stock/
│   │   │   │   ├── finance/
│   │   │   │   ├── reports/
│   │   │   │   ├── settings/
│   │   │   │   ├── uploads/
│   │   │   │   └── audit-logs/
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/
│   └── web/
│       ├── app/
│       │   ├── (public)/
│       │   ├── admin/
│       │   └── api/
│       ├── components/
│       │   ├── public/
│       │   ├── admin/
│       │   ├── forms/
│       │   └── shared/
│       ├── features/
│       │   ├── products/
│       │   ├── categories/
│       │   ├── inquiries/
│       │   ├── customers/
│       │   ├── sales/
│       │   ├── payments/
│       │   └── stock/
│       ├── hooks/
│       ├── lib/
│       ├── services/
│       ├── stores/
│       ├── types/
│       └── validations/
├── packages/
│   ├── ui/
│   ├── types/
│   ├── eslint-config/
│   └── typescript-config/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── .env.example
└── README.md
```

## 27. KRİTİK MİMARİ KARARLAR

Aşağıdaki kararlar uygulanmalı ve gerekçeleri dokümante edilmelidir:

1. PostgreSQL kullanılacak.
2. Prisma ORM kullanılacak.
3. Backend NestJS REST API olacak.
4. Frontend Next.js olacak.
5. Mobil uygulama ileride React Native ve Expo ile geliştirilecek.
6. Web ve mobil aynı API'yi kullanacak.
7. Ürün varyasyonları ayrı tabloda tutulacak.
8. Stok varyasyon seviyesinde tutulacak.
9. Satış anındaki ürün ve fiyat bilgileri snapshot olarak saklanacak.
10. Borç müşteri tablosunda manuel alan olarak tutulmayacak.
11. Ödemeler ayrı hareket tablosunda tutulacak.
12. Kâr alış ve satış fiyatları üzerinden hesaplanacak.
13. Finansal kayıtlar soft delete veya iptal durumuyla korunacak.
14. Stok hareket geçmişi ayrı tabloda tutulacak.
15. Talep sepeti online sipariş değil, mağazaya gönderilen ürün talebi olacak.
16. Müşteri girişi MVP dışında olacak.
17. Public web sitesi mobil responsive geliştirilecek.
18. Admin paneli de mobil responsive olacak.
19. Kategori yapısı hiyerarşik olacak.
20. Ürün birden fazla kategori, bitki ve toprak türüne bağlanabilecek.

## 28. SON TALİMAT

Önce sistem analiz edilmeli ve mimari doküman oluşturulmalıdır. Bütün proje tek seferde kontrolsüz şekilde yazılmamalıdır.

Kod üretimi ikinci aşamada başlar. Kod üretilirken her dosyanın tam yolu başlık olarak yazılmalıdır. Örnek:

```text
apps/api/src/modules/products/products.controller.ts
```

Ardından dosyanın eksiksiz içeriği verilmelidir. Placeholder, yarım kod, "buraya kod gelecek" veya çalışmayan örnek bırakılmamalıdır.

Üretilen kod:

- Derlenebilir
- Çalıştırılabilir
- Test edilebilir
- Type-safe
- Migration uyumlu
- Docker ile çalışabilir

olmalıdır.

---

**Not:** Bu şartname, sprint planı (`sprint-plani-ve-promptlari.md`) ile birlikte kullanılır. Geliştirme sırası ve sprint kapsamları için sprint planı esas alınır; Customer Auth (müşteri kaydı, sepet birleştirme, talep geçmişi) sprint planına Sprint 11 olarak eklenmiştir ve §24'teki "MVP dışı" listesinin ilgili maddelerinin önüne geçer.
