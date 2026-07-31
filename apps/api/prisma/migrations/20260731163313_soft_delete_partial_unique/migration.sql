-- =============================================================================
-- SOFT DELETE x UNIQUE: TAM UNIQUE -> PARTIAL UNIQUE INDEX
-- =============================================================================
--
-- SORUN: Bu tablolar soft delete kullanir (deletedAt). Tam bir UNIQUE kisiti,
-- SILINMIS bir kaydin slug/sku/email degerini de rezerve tutar. Sonuc:
-- "kimyasal-gubre" urununu silen kullanici ayni slug ile yenisini
-- OLUSTURAMAZ ve aldigi hata "bu slug kullanimda" der -- ama listede oyle bir
-- kayit gorunmez. Hatanin sebebi kullaniciya gorunmez.
--
-- COZUM: kisiti `WHERE "deletedAt" IS NULL` ile daraltmak. Silinmis kayitlar
-- index'e girmez, degerleri serbest kalir; yasayan kayitlar arasinda teklik
-- aynen korunur.
--
-- NEDEN RAW SQL: Prisma partial (kosullu) index tanimlayamaz. Bu yuzden
-- ilgili alanlardan `@unique` KALDIRILDI ve teklik burada, veritabani
-- seviyesinde kuruluyor. Prisma tarafinda tip seviyesinde teklik kaybedildigi
-- icin `findUnique` cagrilari `findFirst`e cevrildi.
--
-- BILEREK DISARIDA BIRAKILANLAR -- bunlar partial OLMAMALI:
--   customers.code            (MUS-000001)  belge numarasi
--   inquiries."inquiryNumber" (TLP-...)     belge numarasi
--   payments."paymentNumber"  (ODM-...)     belge numarasi
-- Bir belge numarasinin yeniden kullanilmasi denetim izini bozar: ayni numara
-- iki farkli kayda isaret eder ve sayac mantigiyla celisir. Silinmis bir
-- belgenin numarasi SONSUZA KADAR rezervedir.
--
--   customer_accounts."customerId"  1-1 iliski kisiti
-- Bu bir insan tanimlayicisi degil; Prisma'nin 1-1 modellemesi bu unique'e
-- dayanir, kaldirilirsa iliski 1-N'e doner.
-- =============================================================================

-- DropIndex
DROP INDEX "benefits_slug_key";

-- DropIndex
DROP INDEX "brands_slug_key";

-- DropIndex
DROP INDEX "categories_slug_key";

-- DropIndex
DROP INDEX "customer_accounts_email_key";

-- DropIndex
DROP INDEX "plants_slug_key";

-- DropIndex
DROP INDEX "product_variants_sku_key";

-- DropIndex
DROP INDEX "products_slug_key";

-- DropIndex
DROP INDEX "side_effects_slug_key";

-- DropIndex
DROP INDEX "soil_types_slug_key";

-- DropIndex
DROP INDEX "unit_types_code_key";

-- DropIndex
DROP INDEX "unit_types_slug_key";

-- DropIndex
DROP INDEX "usage_periods_slug_key";

-- DropIndex
DROP INDEX "users_email_key";

-- =============================================================================
-- Partial unique index'ler: teklik YALNIZ yasayan kayitlar arasinda.
-- =============================================================================

CREATE UNIQUE INDEX "users_email_key" ON "users" ("email") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "brands_slug_key" ON "brands" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "plants_slug_key" ON "plants" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "soil_types_slug_key" ON "soil_types" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "benefits_slug_key" ON "benefits" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "side_effects_slug_key" ON "side_effects" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "usage_periods_slug_key" ON "usage_periods" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "unit_types_slug_key" ON "unit_types" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "unit_types_code_key" ON "unit_types" ("code") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "products_slug_key" ON "products" ("slug") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants" ("sku") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts" ("email") WHERE "deletedAt" IS NULL;
