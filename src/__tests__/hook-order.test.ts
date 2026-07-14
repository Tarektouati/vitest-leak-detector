// Regression test for #23: the leak report must run after ALL user afterEach
// hooks, regardless of registration order. The helper is imported BEFORE
// setup.ts, so its cleanup afterEach registers first and — under Vitest's
// default 'stack' hook order — runs after every hook setup.ts registers,
// mimicking a user setup file listed before the detector in setupFiles.
// Reporting via onTestFinished (which always runs after afterEach hooks)
// keeps the timer cleared below from being flagged.
import { deferCleanup } from './helpers/early-cleanup.js'
import '../setup.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { describe, it, expect, afterAll } from 'vitest'
import { configureLeakDetector, LEAK_FILE } from '../setup.js'
import type { LeakRecord } from '../types.js'

// Suppress inline warnings so intentional leaks don't pollute test output.
configureLeakDetector({ warnInline: false })

function recordsFor(testName: string): LeakRecord[] {
  if (!existsSync(LEAK_FILE)) return []
  return readFileSync(LEAK_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LeakRecord)
    .filter((record) => record.testName === testName)
}

afterAll(() => {
  // Remove the file so the reporter doesn't surface records from other steps.
  if (existsSync(LEAK_FILE)) unlinkSync(LEAK_FILE)
})

describe('setup-file order independence (sequential — order matters)', () => {
  it('step 1: creates a timer cleared by an earlier-registered afterEach', () => {
    deferCleanup(setTimeout(() => {}, 60_000))
  })

  it('step 2: timer cleared by the later-running cleanup is not reported', () => {
    expect(recordsFor('step 1: creates a timer cleared by an earlier-registered afterEach')).toEqual(
      [],
    )
  })
})
