/**
 * Intentional leak demo — PROMISE (opt-in tracking)
 *
 * AnalyticsTracker calls an async function fire-and-forget inside useEffect.
 * The async function awaits a Promise that never resolves, so the PROMISE
 * resource stays alive after the component unmounts.
 *
 * Promise tracking is disabled by default (trackPromises: false) because
 * React internals and third-party libraries create many short-lived Promises.
 * Enable it selectively per test file when hunting for fire-and-forget leaks.
 *
 * Fix: use AbortController and pass the signal to the async operation,
 * then return () => controller.abort() from the effect.
 */
import { configureLeakDetector } from 'vitest-leak-detector/setup'

// Enable Promise tracking for this file only.
// In pool:'forks' each test file runs in its own process, so this does not
// affect other test files. warnInline is disabled to keep stdout clean —
// React internals also produce many short-lived Promises.
configureLeakDetector({ trackPromises: true, warnInline: false })

import { render } from '@testing-library/react'
import { describe, it } from 'vitest'
import { AnalyticsTracker } from '../AnalyticsTracker'

describe('AnalyticsTracker', () => {
  it('fires and forgets a tracking event on mount', () => {
    render(<AnalyticsTracker event="page_view" />)
    // reportEvent() is called but never awaited or cancelled.
    // The reporter will flag PROMISE leaks after this test, including one
    // whose stack trace points to AnalyticsTracker.tsx.
  })
})
