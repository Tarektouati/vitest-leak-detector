# vitest-leak-detector

[![TypeScript badge](https://img.shields.io/badge/-TypeScript-3178C6?logo=typescript&logoColor=FFFFFF&labelColor=000000)](https://www.typescriptlang.org) [![Vitest badge](https://img.shields.io/badge/-Vitest%20plugin-6E9F18?logo=vitest&logoColor=FFFFFF&labelColor=000000)](https://vitest.dev) [![Node.js badge](https://img.shields.io/badge/Node.js-%E2%89%A524-5FA04E?logo=nodedotjs&logoColor=FFFFFF&labelColor=000000)](https://nodejs.org) [![npm](https://img.shields.io/npm/v/vitest-leak-detector?logo=npm&logoColor=FFFFFF&labelColor=000000&color=CB3837)](https://www.npmjs.com/package/vitest-leak-detector)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE) [![CI](https://github.com/Tarektouati/vitest-leak-detector/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Tarektouati/vitest-leak-detector/actions/workflows/ci.yml)

A zero-dependency Vitest plugin that detects async resource leaks between tests using Node's `async_hooks`. Identifies which tests leave behind uncleaned timers, open sockets, or pending HTTP requests.

## Requirements

- Node.js ≥ 24
- Vitest ≥ 4.0.0

## Runtime compatibility

This package is **Node.js only**. It relies on [`node:async_hooks`](https://nodejs.org/api/async_hooks.html) — specifically the `init` and `destroy` lifecycle callbacks — to track async resource creation and cleanup at the event loop level. This API is deeply tied to Node.js's libuv-based runtime and V8's async context tracking.

**Deno** ships its own equivalent natively: [`sanitizeOps` and `sanitizeResources`](https://docs.deno.com/runtime/fundamentals/testing/#resource-and-async-op-sanitizers) are built into `Deno.test()` and enabled by default, with [`--trace-leaks`](https://docs.deno.com/runtime/reference/cli/test/) for detailed stack traces. No plugin needed.

**Bun** runs on JavaScriptCore (not V8) and does not expose the async resource lifecycle hooks this package depends on.

## Installation

```sh
pnpm add -D vitest-leak-detector
```

## Setup

Add the setup file and reporter to your `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['vitest-leak-detector/setup'],
    reporters: ['default', 'vitest-leak-detector/reporter'],
  },
})
```

## How it works

The setup file runs in Vitest worker threads. It enables an `async_hooks` hook that tracks async resource lifecycles, but only between `beforeEach` and `afterEach` — preventing Vitest's own internals from registering as false positives.

Stack traces are captured at resource creation time (`init`), not at detection time, so you get useful call sites pointing to your test code.

At the end of each test, any resources that were created but not destroyed are written to a temporary NDJSON file. The reporter reads all such files after the run completes, prints a grouped summary, and deletes them.

Because Node emits `async_hooks` `destroy` events asynchronously, a resource cleaned up during teardown (e.g. `clearTimeout` inside a React effect cleanup) may still look active at the exact moment the test ends. To avoid such false positives, the detector waits up to ~30ms after each test for queued `destroy` events to drain before reporting — this latency only applies when leak candidates exist. Additionally, handles are re-checked for liveness at report time: any handle that reports `hasRef() === false` (an `unref()`'d timer, or a handle that was already closed) or that has been garbage-collected is filtered out, since it no longer keeps the event loop alive. `FILEHANDLE` resources expose no `hasRef()` and never emit `destroy` on `close()`, so they are re-checked through their file descriptor instead: a closed handle's `fd` turns negative and is filtered out.

## What is tracked

| Handle type | Default | Notes |
|---|---|---|
| `Timeout` / `Interval` | ✅ | `setTimeout` / `setInterval` not cleared |
| `TCPWRAP`, `TLSWRAP` | ✅ | Open sockets |
| `HTTPCLIENTREQUEST`, `HTTPPARSER` | ✅ | Pending HTTP |
| `UDPSENDWRAP`, `UDPWRAP` | ✅ | UDP sockets |
| `GETADDRINFOREQWRAP` | ✅ | DNS lookups |
| `FSEVENTWRAP`, `STATWATCHER` | ✅ | `fs.watch()` / `fs.watchFile()` not closed |
| `FILEHANDLE` | ✅ | `fsPromises.open()` without `close()` — no stack trace available (created at an async boundary), identified by test name only |
| `PROMISE` | ⚙️ opt-in | Noisy by default |
| `ROOT`, `TickObject`, `TIMERWRAP`, `Immediate` | ❌ | Vitest internals — always ignored |

## Configuration

`configureLeakDetector` must be called **before the first test runs** — i.e. at the top of the same setup file, before any `import` side-effects that might trigger async resources. Options are read at `beforeEach`/`afterEach` time, so calling this at module scope in the setup file is always safe.

```ts
// vitest-setup.ts  ← referenced in setupFiles
import { configureLeakDetector } from 'vitest-leak-detector/setup'

// Call before any other setup so options are in effect from the first test.
configureLeakDetector({
  trackPromises: false,  // default: false
  trackTimers: true,     // default: true
  trackNetwork: true,    // default: true
  trackFs: true,         // default: true — fs watchers and file handles
  stackDepth: 6,         // default: 6 frames
  warnInline: true,      // default: true — console.warn per leaked resource
  ignoreTypes: [],       // additional resource types to skip
})
```

> **Note:** Calling `configureLeakDetector` from a Vitest `globalSetup` file will **not** work — global setup runs in a separate process before workers start. Call it from a file listed in `setupFiles` instead.

## Example output

```
Async Leak Report
────────────────────────────────────────────────────────────

/project/src/components/Timer.test.ts
  ✖ updates display after delay (2 leaks)
    type: Timeout
    at setTimeout (src/components/Timer.ts:12:5)
    at Object.<anonymous> (src/components/Timer.test.ts:18:3)

1 async leak detected
```

## Common fixes

**Timer leaks**

```ts
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
```

**Network leaks**

```ts
let controller: AbortController
beforeEach(() => { controller = new AbortController() })
afterEach(() => controller.abort())
// pass controller.signal to fetch calls
```

**Fs watcher / file handle leaks**

```ts
let watcher: fs.FSWatcher
beforeEach(() => { watcher = fs.watch(configPath, onChange) })
afterEach(() => watcher.close())
// same idea for fs.watchFile → fs.unwatchFile(path)
// and fsPromises.open → await handle.close()
```

**MSW cleanup**

```ts
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## License

MIT
