import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    setup: 'src/setup.ts',
    reporter: 'src/reporter.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: [/^vitest/, /^@vitest\//],
  target: 'node24',
  sourcemap: false,
})
