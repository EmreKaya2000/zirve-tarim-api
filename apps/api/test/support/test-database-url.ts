/**
 * e2e testlerinin veritabanı adresi — TEK KAYNAK.
 *
 * NEDEN AYRI DOSYA: bu değer iki farklı yerde, iki farklı ZAMANDA gerekiyor:
 *
 *   1. `globalSetup` (test/support/global-setup.ts) — şemaları hazırlarken
 *   2. `setupFiles` (test/setup-env.ts) — her test dosyası için ortamı kurarken
 *
 * Jest `globalSetup`u `setupFiles`tan ÖNCE çalıştırır; yani globalSetup
 * çalışırken `setup-env.ts` henüz yüklenmemiştir ve onun kurduğu varsayılan
 * mevcut değildir. Varsayılan iki dosyada ayrı ayrı yazılsaydı biri
 * değiştiğinde diğeri sessizce farklı bir veritabanına bağlanır ve "tablo
 * bulunamadı" gibi ilgisiz hatalar üretirdi.
 */

/**
 * Yerel geliştirme varsayılanı.
 *
 * `zirve_test` kullanılır, `zirve_tarim` DEĞİL: e2e paketi veri siler ve
 * şema düşürür. Geliştirme veritabanını hedef almak, üzerinde çalıştığınız
 * kataloğu kaybetmek demektir.
 *
 * CI'da `DATABASE_URL` dışarıdan verilir ve bu varsayılan devreye girmez.
 */
const LOCAL_DEFAULT =
  'postgresql://zirve:zirve_local_dev_password@localhost:5432/zirve_test?schema=public';

/** Ortamdan gelen adresi, yoksa yerel varsayılanı döndürür. */
export function resolveTestDatabaseUrl(): string {
  const fromEnv = process.env['DATABASE_URL'];

  return fromEnv === undefined || fromEnv.trim() === '' ? LOCAL_DEFAULT : fromEnv;
}
