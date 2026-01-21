/**
 * Memory Monitor - Main process memory leak detection utility
 *
 * Tracks:
 * - Heap usage over time
 * - Event listener counts
 * - Active timers/intervals
 * - Subscription counts
 * - Window/resource lifecycle
 *
 * Usage:
 * - Call memoryMonitor.startTracking() to begin periodic snapshots
 * - Call memoryMonitor.getReport() for current memory state
 * - Call memoryMonitor.takeHeapSnapshot() to save V8 heap snapshot
 */

import {app, ipcMain} from 'electron'
import * as v8 from 'v8'
import * as fs from 'fs'
import * as path from 'path'
import {userDataPath} from './app-paths'
import * as logger from './logger'

const memLogger = logger.childLogger('seed/memory')

// Types
export interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
  listenerCounts: Record<string, number>
  trackedResources: TrackedResources
}

export interface TrackedResources {
  windows: number
  daemonStateHandlers: number
  ipcHandlers: number
  timers: number
  intervals: number
  subscriptions: number
  discoveryStreams: number
}

export interface MemoryReport {
  current: MemorySnapshot
  history: MemorySnapshot[]
  leakSuspects: LeakSuspect[]
  recommendations: string[]
}

export interface LeakSuspect {
  type: string
  description: string
  severity: 'low' | 'medium' | 'high'
  currentValue: number
  trend: 'stable' | 'growing' | 'shrinking'
}

// Listener registry for tracking event subscriptions
interface ListenerEntry {
  target: string
  event: string
  addedAt: number
  stack?: string
}

class ListenerRegistry {
  private listeners = new Map<string, ListenerEntry>()
  private idCounter = 0

  register(target: string, event: string): string {
    const id = `listener_${++this.idCounter}`
    this.listeners.set(id, {
      target,
      event,
      addedAt: Date.now(),
      stack: new Error().stack,
    })
    return id
  }

  unregister(id: string): boolean {
    return this.listeners.delete(id)
  }

  getAll(): Map<string, ListenerEntry> {
    return new Map(this.listeners)
  }

  getCount(): number {
    return this.listeners.size
  }

  getByTarget(target: string): ListenerEntry[] {
    return Array.from(this.listeners.values()).filter((l) => l.target === target)
  }

  getByEvent(event: string): ListenerEntry[] {
    return Array.from(this.listeners.values()).filter((l) => l.event === event)
  }

  getSummary(): Record<string, number> {
    const summary: Record<string, number> = {}
    for (const entry of this.listeners.values()) {
      const key = `${entry.target}:${entry.event}`
      summary[key] = (summary[key] || 0) + 1
    }
    return summary
  }
}

// Timer/Interval tracking
interface TimerEntry {
  id: NodeJS.Timeout
  type: 'timer' | 'interval'
  createdAt: number
  stack?: string
  description?: string
}

class TimerRegistry {
  private timers = new Map<string, TimerEntry>()
  private idCounter = 0

  registerTimer(id: NodeJS.Timeout, description?: string): string {
    const trackId = `timer_${++this.idCounter}`
    this.timers.set(trackId, {
      id,
      type: 'timer',
      createdAt: Date.now(),
      stack: new Error().stack,
      description,
    })
    return trackId
  }

  registerInterval(id: NodeJS.Timeout, description?: string): string {
    const trackId = `interval_${++this.idCounter}`
    this.timers.set(trackId, {
      id,
      type: 'interval',
      createdAt: Date.now(),
      stack: new Error().stack,
      description,
    })
    return trackId
  }

  unregister(trackId: string): boolean {
    return this.timers.delete(trackId)
  }

  getTimerCount(): number {
    return Array.from(this.timers.values()).filter((t) => t.type === 'timer')
      .length
  }

  getIntervalCount(): number {
    return Array.from(this.timers.values()).filter((t) => t.type === 'interval')
      .length
  }

  getAll(): Map<string, TimerEntry> {
    return new Map(this.timers)
  }

