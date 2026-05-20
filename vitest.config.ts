import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['**/*.spec.{ts,tsx}'],
    // Playwright specs live under e2e/ and import from @playwright/test;
    // they're run by `npm run e2e`, not vitest.
    exclude: ['node_modules', 'build', '.cache', 'e2e'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/**/*.spec.{ts,tsx}', 'app/entry.*.tsx', 'app/root.tsx'],
    },
  },
});
