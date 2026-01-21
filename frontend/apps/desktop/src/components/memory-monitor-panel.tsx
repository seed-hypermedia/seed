/**
 * Memory Monitor Panel - Development tool for detecting memory leaks
 *
 * Features:
 * - Real-time heap usage display
 * - Memory snapshot history chart
 * - Leak suspect detection
 * - Heap snapshot export
 * - Listener and timer tracking
 */

import {useState, useEffect, useCallback} from 'react'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {Separator} from '@shm/ui/separator'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {cn} from '@shm/ui/utils'
import {
  Activity,
  AlertTriangle,
  Camera,
  Download,
  Play,
  Pause,
  Trash2,
  RefreshCw,
} from 'lucide-react'

// Types from memory-monitor.ts
interface MemorySnapshot {
  timestamp: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
  rss: number
  listenerCounts: Record<string, number>
  trackedResources: TrackedResources
}

interface TrackedResources {
  windows: number
  daemonStateHandlers: number
  ipcHandlers: number
  timers: number
  intervals: number
  subscriptions: number
  discoveryStreams: number
}

interface LeakSuspect {
  type: string
  description: string
  severity: 'low' | 'medium' | 'high'
  currentValue: number
  trend: 'stable' | 'growing' | 'shrinking'
}

interface MemoryReport {
  current: MemorySnapshot
  history: MemorySnapshot[]
  leakSuspects: LeakSuspect[]
  recommendations: string[]
}

interface TimerSummary {
  timers: number
  intervals: number
  details: string[]
}

