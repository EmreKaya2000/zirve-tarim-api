# Güvenlik Denetimi

Sprint 12 kapsamında yürütülen denetimin sonucu. Her satır **kanıta** dayanır:
bir dosya/satır referansı, bir test adı veya çalıştırılmış bir komut.

> Bu doküman bir söz listesi değil, bir **durum raporudur**. Karşılanmayan
> maddeler de aşağıda, gerekçesiyle ve etki değerlendirmesiyle birlikte yazılıdır.

Son güncelleme: Sprint 12 · Denetlenen sürüm: `main` (Sprint 11 sonrası)

---

## 1. Güvenlik başlıkları — Helmet

| Kontrol                            | Durum       | Kanıt                                                                                                                    |
| ---------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Helmet kurulu ve global            | ✅          | `apps/api/src/main.ts:29`                                                                                                |
| CSP üretimde açık                  | ✅          | `contentSecurityPolicy: config.isProduction ? undefined : false` — üretimde Helmet'in varsayılan CSP'si devreye girer    |
| CSP geliştirmede kapalı            | ⚠️ Bilinçli | Swagger UI satır içi script/stil kullanıyor; üretimde Swagger da kapalı olduğu için gevşetme yalnız geliştirmeyi etkiler |
| `crossOriginEmbedderPolicy` kapalı | ⚠️ Bilinçli | Aynı kökenden servis edilen görsellerde COEP gereksiz kısıtlama üretiyor                                                 |

Web tarafında ayrıca `apps/web/next.config.ts` içinde `headers()` ile güvenlik
başlıkları tanımlı.

---

## 2. CORS

| Kontrol                           | Durum | Kanıt                                                                                                                         |
| --------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| Whitelist kullanılıyor, joker yok | ✅    | `main.ts:38` — `origin: config.corsOrigins` (virgülle ayrılmış liste)                                                         |
| Üretimde joker REDDEDİLİR         | ✅    | `env.validation.ts` — `CORS_ORIGINS` `*` içerirse uygulama başlamaz. Test: `env.validation.spec.ts` → "joker CORS u reddeder" |
| İzinli metot ve başlıklar sınırlı | ✅    | `main.ts:41-42`                                                                                                               |
| `credentials: true`               | ✅    | Çerez tabanlı jeton taşımaya geçişte gerekli                                                                                  |

---

## 3. Hız sınırlama (rate limiting)

Global sınır: `THROTTLE_LIMIT` (varsayılan 120/dk). Uç bazlı sıkı sınırlar:

| Uç                                        | Sınır      | Gerekçe                                                               |
| ----------------------------------------- | ---------- | --------------------------------------------------------------------- |
| `POST /auth/login`                        | 5/dk       | Kaba kuvvet; hesap kilidiyle (5 denemede 15 dk) iki katmanlı          |
| `POST /auth/refresh`                      | 20/dk      | —                                                                     |
| `POST /customer-auth/register`            | 5/saat     | Gerçek kullanıcı bir kez kayıt olur                                   |
| `POST /customer-auth/login`               | 10/dk      | Vitrinde aynı IP arkasında çok kullanıcı olabilir                     |
| `POST /customer-auth/forgot-password`     | **3/saat** | **En sıkı**: başkasının posta kutusuna e-posta göndertilebilen tek uç |
| `POST /customer-auth/reset-password`      | 10/saat    | —                                                                     |
| `POST /customer-auth/verify-email`        | 20/saat    | Kullanıcı bağlantıya iki kez dokunabilir                              |
| `POST /customer-auth/resend-verification` | 3/saat     | Posta bombalama engeli                                                |
| `PATCH /customer/profile`                 | 10/saat    | E-posta değişikliği posta tetikler                                    |
| `POST /public/inquiries`                  | 5/saat     | Spam talep engeli                                                     |
| `POST /public/cart/validate`              | 60/dk      | Sepet açılışında çağrılır                                             |
| `/customer/cart/*` yazma                  | 60/dk      | Adımlayıcı insan hızının üstünde                                      |
| `POST /customer/cart/merge`               | 10/dk      | İstemci girişte bir kez çağırır                                       |

**Test ortamında sınır KAPALIDIR** (`app.module.ts` → `skipIf: () => config.isTest`).
Bu bilinçli: e2e paketi tek IP'den yüzlerce istek atıyor. Sınırın kendisi
`.env` ile gevşetilemez — `@Throttle` dekoratörleri sabittir.

