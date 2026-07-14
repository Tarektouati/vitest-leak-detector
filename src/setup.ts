import { createHook } from 'node:async_hooks'
import { subscribe } from 'node:diagnostics_channel'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach } from 'vitest'
import type { LeakDetectorOptions, LeakRecord } from './types.js'
import { shouldTrack, filterStack, hasLocatableFrame } from './utils.js'

// The reporter (main process) generates a run ID and exports it via the
// environment before workers fork; namespacing the file with it keeps
// concurrent runs from reading and deleting each other's output (#26).
// 'orphan' covers setup imported without the reporter — those files are
// garbage-collected by a later run's 24h staleness sweep.
const RUN_ID = process.env.VITEST_LEAK_RUN_ID ?? 'orphan'
export const LEAK_FILE = join(tmpdir(), `vitest-leaks-${RUN_ID}-${process.pid}.ndjson`)

let opts: Required<LeakDetectorOptions> = {
  trackPromises: false,
  trackTimers: true,
  trackNetwork: true,
  trackFs: true,
  stackDepth: 6,
  warnInline: true,
  ignoreTypes: [],
}

export function configureLeakDetector(overrides: LeakDetectorOptions): void {
  opts = { ...opts, ...overrides }
}

interface RefCountedResource {
  hasRef?: () => boolean
  // FILEHANDLE resources expose no hasRef(); their fd turns negative on close.
  fd?: number
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
    // FILEHANDLE is created when the async open() completes, so V8 cuts the
    // stack at the async boundary and no user frame is ever present. Keep the
    // record anyway — testName/testFile still identify the leaking test.
    if (type !== 'FILEHANDLE' && !hasLocatableFrame(stack)) return
    const refCounted = resource as RefCountedResource
    // Do NOT touch resource.fd here: the FILEHANDLE fd getter is native and
    // segfaults (SIGBUS in StreamBase::GetFD) when invoked during init, while
    // the object is still mid-construction. Gate on the type instead; fd is
    // only safe to read later, at report time.
    const refCheckable = typeof refCounted?.hasRef === 'function' || type === 'FILEHANDLE'
    activeResources.set(asyncId, {
      type,
      stack,
      testName: currentTestName,
      testFile: currentTestFile,
      // WeakRef only: holding the resource strongly would itself leak memory.
      ref: refCheckable ? new WeakRef(refCounted) : undefined,
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

// fetch() goes through Node's bundled undici and never hits the async_hooks
// network types, so in-flight requests are tracked separately via undici's
// diagnostics_channel events and reported as the synthetic type FETCH.
interface FetchInfo {
  stack: string
  testName: string
  testFile: string
}

const pendingFetches = new Map<object, FetchInfo>()

function onFetchRequestCreate(message: unknown): void {
  if (!trackingEnabled || !shouldTrack('FETCH', opts)) return
  const { request } = message as { request: object }
  // undici's dispatch chain between the user's fetch() call and this publish
  // is deeper than the default stackTraceLimit of 10 — without raising it the
  // user frame is cut off and every fetch would be unlocatable.
  const previousLimit = Error.stackTraceLimit
  Error.stackTraceLimit = 30
  const holder = { stack: '' }
  Error.captureStackTrace(holder, onFetchRequestCreate)
  Error.stackTraceLimit = previousLimit
  // Everything between here and the user's fetch() call is undici-internal,
  // so anonymous frames (undici's own `new Promise`) are noise, not the
  // resource's origin — drop them so the user frame surfaces first.
  const raw = holder.stack
    .split('\n')
    .filter((line) => !line.trimEnd().endsWith('(<anonymous>)'))
    .join('\n')
  const stack = filterStack(raw, opts.stackDepth)
  if (!hasLocatableFrame(stack)) return
  pendingFetches.set(request, {
    stack,
    testName: currentTestName,
    testFile: currentTestFile,
  })
}

function onFetchRequestSettled(message: unknown): void {
  const { request } = message as { request: object }
  pendingFetches.delete(request)
}

subscribe('undici:request:create', onFetchRequestCreate)
// trailers = response fully received; error = failure or AbortSignal abort.
subscribe('undici:request:trailers', onFetchRequestSettled)
subscribe('undici:request:error', onFetchRequestSettled)

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

  // The drains also give a user afterEach that aborts a fetch time for the
  // undici:request:error event to remove it from pendingFetches.
  if (activeResources.size === 0 && pendingFetches.size === 0) return
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (activeResources.size === 0 && pendingFetches.size === 0) return
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (activeResources.size === 0 && pendingFetches.size === 0) return

  const timestamp = Date.now()
  let ndjson = ''

  for (const [, resource] of activeResources) {
    // A resource that was GC'd or reports hasRef() === false (unref'd or
    // already closed) no longer keeps the event loop alive — not a leak.
    if (resource.ref) {
      const live = resource.ref.deref()
      if (live === undefined || live.hasRef?.() === false) continue
      // FILEHANDLE never emits destroy on close() (only on GC), so re-check
      // the fd: it turns negative once the handle is closed.
      if (live.hasRef === undefined && typeof live.fd === 'number' && live.fd < 0) continue
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

  for (const [, fetchInfo] of pendingFetches) {
    const record: LeakRecord = {
      testName: fetchInfo.testName,
      testFile: fetchInfo.testFile,
      type: 'FETCH',
      stack: fetchInfo.stack,
      timestamp,
    }

    if (opts.warnInline) {
      console.warn(`[leak-detector] "${fetchInfo.testName}": FETCH\n${fetchInfo.stack}`)
    }

    ndjson += JSON.stringify(record) + '\n'
  }

  if (ndjson !== '') writeFileSync(LEAK_FILE, ndjson, { flag: 'a' })
  activeResources.clear()
  pendingFetches.clear()
})
