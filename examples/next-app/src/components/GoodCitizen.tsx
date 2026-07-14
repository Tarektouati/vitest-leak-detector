'use client'

import { useState, useEffect } from 'react'

export function GoodCitizen() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1)
    }, 1000)

    // Proper cleanup: the interval is cleared when the component unmounts
    // (Testing Library's cleanup() in test-setup.ts), so the leak detector
    // must never flag this component.
    return () => clearInterval(id)
  }, [])

  return <span data-testid="tick">{tick}</span>
}
