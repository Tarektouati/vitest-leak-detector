// Simulates a user setup file listed BEFORE the detector in setupFiles: its
// afterEach registers first, so under Vitest's default 'stack' hook order it
// runs LAST — after any afterEach the detector could register. This is the
// exact shape that caused false positives in #23 (Testing Library cleanup()
// releasing resources only after the detector had already reported them).
import { afterEach } from 'vitest'

let pendingTimer: NodeJS.Timeout | undefined

export function deferCleanup(timer: NodeJS.Timeout): void {
  pendingTimer = timer
}

afterEach(() => {
  if (pendingTimer !== undefined) {
    clearTimeout(pendingTimer)
    pendingTimer = undefined
  }
})
