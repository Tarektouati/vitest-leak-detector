import type { Reporter } from 'vitest/reporters'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LeakRecord } from './types.js'

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'

const STALE_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000

export default class LeakDetectorReporter implements Reporter {
  private readonly runId: string

  constructor() {
    // The reporter is instantiated in the main vitest process before workers
    // fork, so exporting the run ID through the environment lets each worker's
    // setup file namespace its NDJSON output to this run. Without it,
    // concurrent or crashed runs share the same tmpdir namespace and steal
    // each other's leak files (#26).
    this.runId = randomUUID()
    process.env.VITEST_LEAK_RUN_ID = this.runId
  }

  onTestRunStart(): void {
    // Garbage-collect files left behind by runs that never reached
    // onTestRunEnd (Ctrl+C, crash, OOM). Anything older than 24h cannot
    // belong to a live run.
    let files: string[]
    const tmp = tmpdir()
    try {
      files = readdirSync(tmp).filter((f) => /^vitest-leaks-.*\.ndjson$/.test(f))
    } catch {
      return
    }
    const now = Date.now()
    for (const file of files) {
      const filePath = join(tmp, file)
      try {
        if (now - statSync(filePath).mtimeMs > STALE_FILE_MAX_AGE_MS) unlinkSync(filePath)
      } catch {
        // a concurrent reporter may have deleted it first
      }
    }
  }

  onTestRunEnd(): void {
    let leakFiles: string[]
    const tmp = tmpdir()
    const prefix = `vitest-leaks-${this.runId}-`
    try {
      leakFiles = readdirSync(tmp).filter(
        (f) => f.startsWith(prefix) && f.endsWith('.ndjson'),
      )
    } catch {
      return
    }

    if (leakFiles.length === 0) return

    const allLeaks: LeakRecord[] = []

    for (const file of leakFiles) {
      const filePath = join(tmp, file)
      try {
        const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean)
        for (const line of lines) {
          try {
            allLeaks.push(JSON.parse(line) as LeakRecord)
          } catch {
            // skip malformed lines
          }
        }
        unlinkSync(filePath)
      } catch {
        // skip unreadable files
      }
    }

    if (allLeaks.length === 0) return

    const grouped = new Map<string, Map<string, LeakRecord[]>>()
    for (const leak of allLeaks) {
      if (!grouped.has(leak.testFile)) grouped.set(leak.testFile, new Map())
      const byTest = grouped.get(leak.testFile)!
      if (!byTest.has(leak.testName)) byTest.set(leak.testName, [])
      byTest.get(leak.testName)!.push(leak)
    }

    console.log(`\n${BOLD}${RED}Async Leak Report${RESET}`)
    console.log(`${DIM}${'─'.repeat(60)}${RESET}\n`)

    for (const [file, tests] of grouped) {
      console.log(`${BOLD}${file}${RESET}`)
      for (const [testName, leaks] of tests) {
        console.log(
          `  ${YELLOW}✖ ${testName}${RESET} (${leaks.length} leak${leaks.length > 1 ? 's' : ''})`,
        )
        for (const leak of leaks) {
          console.log(`    ${DIM}type: ${RESET}${leak.type}`)
          const stackLines = leak.stack.split('\n').slice(0, 3)
          for (const line of stackLines) {
            if (line.trim()) console.log(`    ${DIM}${line.trim()}${RESET}`)
          }
        }
      }
      console.log()
    }

    const total = allLeaks.length
    console.log(
      `${BOLD}${RED}${total} async leak${total > 1 ? 's' : ''} detected${RESET}\n`,
    )
  }
}
