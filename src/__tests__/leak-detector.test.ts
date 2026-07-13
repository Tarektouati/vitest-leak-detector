import { describe, it, expect } from 'vitest'
import { filterStack, shouldTrack, hasLocatableFrame } from '../utils.js'
import type { LeakRecord } from '../types.js'

describe('filterStack', () => {
  it('strips node:internal frames', () => {
    const raw = [
      'Error',
      '    at Object.<anonymous> (/project/src/component.ts:10:5)',
      '    at node:internal/timers:100:20',
      '    at node_modules/vitest/dist/runner.js:200:10',
      '    at node_modules/@vitest/runner/dist/index.js:50:3',
      '    at /project/src/util.ts:5:3',
    ].join('\n')

    const result = filterStack(raw, 10)
    expect(result).not.toContain('node:internal')
    expect(result).not.toContain('node_modules/vitest')
    expect(result).not.toContain('node_modules/@vitest')
    expect(result).toContain('src/component.ts')
    expect(result).toContain('src/util.ts')
  })

  it('strips node:async_hooks and node:timers frames', () => {
    const raw = [
      'Error',
      '    at /project/src/thing.ts:1:1',
      '    at node:async_hooks:200:5',
      '    at node:timers:117:19',
    ].join('\n')

    const result = filterStack(raw, 10)
    expect(result).not.toContain('node:async_hooks')
    expect(result).not.toContain('node:timers')
    expect(result).toContain('src/thing.ts')
  })

  it('strips node:diagnostics_channel and undici frames', () => {
    const raw = [
      'Error',
      '    at Channel.publish (node:diagnostics_channel:165:9)',
      '    at new Request (node:internal/deps/undici/undici:2992:27)',
      '    at fetch (node:internal/bootstrap/web/exposed-window-or-worker:83:12)',
      '    at /project/src/api.ts:12:3',
    ].join('\n')

    const result = filterStack(raw, 10)
    expect(result).not.toContain('node:diagnostics_channel')
    expect(result).not.toContain('undici')
    expect(result).toContain('src/api.ts')
  })

  it('strips all node builtin frames and the AsyncHook.init frame', () => {
    const raw = [
      'Error',
      '    at AsyncHook.init (/project/node_modules/vitest-leak-detector/dist/setup.js:65:31)',
      '    at Socket.connect (node:net:1476:7)',
      '    at Object.connect (node:net:254:17)',
      '    at /project/src/api.ts:12:3',
    ].join('\n')

    const result = filterStack(raw, 10)
    expect(result).not.toContain('node:net')
    expect(result).not.toContain('AsyncHook.init')
    expect(result).toContain('src/api.ts')
  })

  it('strips vitest-leak-detector setup frames', () => {
    const raw = [
      'Error',
      '    at AsyncHook.init (/project/node_modules/vitest-leak-detector/dist/setup.js:57:31)',
      '    at /project/src/Timer.ts:5:3',
    ].join('\n')

    const result = filterStack(raw, 10)
    expect(result).not.toContain('vitest-leak-detector/dist/setup')
    expect(result).toContain('src/Timer.ts')
  })

  it('limits output to stackDepth frames', () => {
    const frames = Array.from({ length: 10 }, (_, i) => `    at fn${i} (file.ts:${i}:1)`)
    const raw = ['Error', ...frames].join('\n')

    const result = filterStack(raw, 3)
    expect(result.split('\n').filter(Boolean)).toHaveLength(3)
  })

  it('removes the Error header line', () => {
    const raw = 'Error\n    at something (file.ts:1:1)'
    const result = filterStack(raw, 10)
    expect(result).not.toMatch(/^Error/)
  })
})

