/**
 * Test cases adapted from Jest (jestjs/jest):
 * packages/jest-core/src/__tests__/collectHandles.test.js and the
 * e2e "recently-closed" detect-open-handles fixture.
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Licensed under the MIT license.
 */
// Imports setup.ts to register the async_hooks hook and beforeEach/afterEach handlers.
// Tests run sequentially within the file; test order is intentional.
import '../setup.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterEach, afterAll } from 'vitest'
import { configureLeakDetector } from '../setup.js'
import type { LeakRecord } from '../types.js'

// Suppress inline warnings so intentional leaks don't pollute test output.
configureLeakDetector({ warnInline: false })

const LEAK_FILE = join(tmpdir(), `vitest-leaks-${process.pid}.ndjson`)

function recordsFor(testName: string): LeakRecord[] {
  if (!existsSync(LEAK_FILE)) return []
  return readFileSync(LEAK_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LeakRecord)
    .filter((record) => record.testName === testName)
}

let pendingTimer: NodeJS.Timeout | undefined
let unrefdTimer: NodeJS.Timeout | undefined

// Registered after setup.ts's afterEach, so under Vitest's default reversed
// ('stack') hook order it runs *before* the detector reports — mimicking
// Testing Library's cleanup() clearing timers during teardown.
afterEach(() => {
  if (pendingTimer !== undefined) {
    clearTimeout(pendingTimer)
    pendingTimer = undefined
  }
})

afterAll(() => {
  clearTimeout(unrefdTimer)
  // Remove the file so the reporter doesn't surface these intentional leaks.
  if (existsSync(LEAK_FILE)) unlinkSync(LEAK_FILE)
})

describe('queued destroys (sequential — order matters)', () => {
  it('step 1: creates a timer cleared by a later-registered afterEach', () => {
    pendingTimer = setTimeout(() => {}, 5000)
  })

  it('step 2: timer cleared during teardown is not reported', () => {
    expect(recordsFor('step 1: creates a timer cleared by a later-registered afterEach')).toEqual([])
  })

  it('step 3: creates a timer cleared via a queued microtask at test end', () => {
    const timer = setTimeout(() => {}, 5000)
    queueMicrotask(() => clearTimeout(timer))
  })

  it('step 4: microtask-cleared timer is not reported', () => {
    expect(recordsFor('step 3: creates a timer cleared via a queued microtask at test end')).toEqual([])
  })

  it('step 5: creates a genuine leak (dangling timer-backed promise)', () => {
    // Never awaited or cleared: the 100ms timer outlives the ~30ms destroy
    // drain, so it must still be reported (guards against over-filtering).
    void new Promise((resolve) => setTimeout(resolve, 100))
  })

  it('step 6: genuine leak is still reported', () => {
    const records = recordsFor('step 5: creates a genuine leak (dangling timer-backed promise)')
    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('Timeout')
  })

  it("step 7: creates an unref'd timer", () => {
    unrefdTimer = setTimeout(() => {}, 10_000)
    unrefdTimer.unref()
  })

  it("step 8: unref'd timer is not reported (hasRef check)", () => {
    expect(recordsFor("step 7: creates an unref'd timer")).toEqual([])
  })
})
