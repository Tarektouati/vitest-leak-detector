import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// @vitejs/plugin-react-oxc always injects React Fast Refresh code because
// Vitest runs Vite in "serve" mode. These stubs satisfy that requirement
// without needing the full Fast Refresh runtime.
;(globalThis as Record<string, unknown>).$RefreshSig$ = () => (type: unknown) => type
;(globalThis as Record<string, unknown>).$RefreshReg$ = () => {}

// Unmount React trees after every test to prevent DOM bleed-over.
afterEach(() => cleanup())
