/**
 * Intentional leak demo — Timeout
 *
 * DataLoader calls setTimeout inside useEffect without returning a cleanup
 * function. Every render schedules a timer that is never cancelled, so
 * vitest-leak-detector reports a "Timeout" leak for each test.
 *
 * Fix: store the id and return () => clearTimeout(id) from the effect.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { DataLoader } from '../DataLoader'

describe('DataLoader', () => {
  it('shows a loading state for query "react"', () => {
    render(<DataLoader query="react" />)
    expect(screen.getByText('Loading…')).toBeDefined()
    // The setTimeout is NOT cleared. React 19 schedules additional internal
    // timers in dev mode, so the reporter may flag several Timeout leaks.
  })

  it('shows a loading state for query "vitest"', () => {
    render(<DataLoader query="vitest" />)
    expect(screen.getByText('Loading…')).toBeDefined()
    // Same as above — each render schedules a new uncleaned timeout.
  })
})
