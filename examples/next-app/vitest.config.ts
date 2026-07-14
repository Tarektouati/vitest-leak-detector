import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-oxc'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['vitest-leak-detector/setup', './src/test-setup.ts'],
    reporters: ['default', 'vitest-leak-detector/reporter'],
    pool: 'forks',
  },
})
