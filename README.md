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

## ÜÇ UYGULAMAYI BİRLİKTE ÇALIŞTIRMA

Üç depoyu **yan yana** klonlayın:

```bash
mkdir -p ~/zirve-tarim && cd ~/zirve-tarim
git clone https://github.com/EmreKaya2000/zirve-tarim-api.git
git clone https://github.com/EmreKaya2000/zirve-tarim-front.git
git clone https://github.com/EmreKaya2000/zirve-tarim-admin.git
```

Sonra bu depodan tek komut:

```bash
cd zirve-tarim-api
./scripts/kurulum.sh
```

Betik ön koşulları denetler (docker çalışıyor mu, portlar boş mu), kardeş
depoları klonlar, `.env` dosyasını hazırlar, beş servisi derleyip başlatır,
API sağlıklı olana kadar bekler ve veritabanını doldurur.

**Node ya da pnpm gerektirmez** — her şey konteynerde derlenir. **Tekrar
çalıştırılabilir**: var olan `.env` dosyasına dokunmaz, klonlu depoları
güncellemez (yerel değişikliğiniz durur) ve seed idempotenttir.

Elle yapmayı tercih ederseniz:

```bash
cp .env.example .env
pnpm stack:up          # postgres + mailpit + api + front + admin
docker compose exec api node prisma/seed.js
```

| Servis     | Adres                        |
| ---------- | ---------------------------- |
| Vitrin     | http://localhost:3000        |
| Panel      | http://localhost:3001        |
| API        | http://localhost:4000/api/v1 |
| Swagger    | http://localhost:4000/docs   |
| Mailpit    | http://localhost:8025        |
| PostgreSQL | localhost:5432               |

Durdurmak: `pnpm stack:down` · Loglar: `pnpm stack:logs`

`docker-compose.stack.yml` kardeş depoların kaynaklarından imaj derler; yerel
bir değişikliği görmek için yayınlamaya gerek yoktur.

### Geliştirme modu (kod değişikliği anında yansır)

Yığındaki imajlar üretim derlemesidir, kaynak bağlamaz. Arayüzde çalışırken:

```bash
# bu depoda: yalnız altyapı
docker compose up -d            # postgres + api + mailpit

# vitrin deposunda
pnpm dev                        # :3000

# panel deposunda
pnpm dev                        # :3001
```

`CORS_ORIGINS` **iki kökeni de** içermelidir (`.env.example` içerir); yoksa
arayüzler "Sunucuya ulaşılamadı" der.

## Hızlı başlangıç — yalnız API

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

| Komut                  | Açıklama                                     |
| ---------------------- | -------------------------------------------- |
| `pnpm dev`             | API'yi izleme modunda başlatır               |
| `pnpm build`           | Derler                                       |
| `pnpm lint`            | ESLint — uyarı bile hata sayılır             |
| `pnpm typecheck`       | `tsc --noEmit`                               |
| `pnpm test`            | Birim testler (165)                          |
| `pnpm test:e2e`        | Uçtan uca testler (408) — test veritabanında |
| `pnpm prisma:migrate`  | Migration uygular                            |
| `pnpm prisma:seed`     | Seed verisini yükler                         |
| `pnpm prisma:studio`   | Veritabanını tarayıcıda gezer                |
| `pnpm types:build`     | `@zirve/types` paketini derler               |
| `pnpm docker:up`       | Tüm servisleri kaldırır                      |
| `pnpm e2e:api`         | API'yi TARAYICI TESTLERİ kipinde kaldırır    |
| `./scripts/kurulum.sh` | Sıfırdan kurulum (yeni bilgisayar)           |

Tarayıcı (Playwright) testleri **bu depoda değil**: vitrin testleri
`zirve-tarim-front`, panel testleri `zirve-tarim-admin` deposunda. İkisi de bu
API'nin ayakta olmasını gerektirir.

### Tarayıcı testleri için API'yi `pnpm e2e:api` ile kaldırın

Normal geliştirme ayarıyla kalkan API'de o testlerin bir kısmı **kesinlikle
kırılır ve hata koda değil ortama aittir**:

