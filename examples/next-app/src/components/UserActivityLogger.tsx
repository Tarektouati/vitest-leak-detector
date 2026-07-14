interface Props {
  userId: string
}

// In-flight queue like a real analytics SDK would keep for flush(). Holding
// the pending Promise also keeps it out of reach of the garbage collector:
// an unreferenced Promise can be GC'd before the leak report runs (Promise
// async_hooks `destroy` fires on GC), which would make this demo flaky.
const inflight = new Set<Promise<void>>()

async function trackActivity(userId: string): Promise<void> {
  // Simulates a slow remote analytics call that never settles in tests.
  const call = new Promise<void>(() => {})
  inflight.add(call)
  try {
    await call
  } finally {
    inflight.delete(call)
  }
}

export async function UserActivityLogger({ userId }: Props) {
  // Bug: fire-and-forget — trackActivity is called without await.
  // The returned Promise floats beyond the test boundary and is caught by
  // vitest-leak-detector as an unreleased PROMISE resource.
  trackActivity(userId)

  return (
    <section>
      <h2>Recent Activity</h2>
      <p>Loading activity for user {userId}…</p>
    </section>
  )
}
