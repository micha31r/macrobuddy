import { defineConfig } from 'vitest/config';

// Unit tests run in plain Node and must NOT load the app's vite.config.ts —
// that pulls in the cloudflare() plugin (a Worker runtime/environment) which is
// irrelevant to these tests and incompatible with vitest's environment setup.
// A standalone vitest config takes precedence over vite.config.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
