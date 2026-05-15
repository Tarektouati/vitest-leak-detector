import { createHook } from 'node:async_hooks'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach } from 'vitest'
import type { LeakDetectorOptions, LeakRecord } from './types.js'
import { shouldTrack, filterStack } from './utils.js'

const LEAK_FILE = join(tmpdir(), `vitest-leaks-${process.pid}.ndjson`)

let opts: Required<LeakDetectorOptions> = {
  trackPromises: false,
  trackTimers: true,
  trackNetwork: true,
  stackDepth: 6,
  warnInline: true,
  ignoreTypes: [],
}

export function configureLeakDetector(overrides: LeakDetectorOptions): void {
  opts = { ...opts, ...overrides }
}

interface ResourceInfo {
  type: string
  stack: string
  testName: string
  testFile: string
}

let trackingEnabled = false
let currentTestName = ''
let currentTestFile = ''
const activeResources = new Map<number, ResourceInfo>()

const hook = createHook({
  init(asyncId, type) {
    if (!trackingEnabled || !shouldTrack(type, opts)) return
    const stack = filterStack(new Error().stack ?? '', opts.stackDepth)
    activeResources.set(asyncId, {
      type,
      stack,
      testName: currentTestName,
      testFile: currentTestFile,
    })
  },
  destroy(asyncId) {
    activeResources.delete(asyncId)
  },
  promiseResolve(asyncId) {
    activeResources.delete(asyncId)
  },
})

hook.enable()

beforeEach(({ task }) => {
  currentTestName = task.name
  currentTestFile = task.file?.filepath ?? ''
  trackingEnabled = true
})

afterEach(() => {
  trackingEnabled = false

  if (activeResources.size === 0) return

  const timestamp = Date.now()

  for (const [, resource] of activeResources) {
    const record: LeakRecord = {
      testName: resource.testName,
      testFile: resource.testFile,
      type: resource.type,
      stack: resource.stack,
      timestamp,
    }

    if (opts.warnInline) {
      console.warn(`[leak-detector] "${resource.testName}": ${resource.type}\n${resource.stack}`)
    }

    writeFileSync(LEAK_FILE, JSON.stringify(record) + '\n', { flag: 'a' })
  }

  activeResources.clear()
})
