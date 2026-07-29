-- =============================================================================
-- SPRINT 11 — MÜŞTERİ HESABI, SUNUCU SEPETİ, TALEP BAĞI
-- =============================================================================
--
-- Bu migration üç şeyi getirir:
--   1. Public giriş hesabı ve jeton tabloları (customer_accounts + 3 jeton tablosu)
--   2. Girişli müşterinin sunucu tarafı sepeti (carts, cart_items)
--   3. inquiries.customerAccountId — "bu talebi hangi hesap gönderdi"
--
-- MEVCUT AKIŞLARA ETKİSİ YOKTUR: eklenen her kolon nullable, eklenen her tablo
-- yenidir. Misafir talep akışı (Sprint 6) ve yönetim panelinin tamamı
-- değişmeden çalışır.

-- -----------------------------------------------------------------------------
-- AuditAction: iki yeni eylem
-- -----------------------------------------------------------------------------
-- ALTER TYPE ... ADD VALUE, PostgreSQL 12+ ile transaction içinde çalışabilir;
-- koşul, yeni değerin AYNI transaction içinde KULLANILMAMASIDIR. Burada yalnız
-- tanım eklenir, kullanan INSERT yok.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'EMAIL_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_LINKED';

-- -----------------------------------------------------------------------------
-- customer_accounts
-- -----------------------------------------------------------------------------
CREATE TABLE "customer_accounts" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "email" VARCHAR(255) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(6),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "consentAt" TIMESTAMPTZ(6) NOT NULL,
    "consentIpAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_accounts_customerId_key" ON "customer_accounts"("customerId");
CREATE UNIQUE INDEX "customer_accounts_email_key" ON "customer_accounts"("email");
CREATE INDEX "customer_accounts_isActive_deletedAt_idx" ON "customer_accounts"("isActive", "deletedAt");
CREATE INDEX "customer_accounts_phone_idx" ON "customer_accounts"("phone");

