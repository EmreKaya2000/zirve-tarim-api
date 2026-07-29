import { nestConfig } from '@zirve/eslint-config/nest';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nestConfig,
  {
    // `prisma/seed.js`: `prisma:seed:build` çıktısıdır (üretim imajı kullanır).
    // Türetilmiş, paketlenmiş kod; kaynağı `prisma/seed.ts` zaten lint edilir.
    ignores: ['dist/**', 'coverage/**', 'prisma/migrations/**', 'prisma/seed.js'],
  },
];
