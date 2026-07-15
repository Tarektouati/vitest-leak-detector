import { AsyncLocalStorage, createHook } from 'node:async_hooks'
import { subscribe } from 'node:diagnostics_channel'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// getFn/setFn come from @vitest/runner directly: the supported
// TestRunner.setTestFn static is broken in vitest 4.1 (assigned the getter —
// a silent no-op), and the vitest/suite re-export prints a deprecation
// warning at import time in every worker. @vitest/runner must resolve to the
// same instance vitest uses (peer dependency): the fn registry is a
// module-level WeakMap, so a duplicate copy would wrap into a different map.
import { getFn, setFn, type Test } from '@vitest/runner'
import { beforeEach, afterEach, onTestFinished } from 'vitest'
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

// Identity of the test that owns a resource. Resources created in the test
// body carry the exact owner via AsyncLocalStorage; resources created in user
// beforeEach/afterEach hooks (outside the wrapped body) fall back to the last
// beforeEach's owner — exact in sequential runs, best-effort under
// it.concurrent. Reporting matches on the task object, not testName: names
// are not describe-qualified, so same-named tests in different describe
// blocks would collide on strings (#25).
interface TestRef {
  task: Test
  testName: string
  testFile: string
}

interface ResourceInfo {
  type: string
  stack: string
  owner: TestRef
  ref?: WeakRef<RefCountedResource>
}

const testContext = new AsyncLocalStorage<TestRef>()
const wrappedTasks = new WeakSet<Test>()
// Tracking is active while any test is running. A Set instead of a boolean:
// under it.concurrent one test finishing must not disable tracking for the
// others (#25). Both the afterEach safety net and reportLeaks delete the
// task — idempotent, like the double `= false` this replaces.
const runningTasks = new Set<Test>()
let fallbackOwner: TestRef | undefined
// Suppresses tracking of the detector's own async operations (drain timers,
// report promise): under it.concurrent they are created while other tests
// keep tracking enabled and would be falsely reported as their leaks. Must
// never stay set across an await — that would blind the detector to resources
// other concurrent tests create in the meantime.
let inInternalOp = false
const activeResources = new Map<number, ResourceInfo>()

