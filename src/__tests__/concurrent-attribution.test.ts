// Reproduces issue #25: under it.concurrent, interleaved tests used to
// overwrite the module-level test identity, so ALPHA's leak was attributed to
// BETA (whichever test's beforeEach ran last). Attribution must come from the
// async execution context of the test body instead.
import '../setup.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { describe, it, expect, afterAll } from 'vitest'
import { configureLeakDetector, LEAK_FILE } from '../setup.js'
import type { LeakRecord } from '../types.js'

// Suppress inline warnings so intentional leaks don't pollute test output.
configureLeakDetector({ warnInline: false })

const ALPHA = 'test ALPHA leaks an interval'
const BETA = 'test BETA is totally clean'

let leakedInterval: NodeJS.Timeout

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

afterAll(() => {
  // Clear the intentionally leaked interval so the process can exit.
  clearInterval(leakedInterval)
  // Remove the file so the reporter doesn't surface these intentional leaks.
  if (existsSync(LEAK_FILE)) unlinkSync(LEAK_FILE)
})

describe('concurrent attribution (issue #25)', () => {
  it.concurrent(ALPHA, async () => {
    // The await lets BETA's beforeEach run first, so the module-level
    // fallback identity points at BETA when the interval is created — the
    // exact interleaving that used to misattribute the leak.
    await sleep(50)
    // Ref'd interval: unref'd handles are filtered out by the hasRef()
    // liveness check. Cleared in afterAll.
    leakedInterval = setInterval(() => {}, 60_000)
    await sleep(50)
  })

  it.concurrent(BETA, async () => {
    await sleep(120)
  })
})

describe('verification (runs after the concurrent block completes)', () => {
  it('attributes the interval to ALPHA, not BETA', () => {
    expect(existsSync(LEAK_FILE)).toBe(true)

    const records = readFileSync(LEAK_FILE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LeakRecord)

    const alphaRecords = records.filter((record) => record.testName === ALPHA)
    expect(alphaRecords.length).toBe(1)
    expect(alphaRecords[0].type).toBe('Timeout')

    // No record may carry BETA's name: this also proves BETA's earlier drain
    // neither reported nor wiped ALPHA's still-pending entry.
    expect(records.filter((record) => record.testName === BETA)).toEqual([])
  })
})
