-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_notes_customerId_createdAt_idx" ON "customer_notes"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- ELLE EKLENEN KISITLAR
-- =============================================================================

-- Boş not kaydı hiçbir şey anlatmaz ve görüşme geçmişini kirletir.
-- Uygulama katmanı da reddeder; bu, kod yolu atlanırsa son savunmadır.
ALTER TABLE "customer_notes"
  ADD CONSTRAINT "chk_customer_notes_body_not_blank" CHECK (btrim("body") <> '');