  getSummary(): {timers: number; intervals: number; details: string[]} {
    const details: string[] = []
    for (const [id, entry] of this.timers) {
      const age = Date.now() - entry.createdAt
      details.push(
        `${id}: ${entry.type} (age: ${Math.round(age / 1000)}s) ${entry.description || ''}`,
      )
    }
    return {
      timers: this.getTimerCount(),
      intervals: this.getIntervalCount(),
      details,
    }
  }
}

// Resource counters (injected from other modules)
type ResourceCounterFn = () => number

class MemoryMonitor {
  private snapshots: MemorySnapshot[] = []
  private maxSnapshots = 100
  private trackingInterval: NodeJS.Timeout | null = null
  private trackingIntervalMs = 30_000 // 30 seconds default

  readonly listenerRegistry = new ListenerRegistry()
  readonly timerRegistry = new TimerRegistry()

  // Resource counters to be registered by other modules
  private resourceCounters: Record<string, ResourceCounterFn> = {}

  constructor() {
    this.setupIpcHandlers()
  }

  // Register a resource counter function
  registerResourceCounter(name: string, counter: ResourceCounterFn): void {
    this.resourceCounters[name] = counter
  }

  // Start periodic memory tracking
  startTracking(intervalMs?: number): void {
    if (this.trackingInterval) {
      this.stopTracking()
    }

    const interval = intervalMs || this.trackingIntervalMs
    memLogger.info(`Starting memory tracking (interval: ${interval}ms)`)

    // Take initial snapshot
    this.takeSnapshot()

    this.trackingInterval = setInterval(() => {
      this.takeSnapshot()
    }, interval)
  }

  // Stop periodic tracking
  stopTracking(): void {
    if (this.trackingInterval) {
      clearInterval(this.trackingInterval)
      this.trackingInterval = null
      memLogger.info('Memory tracking stopped')
    }
  }

  // Take a memory snapshot
  takeSnapshot(): MemorySnapshot {
    const memUsage = process.memoryUsage()

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rss: memUsage.rss,
      listenerCounts: this.listenerRegistry.getSummary(),
      trackedResources: this.getTrackedResources(),
    }

    this.snapshots.push(snapshot)

