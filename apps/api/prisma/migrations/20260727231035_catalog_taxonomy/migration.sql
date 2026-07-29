-- CreateEnum
CREATE TYPE "SideEffectSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MeasurementType" AS ENUM ('WEIGHT', 'VOLUME', 'COUNT', 'PACKAGING', 'LENGTH', 'AREA');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "imageUrl" VARCHAR(500),
    "icon" VARCHAR(60),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metaTitle" VARCHAR(200),
    "metaDesc" VARCHAR(400),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "logoUrl" VARCHAR(500),
    "websiteUrl" VARCHAR(500),
    "country" VARCHAR(80),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "latinName" VARCHAR(150),
    "description" TEXT,
    "imageUrl" VARCHAR(500),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "plants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soil_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "phRange" VARCHAR(40),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "soil_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefits" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(60),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "benefits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "side_effects" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "severity" "SideEffectSeverity" NOT NULL DEFAULT 'LOW',
    "precaution" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "side_effects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_periods" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "usage_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" TEXT,
    "code" VARCHAR(16) NOT NULL,
    "measurementType" "MeasurementType" NOT NULL DEFAULT 'COUNT',
    "allowsDecimal" BOOLEAN NOT NULL DEFAULT false,
    "conversionFactor" DECIMAL(18,6),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "unit_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parentId_sortOrder_idx" ON "categories"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "categories_isActive_deletedAt_idx" ON "categories"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "brands_slug_key" ON "brands"("slug");

-- CreateIndex
CREATE INDEX "brands_isActive_deletedAt_idx" ON "brands"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "plants_slug_key" ON "plants"("slug");

-- CreateIndex
CREATE INDEX "plants_isActive_deletedAt_idx" ON "plants"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "soil_types_slug_key" ON "soil_types"("slug");

-- CreateIndex
CREATE INDEX "soil_types_isActive_deletedAt_idx" ON "soil_types"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "benefits_slug_key" ON "benefits"("slug");

-- CreateIndex
CREATE INDEX "benefits_isActive_deletedAt_idx" ON "benefits"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "side_effects_slug_key" ON "side_effects"("slug");

-- CreateIndex
CREATE INDEX "side_effects_severity_idx" ON "side_effects"("severity");

-- CreateIndex
CREATE INDEX "side_effects_isActive_deletedAt_idx" ON "side_effects"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "usage_periods_slug_key" ON "usage_periods"("slug");

-- CreateIndex
CREATE INDEX "usage_periods_isActive_deletedAt_idx" ON "usage_periods"("isActive", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "unit_types_slug_key" ON "unit_types"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "unit_types_code_key" ON "unit_types"("code");

-- CreateIndex
CREATE INDEX "unit_types_measurementType_idx" ON "unit_types"("measurementType");

-- CreateIndex
CREATE INDEX "unit_types_isActive_deletedAt_idx" ON "unit_types"("isActive", "deletedAt");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