-- Hesap silinse bile CRM kartı ve onun finansal geçmişi durur; yalnız bağ kopar.
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- customer_refresh_tokens
-- -----------------------------------------------------------------------------
CREATE TABLE "customer_refresh_tokens" (
    "id" UUID NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "replacedByTokenHash" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "ipAddress" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_refresh_tokens_tokenHash_key" ON "customer_refresh_tokens"("tokenHash");
CREATE INDEX "customer_refresh_tokens_customerAccountId_revokedAt_idx" ON "customer_refresh_tokens"("customerAccountId", "revokedAt");
CREATE INDEX "customer_refresh_tokens_expiresAt_idx" ON "customer_refresh_tokens"("expiresAt");

ALTER TABLE "customer_refresh_tokens" ADD CONSTRAINT "customer_refresh_tokens_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- email_verification_tokens
-- -----------------------------------------------------------------------------
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_customerAccountId_usedAt_idx" ON "email_verification_tokens"("customerAccountId", "usedAt");
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- password_reset_tokens
-- -----------------------------------------------------------------------------
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "customerAccountId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "requestIpAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");
CREATE INDEX "password_reset_tokens_customerAccountId_usedAt_idx" ON "password_reset_tokens"("customerAccountId", "usedAt");
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- carts / cart_items
-- -----------------------------------------------------------------------------
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "customerAccountId" UUID NOT NULL,
    -- Son uygulanan birleştirme isteğinin SHA-256 parmak izi. Toplama işlemi
    -- idempotent olmadığı için, aynı isteğin ikinci kez uygulanmasını bu
    -- kolon engeller (gerekçe schema.prisma'da ayrıntılı yazılı).
    "lastMergeFingerprint" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "carts_customerAccountId_key" ON "carts"("customerAccountId");

ALTER TABLE "carts" ADD CONSTRAINT "carts_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "productVariantId" UUID NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cart_items_cartId_productVariantId_key" ON "cart_items"("cartId", "productVariantId");
CREATE INDEX "cart_items_productVariantId_idx" ON "cart_items"("productVariantId");

ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey"
  FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE bilinçlidir: sepet kalemi TİCARİ KAYIT DEĞİLDİR (snapshot alanı
-- yoktur). Ürün gerçekten silinirse sepette anlamı kalmayan bir satır durur;
-- talep kalemleri ise SetNull ile snapshot'ıyla korunur (Kural 5).
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_productVariantId_fkey"
  FOREIGN KEY ("productVariantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- inquiries.customerAccountId
-- -----------------------------------------------------------------------------
ALTER TABLE "inquiries" ADD COLUMN "customerAccountId" UUID;

CREATE INDEX "inquiries_customerAccountId_createdAt_idx" ON "inquiries"("customerAccountId", "createdAt");

ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- E-POSTA NORMALLEŞTİRME (mevcut satırlar dahil)
--
-- Doğrulanmış e-postayla geçmiş misafir taleplerini bulmak TAM EŞİTLİKLE
-- yapılır: `mode: 'insensitive'` ILIKE üretir ve aşağıdaki indeksi kullanamaz.
-- Bu yüzden hem yeni kayıtlar servis katmanında küçük harfe çevrilir hem de
-- Sprint 6'dan bu yana yazılmış satırlar burada bir kez düzeltilir.
UPDATE "inquiries" SET "contactEmail" = lower("contactEmail") WHERE "contactEmail" IS NOT NULL;

CREATE INDEX "inquiries_contactEmail_idx" ON "inquiries"("contactEmail");

-- =============================================================================
-- ELLE EKLENEN KISITLAR (Prisma DSL bunları ifade edemez)
-- =============================================================================

-- E-posta küçük harfle ve boşluksuz saklanır. Uygulama katmanı da
-- normalleştirir; bu, kod yolu atlanırsa son savunmadır. İki farklı yazımla
-- aynı adresin iki hesap açması UNIQUE kısıtını sessizce etkisiz kılardı.
ALTER TABLE "customer_accounts"
  ADD CONSTRAINT "chk_customer_accounts_email_normalized"
  CHECK ("email" = lower(btrim("email")) AND "email" <> '');

-- Ad ve soyad boş bırakılamaz: "Sayın  ," diye başlayan bir e-posta gönderilmez.
ALTER TABLE "customer_accounts"
  ADD CONSTRAINT "chk_customer_accounts_names_not_blank"
  CHECK (btrim("firstName") <> '' AND btrim("lastName") <> '');

-- Telefon 10 haneli normalleştirilmiş biçimde saklanır (5321234567),
-- `customers.phone` ile aynı sözleşme. Ham kullanıcı girdisi (+90, boşluk,
-- tire) veritabanına ULAŞMAMALIDIR; aksi hâlde aynı numara farklı yazımlarla
-- birden çok hesapta durur ve yöneticinin eşleştirme araması boşa çıkar.
ALTER TABLE "customer_accounts"
  ADD CONSTRAINT "chk_customer_accounts_phone_normalized"
  CHECK ("phone" ~ '^[0-9]{10}$');

-- Sepet miktarı sıfır veya negatif olamaz. "0 adet" bir kalem değildir;
-- kaldırılmış olması gerekir.
ALTER TABLE "cart_items"
  ADD CONSTRAINT "chk_cart_items_quantity_positive" CHECK ("quantity" > 0);

-- Jetonun son kullanma tarihi üretildiği andan sonra olmalıdır. Süresi
-- geçmiş doğan bir jeton, kullanıcının hiç açamayacağı bir bağlantıdır.
ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "chk_email_verification_tokens_expiry_after_creation"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "chk_password_reset_tokens_expiry_after_creation"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "customer_refresh_tokens"
  ADD CONSTRAINT "chk_customer_refresh_tokens_expiry_after_creation"
  CHECK ("expiresAt" > "createdAt");
