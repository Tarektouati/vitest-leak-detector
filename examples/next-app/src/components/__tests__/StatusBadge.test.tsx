/**
 * Intentional leak demo — FETCH (undici / fetch())
 *
 * StatusBadge calls fetch() inside useEffect without returning a cleanup
 * function that aborts it. The request stays pending (the test server never
 * sends a response), so it is still in flight when the test ends.
 *
 * fetch() goes through Node's bundled undici and never emits the async_hooks
 * network types — the plugin tracks it via undici's diagnostics_channel
 * events instead and reports it as the synthetic FETCH type.
 *
 * Fix: create an AbortController in the effect, pass its signal to fetch(),
 * and return () => controller.abort()
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../StatusBadge'

let hangingServer: ReturnType<typeof createServer>
let port: number

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      hangingServer = createServer((_req, _res) => {
        // Intentionally never responds — incoming connections are accepted
        // but the response is withheld, so client requests hang indefinitely.
      })
      hangingServer.listen(0, '127.0.0.1', () => {
        port = (hangingServer.address() as AddressInfo).port
        resolve()
      })
    }),
)

afterAll(() => {
  hangingServer.closeAllConnections?.()
  hangingServer.close()
})

describe('StatusBadge', () => {
  it('renders the default status while waiting for the response', () => {
    render(<StatusBadge port={port} />)
    expect(screen.getByText('unknown')).toBeDefined()
    // The fetch is never aborted. After this test the reporter will flag a
    // FETCH leak attributed to this test.
  })
})
