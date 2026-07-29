/**
 * e2e testleri için ortam değişkenleri.
 *
 * Testler GERÇEK PostgreSQL üzerinde koşar (docs/ARCHITECTURE.md §11.2):
 * jeton rotasyonu, iptal, benzersizlik kısıtları ve transaction davranışı
 * yalnız gerçek veritabanında anlamlı biçimde doğrulanabilir.
 *
 * Yerelde `zirve_test` veritabanı kullanılır — geliştirme verisi bozulmasın.
 * Hazırlamak için:  pnpm --filter @zirve/api test:e2e:setup
 *
 * CI'da DATABASE_URL dışarıdan verilir ve buradaki varsayılan devreye girmez.
 */
import { resolveTestDatabaseUrl } from './support/test-database-url';

process.env['NODE_ENV'] = 'test';

// Varsayılan TEK YERDE tanımlı; globalSetup da aynı işlevi kullanır.
process.env['DATABASE_URL'] = resolveTestDatabaseUrl();
process.env['JWT_ACCESS_SECRET'] =
  process.env['JWT_ACCESS_SECRET'] ?? 'test-access-secret-en-az-otuz-iki-karakter-uzunlugunda';
process.env['JWT_REFRESH_SECRET'] =
  process.env['JWT_REFRESH_SECRET'] ?? 'test-refresh-secret-en-az-otuz-iki-karakter-uzunlugunda';

/**
 * Müşteri jetonu AYRI bir sırla imzalanır (Sprint 11).
 *
 * Yönetici sırrından farklı olması testlerde de ZORUNLUDUR: audience
 * ayrımının imza katmanında da çalıştığını doğrulayan testler (müşteri
 * jetonuyla /admin erişimi, admin jetonuyla /customer erişimi) aynı sır
 * kullanılırsa yalnız `aud` kontrolünü sınar, iki katmanı birden sınamaz.
 */
process.env['JWT_CUSTOMER_ACCESS_SECRET'] =
  process.env['JWT_CUSTOMER_ACCESS_SECRET'] ??
  'test-customer-secret-en-az-otuz-iki-karakter-uzunlugunda';

process.env['SWAGGER_ENABLED'] = 'false';
process.env['LOG_LEVEL'] = 'error';

/**
 * E-posta testlerde GÖNDERİLMEZ.
 *
 * `log` sürücüsü ağ çağrısı yapmaz. Testler doğrulama ve sıfırlama
 * jetonlarını doğrudan veritabanından okur — akışın SMTP'ye bağımlı olmaması
 * MailService soyutlamasının varlık nedenlerinden biridir.
 */
process.env['MAIL_DRIVER'] = 'log';
process.env['PUBLIC_WEB_URL'] = process.env['PUBLIC_WEB_URL'] ?? 'http://localhost:3000';

/**
 * Hız sınırı testlerde devre dışı bırakılır.
 *
 * Giriş ucunda 5/dk sınır vardır; e2e paketi tek IP'den onlarca giriş yapar
 * ve gerçek sınırla testler birbirini düşürür. Sınırın KENDİSİ ayrı bir
 * testte doğrulanmalıdır (Sprint 9 yük/güvenlik testleri).
 */
process.env['THROTTLE_LIMIT'] = '100000';

// API_PORT bilinçli olarak ayarlanmaz: e2e testleri `app.listen()` çağırmaz,
// supertest HTTP sunucusuna doğrudan bağlanır. Varsayılan (4000) yeterlidir.
