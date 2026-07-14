/**
 * Well-behaved component — regression guard for false positives (#23)
 *
 * GoodCitizen clears its setInterval in the effect cleanup, which only runs
 * when Testing Library's cleanup() (registered in test-setup.ts) unmounts the
 * component in an afterEach. The leak report runs after all afterEach hooks,
 * so this test must never be flagged — regardless of the setupFiles order.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GoodCitizen } from '../GoodCitizen'

describe('GoodCitizen', () => {
  it('cleans its interval on unmount — should never be flagged', () => {
    render(<GoodCitizen />)
    expect(screen.getByTestId('tick')).toBeDefined()
  })
})
