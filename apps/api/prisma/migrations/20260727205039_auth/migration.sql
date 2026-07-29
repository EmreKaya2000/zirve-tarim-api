-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SALES_STAFF', 'WAREHOUSE_STAFF', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'STATUS_CHANGE', 'PASSWORD_CHANGE', 'PRICE_CHANGE', 'STOCK_ADJUST', 'PAYMENT_RECORDED', 'SALE_CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(30),
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(6),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "replacedByTokenHash" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "ipAddress" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "revokedReason" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" UUID,
    "oldData" JSONB,
    "newData" JSONB,
    "description" VARCHAR(500),
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_isActive_idx" ON "users"("role", "isActive");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- DİKKAT: ON DELETE NO ACTION bilinçli bir seçimdir, SET NULL DEĞİL.
-- SET NULL, kullanıcı silindiğinde audit_logs üzerinde UPDATE tetikler;
-- bu tablo aşağıdaki RULE ile değişmez olduğu için Postgres
-- "referential integrity query gave unexpected result" hatası verir.
-- NO ACTION ile kural nettir: denetim geçmişi olan kullanıcı silinemez.
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- =============================================================================
-- ELLE EKLENEN KISITLAR (Prisma DSL bunları ifade edemez)
-- docs/ARCHITECTURE.md §6.4, §11.1
-- =============================================================================

-- Denetim kaydı DEĞİŞMEZDİR: yalnız INSERT. UPDATE/DELETE sessizce yok sayılır.
-- Kural 4 ve K-72'nin veritabanı seviyesindeki garantisi.
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- NOT: Burada bilinçli olarak KISMİ unique index KULLANILMIYOR.
--
-- `CREATE UNIQUE INDEX ... WHERE "deletedAt" IS NULL` soft-delete edilmiş bir
-- kullanıcının e-postasının yeniden kullanılmasını sağlardı; ancak Prisma
-- şeması kısmi index ifade edemediği için `prisma migrate diff` kalıcı olarak
-- sapma (drift) bildirir ve CI'daki "şema/migration senkron mu" kontrolü
-- kullanılamaz hâle gelir. O kontrol daha değerlidir: "şema değişti ama
-- migration üretilmedi" hatasını yakalar.
--
-- E-posta yeniden kullanımı bunun yerine uygulama katmanında çözülür:
-- soft delete sırasında e-posta anonimleştirilir (UsersService.remove).
-- Bu aynı zamanda KVKK açısından da daha iyidir — silinen kullanıcının
-- kişisel verisi veritabanında tutulmaz.

-- Sayaçlar negatif olamaz.
ALTER TABLE "users"
  ADD CONSTRAINT "chk_users_failed_login_non_negative" CHECK ("failedLoginCount" >= 0);
