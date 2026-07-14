// @vitest-environment node
/**
 * Intentional leak demo — RSC with fire-and-forget async (PROMISE tracking)
 *
 * UserActivityLogger is a React Server Component that calls trackActivity()
 * without await. The unawaited Promise floats beyond the test boundary and is
 * surfaced by vitest-leak-detector.
 *
 * Unlike client components, RSCs are async functions — they can be called
 * directly in tests without render(). The @vitest-environment node docblock
 * reflects that server components run in a Node.js context, not a browser.
 *
 * Fix: await trackActivity(userId), or accept an AbortSignal so callers can
 * cancel the operation when the RSC render is abandoned.
 */
import { configureLeakDetector } from 'vitest-leak-detector/setup'

// Enable Promise tracking to catch unawaited async calls.
// Must be called before any imports that might trigger async resources.
// warnInline is disabled — React internals produce short-lived Promises that
// would pollute stdout.
configureLeakDetector({ trackPromises: true, warnInline: false })

import { describe, it } from 'vitest'
import { UserActivityLogger } from '../UserActivityLogger.js'

describe('UserActivityLogger RSC', () => {
  it('fires an unawaited trackActivity call that leaks a PROMISE', async () => {
    // RSCs are plain async functions — call directly, no render() needed.
    await UserActivityLogger({ userId: 'user-42' })
    // At test end, vitest-leak-detector finds the unreleased PROMISE in
    // activeResources and writes it to the NDJSON report.
  })
})
