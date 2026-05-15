import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-oxc'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts', 'vitest-leak-detector/setup'],
    reporters: ['default', 'vitest-leak-detector/reporter'],
    pool: 'forks',
  },
})