// Access window.memoryMonitor from preload
declare global {
  interface Window {
    memoryMonitor?: {
      getReport: () => Promise<MemoryReport>
      takeSnapshot: () => Promise<MemorySnapshot>
      takeHeapSnapshot: (filename?: string) => Promise<string>
      forceGC: () => Promise<boolean>
      getHeapStats: () => Promise<any>
      startTracking: (intervalMs?: number) => Promise<boolean>
      stopTracking: () => Promise<boolean>
      clearHistory: () => Promise<boolean>
      getListenerSummary: () => Promise<Record<string, number>>
      getTimerSummary: () => Promise<TimerSummary>
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString()
}

function getSeverityColor(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'low':
      return 'text-yellow-600'
    case 'medium':
      return 'text-orange-600'
    case 'high':
      return 'text-red-600'
    default:
      return 'text-gray-600'
  }
}

export function MemoryMonitorPanel() {
  const [report, setReport] = useState<MemoryReport | null>(null)
  const [isTracking, setIsTracking] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [timerSummary, setTimerSummary] = useState<TimerSummary | null>(null)
  const [listenerSummary, setListenerSummary] = useState<Record<
    string,
    number
  > | null>(null)
  const [error, setError] = useState<string | null>(null)

  const memMonitor = typeof window !== 'undefined' ? window.memoryMonitor : null

  const fetchReport = useCallback(async () => {
    if (!memMonitor) {
      setError('Memory monitor not available')
      return
    }
    setIsLoading(true)
    try {
      const [newReport, timers, listeners] = await Promise.all([
        memMonitor.getReport(),
        memMonitor.getTimerSummary(),
        memMonitor.getListenerSummary(),
      ])
      setReport(newReport)
      setTimerSummary(timers)
      setListenerSummary(listeners)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch report')
    } finally {
      setIsLoading(false)
    }
  }, [memMonitor])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  // Auto-refresh when tracking
  useEffect(() => {
    if (!isTracking) return
    const interval = setInterval(fetchReport, 5000)
    return () => clearInterval(interval)
  }, [isTracking, fetchReport])

  const handleStartTracking = async () => {
    if (!memMonitor) return
    await memMonitor.startTracking(10000) // 10s interval
    setIsTracking(true)
  }

  const handleStopTracking = async () => {
    if (!memMonitor) return
    await memMonitor.stopTracking()
    setIsTracking(false)
  }

  const handleTakeHeapSnapshot = async () => {
    if (!memMonitor) return
    setIsLoading(true)
    try {
      const path = await memMonitor.takeHeapSnapshot()
      alert(`Heap snapshot saved to: ${path}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to take heap snapshot')
    } finally {
      setIsLoading(false)
    }
  }

  const handleForceGC = async () => {
    if (!memMonitor) return
    const result = await memMonitor.forceGC()
    if (!result) {
      alert('GC not available. Run app with --expose-gc flag.')
    } else {
      fetchReport()
    }
  }

  const handleClearHistory = async () => {
    if (!memMonitor) return
    await memMonitor.clearHistory()
    fetchReport()
  }

  if (!memMonitor) {
    return (
      <div className="p-4">
        <SizableText className="text-red-600">
          Memory monitor not available in this environment
        </SizableText>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            <SizableText className="font-semibold text-lg">
              Memory Monitor
            </SizableText>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchReport}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn('w-4 h-4 mr-1', isLoading && 'animate-spin')}
              />
              Refresh
            </Button>
            {isTracking ? (
              <Button variant="outline" size="sm" onClick={handleStopTracking}>
                <Pause className="w-4 h-4 mr-1" />
                Stop
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={handleStartTracking}>
                <Play className="w-4 h-4 mr-1" />
                Start Tracking
              </Button>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-red-100 dark:bg-red-900/20 rounded-md">
            <SizableText className="text-red-600">{error}</SizableText>
          </div>
        )}

        {report && (
          <>
            {/* Current Memory Stats */}
            <div className="space-y-2">
              <SizableText className="font-medium">Current Memory</SizableText>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Heap Used"
                  value={formatBytes(report.current.heapUsed)}
                />
                <StatCard
                  label="Heap Total"
                  value={formatBytes(report.current.heapTotal)}
                />
                <StatCard
                  label="External"
                  value={formatBytes(report.current.external)}
                />
                <StatCard
                  label="RSS"
                  value={formatBytes(report.current.rss)}
                />
              </div>
            </div>

            <Separator />

            {/* Resource Counts */}
            <div className="space-y-2">
              <SizableText className="font-medium">Tracked Resources</SizableText>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                  label="Windows"
                  value={report.current.trackedResources.windows.toString()}
                />
                <StatCard
                  label="Subscriptions"
                  value={report.current.trackedResources.subscriptions.toString()}
                />
                <StatCard
                  label="Discovery Streams"
                  value={report.current.trackedResources.discoveryStreams.toString()}
                />
                <StatCard
                  label="Timers"
                  value={`${timerSummary?.timers || 0} / ${timerSummary?.intervals || 0}`}
                  subtitle="timers / intervals"
                />
              </div>
            </div>

            <Separator />

            {/* Leak Suspects */}
            {report.leakSuspects.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  <SizableText className="font-medium">
                    Potential Leak Suspects ({report.leakSuspects.length})
                  </SizableText>
                </div>
                <div className="space-y-2">
                  {report.leakSuspects.map((suspect, i) => (
                    <div
                      key={i}
                      className="p-3 bg-gray-100 dark:bg-gray-800 rounded-md"
                    >
                      <div className="flex items-center justify-between">
                        <SizableText
                          className={cn('font-medium', getSeverityColor(suspect.severity))}
                        >
                          {suspect.type.toUpperCase()}
                        </SizableText>
                        <span
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            suspect.severity === 'high'
                              ? 'bg-red-200 text-red-800'
                              : suspect.severity === 'medium'
                                ? 'bg-orange-200 text-orange-800'
                                : 'bg-yellow-200 text-yellow-800',
                          )}
                        >
                          {suspect.severity}
                        </span>
                      </div>
                      <SizableText className="text-sm text-gray-600 dark:text-gray-400">
                        {suspect.description}
                      </SizableText>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {report.recommendations.length > 0 && (
              <div className="space-y-2">
                <SizableText className="font-medium">Recommendations</SizableText>
                <ul className="list-disc list-inside space-y-1">
                  {report.recommendations.map((rec, i) => (
                    <li key={i}>
                      <SizableText className="text-sm text-gray-600 dark:text-gray-400">
                        {rec}
                      </SizableText>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Separator />

            {/* Listener Summary */}
            {listenerSummary && Object.keys(listenerSummary).length > 0 && (
              <div className="space-y-2">
                <SizableText className="font-medium">
                  Event Listeners ({Object.keys(listenerSummary).length})
                </SizableText>
                <div className="max-h-40 overflow-y-auto">
                  <div className="space-y-1">
                    {Object.entries(listenerSummary).map(([key, count]) => (
                      <div
                        key={key}
                        className="flex justify-between text-sm font-mono"
                      >
                        <span className="text-gray-600 dark:text-gray-400 truncate max-w-[200px]">
                          {key}
                        </span>
                        <span className={count > 3 ? 'text-red-600' : ''}>
                          {count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <Separator />

            {/* Memory History Chart (simple text-based) */}
            {report.history.length > 1 && (
              <div className="space-y-2">
                <SizableText className="font-medium">
                  Memory History ({report.history.length} snapshots)
                </SizableText>
                <div className="max-h-40 overflow-y-auto text-xs font-mono">
                  {report.history.slice(-10).map((snapshot, i) => (
                    <div key={i} className="flex gap-4">
                      <span className="text-gray-500">
                        {formatTime(snapshot.timestamp)}
                      </span>
                      <span>Heap: {formatBytes(snapshot.heapUsed)}</span>
                      <span>RSS: {formatBytes(snapshot.rss)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Actions */}
            <div className="space-y-2">
              <SizableText className="font-medium">Actions</SizableText>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTakeHeapSnapshot}
                  disabled={isLoading}
                >
                  <Camera className="w-4 h-4 mr-1" />
                  Take Heap Snapshot
                </Button>
                <Button variant="outline" size="sm" onClick={handleForceGC}>
                  <Trash2 className="w-4 h-4 mr-1" />
                  Force GC
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearHistory}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear History
                </Button>
              </div>
              <SizableText className="text-xs text-gray-500">
                Heap snapshots are saved to ~/Library/Application
                Support/Seed/heap-snapshots/ Open in Chrome DevTools for analysis.
              </SizableText>
            </div>
          </>
        )}
      </div>
    </ScrollArea>
  )
}

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string
  value: string
  subtitle?: string
}) {
  return (
    <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-md">
      <SizableText className="text-xs text-gray-500">{label}</SizableText>
      <SizableText className="font-mono font-medium">{value}</SizableText>
      {subtitle && (
        <SizableText className="text-xs text-gray-400">{subtitle}</SizableText>
      )}
    </div>
  )
}

export default MemoryMonitorPanel
