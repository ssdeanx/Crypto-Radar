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
        'src/types.ts',
        'src/analysis/strategies.ts',
        'src/core/index.ts',
        'src/daemon.ts',
        'src/core/warm-daemon.ts',
        'src/index.ts',
        'src/shared-test-helpers.ts',
        'src/ml/**',
        'src/io/charts.ts',
        'src/io/advanced-charts.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 75,
        lines: 80,
      },
    },
  },
});
