import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/core/index.ts',
        'src/index.ts',
        'src/shared-test-helpers.ts',
        'src/ml/**',
        'src/io/charts.ts',
        'src/io/advanced-charts.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        statements: 65,
        branches: 55,
        functions: 65,
        lines: 65,
      },
    },
  },
});
