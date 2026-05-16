import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'forks',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.test.ts'],
      reportsDirectory: './coverage',
    },
  },
})
