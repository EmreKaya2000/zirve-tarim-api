import { createHash } from 'node:crypto';

/**
 * PAKET BAŞINA AYRI POSTGRES ŞEMASI — Sprint 12.
 *
 * =============================================================================
 * NEDEN GEREKLİ
 * =============================================================================
 *
 * e2e paketleri bugüne kadar TEK şemayı (`public`) paylaşıyordu. Her paket
 * kendi verisini bir ön ekle ayırıyor ve `afterAll`da siliyordu; bu, çalışan
 * ama kırılgan bir düzendi:
 *
 *   - Paketler AYNI tohum verisini (ölçü birimleri, kategoriler, markalar)
 *     OKUYOR. Biri onu değiştirirse diğeri sebebini anlamadan kırılır.
 *   - `audit_logs` ve `stock_movements` üzerindeki RULE'lar temizlik için
 *     geçici olarak KAPATILIYOR. Bu, tablo düzeyinde global bir yan etkidir.
 *   - Sayaç tabloları (`number_sequences`) ve benzersizlik kısıtları paylaşımlı.
 *
 * Ölçüm: altı tam koşuda iki kez, FARKLI paketlerde, tekrarlanmayan kırılma
 * gözlendi. Tek başına koşturulduğunda hepsi geçiyordu. Böyle bir paket
 * insanları "tekrar dene"ye alıştırır ve gerçek bir gerilemeyi gürültüye
 * gömer.
 *
 * =============================================================================
 * NASIL ÇALIŞIR
 * =============================================================================
 *
 * Her paket kendi şemasında koşar: `?schema=e2e_auth`, `?schema=e2e_sales`...
 * Şemalar `globalSetup` içinde bir kez oluşturulur, migration uygulanır ve
 * seed edilir. Paketler artık birbirinin verisini GÖREMEZ.
 *
 * KRİTİK ÇAĞRI SIRASI: bu işlev `Test.createTestingModule().compile()` ve
 * `new PrismaClient()` çağrılarından ÖNCE çalışmalıdır. Gerekçe: `AppConfig`
 * ortam değişkenini DI kurulumu sırasında okur, `PrismaClient` ise yapıcıda.
 * İkisi de bu noktadan sonra doğru şemayı görür.
 *
 * `import` deyimleri hoisting yüzünden her şeyden önce çalışır ama yalnız
 * SINIF TANIMLARINI yükler; ortam değişkeni okuması `beforeAll` içindeki
 * `compile()` çağrısında olur. Bu yüzden `beforeAll`un ilk satırı yeterlidir.
 */

/** Şema adlarının ortak ön eki — temizlik betikleri bunu arar. */
export const SCHEMA_PREFIX = 'e2e_';

/**
 * Paket adını geçerli bir şema adına çevirir.
 *
 * PostgreSQL tanımlayıcı sınırı 63 bayttır ve tire kabul etmez. Uzun adlar
 * kısaltılıp sonuna içerik özeti eklenir: iki farklı uzun ad aynı şemaya
 * düşmesin.
 */
export function schemaNameFor(suite: string): string {
  const normalized = suite
    .replace(/\.e2e-spec\.ts$/, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();

  const candidate = `${SCHEMA_PREFIX}${normalized}`;

  if (candidate.length <= 63) {
    return candidate;
  }

  const digest = createHash('sha256').update(suite).digest('hex').slice(0, 8);

  return `${candidate.slice(0, 63 - digest.length - 1)}_${digest}`;
}

/**
 * Verilen bağlantı adresinin şemasını değiştirir.
 *
 * Adresin geri kalanına (kullanıcı, host, port, diğer parametreler)
 * DOKUNULMAZ: CI'da bağlantı adresi dışarıdan verilir ve `sslmode` gibi
 * parametreler taşıyabilir.
 */
export function withSchema(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);

  url.searchParams.set('schema', schema);

  return url.toString();
}

/**
 * Bu paketi kendi şemasına bağlar ve şema adını döndürür.
 *
 * `beforeAll`un İLK satırında çağrılmalıdır (gerekçe: dosya başlığı).
 *
 * @param suite Paket adı. `__filename` verilebilir; dosya adı ayıklanır.
 */
export function useIsolatedSchema(suite: string): string {
  const base = process.env['DATABASE_URL'];

  if (base === undefined || base === '') {
    throw new Error('DATABASE_URL tanımsız. test/setup-env.ts yüklendi mi?');
  }

  const suiteName = suite.split(/[\\/]/).pop() ?? suite;
  const schema = schemaNameFor(suiteName);

  process.env['DATABASE_URL'] = withSchema(base, schema);

  return schema;
}