| Ayar          | Normal | Neden testi kırar                                                                      |
| ------------- | ------ | -------------------------------------------------------------------------------------- |
| Hız sınırı    | açık   | Giriş ucu 5 istek/dk. Paket tek IP'den onlarca giriş yapar → `429 RATE_LIMIT_EXCEEDED` |
| `MAIL_DRIVER` | `log`  | Müşteri zinciri testleri Mailpit kutusunu okur; posta gönderilmezse bağlantı yok       |

```bash
pnpm e2e:api     # NODE_ENV=test + Mailpit'e gerçek SMTP
# ... vitrin/panel deposunda pnpm test:e2e ...
pnpm docker:up   # normal geliştirme kipine dön
```

CI bu ayarı zaten kullanır, o yüzden sorun **yalnız yerelde** görünürdü.
`CORS_ORIGINS` ayrıca `127.0.0.1:3100` ve `:3101` kökenlerini içermelidir —
Playwright standalone sunucuyu o portlarda kaldırır; `.env.example` içerir.

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

### Paylaşım yöntemi: senkron kopya

Front ve Admin depoları paketi `pnpm sync:types` ile **bu depodan kopyalar**.
Kopya `src/types/` altında durur, her dosyanın başında "ELLE DÜZENLEMEYİN"
uyarısı vardır ve o depoların CI'ı `pnpm types:check` ile kopyayı yeniden
üretip `git diff --exit-code` ile ayrışma arar. Elle düzenlenen ya da
güncellenmeyi unutulan kopya **derlemeyi kırar** — sessizce ayrışamaz.

Paket `private: true`'dur ve **yayınlanmaz.**

### Neden registry kullanılmıyor

> Bu bölüm bir denemeyi tekrar etmeyi önlemek için burada. Paket bir kez
> GitHub Packages'a yayınlanmaya çalışıldı ve **çalışmayacağı** görüldü.

**GitHub Packages npm kayıt defteri, paket kapsamının depo sahibiyle aynı
olmasını zorunlu tutar.** Depo sahibi `EmreKaya2000` olduğu için paket
`@emrekaya2000/types` olmak zorundadır. `@zirve/types` yayınlama denemesi şu
hatayı verir:

```
403 permission_denied: The requested installation does not exist.
```

GitHub `zirve` adlı bir kullanıcı/organizasyon arar, bulamaz. Hesapta
organizasyon yok ve `zirve` adlı bir org mevcut değil.

Kapsamı korumak isteyen üç yol var, üçü de bugünkü kurulumun sağladığından
fazlasını getirmiyor:

| Yol                                                       | Bedeli                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Paketi `@emrekaya2000/types` olarak yeniden adlandır      | 135 dosyada import satırı değişir (api 83, front 15, admin 37)     |
| GitHub'da `zirve` organizasyonu kur, üç depoyu oraya taşı | Depo adresleri değişir; en temiz ama hesap düzeyinde iş gerektirir |
| npmjs.com + `@zirve` kapsamı                              | Kapsamın boş olması gerekir; private paket için ücretli plan       |

**Karar: registry kullanılmıyor.** Registry'nin tek getirisi sürüm etiketiydi;
paylaşımın asıl amacı olan "sözleşme üç repoda ayrışmasın" güvencesi senkron
kopya + CI kontrolüyle zaten sağlanıyor. Ayrıca private paket, her geliştirici
makinesinde ve her CI işinde `NODE_AUTH_TOKEN` yönetimi demekti.

Bu karar değişirse yukarıdaki tablodaki yollardan biri seçilmeli; import
yolunun (`@zirve/types`) değişip değişmemesi seçilen yola bağlıdır.

## Dokümantasyon

| Dosya                                            | İçerik                                       |
| ------------------------------------------------ | -------------------------------------------- |
| [`docs/SPEC.md`](./docs/SPEC.md)                 | Bağlayıcı şartname (üç depo için geçerli)    |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Mimari kararlar, ADR, şartname uyum denetimi |
| [`docs/SECURITY.md`](./docs/SECURITY.md)         | Güvenlik planı ve denetim kaydı              |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)     | Dağıtım                                      |
| Swagger                                          | http://localhost:4000/docs                   |
