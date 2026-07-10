import { createHook } from 'node:async_hooks'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach } from 'vitest'
import type { LeakDetectorOptions, LeakRecord } from './types.js'
import { shouldTrack, filterStack, hasLocatableFrame } from './utils.js'

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

interface RefCountedResource {
  hasRef?: () => boolean
}

interface ResourceInfo {
  type: string
  stack: string
  testName: string
  testFile: string
  ref?: WeakRef<RefCountedResource>
}

let trackingEnabled = false
let currentTestName = ''
let currentTestFile = ''
const activeResources = new Map<number, ResourceInfo>()

const hook = createHook({
  init(asyncId, type, _triggerAsyncId, resource) {
    if (!trackingEnabled || !shouldTrack(type, opts)) return
    const stack = filterStack(new Error().stack ?? '', opts.stackDepth)
    if (!hasLocatableFrame(stack)) return
    const refCounted = resource as RefCountedResource
    activeResources.set(asyncId, {
      type,
      stack,
      testName: currentTestName,
      testFile: currentTestFile,
      // WeakRef only: holding the resource strongly would itself leak memory.
      ref: typeof refCounted?.hasRef === 'function' ? new WeakRef(refCounted) : undefined,
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
  currentTestFile = task.file?.filepath ?? '<unknown>'
  trackingEnabled = true
})

// clearTimeout()/close() emit async_hooks `destroy` on a later tick, so a
// synchronous snapshot reports correctly-cleaned resources as leaks. Drain the
// destroy queue (same approach as Jest's collectHandles) before reporting.
afterEach(async () => {
  trackingEnabled = false

  if (activeResources.size === 0) return
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (activeResources.size === 0) return
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (activeResources.size === 0) return

  const timestamp = Date.now()
  let ndjson = ''

  for (const [, resource] of activeResources) {
    // A resource that was GC'd or reports hasRef() === false (unref'd or
    // already closed) no longer keeps the event loop alive — not a leak.
    if (resource.ref) {
      const live = resource.ref.deref()
      if (live === undefined || live.hasRef?.() === false) continue
    }

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

    ndjson += JSON.stringify(record) + '\n'
  }

  if (ndjson !== '') writeFileSync(LEAK_FILE, ndjson, { flag: 'a' })
  activeResources.clear()
})
