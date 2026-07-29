-- CreateEnum
CREATE TYPE "StockMovementDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('INITIAL', 'PURCHASE', 'SALE', 'SALE_CANCEL', 'MANUAL_IN', 'MANUAL_OUT', 'WASTE', 'DAMAGE', 'INVENTORY_ADJUSTMENT');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "direction" "StockMovementDirection" NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "previousStock" DECIMAL(18,3) NOT NULL,
    "newStock" DECIMAL(18,3) NOT NULL,
    "referenceType" VARCHAR(40),
    "referenceId" UUID,
    "description" VARCHAR(500),
    "unitCost" DECIMAL(18,4),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_variantId_createdAt_idx" ON "stock_movements"("variantId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_type_createdAt_idx" ON "stock_movements"("type", "createdAt");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "stock_movements_createdAt_idx" ON "stock_movements"("createdAt");

-- AddForeignKey
-- DİKKAT: ON DELETE NO ACTION bilinçlidir, Cascade DEĞİL.
-- Cascade, varyasyon silinince stock_movements üzerinde DELETE tetikler;
-- tablo aşağıdaki RULE ile değişmez olduğu için Postgres önce silmeyi
-- sessizce yutar, sonra "referential integrity query gave unexpected result"
-- hatası verir. NO ACTION ile kural nettir: stok geçmişi olan varyasyon
-- hard delete EDİLEMEZ. Uygulama zaten soft delete kullanır.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- =============================================================================
-- ELLE EKLENEN KISITLAR (Prisma DSL bunları ifade edemez)
-- docs/ARCHITECTURE.md §6.4, §9.5 — Sprint 9
-- =============================================================================

-- Stok hareketi DEĞİŞMEZDİR: yalnız INSERT. UPDATE/DELETE sessizce yok sayılır.
--
-- K-63'ün veritabanı seviyesindeki garantisi. Uygulama katmanı bir gün
-- atlansa bile geçmiş yeniden yazılamaz: previousStock/newStock zinciri
-- kayıt sonrası düzeltilemez, dolayısıyla envanter farkı gizlenemez.
--
-- Testlerde temizlik için `ALTER TABLE stock_movements DISABLE RULE ...`
-- kullanılır (audit_logs ile aynı yaklaşım).
CREATE RULE stock_movements_no_update AS ON UPDATE TO stock_movements DO INSTEAD NOTHING;
CREATE RULE stock_movements_no_delete AS ON DELETE TO stock_movements DO INSTEAD NOTHING;

-- Miktar DAİMA POZİTİFTİR; yön `direction` alanındadır (K-58).
-- Sıfır miktarlı hareket hiçbir şey ifade etmez ve geçmişi kirletir.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "chk_stock_movements_quantity_positive" CHECK ("quantity" > 0);

-- Negatif stok yasaktır (§13.4). Zincirin iki ucu da negatif olamaz.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "chk_stock_movements_stock_not_negative"
  CHECK ("previousStock" >= 0 AND "newStock" >= 0);

-- ZİNCİR TUTARLILIĞI — bu sprintin en önemli kısıtı.
--
-- newStock, previousStock ve quantity birbirinden bağımsız yazılabilseydi
-- hareket geçmişi "denetlenebilir" olmaktan çıkardı: üç alan da doluyken
-- birbirini tutmayan bir satır, hatayı görünmez kılardı. Kısıt, StockService
-- bir gün atlansa bile tutarsız satırın veritabanına girmesini engeller.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "chk_stock_movements_chain_consistent"
  CHECK (
    "newStock" = "previousStock" + CASE WHEN "direction" = 'IN' THEN "quantity" ELSE -"quantity" END
  );

-- Hareket tipi ile yön uyumlu olmalıdır.
--
-- INVENTORY_ADJUSTMENT hariç her tipin yönü sabittir: SALE bir çıkıştır,
-- SALE_CANCEL bir giriştir. Ters yönde yazılmış bir satır, stok raporunu
-- sessizce ikiye katlar. Sayım düzeltmesinin yönü sayılan miktara bağlıdır,
-- bu yüzden serbest bırakılır.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "chk_stock_movements_direction_matches_type"
  CHECK (
    CASE "type"
      WHEN 'INITIAL'     THEN "direction" = 'IN'
      WHEN 'PURCHASE'    THEN "direction" = 'IN'
      WHEN 'SALE_CANCEL' THEN "direction" = 'IN'
      WHEN 'MANUAL_IN'   THEN "direction" = 'IN'
      WHEN 'SALE'        THEN "direction" = 'OUT'
      WHEN 'MANUAL_OUT'  THEN "direction" = 'OUT'
      WHEN 'WASTE'       THEN "direction" = 'OUT'
      WHEN 'DAMAGE'      THEN "direction" = 'OUT'
      ELSE TRUE
    END
  );

-- Referans ikilisi ya tamamen dolu ya tamamen boştur.
-- Yarım referans ("SALE" ama id yok) hiçbir belgeye götürmez.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "chk_stock_movements_reference_pair"
  CHECK (
    ("referenceType" IS NULL AND "referenceId" IS NULL)
    OR ("referenceType" IS NOT NULL AND "referenceId" IS NOT NULL)
  );
