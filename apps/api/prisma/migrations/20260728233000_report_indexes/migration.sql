-- Sprint 10 — rapor sorgularının kullandığı kolonlara indeks.
--
-- Ölçüt: bu iki ikili, finans raporlarının HER BİRİNDE birlikte filtrelenir.
-- Tekil indeksler ikisini tek geçişte karşılayamıyordu.

-- Her tahsilat raporu "silinmemiş ödemeler + tarih aralığı" tarar.
CREATE INDEX "payments_deletedAt_paymentDate_idx" ON "payments"("deletedAt", "paymentDate");

-- Kâr raporunun ürün/kategori kırılımı: kalemleri ürüne göre gruplayıp
-- satışa join'ler (tarih ve durum filtresi satış tarafındadır).
CREATE INDEX "sale_items_productId_saleId_idx" ON "sale_items"("productId", "saleId");
