#!/usr/bin/env bash
#
# =============================================================================
# ZirveTarım — SIFIRDAN KURULUM
# =============================================================================
#
# Yeni bir bilgisayarda projeyi ayağa kaldırır: kardeş depoları klonlar, .env
# dosyasını hazırlar, üç servisi konteyner olarak derleyip başlatır ve
# veritabanını doldurur.
#
# KULLANIM
#   git clone <api-deposu> && cd zirve-tarim-api
#   ./scripts/kurulum.sh
#
# TEKRAR ÇALIŞTIRILABİLİR. Var olan hiçbir şeyi ezmez:
#   - `.env` varsa dokunulmaz (içindeki sırlar korunur)
#   - Klonlu depolar varsa `git pull` YAPILMAZ (yerel değişikliğiniz durur)
#   - Seed idempotenttir (upsert; yönetici varsa şifresi değişmez)
#
# NEDEN pnpm/Node GEREKTİRMEZ: her şey konteyner içinde derlenir. Yalnız
# arayüz geliştirmek isterseniz Node ve pnpm gerekir; betik sonunda anlatılıyor.

set -euo pipefail

readonly API_REPO_URL='https://github.com/EmreKaya2000/zirve-tarim-api.git'
readonly FRONT_REPO_URL='https://github.com/EmreKaya2000/zirve-tarim-front.git'
readonly ADMIN_REPO_URL='https://github.com/EmreKaya2000/zirve-tarim-admin.git'

readonly API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PARENT_DIR="$(dirname "$API_DIR")"

# Kaç saniye sağlık beklensin. İlk çalıştırmada imajlar sıfırdan derlenir.
readonly HEALTH_TIMEOUT_SECONDS=180

if [[ -t 1 ]]; then
  readonly C_RESET=$'\033[0m' C_BOLD=$'\033[1m' C_RED=$'\033[31m'
  readonly C_GREEN=$'\033[32m' C_YELLOW=$'\033[33m' C_BLUE=$'\033[34m'
else
  readonly C_RESET='' C_BOLD='' C_RED='' C_GREEN='' C_YELLOW='' C_BLUE=''
fi

