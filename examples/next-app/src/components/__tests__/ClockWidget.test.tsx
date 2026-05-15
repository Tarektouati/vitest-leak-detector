/**
 * Intentional leak demo — uncleaned setInterval
 *
 * ClockWidget calls setInterval inside useEffect without returning a cleanup
 * function. The interval keeps firing after the component unmounts.
 * Node.js async_hooks reports both setTimeout and setInterval as "Timeout"
 * type, so vitest-leak-detector will flag these as Timeout leaks.
 * React 19 also schedules a few internal timers per render in dev mode,
 * so the leak count may be higher than 1.
 *
 * Fix: store the id and return () => clearInterval(id) from the effect.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ClockWidget } from '../ClockWidget'

describe('ClockWidget', () => {
  it('renders the current time', () => {
    render(<ClockWidget />)
    expect(screen.getByRole('time')).toBeDefined()
    // Component unmounts at end of test — the setInterval is NOT cleared.
    // React 19 schedules additional internal timers in dev mode, so the
    // reporter may flag several Timeout leaks for this single test.
  })
})