> ⚠️ **Bilinen boşluk:** hız sınırı sayacı **bellekte** tutulur. Birden çok API
> örneği çalıştırıldığında her örnek kendi sayacını tutar ve etkin sınır örnek
> sayısıyla çarpılır. Tek örnekli kurulumda (MVP hedefi) sorun değildir; yatay
> ölçeklemede Redis tabanlı bir depo gerekir → `docs/ROADMAP.md`.

---

## 4. Dosya yükleme doğrulaması

| Kontrol                          | Durum | Kanıt                                                                      |
| -------------------------------- | ----- | -------------------------------------------------------------------------- |
| Boyut sınırı                     | ✅    | `uploads.controller.ts:56` — `limits: { fileSize: MAX_IMAGE_SIZE_BYTES }`  |
| Dosya sayısı sınırı              | ✅    | Aynı satır — `files: MAX_IMAGES_PER_PRODUCT`                               |
| MIME tipi whitelist              | ✅    | `uploads.service.ts:311` — yalnız JPG, PNG, WebP                           |
| **Magic bytes (içerik imzası)**  | ✅    | `uploads.service.ts:322` — `signature.mime !== file.mimetype` ise reddeder |
| Yükleme kimlik doğrulaması ister | ✅    | `/admin/uploads/*` — `JwtAuthGuard` + `RolesGuard`                         |

Üçüncü kontrol kritiktir: yalnız `Content-Type` başlığına bakan bir doğrulama,
uzantısı değiştirilmiş bir betiğin geçmesine izin verir. Gerçek içerik imzası
kontrol edildiği için `.php` içeriğini `image/png` diye göndermek işe yaramaz.

---

## 5. Hassas alan sızıntısı — OTOMATİK TARAMA

| Kontrol                                  | Durum | Kanıt                                                               |
| ---------------------------------------- | ----- | ------------------------------------------------------------------- |
| Public/müşteri uçlarında hassas alan yok | ✅    | `apps/api/test/sensitive-leak.e2e-spec.ts` — 22 uç, 12 test         |
| Taramanın kendisi doğrulanmış            | ✅    | Aynı paket → "yasaklı anahtarı GERÇEKTEN yakalar (negatif kontrol)" |

Taranan yasaklı anahtarlar: `purchasePrice`, `unitPurchasePrice`, `unitCost`,
`averageCost`, `costTotal`, `lineCost`, `additionalCostTotal`, `grossProfit`,
`netProfit`, `lineProfit`, `creditLimit`, `openingBalance`, `internalNote`,
`passwordHash`, `consentIpAddress`, `ipAddress`, `userAgent`,
`failedLoginCount`, `lockedUntil`, `tokenHash`, `replacedByTokenHash`.

Tarama **özyinelemelidir**: sızıntı en çok iç içe ilişkilerde olur
(`product.variants[0].purchasePrice`). Ayrıca **değer** kontrolü de yapılır:
alış fiyatı `111.1111` olarak ekilir ve yanıtın hiçbir yerinde bulunmadığı
doğrulanır — alan adı değişse bile içerik sızmışsa yakalanır.

Yeni bir public uç eklendiğinde bu paketteki listeye de eklenmelidir. Liste
bilinçli olarak **elle** tutulur: otomatik rota keşfi hangi ucun gerçekten
public olduğunu bilemez ve yanlış bir varsayım testi sessizce boşa düşürürdü.

---

## 6. Loglarda PII ve finansal veri maskeleme

| Kontrol                                 | Durum | Kanıt                                                                                                                                                                                    |
| --------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Denetim kaydında hassas alan maskelenir | ✅    | `audit-logs.service.ts:13` — `REDACTED_FIELDS`: `password`, `passwordHash`, `newPassword`, `currentPassword`, `token`, `tokenHash`, `accessToken`, `refreshToken`, `replacedByTokenHash` |
| Maskeleme özyinelemeli                  | ✅    | `redact()` — dizi ve iç nesnelere iner                                                                                                                                                   |
| E-posta loglarda maskeli                | ✅    | `mail.service.ts` → `maskEmail()`: `a***t@ornek.com`                                                                                                                                     |
| Şifre denetim kaydına sızmıyor          | ✅    | `customer-auth.e2e-spec.ts` → "kayıt ve giriş denetim kaydına yazılır" testi ham şifreyi arar ve bulmaz                                                                                  |
| Ham şifre hiç loglanmıyor               | ✅    | `PasswordService` yalnız hash döner; DTO'daki `password` alanı denetim kaydına hiç geçmez                                                                                                |
| Prisma sorgu logu üretimde kısıtlı      | ✅    | `prisma.service.ts` — üretimde yalnız `error` seviyesi (`query` logu kapalı; açık olsa parametreler loglanırdı)                                                                          |

