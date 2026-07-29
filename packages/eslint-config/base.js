import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import turboPlugin from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

/**
 * Tüm paketlerde ortak olan temel ESLint yapılandırması.
 *
 * Master prompt "Değişmez Kurallar" maddelerinden ikisi burada makine tarafından
 * zorlanır:
 *   Kural 1 — `any` kullanma            -> @typescript-eslint/no-explicit-any: error
 *   Kural 2 — float ile para hesaplama  -> no-restricted-syntax (parseFloat/Number)
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      'turbo/no-undeclared-env-vars': 'warn',
    },
  },
  {
    rules: {
      // --- Kural 1: any yasak ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-function-type': 'error',

      // --- Kural 2: para hesabında float yasak ---
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message:
            'Para/miktar hesabında parseFloat kullanmayın. Prisma Decimal veya decimal.js kullanın (SPEC Kural 2).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message:
            'Para/miktar hesabında Number.parseFloat kullanmayın. Decimal kullanın (SPEC Kural 2).',
        },
        {
          object: 'Math',
          property: 'round',
          message:
            'Para yuvarlamasında Math.round kullanmayın. MoneyService/Decimal.toDecimalPlaces kullanın (SPEC Kural 2).',
        },
      ],

      // --- Genel kalite ---
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    // Yapılandırma dosyalarında konsol ve gevşek kurallar serbest.
    files: ['**/*.config.{js,mjs,cjs,ts}', '**/*.setup.{js,mjs,cjs,ts}'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/generated/**',
    ],
  },
];

export default baseConfig;
