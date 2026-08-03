-- =============================================================================
-- KATEGORİ İKONU: METİN ALANI YERİNE YÜKLENEN GÖRSEL
-- =============================================================================
--
-- ÖNCEKİ DURUM: `categories.icon VARCHAR(60)` bir lucide ikon adı tutuyordu
-- (ör. 'sprout', 'shield', 'wheat', 'droplets'). Panelde serbest metin olarak
-- giriliyordu — yazım hatası ya da var olmayan bir ad hiçbir yerde
-- yakalanmıyordu.
--
-- ASIL SORUN: BU ALAN VİTRİNDE HİÇ OKUNMUYORDU. Kategori listesi her kategori
-- için SABİT bir ikon basıyordu. Yani alan yazılıyor ama görünmüyordu; altı
-- kayıttaki değerler ölü veriydi.
--
-- DÜŞÜRÜLEN 6 DEĞER BİLİNÇLİ OLARAK TAŞINMIYOR: bir lucide adından görsel
-- üretilemez ve zaten hiç gösterilmemişlerdi. Mağaza artık kendi ikonunu
-- yüklüyor; ikon yüklenmemiş kategoride vitrin eskiden olduğu gibi
-- varsayılan ikonu gösterir, yani davranış gerilemez.
--
-- `iconStorageKey` AYRI KOLON: anahtar sürücüye göreli kalıcı kimliktir
-- ("categories/2026/08/abc.webp"), URL sürücüye göre değişir (yerel yol vs.
-- CDN adresi). Dosyayı silmek ve sürücü değiştiğinde URL'i yeniden üretmek
-- için anahtar gerekir — ProductImage'daki aynı kalıp.
-- =============================================================================

ALTER TABLE "categories" DROP COLUMN "icon";

ALTER TABLE "categories" ADD COLUMN "iconUrl" VARCHAR(700);
ALTER TABLE "categories" ADD COLUMN "iconStorageKey" VARCHAR(500);
