-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "value" TEXT NOT NULL,
    "valueType" VARCHAR(20) NOT NULL DEFAULT 'string',
    "group" VARCHAR(60) NOT NULL DEFAULT 'general',
    "description" VARCHAR(300),
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "settings_group_idx" ON "settings"("group");

-- CreateIndex
CREATE INDEX "settings_isPublic_idx" ON "settings"("isPublic");

