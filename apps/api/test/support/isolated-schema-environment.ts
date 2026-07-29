import { TestEnvironment as NodeEnvironment } from 'jest-environment-node';

import { schemaNameFor, withSchema } from './isolated-schema';
import { resolveTestDatabaseUrl } from './test-database-url';

/**
 * PAKET BAŞINA İZOLE ŞEMA — özel Jest ortamı.
 *
 * =============================================================================
 * NEDEN ORTAM SEVİYESİNDE, NEDEN `beforeAll` İÇİNDE DEĞİL
 * =============================================================================
 *
 * İlk denemede şema `beforeAll`un ilk satırında ayarlanmıştı. ÇALIŞMADI ve
 * nedeni öğreticidir:
 *
 *   `AppConfigModule` şöyle tanımlı:
 *       ＠Module({ imports: [NestConfigModule.forRoot({ validate, ... })] })
 *
 *   `forRoot()` bir dekoratör ARGÜMANIDIR; dolayısıyla sınıf dekore edilirken,
 *   yani `config.module.ts` İLK İÇE AKTARILDIĞINDA çalışır. `import` deyimleri
 *   hoisting yüzünden test dosyasının en başında değerlendirilir — `beforeAll`
 *   çalışmadan çok önce. O anda okunan `DATABASE_URL` neyse, `ConfigService`
 *   ömrü boyunca onu döndürür.
 *
 *   Ölçüm: `process.env` `?schema=e2e_finance` gösterirken `AppConfig`
 *   `?schema=public` döndürüyordu.
 *
 * Jest ortamının `setup()` metodu test dosyası içe aktarılmadan ÖNCE çalışır ve
 * `context.testPath` ile hangi paketin koşacağını bilir. Doğru yer burasıdır.
 *
 * =============================================================================
 * KAZANÇ: PAKET DOSYALARI DEĞİŞMEZ
 * =============================================================================
 * İzolasyon tamamen altyapıda kalır. On bir paket dosyasına tek satır
 * eklenmesi gerekmez; yeni bir paket yazan kişi de bir şey hatırlamak zorunda
 * değildir — dosyayı `test/` altına koyduğu anda kendi şemasını alır.
 */
export default class IsolatedSchemaEnvironment extends NodeEnvironment {
  private readonly schemaName: string;
  private readonly databaseUrl: string;

  constructor(
    config: ConstructorParameters<typeof NodeEnvironment>[0],
    context: ConstructorParameters<typeof NodeEnvironment>[1],
  ) {
    super(config, context);

    const suite = context.testPath.split(/[\\/]/).pop() ?? 'unknown';

    this.schemaName = schemaNameFor(suite);
    this.databaseUrl = withSchema(resolveTestDatabaseUrl(), this.schemaName);
  }

  override async setup(): Promise<void> {
    await super.setup();

    /*
     * `--runInBand` ile tüm paketler AYNI süreçte, sırayla koşar; bu yüzden
     * `process.env` her paket için yeniden yazılır. Jest her test dosyasına
     * TEMİZ bir modül kaydı verdiği için `config.module.ts` yeniden içe
     * aktarılır ve `forRoot()` bu yeni değeri okur.
     *
     * Paralel çalışmada her worker ayrı bir süreçtir; yazma yine güvenlidir.
     */
    process.env['DATABASE_URL'] = this.databaseUrl;

    // Test bağlamının kendi global'ı da aynı değeri görmeli: jest-environment-node
    // `global.process`u paylaşır ama açıkça yazmak, ileride izole bir global
    // kullanılırsa davranışın bozulmamasını sağlar.
    this.global.process.env['DATABASE_URL'] = this.databaseUrl;
  }
}
