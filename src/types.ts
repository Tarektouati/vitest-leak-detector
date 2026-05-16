export interface LeakRecord {
  testName: string
  testFile: string
  type: string
  stack: string
  timestamp: number
}

export interface LeakDetectorOptions {
  trackPromises?: boolean
  trackTimers?: boolean
  trackNetwork?: boolean
  stackDepth?: number
  warnInline?: boolean
  failOnLeak?: boolean
  ignoreTypes?: string[]
}