adim() { printf '\n%s==> %s%s\n' "$C_BOLD$C_BLUE" "$*" "$C_RESET"; }
bilgi() { printf '    %s\n' "$*"; }
tamam() { printf '    %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
uyari() { printf '    %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
hata() {
  printf '\n%sHATA:%s %s\n\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 1. Ön koşullar
# ---------------------------------------------------------------------------
adim '1/6  Ön koşullar denetleniyor'

command -v git >/dev/null 2>&1 || hata 'git bulunamadı. Kurun: https://git-scm.com/downloads'
command -v docker >/dev/null 2>&1 || hata 'docker bulunamadı. Kurun: https://docs.docker.com/get-docker/'

# `docker compose` (v2, boşluklu) gerekir; eski `docker-compose` desteklenmez.
docker compose version >/dev/null 2>&1 ||
  hata 'docker compose (v2) bulunamadı. Docker Desktop güncelleyin.'

docker info >/dev/null 2>&1 ||
  hata 'Docker çalışmıyor. Docker Desktop uygulamasını açıp tekrar deneyin.'

tamam "git $(git --version | awk '{print $3}')"
tamam "docker $(docker --version | awk '{print $3}' | tr -d ',')"

# Portlar: çakışma erken yakalanmalı. Servis "sağlıksız" görünüp saatlerce
# aranan bir hatanın en sık sebebi başka bir uygulamanın portu tutmasıdır.
port_dolu() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN
  else
    return 1 # denetleyemiyoruz; engel çıkarma
  fi
}

# Yığın zaten ayaktaysa portlar bizimdir; o durumda uyarı gürültüdür.
yigin_ayakta=false
if docker compose -f "$API_DIR/docker-compose.yml" -f "$API_DIR/docker-compose.stack.yml" \
  ps --status running --quiet 2>/dev/null | grep -q .; then
  yigin_ayakta=true
fi

if [[ "$yigin_ayakta" == false ]]; then
  dolu_portlar=()
  for port in 3000 3001 4000 5432 8025; do
    port_dolu "$port" && dolu_portlar+=("$port")
  done

  if ((${#dolu_portlar[@]} > 0)); then
    uyari "Şu portlar başka bir uygulamada: ${dolu_portlar[*]}"
    bilgi 'Servisler bu portlara bağlanamaz. Kullanan uygulamayı kapatın'
    bilgi 'ya da eski bir ZirveTarım yığınını durdurun:'
    bilgi '  docker compose -f docker-compose.yml -f docker-compose.stack.yml down'
    hata 'Port çakışması. Yukarıdakini çözüp tekrar çalıştırın.'
  fi
  tamam 'Gerekli portlar boş (3000, 3001, 4000, 5432, 8025)'
else
  tamam 'Yığın zaten ayakta; port denetimi atlandı'
fi

# ---------------------------------------------------------------------------
# 2. Kardeş depolar
# ---------------------------------------------------------------------------
adim '2/6  Kardeş depolar hazırlanıyor'

bilgi "Çalışma dizini: $PARENT_DIR"

# Depolar PRIVATE. `gh` kuruluysa kimlik doğrulaması hazırdır; yoksa git
# kendi kimlik yöneticisini kullanır (ilk klonda kullanıcı adı/parola sorar).
klonla() {
  local ad="$1" url="$2" hedef="$PARENT_DIR/$1"

  if [[ -d "$hedef/.git" ]]; then
    tamam "$ad zaten klonlu (güncellenmedi)"
    return
  fi

  if [[ -e "$hedef" ]]; then
    hata "$hedef var ama git deposu değil. Taşıyın ya da silin."
  fi

  bilgi "$ad klonlanıyor..."
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    gh repo clone "EmreKaya2000/$ad" "$hedef" >/dev/null ||
      hata "$ad klonlanamadı. Depoya erişiminiz var mı?"
  else
    git clone --quiet "$url" "$hedef" ||
      hata "$ad klonlanamadı. Depo private; kimlik bilgisi gerekir.
       En kolay yol: gh CLI kurup 'gh auth login' çalıştırın."
  fi
  tamam "$ad klonlandı"
}

klonla 'zirve-tarim-front' "$FRONT_REPO_URL"
klonla 'zirve-tarim-admin' "$ADMIN_REPO_URL"

# ---------------------------------------------------------------------------
# 3. Ortam dosyası
# ---------------------------------------------------------------------------
adim '3/6  .env hazırlanıyor'

if [[ -f "$API_DIR/.env" ]]; then
  tamam '.env zaten var (dokunulmadı)'
else
  cp "$API_DIR/.env.example" "$API_DIR/.env"
  tamam '.env dosyası .env.example üzerinden oluşturuldu'
  uyari 'İçindeki sırlar GELİŞTİRME içindir. Üretimde mutlaka değiştirin.'
fi

# ---------------------------------------------------------------------------
# 4. Konteynerler
# ---------------------------------------------------------------------------
adim '4/6  Servisler derleniyor ve başlatılıyor'
bilgi 'İlk çalıştırmada imajlar sıfırdan derlenir; birkaç dakika sürebilir.'

compose() {
  docker compose \
    -f "$API_DIR/docker-compose.yml" \
    -f "$API_DIR/docker-compose.stack.yml" \
    --project-directory "$API_DIR" "$@"
}

compose up -d --build || hata 'Servisler başlatılamadı. Yukarıdaki derleme çıktısına bakın.'
tamam 'postgres, mailpit, api, front, admin ayakta'

# ---------------------------------------------------------------------------
# 5. Sağlık
# ---------------------------------------------------------------------------
adim '5/6  API sağlığı bekleniyor'

api_hazir=false
for ((i = 0; i < HEALTH_TIMEOUT_SECONDS / 3; i++)); do
  if curl -fsS http://localhost:4000/health >/dev/null 2>&1; then
    api_hazir=true
    break
  fi
  sleep 3
done

if [[ "$api_hazir" == false ]]; then
  bilgi 'Son API logları:'
  compose logs --tail 30 api || true
  hata "API $HEALTH_TIMEOUT_SECONDS saniyede yanıt vermedi. Yukarıdaki loglara bakın."
fi

tamam 'API yanıt veriyor (migration’lar açılışta uygulandı)'

# ---------------------------------------------------------------------------
# 6. Seed
# ---------------------------------------------------------------------------
adim '6/6  Veritabanı dolduruluyor'

# Idempotent: upsert kullanır, var olan yöneticinin şifresini DEĞİŞTİRMEZ.
compose exec -T api node prisma/seed.js ||
  hata 'Seed başarısız. Loglar: docker compose logs api'

tamam 'Seed tamamlandı'

# ---------------------------------------------------------------------------
# Özet
# ---------------------------------------------------------------------------
cat <<TABLO

${C_BOLD}${C_GREEN}Kurulum tamamlandı.${C_RESET}

  ${C_BOLD}Vitrin${C_RESET}       http://localhost:3000
  ${C_BOLD}Panel${C_RESET}        http://localhost:3001
  ${C_BOLD}API${C_RESET}          http://localhost:4000/api/v1
  ${C_BOLD}Swagger${C_RESET}      http://localhost:4000/docs
  ${C_BOLD}Mailpit${C_RESET}      http://localhost:8025
  ${C_BOLD}PostgreSQL${C_RESET}   localhost:5432

  ${C_BOLD}Panel girişi${C_RESET}  admin@zirvetarim.local / ZirveTarim2026

${C_BOLD}Sık kullanılan komutlar${C_RESET} (bu depodan):

  docker compose -f docker-compose.yml -f docker-compose.stack.yml logs -f
  docker compose -f docker-compose.yml -f docker-compose.stack.yml down
  ./scripts/kurulum.sh          # tekrar çalıştırılabilir

${C_BOLD}Arayüz geliştirecekseniz${C_RESET} yığındaki imajlar üretim derlemesidir,
kaynağı bağlamaz. Node 22 + pnpm kurup:

  docker compose up -d                       # yalnız postgres + api + mailpit
  cd ../zirve-tarim-front && pnpm install && pnpm sync:types && pnpm dev
  cd ../zirve-tarim-admin && pnpm install && pnpm sync:types && pnpm dev

TABLO