    // Trim old snapshots
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots = this.snapshots.slice(-this.maxSnapshots)
    }

    return snapshot
  }

  // Get tracked resource counts
  private getTrackedResources(): TrackedResources {
    const resources: TrackedResources = {
      windows: 0,
      daemonStateHandlers: 0,
      ipcHandlers: 0,
      timers: this.timerRegistry.getTimerCount(),
      intervals: this.timerRegistry.getIntervalCount(),
      subscriptions: 0,
      discoveryStreams: 0,
    }

    // Call registered resource counters
    for (const [name, counter] of Object.entries(this.resourceCounters)) {
      try {
        const value = counter()
        if (name in resources) {
          ;(resources as any)[name] = value
        }
      } catch (e) {
        memLogger.warn(`Failed to get resource count for ${name}`)
      }
    }

    return resources
  }

  // Analyze snapshots for potential leaks
  private analyzeLeaks(): LeakSuspect[] {
    const suspects: LeakSuspect[] = []

    if (this.snapshots.length < 5) {
      return suspects // Need enough data
    }

    const recent = this.snapshots.slice(-10)
    const first = recent[0]
    const last = recent[recent.length - 1]

    // Check heap growth
    const heapGrowth =
      ((last.heapUsed - first.heapUsed) / first.heapUsed) * 100
    if (heapGrowth > 20) {
      suspects.push({
        type: 'heap',
        description: `Heap grew ${heapGrowth.toFixed(1)}% in last ${recent.length} snapshots`,
        severity: heapGrowth > 50 ? 'high' : heapGrowth > 30 ? 'medium' : 'low',
        currentValue: last.heapUsed,
        trend: 'growing',
      })
    }

    // Check listener growth
    const firstListenerCount = Object.values(first.listenerCounts).reduce(
      (a, b) => a + b,
      0,
    )
    const lastListenerCount = Object.values(last.listenerCounts).reduce(
      (a, b) => a + b,
      0,
    )
    if (lastListenerCount > firstListenerCount + 5) {
      suspects.push({
        type: 'listeners',
        description: `Listener count grew from ${firstListenerCount} to ${lastListenerCount}`,
        severity: lastListenerCount > firstListenerCount + 20 ? 'high' : 'medium',
        currentValue: lastListenerCount,
        trend: 'growing',
      })
    }

    // Check resource counts
    const resourceChecks = [
      {key: 'windows', threshold: 10, name: 'Windows'},
      {key: 'daemonStateHandlers', threshold: 5, name: 'Daemon handlers'},
      {key: 'subscriptions', threshold: 50, name: 'Subscriptions'},
      {key: 'discoveryStreams', threshold: 20, name: 'Discovery streams'},
      {key: 'intervals', threshold: 5, name: 'Intervals'},
    ] as const

    for (const check of resourceChecks) {
      const firstVal = first.trackedResources[check.key]
      const lastVal = last.trackedResources[check.key]
      if (lastVal > check.threshold && lastVal > firstVal) {
        suspects.push({
          type: check.key,
          description: `${check.name} count: ${lastVal} (was ${firstVal})`,
          severity: lastVal > check.threshold * 2 ? 'high' : 'medium',
          currentValue: lastVal,
          trend: lastVal > firstVal ? 'growing' : 'stable',
        })
      }
    }

    return suspects
  }

  // Generate recommendations based on analysis
  private generateRecommendations(suspects: LeakSuspect[]): string[] {
    const recommendations: string[] = []

    for (const suspect of suspects) {
      switch (suspect.type) {
        case 'heap':
          recommendations.push(
            'Consider taking a heap snapshot to identify retained objects',
          )
          recommendations.push(
            'Check for detached DOM nodes and unreferenced closures',
          )
          break
        case 'listeners':
          recommendations.push(
            'Review event listener cleanup in component unmount/window close',
          )
          recommendations.push(
            'Check for missing removeListener calls in IPC handlers',
          )
          break
        case 'windows':
          recommendations.push(
            'Verify all windows are properly closed and removed from registry',
          )
          break
        case 'daemonStateHandlers':
          recommendations.push(
            'Check subscribeDaemonState cleanup in window close handlers',
          )
          break
        case 'subscriptions':
          recommendations.push(
            'Review subscription cleanup in app-sync.ts unsubscribe flow',
          )
          break
        case 'discoveryStreams':
          recommendations.push(
            'Consider implementing eviction policy for discovery streams',
          )
          break
        case 'intervals':
          recommendations.push(
            'Review setInterval usage - ensure all are cleared on cleanup',
          )
          break
      }
    }

    return [...new Set(recommendations)] // Dedupe
  }

  // Get full memory report
  getReport(): MemoryReport {
    const current = this.takeSnapshot()
    const leakSuspects = this.analyzeLeaks()
    const recommendations = this.generateRecommendations(leakSuspects)

    return {
      current,
      history: [...this.snapshots],
      leakSuspects,
      recommendations,
    }
  }

  // Take V8 heap snapshot and save to file
  async takeHeapSnapshot(filename?: string): Promise<string> {
    const snapshotDir = path.join(userDataPath, 'heap-snapshots')

    // Ensure directory exists
    if (!fs.existsSync(snapshotDir)) {
      fs.mkdirSync(snapshotDir, {recursive: true})
    }

    const snapshotPath = path.join(
      snapshotDir,
      filename || `heap-${Date.now()}.heapsnapshot`,
    )

    memLogger.info(`Taking heap snapshot: ${snapshotPath}`)

    // Write heap snapshot
    const snapshotStream = v8.writeHeapSnapshot(snapshotPath)

    memLogger.info(`Heap snapshot saved: ${snapshotStream}`)

    return snapshotStream || snapshotPath
  }

  // Force garbage collection (if --expose-gc flag is set)
  forceGC(): boolean {
    if (global.gc) {
      memLogger.info('Forcing garbage collection')
      global.gc()
      return true
    }
    memLogger.warn('GC not exposed. Run with --expose-gc flag')
    return false
  }

  // Get heap statistics
  getHeapStats(): v8.HeapInfo {
    return v8.getHeapStatistics()
  }

  // Get heap space details
  getHeapSpaceStats(): v8.HeapSpaceInfo[] {
    return v8.getHeapSpaceStatistics()
  }

  // Clear snapshot history
  clearHistory(): void {
    this.snapshots = []
    memLogger.info('Memory snapshot history cleared')
  }

  // Setup IPC handlers for renderer access
  private setupIpcHandlers(): void {
    ipcMain.handle('memory:getReport', () => {
      return this.getReport()
    })

    ipcMain.handle('memory:takeSnapshot', () => {
      return this.takeSnapshot()
    })

    ipcMain.handle('memory:takeHeapSnapshot', async (_, filename?: string) => {
      return this.takeHeapSnapshot(filename)
    })

    ipcMain.handle('memory:forceGC', () => {
      return this.forceGC()
    })

    ipcMain.handle('memory:getHeapStats', () => {
      return this.getHeapStats()
    })

    ipcMain.handle('memory:startTracking', (_, intervalMs?: number) => {
      this.startTracking(intervalMs)
      return true
    })

    ipcMain.handle('memory:stopTracking', () => {
      this.stopTracking()
      return true
    })

    ipcMain.handle('memory:clearHistory', () => {
      this.clearHistory()
      return true
    })

    ipcMain.handle('memory:getListenerSummary', () => {
      return this.listenerRegistry.getSummary()
    })

    ipcMain.handle('memory:getTimerSummary', () => {
      return this.timerRegistry.getSummary()
    })

    memLogger.debug('Memory monitor IPC handlers registered')
  }
}

