import { readFileSync, watch } from 'node:fs'

interface Props {
  configPath: string
}

function loadFlags(configPath: string): Record<string, boolean> {
  return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, boolean>
}

export function FeatureFlags({ configPath }: Props) {
  let flags = loadFlags(configPath)

  // Bug: the watcher set up to hot-reload flags is never closed.
  // The FSEVENTWRAP resource keeps the process alive beyond the test boundary
  // and is caught by vitest-leak-detector.
  watch(configPath, () => {
    try {
      flags = loadFlags(configPath)
    } catch {
      // Keep the previous flags if the file is mid-write or was removed.
    }
  })

  // Fix: keep a reference to the watcher and call watcher.close() when the
  // component is done (or expose it so tests can close it in afterEach).

  return (
    <ul>
      {Object.entries(flags).map(([name, enabled]) => (
        <li key={name}>
          {name}: {enabled ? 'on' : 'off'}
        </li>
      ))}
    </ul>
  )
}
