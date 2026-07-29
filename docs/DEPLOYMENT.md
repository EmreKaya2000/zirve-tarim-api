# Dağıtım Kılavuzu

Zirve Tarım'ı yerelde çalıştırmak ve üretime almak için gereken her şey.

> Bu doküman ÇALIŞTIRILMIŞ komutları içerir. Denenmemiş bir adım varsa
> "DENENMEDİ" ibaresiyle işaretlidir.

---

## 1. Yerel geliştirme

### 1.1 Ön koşullar

| Araç             | Sürüm                      |
| ---------------- | -------------------------- |
| Node.js          | ≥ 20.11                    |
| pnpm             | 9.15.9 (`corepack enable`) |
| Docker + Compose | güncel                     |

### 1.2 Docker ile tüm yığın (önerilen)

```bash
cp .env.example .env

# E-postaları TARAYICIDAN görmek için Mailpit'e yönlendirin.
# Değişkenler kabuktan verildiğinde .env'deki değerleri EZER.
MAIL_DRIVER=smtp SMTP_HOST=mailpit SMTP_PORT=1025 \
  docker compose up -d --build

# Migration API konteyneri açılırken kendi uygulanır. Seed ELLE çalıştırılır:
docker compose exec api node prisma/seed.js
```

Seed **KONTEYNER İÇİNDE** koşturulmalıdır, host'tan `pnpm prisma:seed` ile
DEĞİL. İkisi aynı veritabanını yazar ama görselleri farklı yerlere koyar:
seed her ürün için placeholder'ı `uploads/products/<yıl>/<ay>/` altına
kopyalar. Host'tan koşarsa dosyalar host diskine yazılır; konteynerin gördüğü
`api-uploads` volume'ü BOŞ kalır ve tüm ürün görselleri 404 döner.

Yanlış sırada gidildiyse seed'i tekrar çalıştırmak KURTARMAZ: seed
idempotenttir ve ilk varyasyonun SKU'su varsa ürünü tamamen atlar — görseli de
yeniden üretmez. Bu durumda dosyaları taşıyıp sahipliği düzeltmek gerekir:

```bash
docker cp apps/api/uploads/. zirve-api:/app/apps/api/uploads/
docker compose exec -u 0 api chown -R nestjs:nodejs /app/apps/api/uploads
```

