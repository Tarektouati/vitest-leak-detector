'use client'

import { useState, useEffect } from 'react'

interface Props {
  query: string
}

export function DataLoader({ query }: Props) {
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    // Bug: the timer id is never stored, so it cannot be cancelled.
    // If the component unmounts or `query` changes before the timeout fires,
    // the callback still runs, leaking a "Timeout" async resource.
    setTimeout(() => {
      setResult(`Data for: ${query}`)
    }, 2000)

    // Fix would be:
    //   const id = setTimeout(...)
    //   return () => clearTimeout(id)
  }, [query])

  return <p>{result ?? 'Loading…'}</p>
}
