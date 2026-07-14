// Imports setup.ts to register the async_hooks hook and beforeEach/afterEach handlers.
// Tests run sequentially within the file; test order is intentional.
import '../setup.js'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { describe, it, expect, afterAll } from 'vitest'
import { configureLeakDetector, LEAK_FILE } from '../setup.js'
import type { LeakRecord } from '../types.js'

// Suppress inline warnings so intentional leaks don't pollute test output.
configureLeakDetector({ warnInline: false })

let leakedTimer: NodeJS.Timeout

afterAll(() => {
  // Clear the intentionally leaked timer so the process can exit.
  clearTimeout(leakedTimer)
  // Remove the file so the reporter doesn't surface these intentional leaks.
  if (existsSync(LEAK_FILE)) unlinkSync(LEAK_FILE)
})

describe('hook wiring (sequential — order matters)', () => {
  it('step 1: creates a leaked setTimeout', () => {
    // The timer must stay ref'd: unref'd handles are filtered out at report
    // time by the hasRef() liveness check. It is cleared in afterAll.
    leakedTimer = setTimeout(() => {}, 60_000)
    // afterEach registered by setup.ts fires after this, writes the NDJSON record.
  })

  it('step 2: NDJSON record was written by previous test', () => {
    expect(existsSync(LEAK_FILE)).toBe(true)

    const lines = readFileSync(LEAK_FILE, 'utf-8').split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)

    const record = JSON.parse(lines[0]) as LeakRecord
    expect(record.type).toBe('Timeout')
    expect(record.testName).toBe('step 1: creates a leaked setTimeout')
    // Node.js cuts the V8 stack at async boundaries: since Vitest wraps test
    // functions in a Promise, the test-file frame is not captured inside
    // async_hooks init. The stack may be empty or show only internal frames.
    expect(typeof record.stack).toBe('string')
    expect(typeof record.timestamp).toBe('number')
  })
})
