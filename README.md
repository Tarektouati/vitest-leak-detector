# vitest-leak-detector

A zero-dependency Vitest plugin that detects async resource leaks between tests using Node's `async_hooks`. Identifies which tests leave behind uncleaned timers, open sockets, or pending HTTP requests.

## Requirements

- Node.js ≥ 22
- Vitest ≥ 4.0.0

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

## What is tracked

| Handle type | Default | Notes |
|---|---|---|
| `Timeout` / `Interval` | ✅ | `setTimeout` / `setInterval` not cleared |
| `TCPWRAP`, `TLSWRAP` | ✅ | Open sockets |
| `HTTPCLIENTREQUEST`, `HTTPPARSER` | ✅ | Pending HTTP |
| `UDPSENDWRAP`, `UDPWRAP` | ✅ | UDP sockets |
| `GETADDRINFOREQWRAP` | ✅ | DNS lookups |
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

**MSW cleanup**

```ts
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

## License

MIT
