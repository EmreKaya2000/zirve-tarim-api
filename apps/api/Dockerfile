# =============================================================================
# apps/api — NestJS çok aşamalı Docker imajı
# Build bağlamı DEPO KÖKÜDÜR:  docker build -f apps/api/Dockerfile .
#
# İmaj boyutu notu:
#   .npmrc'de `node-linker=hoisted` olduğu için kökteki node_modules TÜM
#   workspace'lerin bağımlılıklarını (Next.js, turbo, jest, eslint...) barındırır.
#   Bu dizini olduğu gibi kopyalamak ~1.6 GB'lık bir API imajı üretir.
#   Bu yüzden `pnpm deploy --prod` ile yalnızca apps/api'nin üretim
#   bağımlılıklarını içeren, kendi kendine yeten bir ağaç çıkarılır.
# =============================================================================

# -----------------------------------------------------------------------------
# 1) base — ortak temel
# -----------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Prisma engine'lerinin Alpine'da çalışması için gerekli.
RUN apk add --no-cache libc6-compat openssl
RUN corepack enable
WORKDIR /app

# -----------------------------------------------------------------------------
# 2) deps — tüm bağımlılıkları kur (kaynak değişse de bu katman önbellekte kalır)
# -----------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
# apps/api postinstall'ı `prisma generate` çalıştırdığı için şema burada gerekli.
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# 3) builder — derle ve üretim ağacını çıkar
# -----------------------------------------------------------------------------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/types/node_modules ./packages/types/node_modules
COPY . .

# @zirve/types önce derlenmeli: apps/api çalışma zamanında onun dist'ini require eder.
RUN pnpm --filter @zirve/types build
RUN pnpm --filter @zirve/api exec prisma generate
RUN pnpm --filter @zirve/api build

# Seed'i TEK BİR CJS DOSYASINA paketle.
#
# `package.json#prisma.seed` = `tsx prisma/seed.ts` ve `tsx` bir
# devDependency'dir: üretim imajında YOKTUR. Dolayısıyla konteyner içinde
# `prisma db seed` "spawn tsx ENOENT" ile düşer ve ilk yönetici hesabı
# oluşturulamaz — üretime çıkışı tamamen bloklayan bir durum.
#
# Bundle çıktısı `prisma/` içine yazılır (aşağıdaki `cp -r` onu üretim
# ağacına taşır). Konum ÖNEMLİ: seed, placeholder görselini
# `__dirname/seed-data/assets/` altında arar; dosya `prisma/` ile birlikte
# kopyalandığı için yol çalışma zamanında da doğrudur.
#
# `--packages=external`: @prisma/client ve @node-rs/argon2 (native binding)
# bundle EDİLMEZ, çalışma zamanında node_modules'ten çözülür. Göreli
# import'lar (`./seed-data/*`, `../src/common/utils/slug.util`) ise bundle'a
# girer; bu yüzden üretim ağacında `src/` bulunmamasına rağmen seed çalışır.
RUN pnpm --filter @zirve/api prisma:seed:build

# Yalnız üretim bağımlılıklarını içeren, taşınabilir bir ağaç üret.
# @zirve/types workspace bağımlılığı da dist'iyle birlikte içeri alınır.
RUN pnpm --filter @zirve/api deploy --prod /prod/api

# Derlenmiş çıktı ve Prisma varlıklarını üretim ağacına yerleştir.
RUN rm -rf /prod/api/dist /prod/api/prisma \
 && cp -r apps/api/dist    /prod/api/dist \
 && cp -r apps/api/prisma  /prod/api/prisma

# Üretimde gereksiz olan kaynak ve geliştirme dosyalarını at.
RUN rm -rf /prod/api/src \
           /prod/api/test \
           /prod/api/Dockerfile \
           /prod/api/eslint.config.mjs \
           /prod/api/tsconfig.json \
           /prod/api/tsconfig.build.json \
           /prod/api/nest-cli.json

# Prisma client'ı üretim node_modules'ü içinde üret.
RUN cd /prod/api && ./node_modules/.bin/prisma generate

# -----------------------------------------------------------------------------
# 4) runner — yalnız çalışma zamanı
# -----------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 --ingroup nodejs nestjs

WORKDIR /app/apps/api
COPY --from=builder --chown=nestjs:nodejs /prod/api ./

# Yükleme dizini İMAJDA oluşturulmalıdır.
#
# docker-compose bu yola adlandırılmış bir volume bağlar. Docker, boş bir
# volume'ü ilk bağlayışında imajdaki dizinin sahipliğini kopyalar; dizin
# imajda yoksa volume root'a ait olur ve nestjs kullanıcısı yazamaz —
# ilk görsel yüklemesi EACCES ile düşer.
RUN mkdir -p uploads && chown nestjs:nodejs uploads

USER nestjs

EXPOSE 4000

# Konteyner sağlık kontrolü; docker-compose `depends_on: service_healthy` bunu kullanır.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
