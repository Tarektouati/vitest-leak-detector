// Imports setup.ts to register the undici diagnostics_channel subscribers and
// beforeEach/afterEach handlers. Tests run sequentially within the file; test
// order is intentional.
import '../setup.js'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { configureLeakDetector, LEAK_FILE } from '../setup.js'
import type { LeakRecord } from '../types.js'

// Suppress inline warnings so intentional leaks don't pollute test output.
configureLeakDetector({ warnInline: false })

let server: ReturnType<typeof createServer>
let baseUrl: string
const leakedFetchController = new AbortController()

function readRecords(): LeakRecord[] {
  if (!existsSync(LEAK_FILE)) return []
  return readFileSync(LEAK_FILE, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LeakRecord)
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url === '/hang') return // never responds — client requests hang
        res.end('ok')
      })
      server.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)

afterAll(() => {
  // Settle the intentionally leaked fetch so the process can exit.
  leakedFetchController.abort()
  server.closeAllConnections?.()
  server.close()
  // Remove the file so the reporter doesn't surface these intentional leaks.
  if (existsSync(LEAK_FILE)) unlinkSync(LEAK_FILE)
})

describe('fetch tracking (sequential — order matters)', () => {
  it('step 1: a completed fetch is not reported', async () => {
    const res = await fetch(`${baseUrl}/`)
    await res.text()
  })

  it('step 2: no NDJSON record was written for the completed fetch', () => {
    expect(readRecords().filter((r) => r.type === 'FETCH')).toHaveLength(0)
  })

  it('step 3: creates a leaked pending fetch', () => {
    // Never awaited and never aborted during the test — the request hangs on
    // the /hang route and is still in flight when afterEach reports.
    fetch(`${baseUrl}/hang`, { signal: leakedFetchController.signal }).catch(() => {})
  })

  it('step 4: NDJSON record was written for the pending fetch', () => {
    const records = readRecords().filter((r) => r.type === 'FETCH')
    expect(records).toHaveLength(1)

    const record = records[0]
    expect(record.testName).toBe('step 3: creates a leaked pending fetch')
    // undici publishes undici:request:create synchronously from the fetch()
    // call, so unlike async_hooks resources the test-file frame is captured.
    expect(record.stack).toContain('fetch-leaks.test.ts')
    expect(typeof record.timestamp).toBe('number')
  })

  it('step 5: an aborted fetch is not reported', async () => {
    const controller = new AbortController()
    const pending = fetch(`${baseUrl}/hang`, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow()
  })

  it('step 6: no new NDJSON record was written for the aborted fetch', () => {
    expect(readRecords().filter((r) => r.type === 'FETCH')).toHaveLength(1)
  })
})
