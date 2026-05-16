interface Props {
  userId: string
}

async function trackActivity(userId: string): Promise<void> {
  // Simulates a slow remote analytics call that never settles in tests.
  await new Promise<void>(() => {})
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
