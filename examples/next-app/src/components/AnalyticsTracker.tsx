'use client'

import { useEffect } from 'react'

interface Props {
  event: string
}

export function AnalyticsTracker({ event }: Props) {
  useEffect(() => {
    // Bug: fire-and-forget — the Promise is never awaited or cancelled.
    // If the component unmounts before the operation completes, the
    // Promise keeps a reference alive indefinitely.
    reportEvent(event)

    // Fix:
    //   const controller = new AbortController()
    //   reportEvent(event, controller.signal)
    //   return () => controller.abort()
  }, [event])

  return null
}

async function reportEvent(_name: string): Promise<void> {
  // Simulates a slow analytics pipeline that never completes in tests.
  await new Promise<void>(() => {})
}
