import { existsSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import LeakDetectorReporter from '../reporter.js'
import type { LeakRecord } from '../types.js'

function leakRecord(overrides: Partial<LeakRecord> = {}): string {
  const record: LeakRecord = {
    testName: 'some test',
    testFile: '/some/file.test.ts',
    type: 'TCPWRAP',
    stack: 'at somewhere',
    timestamp: Date.now(),
    ...overrides,
  }
  return JSON.stringify(record) + '\n'
}

const plantedFiles: string[] = []

function plant(name: string, content: string, mtime?: Date): string {
  const filePath = join(tmpdir(), name)
  writeFileSync(filePath, content)
  if (mtime) utimesSync(filePath, mtime, mtime)
  plantedFiles.push(filePath)
  return filePath
}

beforeEach(() => {
  // The report is printed via console.log; keep it out of the test output.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const filePath of plantedFiles) {
    if (existsSync(filePath)) unlinkSync(filePath)
  }
  plantedFiles.length = 0
})

describe('LeakDetectorReporter run isolation', () => {
  it('exports its run ID through the environment for fork workers', () => {
    const reporter = new LeakDetectorReporter()
    expect(process.env.VITEST_LEAK_RUN_ID).toBeTruthy()
    // A second reporter (another run) gets its own namespace.
    const first = process.env.VITEST_LEAK_RUN_ID
    new LeakDetectorReporter()
    expect(process.env.VITEST_LEAK_RUN_ID).not.toBe(first)
    void reporter
  })

  it('reads and deletes only files belonging to its own run', () => {
    const reporter = new LeakDetectorReporter()
    const runId = process.env.VITEST_LEAK_RUN_ID!
    const own = plant(`vitest-leaks-${runId}-1234.ndjson`, leakRecord({ testName: 'own leak' }))
    const foreign = plant(
      'vitest-leaks-11111111-2222-3333-4444-555555555555-99.ndjson',
      leakRecord({ testName: 'foreign leak' }),
    )
    const legacy = plant('vitest-leaks-424242.ndjson', leakRecord({ testName: 'ghost leak' }))

    reporter.onTestRunEnd()

    expect(existsSync(own)).toBe(false)
    expect(existsSync(foreign)).toBe(true)
    expect(existsSync(legacy)).toBe(true)

    const logged = vi.mocked(console.log).mock.calls.flat().join('\n')
    expect(logged).toContain('own leak')
    expect(logged).not.toContain('foreign leak')
    expect(logged).not.toContain('ghost leak')
  })

  it('sweeps files older than 24h at run start, regardless of run ID', () => {
    const reporter = new LeakDetectorReporter()
    const dayAndHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)
    const stale = plant('vitest-leaks-crashed-run-42.ndjson', leakRecord(), dayAndHourAgo)
    const fresh = plant(
      'vitest-leaks-66666666-7777-8888-9999-000000000000-77.ndjson',
      leakRecord(),
    )

    reporter.onTestRunStart()

    expect(existsSync(stale)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })
})
