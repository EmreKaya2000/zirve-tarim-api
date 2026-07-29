# ZirveTarım Api

Ziraat mağazası katalog, talep, satış ve finans sisteminin **REST API**'si.
NestJS + Prisma + PostgreSQL.

Bu depo ayrıca **`@zirve/types`** paketini barındırır: API sözleşmesi (tipler,
enum sabitleri, talep durum makinesi, satış izin kuralları, etiketler). Vitrin
ve yönetim paneli bu paketi tüketir.

## Üç depolu yapı

| Depo                                                                   | Ne yapar                                  |
| ---------------------------------------------------------------------- | ----------------------------------------- |
| **zirve-tarim-api** (bu depo)                                          | REST API + `@zirve/types` sözleşme paketi |
| [zirve-tarim-front](https://github.com/EmreKaya2000/zirve-tarim-front) | Halka açık vitrin (Next.js)               |
| [zirve-tarim-admin](https://github.com/EmreKaya2000/zirve-tarim-admin) | Yönetim paneli (Next.js)                  |

Şartname üçünde de geçerlidir: [`docs/SPEC.md`](./docs/SPEC.md).

## Hızlı başlangıç

### Docker ile (önerilen)

```bash
cp .env.example .env
docker compose up -d
```

Migration'lar API konteyneri açılışında otomatik uygulanır. Seed:

```bash
docker compose exec api node prisma/seed.js
```

| Servis     | Adres                        |
| ---------- | ---------------------------- |
| API        | http://localhost:4000/api/v1 |
| Swagger    | http://localhost:4000/docs   |
| Sağlık     | http://localhost:4000/health |
| PostgreSQL | localhost:5432               |
| Mailpit    | http://localhost:8025        |

Yönetici girişi (seed): `admin@zirvetarim.local` / `ZirveTarim2026`

### Yerel geliştirme

```bash
cp .env.example .env
docker compose up -d postgres mailpit

pnpm install
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
```

## Komutlar

| Komut                 | Açıklama                                     |
| --------------------- | -------------------------------------------- |
| `pnpm dev`            | API'yi izleme modunda başlatır               |
| `pnpm build`          | Derler                                       |
| `pnpm lint`           | ESLint — uyarı bile hata sayılır             |
| `pnpm typecheck`      | `tsc --noEmit`                               |
| `pnpm test`           | Birim testler (155)                          |
| `pnpm test:e2e`       | Uçtan uca testler (399) — test veritabanında |
| `pnpm prisma:migrate` | Migration uygular                            |
| `pnpm prisma:seed`    | Seed verisini yükler                         |
| `pnpm prisma:studio`  | Veritabanını tarayıcıda gezer                |
| `pnpm types:build`    | `@zirve/types` paketini derler               |
| `pnpm docker:up`      | Tüm servisleri kaldırır                      |

Tarayıcı (Playwright) testleri **bu depoda değil**: vitrin testleri
`zirve-tarim-front`, panel testleri `zirve-tarim-admin` deposunda. İkisi de bu
API'nin ayakta olmasını gerektirir.

## `@zirve/types` — sözleşme paketi

Paket **71 tip** ve **116 çalışma zamanı değeri** içerir. İkincisi kritik:
bunlar yalnız sabit değil, API ile arayüzlerin **paylaştığı iş kuralları**.

```
ALLOWED_INQUIRY_TRANSITIONS  canTransitionInquiry  nextInquiryStatuses
canCancelSale  canEditSale  canAcceptPayment
requiresSuperAdminForStockType   isValidCustomerPassword
MAX_LIMIT  DEFAULT_LIMIT  ERROR_CODES  MAX_INQUIRY_ITEMS
SALE_STATUS_LABELS  STOCK_MOVEMENT_TYPE_LABELS  (+20 etiket haritası)
```

**Neden kopyalanmamalı:** API geçişi doğrular, panel aynı tablodan seçenek
listesi kurar. İkisi ayrışırsa panel, API'nin reddedeceği bir geçişi kullanıcıya
sunar. Bu projede bu sınıf hata bir kez yaşandı: ürün formu taksonomi
listelerini `limit=200` ile çekiyordu, API'nin üst sınırı 100'dü; yedi listenin
tamamı 400 dönüyor ve ölçü birimi gelmediği için varyasyon oluşturulamıyordu.
Düzeltmesi "elle yazılan sayı yerine paylaşılan `MAX_LIMIT` sabitini kullan"
oldu.

### Bugünkü paylaşım yöntemi: senkron kopya

Front ve Admin depoları paketi `pnpm sync:types` ile **bu depodan kopyalar**.
Kopya `src/types/` altında durur, başında "ELLE DÜZENLEMEYİN" uyarısı vardır ve
o depoların CI'ı kopyanın ayrışıp ayrışmadığını kontrol eder.

Neden böyle: paket PRIVATE olacağı için registry'den çekmek **her makinede ve
her CI işinde** `NODE_AUTH_TOKEN` zorunlu kılar. Senkron kopya, token
kurulmadan çalışan bir sistem verir ve tek doğru kaynağı korur.

### Registry'ye geçiş (token hazır olduğunda)

1. Bu depoda: **Settings > Actions > General > Workflow permissions** →
   _Read and write permissions_.
2. `@zirve/types yayınla` workflow'unu elle tetikle (Actions sekmesi).
3. Front ve Admin depolarında `NODE_AUTH_TOKEN` secret'ını ekle ve
   `.npmrc`'ye `@zirve:registry=https://npm.pkg.github.com` satırını koy.
4. O depolarda `pnpm sync:types` adımını kaldır, `@zirve/types` bağımlılığını
   sürümle bağla.

Import yolları iki yöntemde de **aynı** (`@zirve/types`), yani geçiş uygulama
kodunu hiç etkilemez.

## Dokümantasyon

| Dosya                                            | İçerik                                       |
| ------------------------------------------------ | -------------------------------------------- |
| [`docs/SPEC.md`](./docs/SPEC.md)                 | Bağlayıcı şartname (üç depo için geçerli)    |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Mimari kararlar, ADR, şartname uyum denetimi |
| [`docs/SECURITY.md`](./docs/SECURITY.md)         | Güvenlik planı ve denetim kaydı              |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)     | Dağıtım                                      |
| Swagger                                          | http://localhost:4000/docs                   |