const hook = createHook({
  init(asyncId, type, _triggerAsyncId, resource) {
    if (inInternalOp || runningTasks.size === 0 || !shouldTrack(type, opts)) return
    // init runs synchronously in the creating execution context, so the store
    // is the owner of whichever test body is executing right now.
    const owner = testContext.getStore() ?? fallbackOwner
    if (owner === undefined) return
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
      owner,
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
  owner: TestRef
}

const pendingFetches = new Map<object, FetchInfo>()

function onFetchRequestCreate(message: unknown): void {
  if (inInternalOp || runningTasks.size === 0 || !shouldTrack('FETCH', opts)) return
  // The publish happens synchronously inside the user's fetch() call, so the
  // ALS store identifies the calling test body.
  const owner = testContext.getStore() ?? fallbackOwner
  if (owner === undefined) return
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
    owner,
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
  const owner: TestRef = {
    task,
    testName: task.name,
    testFile: task.file?.filepath ?? '<unknown>',
  }
  fallbackOwner = owner
  runningTasks.add(task)
  // Bind the owner to the test body's async execution context: every resource
  // created inside the body inherits it, no matter how many concurrent test
  // bodies interleave (#25). Re-setting the fn from beforeEach works because
  // the runner retrieves it only after all beforeEach hooks have run. Wrap
  // once per task — beforeEach re-runs on retries/repeats and must not stack
  // wrappers. (entering the context from this hook instead would not work:
  // the test body resumes in the runner's continuation context, a sibling of
  // this one.)
  if (!wrappedTasks.has(task)) {
    wrappedTasks.add(task)
    const fn = getFn(task)
    if (fn) {
      setFn(task, () => testContext.run(owner, fn))
    }
  }
  // Report via onTestFinished, not a competing afterEach: under Vitest's
  // default sequence.hooks 'stack' mode, afterEach hooks run in reverse
  // registration order, so a report registered as afterEach would run before
  // user cleanup hooks (Testing Library cleanup(), MSW resetHandlers(), ...)
  // whenever the detector is not first in setupFiles — flagging everything
  // that cleanup releases as a leak (#23). onTestFinished runs after all
  // afterEach hooks in every sequence.hooks mode, making the detector
  // independent of setupFiles order.
  onTestFinished(() => reportLeaks(task))
})

// Safety net for tests skipped dynamically via ctx.skip(), where
// onTestFinished never fires but afterEach hooks still run.
afterEach(({ task }) => {
  runningTasks.delete(task)
})

// A resource is reported by the drain of the test that owns it. Entries owned
// by a dynamically skipped test (ctx.skip()) are swept along too: their
// onTestFinished never fires, so no drain of their own will ever claim them.
// Entries owned by other tests must be left alone — a concurrent test that
// just finished may have cleared resources whose async_hooks destroy has not
// been emitted yet, and reporting them here would be a false positive.
function isOwnedBy(owner: TestRef, task: Test): boolean {
  return owner.task === task || owner.task.mode === 'skip'
}

function hasOwnedEntries(task: Test): boolean {
  for (const [, resource] of activeResources) {
    if (isOwnedBy(resource.owner, task)) return true
  }
  for (const [, fetchInfo] of pendingFetches) {
    if (isOwnedBy(fetchInfo.owner, task)) return true
  }
  return false
}

// The callback must stay synchronous up to the early return: an async
// function's implicit promise is created at invocation, before the first body
// statement runs — if tracking were still active, with trackPromises it would
// be tracked and reported as a phantom leak on every test (#24). This test's
// tracking is switched off synchronously here; only then is the drain/report
// promise created, shielded by inInternalOp from the tracking that other
// concurrent tests keep enabled.
function reportLeaks(task: Test): void | Promise<void> {
  runningTasks.delete(task)
  if (!hasOwnedEntries(task)) return
  inInternalOp = true
  const report = drainAndReport(task)
  inInternalOp = false
  return report
}

// Creates the drain timer with tracking suppressed: the promise and its
// Timeout are detector internals, not test resources. The flag is cleared
// before the await so other concurrent tests' resources stay tracked.
function internalDelay(ms: number): Promise<void> {
  inInternalOp = true
  const delay = new Promise<void>((resolve) => setTimeout(resolve, ms))
  inInternalOp = false
  return delay
}

// clearTimeout()/close() emit async_hooks `destroy` on a later tick, so a
// synchronous snapshot reports correctly-cleaned resources as leaks. Drain the
// destroy queue (same approach as Jest's collectHandles) before reporting.
// Only this test's entries are reported and removed: under it.concurrent the
// maps also hold other still-running tests' resources, which their own drains
// will judge (#25). The report loop is synchronous, so two overlapping drains
// cannot double-report an entry.
async function drainAndReport(task: Test): Promise<void> {
  // The drains also give a user afterEach that aborts a fetch time for the
  // undici:request:error event to remove it from pendingFetches.
  await internalDelay(0)
  if (!hasOwnedEntries(task)) return
  await internalDelay(30)
  if (!hasOwnedEntries(task)) return

  const timestamp = Date.now()
  let ndjson = ''

  for (const [asyncId, resource] of activeResources) {
    if (!isOwnedBy(resource.owner, task)) continue
    activeResources.delete(asyncId)

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
      testName: resource.owner.testName,
      testFile: resource.owner.testFile,
      type: resource.type,
      stack: resource.stack,
      timestamp,
    }

    if (opts.warnInline) {
      console.warn(
        `[leak-detector] "${resource.owner.testName}": ${resource.type}\n${resource.stack}`,
      )
    }

    ndjson += JSON.stringify(record) + '\n'
  }

  for (const [request, fetchInfo] of pendingFetches) {
    if (!isOwnedBy(fetchInfo.owner, task)) continue
    pendingFetches.delete(request)

    const record: LeakRecord = {
      testName: fetchInfo.owner.testName,
      testFile: fetchInfo.owner.testFile,
      type: 'FETCH',
      stack: fetchInfo.stack,
      timestamp,
    }

    if (opts.warnInline) {
      console.warn(`[leak-detector] "${fetchInfo.owner.testName}": FETCH\n${fetchInfo.stack}`)
    }

    ndjson += JSON.stringify(record) + '\n'
  }

  if (ndjson !== '') writeFileSync(LEAK_FILE, ndjson, { flag: 'a' })
}
