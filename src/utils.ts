import type { LeakDetectorOptions } from './types.js'

const ALWAYS_IGNORED = new Set(['ROOT', 'TickObject', 'TIMERWRAP', 'Immediate', 'DESTROYWRAP'])
const TIMER_TYPES = new Set(['Timeout', 'Interval'])
const NETWORK_TYPES = new Set([
  'TCPWRAP',
  'TLSWRAP',
  'HTTPCLIENTREQUEST',
  'HTTPPARSER',
  'UDPSENDWRAP',
  'UDPWRAP',
  'GETADDRINFOREQWRAP',
  // Synthetic type for in-flight fetch() requests tracked via undici's
  // diagnostics_channel (fetch bypasses the async_hooks network types above).
  'FETCH',
])
// FSREQCALLBACK is deliberately excluded: every async fs operation emits one,
// which makes it far too noisy relative to the signal it would add.
const FS_TYPES = new Set(['FSEVENTWRAP', 'STATWATCHER', 'FILEHANDLE'])

type TrackingOptions = Pick<
  Required<LeakDetectorOptions>,
  'trackTimers' | 'trackNetwork' | 'trackPromises' | 'trackFs' | 'ignoreTypes'
>

export function shouldTrack(type: string, opts: TrackingOptions): boolean {
  if (ALWAYS_IGNORED.has(type)) return false
  if (opts.ignoreTypes.includes(type)) return false
  if (type === 'PROMISE') return opts.trackPromises
  if (TIMER_TYPES.has(type)) return opts.trackTimers
  if (NETWORK_TYPES.has(type)) return opts.trackNetwork
  if (FS_TYPES.has(type)) return opts.trackFs
  return false
}

export function filterStack(rawStack: string, depth: number): string {
  return rawStack
    .split('\n')
    .slice(1)
    .filter(
      (line) =>
        // All Node builtin frames ("at node:net:…" or "at fn (node:net:…)") —
        // never user code, and undici socket frames would otherwise pass
        // hasLocatableFrame and double-report fetch leaks as TCPWRAP.
        !/\(node:|\bat node:/.test(line) &&
        // This package's own async_hooks init callback frame.
        !line.includes('AsyncHook.init') &&
        !line.includes('node_modules/vitest') &&
        !line.includes('node_modules/@vitest') &&
        !line.includes('vitest-leak-detector/dist/setup') &&
        !line.includes('vitest-leak-detector/src/setup'),
    )
    .slice(0, depth)
    .join('\n')
}

export function hasLocatableFrame(filteredStack: string): boolean {
  const firstFrame = filteredStack.split('\n').find(line => line.trim().length > 0)
  if (!firstFrame) return false
  if (firstFrame.trimEnd().endsWith('(<anonymous>)')) return false
  if (firstFrame.includes('node_modules/')) return false
  return true
}
