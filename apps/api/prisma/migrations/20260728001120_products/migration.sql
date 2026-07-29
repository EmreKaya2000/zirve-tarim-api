-- CreateEnum
CREATE TYPE "ProductRelationType" AS ENUM ('COMPATIBLE', 'INCOMPATIBLE', 'SIMILAR', 'ALTERNATIVE', 'COMPLEMENTARY', 'RECOMMENDED_TOGETHER');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" VARCHAR(220) NOT NULL,
    "slug" VARCHAR(250) NOT NULL,
    "shortDescription" VARCHAR(500),
    "description" TEXT,
    "brandId" UUID,
    "usageInstructions" TEXT,
    "ingredients" TEXT,
    "storageConditions" TEXT,
    "licenseNumber" VARCHAR(100),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isNew" BOOLEAN NOT NULL DEFAULT false,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "metaTitle" VARCHAR(200),
    "metaDesc" VARCHAR(400),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "searchText" TEXT NOT NULL DEFAULT '',
    "minSalePrice" DECIMAL(18,4),
    "maxSalePrice" DECIMAL(18,4),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "storageKey" VARCHAR(500) NOT NULL,
    "url" VARCHAR(700) NOT NULL,
    "altText" VARCHAR(250),
    "originalName" VARCHAR(255),
    "mimeType" VARCHAR(100) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unitTypeId" UUID NOT NULL,
    "sku" VARCHAR(64) NOT NULL,
    "name" VARCHAR(150),
    "unitQuantity" DECIMAL(18,3) NOT NULL,
    "purchasePrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "minOrderQuantity" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "quantityStep" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "maxOrderQuantity" DECIMAL(18,3),
    "stockQuantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "lowStockThreshold" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "trackStock" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_plants" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "plantId" UUID NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_plants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_soil_types" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "soilTypeId" UUID NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_soil_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_benefits" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "benefitId" UUID NOT NULL,
    "note" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_side_effects" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sideEffectId" UUID NOT NULL,
    "severityOverride" "SideEffectSeverity",
    "note" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_side_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_usage_periods" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "usagePeriodId" UUID NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_usage_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_relations" (
    "id" UUID NOT NULL,
    "sourceProductId" UUID NOT NULL,
    "targetProductId" UUID NOT NULL,
    "type" "ProductRelationType" NOT NULL,
    "note" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_brandId_idx" ON "products"("brandId");

-- CreateIndex
CREATE INDEX "products_isActive_isPublished_deletedAt_idx" ON "products"("isActive", "isPublished", "deletedAt");

-- CreateIndex
CREATE INDEX "products_isFeatured_isActive_idx" ON "products"("isFeatured", "isActive");

-- CreateIndex
CREATE INDEX "products_sortOrder_idx" ON "products"("sortOrder");

-- CreateIndex
CREATE INDEX "products_createdAt_idx" ON "products"("createdAt");

-- CreateIndex
CREATE INDEX "products_minSalePrice_idx" ON "products"("minSalePrice");

-- CreateIndex
CREATE INDEX "products_searchText_idx" ON "products"("searchText");

-- CreateIndex
CREATE INDEX "product_categories_categoryId_idx" ON "product_categories"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_productId_categoryId_key" ON "product_categories"("productId", "categoryId");

-- CreateIndex
CREATE INDEX "product_images_productId_sortOrder_idx" ON "product_images"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_productId_sortOrder_idx" ON "product_variants"("productId", "sortOrder");

-- CreateIndex
CREATE INDEX "product_variants_unitTypeId_idx" ON "product_variants"("unitTypeId");

-- CreateIndex
CREATE INDEX "product_variants_isActive_deletedAt_idx" ON "product_variants"("isActive", "deletedAt");

-- CreateIndex
CREATE INDEX "product_variants_salePrice_idx" ON "product_variants"("salePrice");

-- CreateIndex
CREATE INDEX "product_plants_plantId_idx" ON "product_plants"("plantId");

-- CreateIndex
CREATE UNIQUE INDEX "product_plants_productId_plantId_key" ON "product_plants"("productId", "plantId");

-- CreateIndex
CREATE INDEX "product_soil_types_soilTypeId_idx" ON "product_soil_types"("soilTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "product_soil_types_productId_soilTypeId_key" ON "product_soil_types"("productId", "soilTypeId");

-- CreateIndex
CREATE INDEX "product_benefits_benefitId_idx" ON "product_benefits"("benefitId");

-- CreateIndex
CREATE UNIQUE INDEX "product_benefits_productId_benefitId_key" ON "product_benefits"("productId", "benefitId");

-- CreateIndex
CREATE INDEX "product_side_effects_sideEffectId_idx" ON "product_side_effects"("sideEffectId");

-- CreateIndex
CREATE UNIQUE INDEX "product_side_effects_productId_sideEffectId_key" ON "product_side_effects"("productId", "sideEffectId");

-- CreateIndex
CREATE INDEX "product_usage_periods_usagePeriodId_idx" ON "product_usage_periods"("usagePeriodId");

-- CreateIndex
CREATE UNIQUE INDEX "product_usage_periods_productId_usagePeriodId_key" ON "product_usage_periods"("productId", "usagePeriodId");

-- CreateIndex
CREATE INDEX "product_relations_targetProductId_type_idx" ON "product_relations"("targetProductId", "type");

-- CreateIndex
CREATE INDEX "product_relations_sourceProductId_type_idx" ON "product_relations"("sourceProductId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "product_relations_sourceProductId_targetProductId_type_key" ON "product_relations"("sourceProductId", "targetProductId", "type");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "unit_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_plants" ADD CONSTRAINT "product_plants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_plants" ADD CONSTRAINT "product_plants_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "plants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_soil_types" ADD CONSTRAINT "product_soil_types_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_soil_types" ADD CONSTRAINT "product_soil_types_soilTypeId_fkey" FOREIGN KEY ("soilTypeId") REFERENCES "soil_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_benefits" ADD CONSTRAINT "product_benefits_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_benefits" ADD CONSTRAINT "product_benefits_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "benefits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_side_effects" ADD CONSTRAINT "product_side_effects_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_side_effects" ADD CONSTRAINT "product_side_effects_sideEffectId_fkey" FOREIGN KEY ("sideEffectId") REFERENCES "side_effects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_usage_periods" ADD CONSTRAINT "product_usage_periods_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_usage_periods" ADD CONSTRAINT "product_usage_periods_usagePeriodId_fkey" FOREIGN KEY ("usagePeriodId") REFERENCES "usage_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_sourceProductId_fkey" FOREIGN KEY ("sourceProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- ELLE EKLENEN KISITLAR (Prisma DSL bunları ifade edemez)
-- docs/ARCHITECTURE.md §6.4
-- =============================================================================

-- --- Ürün ilişkileri ---

-- Bir ürün kendisiyle ilişkilendirilemez.
ALTER TABLE "product_relations"
  ADD CONSTRAINT "chk_product_relation_not_self"
  CHECK ("sourceProductId" <> "targetProductId");

-- SİMETRİK türlerde kanonik sıralama ZORUNLUDUR: aynı çift ters yönde ikinci
-- kez yazılamaz. Böylece "A, B ile uyumsuz" bilgisi tek satırda durur ve iki
-- kaydın birbirinden ayrışması (biri silinip diğeri kalması) imkânsız olur.
--
-- YÖNLÜ türlerde ("A yerine B önerilir") sıralama kısıtı UYGULANMAZ; yön
-- anlamın kendisidir.
ALTER TABLE "product_relations"
  ADD CONSTRAINT "chk_product_relation_symmetric_canonical"
  CHECK (
    type IN ('ALTERNATIVE', 'COMPLEMENTARY', 'RECOMMENDED_TOGETHER')
    OR "sourceProductId" < "targetProductId"
  );

-- --- Ana kategori: ürün başına EN FAZLA BİR tane ---
-- Kısmi unique index; Prisma kısmi index ifade edemez.
CREATE UNIQUE INDEX "product_categories_primary_key"
  ON "product_categories" ("productId")
  WHERE "isPrimary" = true;

-- --- Ana görsel: ürün başına EN FAZLA BİR tane ---
CREATE UNIQUE INDEX "product_images_primary_key"
  ON "product_images" ("productId")
  WHERE "isPrimary" = true;

-- --- Varsayılan varyasyon: ürün başına EN FAZLA BİR tane ---
CREATE UNIQUE INDEX "product_variants_default_key"
  ON "product_variants" ("productId")
  WHERE "isDefault" = true AND "deletedAt" IS NULL;

-- --- Varyasyon sayısal kuralları (son savunma hattı) ---
ALTER TABLE "product_variants"
  ADD CONSTRAINT "chk_variant_prices_non_negative"
  CHECK ("purchasePrice" >= 0 AND "salePrice" >= 0 AND "taxRate" >= 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "chk_variant_unit_quantity_positive"
  CHECK ("unitQuantity" > 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "chk_variant_min_order_positive"
  CHECK ("minOrderQuantity" > 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "chk_variant_step_positive"
  CHECK ("quantityStep" > 0);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "chk_variant_max_order_valid"
  CHECK ("maxOrderQuantity" IS NULL OR "maxOrderQuantity" >= "minOrderQuantity");

-- Negatif stok yasak (docs/ARCHITECTURE.md §13.4).
ALTER TABLE "product_variants"
  ADD CONSTRAINT "chk_variant_stock_non_negative"
  CHECK ("stockQuantity" >= 0);

-- --- Görsel boyutu ---
ALTER TABLE "product_images"
  ADD CONSTRAINT "chk_image_size_positive" CHECK ("sizeBytes" > 0);

-- --- Tam metin arama (ürün adı + kısa açıklama + içerik) ---
CREATE INDEX "products_search_idx" ON "products"
  USING GIN (
    to_tsvector(
      'simple',
      name || ' ' || COALESCE("shortDescription", '') || ' ' || COALESCE(ingredients, '')
    )
  );