> ⚠️ **Bilinen boşluk:** finansal **tutarlar** (satış toplamı, kâr) uygulama
> loglarında maskelenmez. Bunlar `console`/stdout'a yalnız hata yığın izlerinde
> düşebilir ve `errorFormat: 'minimal'` ile üretimde daraltılmıştır. Yapılandırılmış
> log (pino) ve alan bazlı maskeleme → `docs/ROADMAP.md`.

---

## 7. `.env.example` güncelliği ve secret hijyeni

| Kontrol                                     | Durum | Kanıt                                                                                                                                            |
| ------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.env` gitignore'da                         | ✅    | `git check-ignore -v .env` → `.gitignore:16`                                                                                                     |
| İzlenen dosyalarda secret yok               | ✅    | `git ls-files \| grep -E '^\.env$\|\.pem$\|\.key$\|id_rsa'` → boş                                                                                |
| `.env.example` tüm değişkenleri içerir      | ✅    | Sprint 12'de `SEED_DEMO_DATA` dahil güncellendi; `env.validation.ts` ile karşılaştırıldı                                                         |
| Üretimde yer tutucu sır reddedilir          | ✅    | `env.validation.ts` — `INSECURE_SECRET_MARKERS`. Test: "yer tutucu sırrı reddeder"                                                               |
| Sırların birbirinden farklı olması zorunlu  | ✅    | access ≠ refresh ≠ customer. Testler: "access ve refresh sırrının aynı olmasını reddeder", "müşteri ve yönetici sırrının aynı olmasını reddeder" |
| Üretimde Swagger kapalı olmalı              | ✅    | `env.validation.ts` — açık bırakılırsa uygulama başlamaz                                                                                         |
| Üretimde varsayılan seed şifresi reddedilir | ✅    | `env.validation.ts` + test                                                                                                                       |

---

## 8. Bağımlılık taraması — `pnpm audit`

Denetim anında **6 zafiyet** (5 high, 1 moderate). Biri düzeltildi, dördü
gerekçesiyle kabul edildi.

### Düzeltilen

| Paket                       | Sorun                                    | Eylem                                                      |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `sharp` 0.34.5 → **0.35.3** | libvips CVE-2026-33327/33328/35590/35591 | Kök `package.json` içinde `pnpm.overrides` ile yükseltildi |

**Neden düzeltildi:** `sharp` bizim kodumuzda değil, **Next.js'in görsel
optimizatöründe** kullanılıyor. Ürün görselleri `next/image` üzerinden
sunulduğu için yüklenen bir dosya libvips'e ulaşır. Yükleme yönetici yetkisi
istese de, "kötü niyetli görsel → sunucuda kod çalıştırma" zinciri bir personel
hesabına bırakılamaz.

**Neden `override` gerekti:** Next `sharp@^0.34.3` istiyor ve 0.35'e henüz
geçmedi. Override sonrası **doğrulandı**: `next build` başarılı ve
`/_next/image?url=...&w=256` isteği 200 dönüp 256×256 görsel üretti (log temiz).

### Kabul edilenler

| Paket                    | Şiddet             | Nerede                            | Neden kabul edildi                                                                                                                                                                                                                                             |
| ------------------------ | ------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss` ≤8.5.17        | HIGH ×2 + MODERATE | `next` içinde gömülü              | **Derleme zamanı.** Uygulama kullanıcı CSS'i işlemiyor; `sourceMappingURL` saldırısı için saldırganın derleme girdisine erişmesi gerekir. Kendi `postcss` bağımlılığımız güncel; savunmasız kopya Next'in içinde ve Next sürümü yükseltilmeden değiştirilemez. |
| `js-yaml` 5.2.1          | HIGH               | `@nestjs/swagger`                 | Zafiyet **YAML ayrıştırmada**; Swagger yalnız YAML **üretir**, güvenilmeyen YAML okumaz. Üretimde Swagger zaten kapalı.                                                                                                                                        |
| `brace-expansion` ≤5.0.7 | HIGH               | `@nestjs/cli` → webpack eklentisi | **Yalnız devDependency.** Üretim imajında yok: `pnpm deploy --prod` ağacı geliştirme bağımlılıklarını içermez.                                                                                                                                                 |

**Yeniden değerlendirme koşulu:** Next.js bir üst sürüme çıkarıldığında
`postcss` zinciri; `@nestjs/swagger` güncellendiğinde `js-yaml`. `pnpm audit`
CI'da **bilgilendirme amaçlı** koşar ve derlemeyi kırmaz — kırsaydı, üçüncü
taraf bir paketin yeni bir advisory'si bizim yayınımızı bloke ederdi.

