// Imports setup.ts to register the async_hooks hook and beforeEach/afterEach handlers.
// Tests run sequentially within the file; test order is intentional.
import '../setup.js'
import { existsSync, readFileSync, unlinkSync, writeFileSync, watch, watchFile, unwatchFile, type FSWatcher } from 'node:fs'
import { open, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
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

// fs.watchFile dedupes StatWatchers per path, so each test watches its own file.
const watchedFile = join(tmpdir(), `fs-resources-watch-${process.pid}.txt`)
const statFile = join(tmpdir(), `fs-resources-stat-${process.pid}.txt`)
const handleFile = join(tmpdir(), `fs-resources-handle-${process.pid}.txt`)
writeFileSync(watchedFile, 'watched')
writeFileSync(statFile, 'stat-watched')
writeFileSync(handleFile, 'opened')

let leakedWatcher: FSWatcher | undefined
let leakedHandle: FileHandle | undefined

afterAll(async () => {
  // Clean up the intentional leaks so the process can exit.
  leakedWatcher?.close()
  unwatchFile(statFile)
  await leakedHandle?.close()
  for (const file of [watchedFile, statFile, handleFile]) unlinkSync(file)
  // Remove the file so the reporter doesn't surface these intentional leaks.
  if (existsSync(LEAK_FILE)) unlinkSync(LEAK_FILE)
})

describe('fs resources (sequential — order matters)', () => {
  it('step 1: leaks an fs.watch() watcher', () => {
    leakedWatcher = watch(watchedFile, () => {})
  })

  it('step 2: leaked fs.watch() is reported as FSEVENTWRAP', () => {
    const records = recordsFor('step 1: leaks an fs.watch() watcher')
    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('FSEVENTWRAP')
  })

  it('step 3: creates an fs.watch() watcher closed in-test', () => {
    const watcher = watch(watchedFile, () => {})
    watcher.close()
  })

  it('step 4: closed fs.watch() is not reported (destroy drain)', () => {
    expect(recordsFor('step 3: creates an fs.watch() watcher closed in-test')).toEqual([])
  })

  it('step 5: leaks an fs.watchFile() watcher', () => {
    watchFile(statFile, () => {})
  })

  it('step 6: leaked fs.watchFile() is reported as STATWATCHER', () => {
    const records = recordsFor('step 5: leaks an fs.watchFile() watcher')
    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('STATWATCHER')
  })

  it('step 7: leaks a promise-based FileHandle', async () => {
    leakedHandle = await open(handleFile, 'r')
  })

  it('step 8: leaked FileHandle is reported despite having no user stack frame', () => {
    const records = recordsFor('step 7: leaks a promise-based FileHandle')
    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('FILEHANDLE')
  })

  it('step 9: opens and closes a FileHandle in-test', async () => {
    const handle = await open(handleFile, 'r')
    await handle.close()
  })

  it('step 10: closed FileHandle is not reported (fd re-check, destroy never fires)', () => {
    expect(recordsFor('step 9: opens and closes a FileHandle in-test')).toEqual([])
  })
})
