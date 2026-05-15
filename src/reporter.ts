import type { Reporter } from 'vitest/reporters'
import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LeakRecord } from './types.js'

const RESET = '\x1b[0m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'

export default class LeakDetectorReporter implements Reporter {
  onTestRunEnd(): void {
    let leakFiles: string[]
    const tmp = tmpdir()
    try {
      leakFiles = readdirSync(tmp).filter((f) => /^vitest-leaks-\d+\.ndjson$/.test(f))
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