---

## 9. Kimlik ve yetki

Ayrıntılı karar tablosu `docs/ARCHITECTURE.md` §11.1'de. Sprint 12'de
doğrulanan noktalar:

| Kontrol                                 | Durum | Kanıt                                                                                                                                                                                            |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Şifreler Argon2id                       | ✅    | `password.service.ts` — m=19 MiB, t=2, p=1 (OWASP asgarisi)                                                                                                                                      |
| Refresh token hash'li saklanır          | ✅    | `token-hash.ts` — SHA-256; ham değer DB'de yok. Test: "veritabanında yalnız HASH saklanır"                                                                                                       |
| Refresh token rotasyonlu                | ✅    | Testler: `auth.e2e-spec.ts`, `customer-auth.e2e-spec.ts` → "rotasyon"                                                                                                                            |
| Yeniden kullanım tüm oturumları düşürür | ✅    | Test: "iptal edilmiş jetonun yeniden kullanımı TÜM oturumları düşürür"                                                                                                                           |
| İki kimlik alanı ayrı                   | ✅    | Ayrı sır + `aud` + tablo. Test grubu: "AUDIENCE AYRIMI"                                                                                                                                          |
| Enumeration koruması                    | ✅    | Kayıt jeton döndürmez; kayıt/`forgot-password` yanıtları adresin varlığından bağımsız. Testler: "MÜKERRER e-postada AYNI genel yanıtı verir", "bilinmeyen adres için de AYNI genel yanıtı verir" |
| Varlık sızdırmama                       | ✅    | Başkasının talebi/sepet kalemi → **404**. Test: "BAŞKASININ talep numarasına erişim 404 döner (403 DEĞİL)"                                                                                       |
| Sahiplik `WHERE` içinde                 | ✅    | `customer-inquiries.service.ts`, `cart.service.ts` — kayıt çekildikten sonra kontrol YOK                                                                                                         |
| Host header injection                   | ✅    | E-posta bağlantıları `PUBLIC_WEB_URL`den; `Host` başlığından değil                                                                                                                               |
| Open redirect                           | ✅    | `isSafePublicRedirect()` — `//`, mutlak URL ve `/admin` reddedilir                                                                                                                               |
| Yığın izi sızmıyor                      | ✅    | Test: "404 ve doğrulama hataları yığın izi veya SQL sızdırmaz"                                                                                                                                   |
| Değişmez tablolar                       | ✅    | `audit_logs` ve `stock_movements` — DB RULE ile UPDATE/DELETE engelli                                                                                                                            |

---

## 10. Karşılanmayan / devredilen maddeler

Dürüstlük gereği: aşağıdakiler bu sprintte **yapılmadı** ve yol haritasına
devredildi (`docs/ROADMAP.md`).

| Madde                                       | Neden şimdi değil                                                                                                               | Etki                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Refresh token `httpOnly` çerezde            | API çerez üretmiyor; mobil istemci de aynı sözleşmeyi kullanacak. Bugün `localStorage` (ARCHITECTURE §11.1'de ödünleşme yazılı) | XSS durumunda jeton okunabilir                   |
| Dağıtık hız sınırı (Redis)                  | Tek örnekli kurulum hedefleniyor                                                                                                | Yatay ölçeklemede sınır örnek sayısıyla çarpılır |
| Yapılandırılmış log + alan maskeleme (pino) | Nest'in varsayılan logger'ı yeterli görüldü                                                                                     | Finansal tutarlar hata izlerinde görünebilir     |
| Penetrasyon testi / DAST                    | Uzmanlık ve ortam gerektirir                                                                                                    | Bilinmeyen zafiyetler                            |
| Bağımlılık otomasyonu (Dependabot/Renovate) | Depo ayarı gerektirir                                                                                                           | Yeni advisory'ler elle fark edilir               |
| 2FA (yönetici)                              | MVP dışı                                                                                                                        | Şifre tek faktör                                 |

---

## Denetimi yeniden koşturmak

```bash
# Hassas alan sızıntısı
pnpm --filter @zirve/api exec jest --config ./test/jest-e2e.json test/sensitive-leak.e2e-spec.ts

# Kimlik ve yetki
pnpm --filter @zirve/api exec jest --config ./test/jest-e2e.json test/auth.e2e-spec.ts test/customer-auth.e2e-spec.ts

# Ortam sertleştirmesi
pnpm --filter @zirve/api exec jest src/config

# Bağımlılıklar
pnpm audit --audit-level moderate
```