describe('shouldTrack', () => {
  const base = { trackTimers: true, trackNetwork: true, trackPromises: false, trackFs: true, ignoreTypes: [] as string[] }

  it('returns false for always-ignored types', () => {
    for (const type of ['ROOT', 'TickObject', 'TIMERWRAP', 'Immediate', 'DESTROYWRAP']) {
      expect(shouldTrack(type, base)).toBe(false)
    }
  })

  it('tracks Timeout and Interval when trackTimers is true', () => {
    expect(shouldTrack('Timeout', base)).toBe(true)
    expect(shouldTrack('Interval', base)).toBe(true)
  })

  it('does not track timers when trackTimers is false', () => {
    const opts = { ...base, trackTimers: false }
    expect(shouldTrack('Timeout', opts)).toBe(false)
    expect(shouldTrack('Interval', opts)).toBe(false)
  })

  it('tracks network types when trackNetwork is true', () => {
    for (const type of ['TCPWRAP', 'TLSWRAP', 'HTTPCLIENTREQUEST', 'HTTPPARSER', 'UDPSENDWRAP', 'UDPWRAP', 'GETADDRINFOREQWRAP', 'FETCH']) {
      expect(shouldTrack(type, base)).toBe(true)
    }
  })

  it('does not track network types when trackNetwork is false', () => {
    const opts = { ...base, trackNetwork: false }
    expect(shouldTrack('TCPWRAP', opts)).toBe(false)
    expect(shouldTrack('FETCH', opts)).toBe(false)
  })

  it('respects ignoreTypes for FETCH', () => {
    const opts = { ...base, ignoreTypes: ['FETCH'] }
    expect(shouldTrack('FETCH', opts)).toBe(false)
  })

  it('tracks fs types when trackFs is true', () => {
    for (const type of ['FSEVENTWRAP', 'STATWATCHER', 'FILEHANDLE']) {
      expect(shouldTrack(type, base)).toBe(true)
    }
  })

  it('does not track fs types when trackFs is false', () => {
    const opts = { ...base, trackFs: false }
    for (const type of ['FSEVENTWRAP', 'STATWATCHER', 'FILEHANDLE']) {
      expect(shouldTrack(type, opts)).toBe(false)
    }
  })

  it('never tracks FSREQCALLBACK (too noisy)', () => {
    expect(shouldTrack('FSREQCALLBACK', base)).toBe(false)
  })

  it('does not track PROMISE by default', () => {
    expect(shouldTrack('PROMISE', base)).toBe(false)
  })

  it('tracks PROMISE when trackPromises is true', () => {
    const opts = { ...base, trackPromises: true }
    expect(shouldTrack('PROMISE', opts)).toBe(true)
  })

  it('respects custom ignoreTypes', () => {
    const opts = { ...base, ignoreTypes: ['Timeout', 'TCPWRAP'] }
    expect(shouldTrack('Timeout', opts)).toBe(false)
    expect(shouldTrack('TCPWRAP', opts)).toBe(false)
    expect(shouldTrack('Interval', opts)).toBe(true)
  })

  it('returns false for unknown types', () => {
    expect(shouldTrack('UNKNOWN_RESOURCE', base)).toBe(false)
  })
})

describe('hasLocatableFrame', () => {
  it('returns true when at least one frame has a real file path', () => {
    const stack = '    at setTimeout (src/components/Timer.ts:12:5)'
    expect(hasLocatableFrame(stack)).toBe(true)
  })

  it('returns false when every non-empty frame ends with (<anonymous>)', () => {
    const stack = [
      '    at new Promise (<anonymous>)',
      '    at scheduleCallback (<anonymous>)',
    ].join('\n')
    expect(hasLocatableFrame(stack)).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(hasLocatableFrame('')).toBe(false)
  })

  it('returns false when first frame is anonymous even if later frames are real', () => {
    const stack = [
      '    at new Promise (<anonymous>)',
      '    at Object.<anonymous> (src/Timer.ts:8:3)',
    ].join('\n')
    expect(hasLocatableFrame(stack)).toBe(false)
  })

  it('returns false when first frame is from node_modules', () => {
    const stack = [
      '    at Object.asyncWrapper (/project/node_modules/@testing-library/react/dist/pure.js:93:9)',
      '    at src/components/MyComponent.spec.tsx:44:5',
    ].join('\n')
    expect(hasLocatableFrame(stack)).toBe(false)
  })

  it('returns true when first frame is user code followed by anonymous frames', () => {
    const stack = [
      '    at setInterval (src/ClockWidget.tsx:13:5)',
      '    at new Promise (<anonymous>)',
    ].join('\n')
    expect(hasLocatableFrame(stack)).toBe(true)
  })

  it('treats Object.<anonymous> with a real path as locatable', () => {
    const stack = '    at Object.<anonymous> (src/file.ts:1:1)'
    expect(hasLocatableFrame(stack)).toBe(true)
  })
})

describe('LeakRecord serialization', () => {
  it('round-trips through JSON correctly', () => {
    const record: LeakRecord = {
      testName: 'my test name',
      testFile: '/path/to/test.ts',
      type: 'Timeout',
      stack: '    at setTimeout (/path/to/component.ts:10:5)',
      timestamp: 1234567890,
    }
    const deserialized = JSON.parse(JSON.stringify(record)) as LeakRecord
    expect(deserialized).toEqual(record)
  })

  it('serializes to valid NDJSON (no newlines in value)', () => {
    const record: LeakRecord = {
      testName: 'test',
      testFile: '/file.ts',
      type: 'Timeout',
      stack: '    at fn (file.ts:1:1)\n    at fn2 (file.ts:2:1)',
      timestamp: 0,
    }
    const line = JSON.stringify(record)
    expect(line).not.toContain('\n')
    expect(() => JSON.parse(line)).not.toThrow()
  })
})
