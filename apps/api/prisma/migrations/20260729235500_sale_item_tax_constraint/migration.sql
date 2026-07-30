-- ---------------------------------------------------------------------------
-- KDV KURALI: türetilmiş alan tutarlılık kısıtı yenilenir
--
-- Eski kısıt `lineProfit = lineTotal - lineCost` diyordu; KDV'siz dünyada
-- doğruydu. Artık kâr NET tutar üzerinden hesaplanıyor:
--
--   lineTax    = lineTotal * taxRate / (100 + taxRate)
--   lineProfit = (lineTotal - lineTax) - (lineCost - alışKDV)
--
-- Kısıt olduğu gibi bırakılsaydı KDV'li her satış INSERT'te patlardı — nitekim
-- patladı ve bu değişikliği veritabanı yakaladı. Uygulama katmanına güvenip
-- kısıtı gevşetmek yerine formülü kısıta da yazıyoruz: türetilmiş alanların
-- sapması (R-06) en pahalı sessiz hata sınıfıdır.
--
-- Yuvarlama toleransı: uygulama 4 ondalığa yuvarlıyor, SQL'deki ifade tam
-- kesir aritmetiği yapıyor. 0.0001'lik fark meşrudur; eşitlik yerine
-- |fark| <= 0.0001 aranır.
-- ---------------------------------------------------------------------------

ALTER TABLE "sale_items" DROP CONSTRAINT IF EXISTS "chk_sale_items_derived_consistent";

ALTER TABLE "sale_items"
  ADD CONSTRAINT "chk_sale_items_derived_consistent"
  CHECK (
    "lineSubtotal" = "unitSalePrice" * "quantity"
    AND "lineTotal" = "lineSubtotal" - "discountAmount"
    AND "lineCost" = "unitPurchasePrice" * "quantity"
    AND "taxRate" >= 0
    AND abs(
      "lineTax" - ("lineTotal" * "taxRate" / (100 + "taxRate"))
    ) <= 0.0001
    AND abs(
      "lineProfit"
      - (("lineTotal" - "lineTax") - ("lineCost" - ("lineCost" * "taxRate" / (100 + "taxRate"))))
    ) <= 0.0001
  );
