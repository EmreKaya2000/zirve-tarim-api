import globals from 'globals';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';

import { baseConfig } from './base.js';

/**
 * Next.js App Router (apps/web) için ESLint yapılandırması.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const nextConfig = [
  ...baseConfig,
  {
    ...pluginReact.configs.flat.recommended,
    languageOptions: {
      ...pluginReact.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.node,
      },
    },
  },
  {
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
      // Next.js JSX dönüşümü React'i otomatik içeri alır.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Server Component'lerde async fonksiyonlar normaldir.
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
];

export default nextConfig;
