import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PrismaClient } from '@prisma/client';

import { schemaNameFor, withSchema } from './isolated-schema';
import { resolveTestDatabaseUrl } from './test-database-url';

const execFileAsync = promisify(execFile);

/**
 * e2e paketleri için ŞEMA HAZIRLIĞI — Jest `globalSetup`.
 *
 * Her `*.e2e-spec.ts` dosyası için bir Postgres şeması oluşturur, migration
 * uygular ve seed eder. Gerekçe `isolated-schema.ts` başlığında.
 *
 * =============================================================================
 * NEDEN `prisma migrate deploy`, NEDEN `db push` DEĞİL
 * =============================================================================
 * `db push` şemayı Prisma modelinden türetir ve migration dosyalarındaki
 * ELLE YAZILMIŞ SQL'i uygulamaz: `audit_logs` ve `stock_movements` üzerindeki
 * değişmezlik RULE'ları, CHECK kısıtları ve kısmi indeksler oluşmaz. Testlerin
 * bir bölümü doğrudan bu kısıtları doğruluyor; `db push` ile o testler
 * SESSİZCE anlamsızlaşırdı — kısıt yoksa ihlal de olmaz.
 *
 * =============================================================================
 * NEDEN SINIRLI EŞZAMANLILIK
 * =============================================================================
 * On bir şemayı sırayla hazırlamak yaklaşık bir dakika sürer. Hepsini birden
 * başlatmak ise Postgres bağlantı havuzunu doldurur ve `prisma migrate deploy`
 * kilitlenmelerine yol açar. Dörtlü gruplar ikisinin arasında durur.
 */

/** Aynı anda hazırlanacak şema sayısı. */
const CONCURRENCY = 4;

const API_ROOT = join(__dirname, '..', '..');

export default async function globalSetup(): Promise<void> {
  // `globalSetup`, `setupFiles`tan ÖNCE çalışır: setup-env.ts'in kurduğu
  // varsayılan burada henüz yoktur (bkz. test-database-url.ts).
  const baseUrl = resolveTestDatabaseUrl();

  // Alt süreçler (migrate deploy, seed) bu adresi devralsın.
  process.env['DATABASE_URL'] = baseUrl;

  const suites = await listSuites();

  if (suites.length === 0) {
    throw new Error('test/ altında hiç e2e paketi bulunamadı.');
  }

  const started = Date.now();

  process.stdout.write(`\n[e2e] ${suites.length} paket için izole şema hazırlanıyor...\n`);

  // Şemalar TEK bağlantıyla, sırayla oluşturulur: `CREATE SCHEMA` ucuz bir
  // işlem ve eşzamanlı çalıştırıldığında katalog kilidi için yarışır.
  await createSchemas(baseUrl, suites);

  // Migration + seed pahalı kısım; gruplar hâlinde paralel koşar.
  for (let index = 0; index < suites.length; index += CONCURRENCY) {
    const batch = suites.slice(index, index + CONCURRENCY);

    await Promise.all(batch.map((suite) => prepareSchema(baseUrl, suite)));
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  process.stdout.write(`[e2e] Şemalar hazır (${seconds} sn).\n\n`);
}

/** `test/` altındaki e2e paket dosyalarını listeler. */
async function listSuites(): Promise<string[]> {
  const entries = await readdir(join(API_ROOT, 'test'));

  return entries.filter((entry) => entry.endsWith('.e2e-spec.ts')).sort();
}

/**
 * Şemaları oluşturur ve İÇLERİNİ BOŞALTIR.
 *
 * `DROP SCHEMA ... CASCADE` ile başlanır: önceki koşudan kalan yarım veri,
 * benzersizlik kısıtlarına takılan "zaten var" hataları üretir ve hata
 * mesajı testin kendisiyle ilgisiz görünür. Her koşu temiz bir zeminde
 * başlar — e2e'nin deterministik olmasının önkoşulu bu.
 */
async function createSchemas(baseUrl: string, suites: string[]): Promise<void> {
  // `pg` sürücüsü AYRI BİR BAĞIMLILIK olurdu; yalnız iki DDL cümlesi için
  // paket eklemek yerine üretilmiş Prisma client'ı kullanılıyor.
  const prisma = new PrismaClient({ datasources: { db: { url: baseUrl } } });

  try {
    for (const suite of suites) {
      const schema = schemaNameFor(suite);

      // Şema adı dosya adından türetiliyor ve `[^a-zA-Z0-9]` temizliğinden
      // geçiyor; yine de tanımlayıcı olarak alıntılanır.
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Bir şemaya migration uygular ve seed eder. */
async function prepareSchema(baseUrl: string, suite: string): Promise<void> {
  const schema = schemaNameFor(suite);
  const databaseUrl = withSchema(baseUrl, schema);

  // Alt süreçlere YALNIZ bu şemanın adresi geçirilir.
  const env = { ...process.env, DATABASE_URL: databaseUrl };

  try {
    await execFileAsync('node', [prismaBin(), 'migrate', 'deploy'], {
      cwd: API_ROOT,
      env,
      // Migration çıktısı gürültülü; hata durumunda aşağıda basılır.
      maxBuffer: 10 * 1024 * 1024,
    });

    await execFileAsync('node', [tsxBin(), join(API_ROOT, 'prisma', 'seed.ts')], {
      cwd: API_ROOT,
      env,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    // Hazırlık hatası SESSİZ KALMAMALI: aksi hâlde on bir paket birden
    // "tablo bulunamadı" ile kırılır ve asıl neden görünmez.
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(`[e2e] "${schema}" şeması hazırlanamadı:\n${detail}`);
  }
}

/**
 * Prisma CLI'ın yolu.
 *
 * `pnpm exec` yerine doğrudan JS dosyası çağrılır: paket yöneticisini alt
 * süreç olarak başlatmak her şema için fazladan bir Node süreci ve saniyeler
 * demek olurdu.
 */
function prismaBin(): string {
  return require.resolve('prisma/build/index.js');
}

/**
 * tsx CLI'ın yolu — seed betiği TypeScript olduğu için gerekli.
 *
 * `tsx/dist/cli.mjs` DOĞRUDAN çözülemez: paketin `exports` haritası o alt yolu
 * dışa açmıyor. Haritada tanımlı `tsx/cli` girişi kullanılır.
 */
function tsxBin(): string {
  return require.resolve('tsx/cli');
}
