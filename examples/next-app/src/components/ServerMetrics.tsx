'use client'

import { request } from 'node:http'
import { useState, useEffect } from 'react'

interface Props {
  port: number
}

export function ServerMetrics({ port }: Props) {
  const [latency, setLatency] = useState<number | null>(null)

  useEffect(() => {
    // Bug: the HTTP request is never aborted on unmount.
    // The pending HTTPCLIENTREQUEST and TCPWRAP resources outlive the
    // component and bleed into the next test.
    const start = Date.now()
    const req = request(
      { hostname: '127.0.0.1', port, path: '/metrics' },
      (res) => {
        res.on('data', () => {})
        res.on('end', () => setLatency(Date.now() - start))
      },
    )
    // Suppress socket errors that fire when the test server closes after the test.
    req.on('error', () => {})
    req.end()

    // Fix: return () => req.destroy()
  }, [port])

  return <span>{latency !== null ? `${latency}ms` : 'checking…'}</span>
}
