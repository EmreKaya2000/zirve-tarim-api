-- CreateEnum
CREATE TYPE "InquirySource" AS ENUM ('WEB', 'MOBILE', 'PHONE', 'IN_STORE');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'REVIEWING', 'CONTACTED', 'QUOTED', 'APPROVED', 'CONVERTED_TO_SALE', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PreferredContact" AS ENUM ('PHONE', 'WHATSAPP', 'EMAIL');

-- CreateTable
CREATE TABLE "inquiries" (
    "id" UUID NOT NULL,
    "inquiryNumber" VARCHAR(32) NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" "InquirySource" NOT NULL DEFAULT 'WEB',
    "contactName" VARCHAR(200) NOT NULL,
    "contactPhone" VARCHAR(30) NOT NULL,
    "contactEmail" VARCHAR(255),
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "address" VARCHAR(500),
    "preferredContact" "PreferredContact" NOT NULL DEFAULT 'PHONE',
    "customerNote" TEXT,
    "internalNote" TEXT,
    "consentAccepted" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMPTZ(6) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
    "estimatedTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "assignedToId" UUID,
    "contactedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_items" (
    "id" UUID NOT NULL,
    "inquiryId" UUID NOT NULL,
    "productId" UUID,
    "variantId" UUID,
    "productNameSnapshot" VARCHAR(220) NOT NULL,
    "variantNameSnapshot" VARCHAR(200),
    "skuSnapshot" VARCHAR(64) NOT NULL,
    "unitTypeSnapshot" VARCHAR(50) NOT NULL,
    "unitQuantitySnapshot" DECIMAL(18,3) NOT NULL,
    "displayedPriceSnapshot" DECIMAL(18,4),
    "quantity" DECIMAL(18,3) NOT NULL,
    "lineTotal" DECIMAL(18,4),
    "note" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inquiry_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry_status_histories" (
    "id" UUID NOT NULL,
    "inquiryId" UUID NOT NULL,
    "fromStatus" "InquiryStatus",
    "toStatus" "InquiryStatus" NOT NULL,
    "note" VARCHAR(500),
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inquiry_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(20) NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inquiries_inquiryNumber_key" ON "inquiries"("inquiryNumber");

-- CreateIndex
CREATE INDEX "inquiries_status_createdAt_idx" ON "inquiries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "inquiries_contactPhone_idx" ON "inquiries"("contactPhone");

-- CreateIndex
CREATE INDEX "inquiries_assignedToId_status_idx" ON "inquiries"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "inquiries_deletedAt_idx" ON "inquiries"("deletedAt");

-- CreateIndex
CREATE INDEX "inquiry_items_inquiryId_idx" ON "inquiry_items"("inquiryId");

-- CreateIndex
CREATE INDEX "inquiry_items_productId_idx" ON "inquiry_items"("productId");

-- CreateIndex
CREATE INDEX "inquiry_status_histories_inquiryId_createdAt_idx" ON "inquiry_status_histories"("inquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_scope_year_key" ON "number_sequences"("scope", "year");

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_items" ADD CONSTRAINT "inquiry_items_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_items" ADD CONSTRAINT "inquiry_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_items" ADD CONSTRAINT "inquiry_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_status_histories" ADD CONSTRAINT "inquiry_status_histories_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inquiry_status_histories" ADD CONSTRAINT "inquiry_status_histories_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- =============================================================================
-- Prisma DSL ile ifade edilemeyen kısıtlar
-- =============================================================================

-- KVKK onayı olmadan talep KAYDI OLUŞAMAZ.
--
-- Servis katmanı zaten reddediyor; bu kısıt savunmanın ikinci katmanı:
-- ileride eklenecek bir toplu içe aktarma veya elle INSERT de onaysız
-- kayıt üretemesin.
ALTER TABLE "inquiries"
  ADD CONSTRAINT "chk_inquiries_consent" CHECK ("consentAccepted" = true);

ALTER TABLE "inquiries"
  ADD CONSTRAINT "chk_inquiries_estimated_total" CHECK ("estimatedTotal" >= 0);

-- Talep numarası biçimi: TLP-YYYY-NNNNNN (ön ek ayardan gelir, 2-6 harf).
ALTER TABLE "inquiries"
  ADD CONSTRAINT "chk_inquiries_number_format"
  CHECK ("inquiryNumber" ~ '^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$');

-- Miktar pozitif olmalı; 0 veya negatif kalem anlamsızdır.
ALTER TABLE "inquiry_items"
  ADD CONSTRAINT "chk_inquiry_items_quantity" CHECK ("quantity" > 0);

ALTER TABLE "inquiry_items"
  ADD CONSTRAINT "chk_inquiry_items_prices"
  CHECK (
    ("displayedPriceSnapshot" IS NULL OR "displayedPriceSnapshot" >= 0)
    AND ("lineTotal" IS NULL OR "lineTotal" >= 0)
  );

-- Fiyat gizliyse satır tutarı da yazılamaz: ikisi birlikte NULL ya da
-- birlikte dolu olmalı. Aksi hâlde "fiyatı yok ama tutarı var" gibi
-- okunamaz bir kayıt oluşur.
ALTER TABLE "inquiry_items"
  ADD CONSTRAINT "chk_inquiry_items_price_pair"
  CHECK (
    ("displayedPriceSnapshot" IS NULL AND "lineTotal" IS NULL)
    OR ("displayedPriceSnapshot" IS NOT NULL AND "lineTotal" IS NOT NULL)
  );

-- Durum geçişi kendi üstüne olamaz.
ALTER TABLE "inquiry_status_histories"
  ADD CONSTRAINT "chk_inquiry_status_change"
  CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");

ALTER TABLE "number_sequences"
  ADD CONSTRAINT "chk_number_sequences_value" CHECK ("lastValue" >= 0);

ALTER TABLE "number_sequences"
  ADD CONSTRAINT "chk_number_sequences_year" CHECK ("year" BETWEEN 2000 AND 2999);
