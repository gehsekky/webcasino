import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['**/*.spec.{ts,tsx}'],
    exclude: ['node_modules', 'build', '.cache'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['app/**/*.{ts,tsx}'],
      exclude: ['app/**/*.spec.{ts,tsx}', 'app/entry.*.tsx', 'app/root.tsx'],
    },
  },
});