`chown` adımı ATLANAMAZ: `docker cp` host kullanıcısının uid'siyle yazar
(macOS'ta 501), konteyner ise `nestjs` (uid 1001) olarak koşar. Sahiplik
düzeltilmezse dizinler yazılamaz hâlde kalır ve panelden yapılan İLK görsel
yüklemesi `EACCES` ile 500 döner.

`node prisma/seed.js` kullanılır, `prisma db seed` DEĞİL: o komut
`package.json#prisma.seed` üzerinden `tsx` çağırır ve `tsx` bir
devDependency olduğu için üretim imajında yoktur (`spawn tsx ENOENT`).
İmaj derlenirken seed tek bir CJS dosyasına paketlenir.

| Servis         | Adres                        | Not                                           |
| -------------- | ---------------------------- | --------------------------------------------- |
| Vitrin         | http://localhost:3000        | Public site                                   |
| Yönetim paneli | http://localhost:3000/admin  |                                               |
| API            | http://localhost:4000/api/v1 |                                               |
| Swagger        | http://localhost:4000/docs   | Yalnız geliştirmede açık                      |
| Sağlık         | http://localhost:4000/health | Prefix DIŞINDA (orkestratör sabit yol bekler) |
| Mailpit        | http://localhost:8025        | Gönderilen tüm e-postalar burada              |
| PostgreSQL     | localhost:5432               |                                               |

İlk yönetici: `.env` içindeki `SEED_SUPER_ADMIN_EMAIL` / `SEED_SUPER_ADMIN_PASSWORD`
(varsayılan `admin@zirvetarim.local` / `ZirveTarim2026`).

### 1.3 Host'ta geliştirme (hot reload)

```bash
docker compose up -d postgres mailpit   # yalnız altyapı
pnpm install
pnpm prisma:migrate:deploy
pnpm prisma:seed
pnpm dev                                # api :4000, web :3000
```

`pnpm dev` kullanırken `SMTP_HOST=localhost` olmalıdır (`mailpit` yalnız
konteyner ağında çözülür).

### 1.4 E-postaları görmek

Kayıt, e-posta doğrulama ve şifre sıfırlama akışları e-posta gönderir.

- `MAIL_DRIVER=log` → gönderilmez, gövde API log'una yazılır
  (`docker compose logs -f api`). Bağlantıyı log'dan kopyalayın.
- `MAIL_DRIVER=smtp` + Mailpit → http://localhost:8025 adresinden okunur.
  Gerçek SMTP yolu çalıştığı için üretim davranışına en yakın olan budur.

---

## 2. Test

```bash
pnpm test                                # birim (155)
pnpm --filter @zirve/api test:e2e        # API e2e (380) — gerçek PostgreSQL
pnpm --filter @zirve/web test:e2e        # Playwright
```

**API e2e paket başına AYRI ŞEMADA koşar.** `test/support/global-setup.ts` her
`*.e2e-spec.ts` için bir şema oluşturur, migration uygular ve seed eder
(~14 sn). Paketler birbirinin verisini göremez; bu, Sprint 12'de ölçülen
tekrarlanmayan kırılmaları ortadan kaldırdı.

Playwright ön koşulları:

```bash
# 1) API ayakta ve seed edilmiş olmalı
# 2) Müşteri zinciri için Mailpit + SMTP:
docker compose up -d mailpit
MAIL_DRIVER=smtp SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
  PUBLIC_WEB_URL=http://127.0.0.1:3100 node apps/api/dist/main.js &
pnpm --filter @zirve/web test:e2e
```

Mailpit yoksa müşteri zinciri paketi **atlanır** (kırılmaz).

Yerelde üst üste koşarken `NODE_ENV=test` ile API başlatın: kayıt ucu saatte
5 istekle sınırlı ve sınır gerçek kullanıcıyı korumak için oradadır —
gevşetilmez, test ortamında atlanır.

---

## 3. Üretim

### 3.1 Sırları hazırla

```bash
cp .env.example .env.production
```

`.env.production` içinde ZORUNLU olanlar — `docker-compose.prod.yml` bunlar
tanımsızsa yığını **ayağa kaldırmaz**:

| Değişken                                              | Not                                    |
| ----------------------------------------------------- | -------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` |                                        |
| `JWT_ACCESS_SECRET`                                   | `openssl rand -base64 48`              |
| `JWT_REFRESH_SECRET`                                  | access'ten FARKLI olmalı               |
| `JWT_CUSTOMER_ACCESS_SECRET`                          | access'ten FARKLI olmalı               |
| `CORS_ORIGINS`                                        | Joker (`*`) KABUL EDİLMEZ              |
| `MAIL_FROM_ADDRESS`, `SMTP_HOST`                      | `MAIL_DRIVER=log` üretimde REDDEDİLİR  |
| `PUBLIC_WEB_URL`                                      | E-posta bağlantılarının kökü           |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`         | Tarayıcıdan erişilecek GERÇEK adresler |

Üretim ortamı ayrıca uygulama açılışında doğrulanır (`env.validation.ts`):
yer tutucu sır, açık Swagger, joker CORS, `log` posta sürücüsü ve varsayılan
seed şifresi uygulamayı **başlatmaz**.

### 3.2 Migration — ÖNCE, ayrı adım

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  --profile migrate run --rm migrate
```

`migrate deploy` yalnız bekleyen migration'ları uygular; yeni migration
**üretmez** ve şema sıfırlamaz. `migrate dev` üretimde ASLA kullanılmaz.

**Neden ayrı adım:** iki API örneği aynı anda başlarsa ikisi de migration
uygulamaya kalkar. Prisma advisory lock kullandığı için veri bozulmaz ama
kilidi bekleyen örnek sağlık kontrolünü geçemez ve orkestratör onu ölü sayar.

### 3.3 Uygulamayı başlat

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`api` ve `web` portları **dışarıya açılmaz** (`expose`, `ports` değil).
Önlerine bir reverse proxy koyun:

| Yol                             | Hedef      |
| ------------------------------- | ---------- |
| `/`                             | `web:3000` |
| `/api/`, `/health`, `/uploads/` | `api:4000` |

Proxy'nin keep-alive süresi uygulamanın `KEEP_ALIVE_TIMEOUT` değerinden
(varsayılan 65000 ms) **KISA** olmalıdır. Aksi hâlde Node bağlantıyı proxy'den
önce kapatır ve istemci sebepsiz 502 alır.

### 3.4 İlk yönetici

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec api sh -c 'SEED_SUPER_ADMIN_EMAIL=... SEED_SUPER_ADMIN_PASSWORD=... node prisma/seed.js'
```

`prisma db seed` KULLANILMAZ: o komut `tsx`'e ihtiyaç duyar ve `tsx` üretim
imajında yoktur (bkz. §1.2).

Uploads için **bind mount** kullanılıyorsa (adlandırılmış volume yerine) host
dizini konteyner kullanıcısına ait olmalıdır — aksi hâlde görsel yükleme
`EACCES` verir. Adlandırılmış volume'de bu gerekmez; Docker sahipliği imajdaki
dizinden devralır:

```bash
sudo chown -R 1001:1001 /srv/zirve/uploads
```

Üretimde **demo verisi yüklenmez** (uydurma markalar, ürünler, kredi limitli
müşteriler). Yalnız sistem verisi gelir: ayarlar, süper yönetici, ölçü
birimleri ve tarımsal taksonomi. Bilinçli olarak demo istenirse
`SEED_DEMO_DATA=true` — o durumda gürültülü bir uyarı basılır.

Seed **idempotenttir**: tekrar çalıştırmak kayıt çoğaltmaz ve mevcut
yöneticinin şifresini EZMEZ.

### 3.5 Kapanış ve yeniden başlatma

API `SIGTERM` aldığında yeni bağlantı almayı bırakır, açık istekleri
tamamlamayı bekler (azami 15 sn) ve veritabanı havuzunu kapatır.
`docker-compose.prod.yml` bu yüzden `stop_grace_period: 30s` kullanır —
Docker'ın varsayılan 10 saniyesi kapanış tamamlanmadan `SIGKILL` gönderirdi.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
```

### 3.6 Yedekleme

```bash
# Veritabanı
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > yedek.sql.gz

# Yüklenen görseller (api-uploads volume)
docker run --rm -v zirve-tarim-prod_api-uploads:/data -v "$PWD":/backup alpine \
  tar czf /backup/uploads.tar.gz -C /data .
```

> Görseller şu an yerel diskte (volume). `StorageService` soyutlaması S3/R2
> sürücüsü eklenebilecek şekilde duruyor; o geçiş yapılana kadar volume
> yedeği ihmal edilmemelidir — kaybı ürün görsellerinin tamamı demektir.

---

## 4. CI/CD

`.github/workflows/ci.yml` beş iş çalıştırır:

| İş         | Ne zaman             | Ne yapar                                                                         |
| ---------- | -------------------- | -------------------------------------------------------------------------------- |
| `verify`   | PR + main            | install → prisma generate → format → lint → typecheck → birim test → build       |
| `database` | PR + main            | PostgreSQL → migrate deploy → seed → **şema/migration drift kontrolü** → API e2e |
| `web-e2e`  | PR + main            | PostgreSQL + **Mailpit** → seed → API başlat → web derle → Playwright            |
| `docker`   | **yalnız main push** | API ve web imajlarını derler (`needs: verify, database, web-e2e`)                |
| `audit`    | PR + main            | `pnpm audit`; **derlemeyi kırmaz** (`continue-on-error`)                         |

**Drift kontrolü** kritiktir: migration'lar uygulandıktan sonra şema ile
veritabanı arasında fark kalmamalıdır. Fark varsa biri Prisma şemasını
değiştirip migration üretmeyi unutmuş demektir.

**`docker` işi imajı YAYINLAMAZ**, yalnız derler. Kayıt defterine gönderim
hedef ortam ve kimlik bilgileri belirlendiğinde eklenecek: (DENENMEDİ)

```yaml
- uses: docker/login-action@v3
  with:
    registry: ghcr.io
    username: ${{ github.actor }}
    password: ${{ secrets.GITHUB_TOKEN }}
# ardından build-push-action'da: push: true
```

**`audit` neden kırmıyor:** üçüncü taraf bir pakette yayınlanan yeni bir
advisory bizim yayınımızı anında bloke etmemelidir. Değerlendirme ve karar
`docs/SECURITY.md` §8'de kayıt altına alınır.

---

## 5. Sorun giderme

| Belirti                                      | Neden / çözüm                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `web` konteyneri ayağa kalkmıyor             | `api` sağlıklı olmayı bekliyor (`depends_on`). `docker compose logs api`                                 |
| Görseller 404                                | Seed host'tan koşmuş: dosyalar volume'de değil. Konteyner içinde `node prisma/seed.js` (bkz. §1.2)       |
| Görsel yükleme 500 / `EACCES`                | Uploads ağacı `nestjs` (1001) dışında birinin. `docker compose exec -u 0 api chown -R 1001:1001 uploads` |
| `prisma db seed` → `spawn tsx ENOENT`        | Üretim imajında `tsx` yok. `node prisma/seed.js` kullanılır                                              |
| Görsellerin URL'i `localhost:4000`'e gidiyor | Web imajı yanlış `WEB_BUILD_API_ORIGIN` ile derlenmiş; rewrite derleme anında gömülür                    |
| Tarayıcıdan API'ye istekler CORS'a takılıyor | `CORS_ORIGINS` sitenin GERÇEK kökenini içermeli; joker kabul edilmez                                     |
| Doğrulama e-postası gelmiyor                 | `MAIL_DRIVER=log` mu? Üretimde bu değer reddedilir; geliştirmede log'a bakın                             |
| E-postadaki bağlantı yanlış adrese gidiyor   | `PUBLIC_WEB_URL` yanlış. Adres isteğin `Host` başlığından TÜRETİLMEZ (host header injection)             |
| Proxy arkasında rastgele 502                 | Proxy'nin keep-alive süresi `KEEP_ALIVE_TIMEOUT`tan uzun                                                 |
| `NEXT_PUBLIC_*` değişikliği etkisiz          | Bu değerler derleme anında gömülür; web imajı YENİDEN derlenmeli                                         |
| Playwright "Cannot find module server.js"    | Web derlenmemiş. `pnpm --filter @zirve/web build` (standalone kopyalamayı da yapar)                      |
| Playwright eski sürümü test ediyor           | Ayakta kalmış bir standalone sunucu yeniden kullanılıyor. `pkill -f standalone/apps/web/server.js`       |
| e2e "tablo bulunamadı"                       | Şema hazırlığı düşmüş. `pnpm --filter @zirve/api test:e2e:setup` ve `globalSetup` çıktısına bakın        |

---

## 6. Bilinen sınırlar

Üretime almadan önce bilinmesi gerekenler. Ayrıntı: `docs/ROADMAP.md`,
`docs/SECURITY.md` §10.

- **Tek API örneği varsayılıyor.** Hız sınırı sayacı bellekte; yatay
  ölçeklemede etkin sınır örnek sayısıyla çarpılır.
- **Görseller yerel diskte.** Birden çok API örneği aynı volume'ü paylaşmak
  zorunda kalır.
- **Refresh token `localStorage`'da**, `httpOnly` çerezde değil.
- **Yapılandırılmış log yok**; Nest'in varsayılan logger'ı kullanılıyor.
- **İade akışı yok** (enum'larda hazır, uygulanmadı).
- **Tek mağaza, tek depo, TRY.**
