// vitest.config.ts
// -----------------------------------------------------------------------------
// VITEST CONFIGURATION
//
// The test runner config. Two important choices here:
//   1. `environment: 'happy-dom'` gives us a lightweight DOM
//      implementation. The rewriter uses `new URL(s, document.baseURI)`
//      so we need `document` to exist in the test runtime.
//   2. `alias '@'` mirrors WXT's path alias so test files can import
//      from `@/utils/...` exactly the way runtime code does.
// -----------------------------------------------------------------------------

import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
