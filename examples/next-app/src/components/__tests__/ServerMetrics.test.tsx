/**
 * Intentional leak demo — HTTPCLIENTREQUEST / TCPWRAP (network resources)
 *
 * ServerMetrics makes a node:http request inside useEffect without returning
 * a cleanup function. The request stays pending (the test server never sends
 * a response), so the HTTPCLIENTREQUEST and TCPWRAP async resources outlive
 * the component.
 *
 * Note: modern fetch() uses undici, which creates different async resource
 * types not yet tracked by the plugin. node:http.request() is used here
 * because it creates the HTTPCLIENTREQUEST / TCPWRAP types that the plugin
 * tracks out of the box.
 *
 * Fix: return () => req.destroy() from the effect, or use fetch() with an
 * AbortController: return () => controller.abort()
 */
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ServerMetrics } from '../ServerMetrics'

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

describe('ServerMetrics', () => {
  it('renders a loading state while waiting for the metrics response', () => {
    render(<ServerMetrics port={port} />)
    expect(screen.getByText('checking…')).toBeDefined()
    // The HTTP request is never aborted. After this test the reporter will
    // flag HTTPCLIENTREQUEST and TCPWRAP leaks attributed to this test.
  })
})
