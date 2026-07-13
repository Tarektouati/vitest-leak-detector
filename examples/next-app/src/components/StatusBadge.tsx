'use client'

import { useState, useEffect } from 'react'

interface Props {
  port: number
}

export function StatusBadge({ port }: Props) {
  const [status, setStatus] = useState<string>('unknown')

  useEffect(() => {
    // Bug: the fetch is never aborted on unmount. The in-flight request
    // outlives the component and bleeds into the next test. fetch() goes
    // through undici, so the leak surfaces as the synthetic FETCH type.
    fetch(`http://127.0.0.1:${port}/status`)
      .then((res) => res.text())
      .then(setStatus)
      // Suppress errors that fire when the test server closes after the test.
      .catch(() => {})

    // Fix:
    //   const controller = new AbortController()
    //   fetch(url, { signal: controller.signal })…
    //   return () => controller.abort()
  }, [port])

  return <span>{status}</span>
}
