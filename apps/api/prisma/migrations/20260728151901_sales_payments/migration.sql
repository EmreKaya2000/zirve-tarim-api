-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('CASH', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CREDIT_CARD', 'CHECK', 'PROMISSORY_NOTE', 'OFFSET');

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "customerId" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "type" "CustomerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "fullName" VARCHAR(200) NOT NULL,
    "companyName" VARCHAR(250),
    "phone" VARCHAR(30) NOT NULL,
    "altPhone" VARCHAR(30),
    "email" VARCHAR(255),
    "taxNumber" VARCHAR(20),
    "taxOffice" VARCHAR(120),
    "city" VARCHAR(80),
    "district" VARCHAR(80),
    "address" VARCHAR(500),
    "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "saleNumber" VARCHAR(32) NOT NULL,
    "customerId" UUID NOT NULL,
    "inquiryId" UUID,
    "status" "SaleStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentType" "PaymentType" NOT NULL DEFAULT 'CASH',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "remainingTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "costTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "additionalCostTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "netProfit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "saleDate" TIMESTAMPTZ(6) NOT NULL,
    "dueDate" TIMESTAMPTZ(6),
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6),
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "productId" UUID,
    "variantId" UUID,
    "productNameSnapshot" VARCHAR(220) NOT NULL,
    "variantNameSnapshot" VARCHAR(200),
    "skuSnapshot" VARCHAR(64) NOT NULL,
    "unitTypeSnapshot" VARCHAR(50) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unitPurchasePrice" DECIMAL(18,4) NOT NULL,
    "unitSalePrice" DECIMAL(18,4) NOT NULL,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineSubtotal" DECIMAL(18,4) NOT NULL,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "lineCost" DECIMAL(18,4) NOT NULL,
    "lineProfit" DECIMAL(18,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_additional_costs" (
    "id" UUID NOT NULL,
    "saleId" UUID NOT NULL,
    "costType" VARCHAR(50) NOT NULL,
    "description" VARCHAR(300),
    "amount" DECIMAL(18,4) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sale_additional_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "paymentNumber" VARCHAR(32) NOT NULL,
    "saleId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'TRY',
    "paymentDate" TIMESTAMPTZ(6) NOT NULL,
    "dueDate" TIMESTAMPTZ(6),
    "reference" VARCHAR(120),
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_isActive_deletedAt_idx" ON "customers"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "customers_fullName_idx" ON "customers"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "sales_saleNumber_key" ON "sales"("saleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "sales_inquiryId_key" ON "sales"("inquiryId");

-- CreateIndex
CREATE INDEX "sales_customerId_saleDate_idx" ON "sales"("customerId", "saleDate");

-- CreateIndex
CREATE INDEX "sales_status_saleDate_idx" ON "sales"("status", "saleDate");

-- CreateIndex
CREATE INDEX "sales_status_dueDate_idx" ON "sales"("status", "dueDate");

-- CreateIndex
CREATE INDEX "sales_saleDate_idx" ON "sales"("saleDate");

-- CreateIndex
CREATE INDEX "sale_items_saleId_sortOrder_idx" ON "sale_items"("saleId", "sortOrder");

-- CreateIndex
CREATE INDEX "sale_items_productId_idx" ON "sale_items"("productId");

-- CreateIndex
CREATE INDEX "sale_additional_costs_saleId_idx" ON "sale_additional_costs"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymentNumber_key" ON "payments"("paymentNumber");

-- CreateIndex
CREATE INDEX "payments_saleId_idx" ON "payments"("saleId");

-- CreateIndex
CREATE INDEX "payments_customerId_paymentDate_idx" ON "payments"("customerId", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_method_paymentDate_idx" ON "payments"("method", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_paymentDate_idx" ON "payments"("paymentDate");

-- CreateIndex
CREATE INDEX "payments_deletedAt_idx" ON "payments"("deletedAt");

-- CreateIndex
CREATE INDEX "inquiries_customerId_idx" ON "inquiries"("customerId");

-- AddForeignKey
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "inquiries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_additional_costs" ADD CONSTRAINT "sale_additional_costs_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_additional_costs" ADD CONSTRAINT "sale_additional_costs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- Prisma DSL ile ifade edilemeyen finansal bütünlük kısıtları
-- =============================================================================
--
-- Bu kısıtlar servis katmanındaki denetimlerin İKİNCİ KATMANIDIR. Servis
-- zaten reddediyor; buradaki kısıtlar ileride eklenecek bir toplu içe
-- aktarma, elle SQL veya hatalı bir refactor'ın finansal tutarsızlık
-- üretmesini engeller. Para söz konusu olduğunda tek katman yetmez.

-- --- Müşteri ---
ALTER TABLE "customers"
  ADD CONSTRAINT "chk_customers_credit_limit" CHECK ("creditLimit" >= 0);

-- Müşteri kodu, belge numaralarıyla AYNI biçimdedir (MUS-2026-000001):
-- tek bir çakışmasız numara üreteci kullanılır, ikinci bir mekanizma yok.
ALTER TABLE "customers"
  ADD CONSTRAINT "chk_customers_code_format"
  CHECK ("code" ~ '^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$');

-- --- Satış ---
ALTER TABLE "sales"
  ADD CONSTRAINT "chk_sales_number_format"
  CHECK ("saleNumber" ~ '^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$');

-- Tutarlar negatif olamaz. İndirim ve maliyet dahil: negatif bir indirim
-- "gizli zam", negatif maliyet ise sahte kâr üretir.
ALTER TABLE "sales"
  ADD CONSTRAINT "chk_sales_amounts_non_negative"
  CHECK (
    "subtotal" >= 0
    AND "discountTotal" >= 0
    AND "taxTotal" >= 0
    AND "grandTotal" >= 0
    AND "paidTotal" >= 0
    AND "costTotal" >= 0
    AND "additionalCostTotal" >= 0
  );

-- Ödenen tutar genel toplamı AŞAMAZ. Fazla tahsilat bu sprintte avans
-- olarak tutulmuyor; aşım bir hesap hatasıdır.
ALTER TABLE "sales"
  ADD CONSTRAINT "chk_sales_paid_within_total" CHECK ("paidTotal" <= "grandTotal");

-- Kalan borç, genel toplam ile ödenen arasındaki farka EŞİT olmalıdır.
-- Bu kısıt, stored alanların birbirine göre bozulmasını yakalar: bir
-- yerde paidTotal güncellenip remainingTotal atlanırsa INSERT/UPDATE düşer.
ALTER TABLE "sales"
  ADD CONSTRAINT "chk_sales_remaining_consistent"
  CHECK ("remainingTotal" = "grandTotal" - "paidTotal");

-- Vadeli satışta vade tarihi ZORUNLUDUR.
ALTER TABLE "sales"
  ADD CONSTRAINT "chk_sales_credit_needs_due_date"
  CHECK ("paymentType" <> 'CREDIT' OR "dueDate" IS NOT NULL);

-- İptal edilen satışta gerekçe ZORUNLUDUR.
ALTER TABLE "sales"
  ADD CONSTRAINT "chk_sales_cancel_reason"
  CHECK ("status" <> 'CANCELLED' OR ("cancelReason" IS NOT NULL AND "cancelledAt" IS NOT NULL));

-- --- Satış kalemleri ---
ALTER TABLE "sale_items"
  ADD CONSTRAINT "chk_sale_items_quantity" CHECK ("quantity" > 0);

ALTER TABLE "sale_items"
  ADD CONSTRAINT "chk_sale_items_prices"
  CHECK ("unitPurchasePrice" >= 0 AND "unitSalePrice" >= 0 AND "discountAmount" >= 0);

-- İndirim satır ara toplamını AŞAMAZ: aşarsa satır negatif tutara düşer.
ALTER TABLE "sale_items"
  ADD CONSTRAINT "chk_sale_items_discount_within_subtotal"
  CHECK ("discountAmount" <= "lineSubtotal");

-- Türetilmiş satır alanlarının formülle tutarlılığı.
--
-- lineProfit BİLİNÇLİ OLARAK negatif olabilir: zararına satış gerçek bir
-- iş durumudur (elde kalan malı maliyetin altında çıkarmak). Kısıt yalnız
-- hesabın DOĞRU olmasını zorlar, işaretini değil.
ALTER TABLE "sale_items"
  ADD CONSTRAINT "chk_sale_items_derived_consistent"
  CHECK (
    "lineSubtotal" = "unitSalePrice" * "quantity"
    AND "lineTotal" = "lineSubtotal" - "discountAmount"
    AND "lineCost" = "unitPurchasePrice" * "quantity"
    AND "lineProfit" = "lineTotal" - "lineCost"
  );

-- --- Ek maliyetler ---
ALTER TABLE "sale_additional_costs"
  ADD CONSTRAINT "chk_additional_costs_amount" CHECK ("amount" > 0);

-- --- Ödemeler ---
ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_number_format"
  CHECK ("paymentNumber" ~ '^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$');

-- Tutar SIFIRDAN BÜYÜK olmalı. Sıfır tutarlı ödeme kaydı, tahsilat
-- listesini kirletir ve hiçbir şey ifade etmez.
ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_amount" CHECK ("amount" > 0);

-- Çek ve senette vade tarihi ZORUNLUDUR: vadesiz çek takip edilemez.
ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_instrument_due_date"
  CHECK ("method" NOT IN ('CHECK', 'PROMISSORY_NOTE') OR "dueDate" IS NOT NULL);
