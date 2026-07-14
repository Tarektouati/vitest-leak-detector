// Regression test for issue #24: the detector's own async afterEach used to
// create its implicit promise while trackingEnabled was still true, producing
// a phantom PROMISE leak on every test when trackPromises is on. In-repo runs
// mask this via the path filters in filterStack ('vitest-leak-detector/src/setup'
// etc.), so the setup is vendored to a neutral path — where those filters
// cannot match — and run in a child Vitest process.
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Inside the repo so the child config can resolve 'vitest/config' from the
// repo's node_modules, but under a directory name the path filters never match.
let vendorDir: string
let leakTmpDir: string

beforeAll(() => {
  vendorDir = mkdtempSync(join(ROOT, '.e2e-vendored-'))
  // Redirected tmpdir for the child (setup.ts writes its NDJSON leak file to
  // os.tmpdir()), so this test can assert on the child's leak output without
  // knowing the child worker's pid.
  leakTmpDir = join(vendorDir, 'leak-tmp')
  mkdirSync(leakTmpDir)

  // setup.ts imports './types.js' and './utils.js', so keep the file names.
  for (const file of ['setup.ts', 'types.ts', 'utils.ts']) {
    copyFileSync(join(ROOT, 'src', file), join(vendorDir, file))
  }

  writeFileSync(
    join(vendorDir, 'entry.ts'),
    `import { configureLeakDetector } from './setup.js'\n` +
      `configureLeakDetector({ trackPromises: true })\n`,
  )

  writeFileSync(
    join(vendorDir, 'clean.test.ts'),
    `import { it, expect } from 'vitest'\n` +
      `it('clean test, zero real leaks', () => {\n` +
      `  expect(1 + 1).toBe(2)\n` +
      `})\n`,
  )

  writeFileSync(
    join(vendorDir, 'vitest.config.ts'),
    `import { defineConfig } from 'vitest/config'\n` +
      `export default defineConfig({\n` +
      `  test: {\n` +
      `    pool: 'forks',\n` +
      `    include: ['*.test.ts'],\n` +
      `    setupFiles: ['./entry.ts'],\n` +
      `  },\n` +
      `})\n`,
  )
})

afterAll(() => {
  rmSync(vendorDir, { recursive: true, force: true })
})

describe('vendored setup (neutral path, trackPromises: true)', () => {
  it('reports no phantom PROMISE leak for a clean test', () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--root', vendorDir],
      {
        cwd: vendorDir,
        encoding: 'utf-8',
        timeout: 60_000,
        // TMPDIR (POSIX) / TMP+TEMP (Windows) steer the child's os.tmpdir().
        env: { ...process.env, TMPDIR: leakTmpDir, TMP: leakTmpDir, TEMP: leakTmpDir },
      },
    )

    expect(result.status).toBe(0)
    // Vitest swallows the inline console.warn from the detector's afterEach,
    // so the NDJSON leak file is the reliable signal: a phantom PROMISE leak
    // would have been appended there by the child's setup.
    const leakFiles = readdirSync(leakTmpDir).filter((name) => name.startsWith('vitest-leaks-'))
    expect(leakFiles).toEqual([])
  }, 90_000)
})
