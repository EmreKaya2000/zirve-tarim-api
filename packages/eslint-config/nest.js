import globals from 'globals';

import { baseConfig } from './base.js';

/**
 * NestJS (apps/api) için ESLint yapılandırması.
 *
 * NestJS dekoratör ağırlıklı çalıştığı için sınıf üyelerinde bazı
 * TypeScript-ESLint kuralları gevşetilir.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nestConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      /**
       * KRİTİK: NestJS'te kapalı olmak ZORUNDA.
       *
       * Bağımlılık enjeksiyonu `emitDecoratorMetadata` ile üretilen
       * `design:paramtypes` bilgisine dayanır ve bu, constructor parametre
       * tipinin ÇALIŞMA ZAMANINDA var olmasını gerektirir. Bu kural açıkken
       * `--fix`, `import { PrismaService }` ifadesini `import type` yapar;
       * kod derlenir ama uygulama açılışta "Nest can't resolve dependencies"
       * hatasıyla çöker. Sessiz ve pahalı bir hata sınıfıdır.
       */
      '@typescript-eslint/consistent-type-imports': 'off',

      // Dekoratörlü sınıf metotlarında dönüş tipi çıkarımı yeterli.
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      // DI için boş constructor yaygın bir kalıp.
      '@typescript-eslint/no-empty-function': ['error', { allow: ['constructors'] }],
      // Interface yerine type kullanımı serbest.
      '@typescript-eslint/consistent-type-definitions': 'off',
      // Prisma Decimal ve dekoratör metadata'sı ile çakışmaması için.
      '@typescript-eslint/no-inferrable-types': 'off',
    },
  },
  {
    // Prisma seed betiği ve migration yardımcıları konsola yazabilir.
    files: ['prisma/**/*.ts', 'src/main.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
];

export default nestConfig;
