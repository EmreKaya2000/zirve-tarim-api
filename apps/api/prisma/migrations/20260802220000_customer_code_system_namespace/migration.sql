-- =============================================================================
-- MÜŞTERİ KODUNDA AYRILMIŞ SİSTEM ALANI
-- =============================================================================
--
-- `chk_customers_code_format` yalnız üretilen numara biçimini kabul ediyordu:
--   ^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$        örn. MUS-2026-000001
--
-- Kartsız (perakende) peşin satışların bağlandığı SİSTEM KARTI bu biçime
-- sığmıyor: kodu bir sayaçtan üretilmez, sabittir ve müşteri listesinde
-- okunduğunda ne olduğu anlaşılmalıdır.
--
-- Kısıta ikinci bir biçim eklendi:
--   ^[A-Z]{2,6}-SYS-[A-Z]{3,20}$           örn. MUS-SYS-PERAKENDE
--
-- `SYS` segmenti numara üreteci tarafından ASLA üretilemez — o daima dört
-- haneli bir yıl yazar. Dolayısıyla sistem kayıtları ile gerçek müşteri
-- kodları arasında çakışma imkânsızdır ve ayrım koda bakınca görülür.
-- =============================================================================

ALTER TABLE "customers" DROP CONSTRAINT "chk_customers_code_format";

ALTER TABLE "customers"
  ADD CONSTRAINT "chk_customers_code_format"
  CHECK (
    "code" ~ '^[A-Z]{2,6}-[0-9]{4}-[0-9]{6,}$'
    OR "code" ~ '^[A-Z]{2,6}-SYS-[A-Z]{3,20}$'
  );