// Singleton instance
export const memoryMonitor = new MemoryMonitor()

// Convenience exports for tracked setTimeout/setInterval
export function trackedSetTimeout(
  callback: () => void,
  ms: number,
  description?: string,
): {timeout: NodeJS.Timeout; trackId: string} {
  const timeout = setTimeout(() => {
    memoryMonitor.timerRegistry.unregister(trackId)
    callback()
  }, ms)
  const trackId = memoryMonitor.timerRegistry.registerTimer(timeout, description)
  return {timeout, trackId}
}

export function trackedSetInterval(
  callback: () => void,
  ms: number,
  description?: string,
): {interval: NodeJS.Timeout; trackId: string} {
  const interval = setInterval(callback, ms)
  const trackId = memoryMonitor.timerRegistry.registerInterval(
    interval,
    description,
  )
  return {interval, trackId}
}

export function trackedClearTimeout(trackId: string): void {
  const timers = memoryMonitor.timerRegistry.getAll()
  const entry = timers.get(trackId)
  if (entry) {
    clearTimeout(entry.id)
    memoryMonitor.timerRegistry.unregister(trackId)
  }
}

export function trackedClearInterval(trackId: string): void {
  const timers = memoryMonitor.timerRegistry.getAll()
  const entry = timers.get(trackId)
  if (entry) {
    clearInterval(entry.id)
    memoryMonitor.timerRegistry.unregister(trackId)
  }
}

// App lifecycle integration
export function setupMemoryMonitorLifecycle(): void {
  // Start tracking in development
  if (process.env.NODE_ENV !== 'production') {
    memoryMonitor.startTracking(30_000) // Every 30s in dev
  }

  // Log memory on app quit
  app.on('before-quit', () => {
    const report = memoryMonitor.getReport()
    memLogger.info('Final memory report', {
      heapUsed: Math.round(report.current.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(report.current.heapTotal / 1024 / 1024) + 'MB',
      leakSuspects: report.leakSuspects.length,
    })
    memoryMonitor.stopTracking()
  })
}

export default memoryMonitor
