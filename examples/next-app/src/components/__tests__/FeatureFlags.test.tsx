// @vitest-environment node
/**
 * Intentional leak demo — fs.watch() watcher never closed (FSEVENTWRAP tracking)
 *
 * FeatureFlags reads a JSON config file and starts fs.watch() to hot-reload
 * flags when the file changes. The watcher is never closed, so the FSEVENTWRAP
 * resource outlives the test and keeps the worker process alive —
 * vitest-leak-detector reports it with a stack pointing at the watch() call.
 *
 * Rendered as a React Server Component: it reads from the filesystem, so it
 * runs in a Node.js context, not a browser.
 *
 * Fix: keep a reference to the watcher and call watcher.close() during
 * cleanup (e.g. in afterEach, or a component-level dispose hook).
 */
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, afterAll } from 'vitest'
import { FeatureFlags } from '../FeatureFlags.js'

const configPath = join(tmpdir(), `feature-flags-${process.pid}.json`)
writeFileSync(configPath, JSON.stringify({ darkMode: true, beta: false }))

afterAll(() => {
  unlinkSync(configPath)
})

describe('FeatureFlags RSC', () => {
  it('renders flags but leaks the config-file watcher (FSEVENTWRAP)', () => {
    // RSCs are plain functions — call directly, no render() needed.
    const element = FeatureFlags({ configPath })
    expect(element.props.children).toHaveLength(2)
    // afterEach: vitest-leak-detector finds the unclosed fs.watch() watcher in
    // activeResources and writes it to the NDJSON report.
  })
})
