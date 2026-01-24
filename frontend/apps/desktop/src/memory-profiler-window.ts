/**
 * Memory Profiler Window
 *
 * A dedicated window for real-time memory leak detection during manual testing.
 * Run with: MEMORY_PROFILER=1 yarn desktop
 *
 * Features:
 * - Real-time heap and resource tracking
 * - Event log of window/subscription changes
 * - Final report on app quit
 * - Export to JSON/HTML
 */

import {BrowserWindow, app, ipcMain} from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import {memoryMonitor, MemorySnapshot, MemoryReport} from './memory-monitor'
import {userDataPath} from './app-paths'
import * as logger from './logger'

let profilerWindow: BrowserWindow | null = null
let updateInterval: NodeJS.Timeout | null = null
let eventLog: ProfilerEvent[] = []
let startTime: number = 0

interface ProfilerEvent {
  timestamp: number
  type: 'window_open' | 'window_close' | 'subscription_change' | 'memory_warning' | 'gc' | 'snapshot'
  details: string
}

export function isProfilerEnabled(): boolean {
  return process.env.MEMORY_PROFILER === '1' || process.argv.includes('--memory-profiler')
}

export function createProfilerWindow(): BrowserWindow | null {
  if (!isProfilerEnabled()) return null
  if (profilerWindow) return profilerWindow

  startTime = Date.now()
  logger.info('[PROFILER] Starting memory profiler window')

  profilerWindow = new BrowserWindow({
    width: 500,
    height: 700,
    x: 50,
    y: 50,
    title: 'Memory Profiler',
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-profiler.js'),
    },
  })

  // Load profiler HTML
  profilerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getProfilerHTML())}`)

  profilerWindow.on('closed', () => {
    profilerWindow = null
    if (updateInterval) {
      clearInterval(updateInterval)
      updateInterval = null
    }
  })

  // Start tracking
  memoryMonitor.startTracking(2000) // 2s intervals for profiler

  // Update profiler window every 2 seconds
  updateInterval = setInterval(() => {
    sendUpdate()
  }, 2000)

  // Initial update
  setTimeout(sendUpdate, 500)

  setupProfilerIPC()

  return profilerWindow
}

function setupProfilerIPC() {
  ipcMain.handle('profiler:getState', () => {
    const report = memoryMonitor.getReport()
    return {
      report,
      eventLog,
      startTime,
      uptime: Date.now() - startTime,
    }
  })

  ipcMain.handle('profiler:takeSnapshot', async () => {
    const path = await memoryMonitor.takeHeapSnapshot()
    logEvent('snapshot', `Heap snapshot saved: ${path}`)
    return path
  })

  ipcMain.handle('profiler:forceGC', () => {
    const result = memoryMonitor.forceGC()
    if (result) logEvent('gc', 'Forced garbage collection')
    return result
  })

  ipcMain.handle('profiler:exportReport', async () => {
    return exportFinalReport()
  })
}

function sendUpdate() {
  if (!profilerWindow || profilerWindow.isDestroyed()) return

  const report = memoryMonitor.getReport()

  // Check for memory warnings
  if (report.leakSuspects.length > 0) {
    const highSeverity = report.leakSuspects.filter(s => s.severity === 'high')
    if (highSeverity.length > 0) {
      logEvent('memory_warning', `High severity leak suspects: ${highSeverity.map(s => s.type).join(', ')}`)
    }
  }

  profilerWindow.webContents.send('profiler:update', {
    report,
    eventLog: eventLog.slice(-50), // Last 50 events
    uptime: Date.now() - startTime,
  })
}

export function logEvent(type: ProfilerEvent['type'], details: string) {
  const event: ProfilerEvent = {
    timestamp: Date.now(),
    type,
    details,
  }
  eventLog.push(event)

  // Keep last 500 events
  if (eventLog.length > 500) {
    eventLog = eventLog.slice(-500)
  }

  // Send to profiler window if open
  if (profilerWindow && !profilerWindow.isDestroyed()) {
    profilerWindow.webContents.send('profiler:event', event)
  }
}

export function logWindowOpen(windowId: string) {
  logEvent('window_open', `Window opened: ${windowId}`)
}

export function logWindowClose(windowId: string) {
  logEvent('window_close', `Window closed: ${windowId}`)
}

export function logSubscriptionChange(count: number, delta: number) {
  logEvent('subscription_change', `Subscriptions: ${count} (${delta >= 0 ? '+' : ''}${delta})`)
}

export async function exportFinalReport(): Promise<string> {
  const report = memoryMonitor.getReport()
  const reportDir = path.join(userDataPath, 'memory-reports')

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, {recursive: true})
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const jsonPath = path.join(reportDir, `memory-report-${timestamp}.json`)
  const htmlPath = path.join(reportDir, `memory-report-${timestamp}.html`)

  const fullReport = {
    generatedAt: new Date().toISOString(),
    uptime: Date.now() - startTime,
    uptimeFormatted: formatUptime(Date.now() - startTime),
    report,
    eventLog,
    summary: generateSummary(report),
  }

  // Save JSON
  fs.writeFileSync(jsonPath, JSON.stringify(fullReport, null, 2))

  // Save HTML
  fs.writeFileSync(htmlPath, generateHTMLReport(fullReport))

  logger.info(`[PROFILER] Report saved to: ${htmlPath}`)

  return htmlPath
}

function generateSummary(report: MemoryReport): object {
  const history = report.history
  if (history.length < 2) {
    return {status: 'Insufficient data'}
  }

  const first = history[0]
  const last = history[history.length - 1]

  const heapGrowth = last.heapUsed - first.heapUsed
  const heapGrowthPercent = ((heapGrowth / first.heapUsed) * 100).toFixed(1)

  return {
    status: report.leakSuspects.length > 0 ? 'POTENTIAL LEAKS DETECTED' : 'OK',
    duration: formatUptime(last.timestamp - first.timestamp),
    snapshots: history.length,
    heapStart: formatBytes(first.heapUsed),
    heapEnd: formatBytes(last.heapUsed),
    heapGrowth: `${formatBytes(Math.abs(heapGrowth))} (${heapGrowth >= 0 ? '+' : ''}${heapGrowthPercent}%)`,
    leakSuspects: report.leakSuspects.length,
    recommendations: report.recommendations.length,
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

function generateHTMLReport(data: any): string {
  const {report, eventLog, summary} = data

  return `<!DOCTYPE html>
<html>
<head>
  <title>Memory Report - ${data.generatedAt}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #1a1a2e; color: #eee; }
    h1, h2, h3 { color: #00d9ff; }
    .summary { background: #16213e; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .stat { background: #0f3460; padding: 15px; border-radius: 6px; }
    .stat-label { font-size: 12px; color: #888; text-transform: uppercase; }
    .stat-value { font-size: 24px; font-weight: bold; margin-top: 5px; }
    .warning { color: #ff6b6b; }
    .ok { color: #51cf66; }
    .suspect { background: #2d1b1b; border-left: 4px solid #ff6b6b; padding: 10px; margin: 10px 0; border-radius: 4px; }
    .suspect.high { border-color: #ff0000; }
    .suspect.medium { border-color: #ff9500; }
    .suspect.low { border-color: #ffcc00; }
    .event-log { max-height: 400px; overflow-y: auto; background: #0a0a15; padding: 10px; border-radius: 6px; font-family: monospace; font-size: 12px; }
    .event { padding: 4px 0; border-bottom: 1px solid #222; }
    .event-time { color: #666; }
    .event-type { padding: 2px 6px; border-radius: 3px; font-size: 10px; margin: 0 8px; }
    .event-type.window_open { background: #1e5128; }
    .event-type.window_close { background: #5c2626; }
    .event-type.memory_warning { background: #6b3a00; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #333; }
    th { background: #16213e; }
  </style>
</head>
<body>
  <h1>Memory Profiler Report</h1>
  <p>Generated: ${data.generatedAt} | Session Duration: ${data.uptimeFormatted}</p>

  <div class="summary">
    <h2>Summary</h2>
    <div class="summary-grid">
      <div class="stat">
        <div class="stat-label">Status</div>
        <div class="stat-value ${summary.status === 'OK' ? 'ok' : 'warning'}">${summary.status}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Heap Start</div>
        <div class="stat-value">${summary.heapStart}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Heap End</div>
        <div class="stat-value">${summary.heapEnd}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Heap Growth</div>
        <div class="stat-value">${summary.heapGrowth}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Snapshots</div>
        <div class="stat-value">${summary.snapshots}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Leak Suspects</div>
        <div class="stat-value ${summary.leakSuspects > 0 ? 'warning' : 'ok'}">${summary.leakSuspects}</div>
      </div>
    </div>
  </div>

  ${report.leakSuspects.length > 0 ? `
  <h2>Leak Suspects</h2>
  ${report.leakSuspects.map((s: any) => `
    <div class="suspect ${s.severity}">
      <strong>${s.type}</strong> (${s.severity}) - ${s.description}
    </div>
  `).join('')}
  ` : ''}

  ${report.recommendations.length > 0 ? `
  <h2>Recommendations</h2>
  <ul>
    ${report.recommendations.map((r: string) => `<li>${r}</li>`).join('')}
  </ul>
  ` : ''}

  <h2>Memory History</h2>
  <table>
    <tr><th>Time</th><th>Heap Used</th><th>Heap Total</th><th>RSS</th><th>Windows</th><th>Subscriptions</th></tr>
    ${report.history.slice(-20).map((s: any) => `
      <tr>
        <td>${new Date(s.timestamp).toLocaleTimeString()}</td>
        <td>${formatBytes(s.heapUsed)}</td>
        <td>${formatBytes(s.heapTotal)}</td>
        <td>${formatBytes(s.rss)}</td>
        <td>${s.trackedResources.windows}</td>
        <td>${s.trackedResources.subscriptions}</td>
      </tr>
    `).join('')}
  </table>

  <h2>Event Log (Last 50)</h2>
  <div class="event-log">
    ${eventLog.slice(-50).reverse().map((e: any) => `
      <div class="event">
        <span class="event-time">${new Date(e.timestamp).toLocaleTimeString()}</span>
        <span class="event-type ${e.type}">${e.type}</span>
        ${e.details}
      </div>
    `).join('')}
  </div>
</body>
</html>`
}

function getProfilerHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Memory Profiler</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; padding: 15px; font-size: 13px; }
    h2 { font-size: 14px; color: #00d9ff; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1px solid #333; }
    .section { margin-bottom: 20px; }
    .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .stat { background: #16213e; padding: 10px; border-radius: 6px; }
    .stat-label { font-size: 10px; color: #888; text-transform: uppercase; }
    .stat-value { font-size: 18px; font-weight: bold; margin-top: 3px; }
    .stat-value.warning { color: #ff6b6b; }
    .stat-value.ok { color: #51cf66; }
    .suspects { max-height: 120px; overflow-y: auto; }
    .suspect { background: #2d1b1b; border-left: 3px solid #ff6b6b; padding: 6px 10px; margin: 5px 0; border-radius: 3px; font-size: 11px; }
    .event-log { max-height: 150px; overflow-y: auto; background: #0a0a15; padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; }
    .event { padding: 3px 0; border-bottom: 1px solid #222; }
    .event-time { color: #666; font-size: 10px; }
    .event-type { font-size: 9px; padding: 1px 4px; border-radius: 2px; margin: 0 5px; }
    .event-type.window_open { background: #1e5128; }
    .event-type.window_close { background: #5c2626; }
    .event-type.memory_warning { background: #6b3a00; }
    .event-type.snapshot { background: #1e3a5f; }
    .event-type.gc { background: #3d1e5f; }
    .buttons { display: flex; gap: 8px; flex-wrap: wrap; }
    button { background: #0f3460; border: none; color: #eee; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; }
    button:hover { background: #1a4a80; }
    button:active { background: #0a2a45; }
    .uptime { text-align: center; color: #666; font-size: 11px; margin-bottom: 10px; }
    #status { text-align: center; padding: 8px; border-radius: 4px; margin-bottom: 15px; font-weight: bold; }
    #status.ok { background: #1e5128; }
    #status.warning { background: #6b3a00; }
    #status.error { background: #5c2626; }
  </style>
</head>
<body>
  <div id="status" class="ok">Monitoring...</div>
  <div class="uptime" id="uptime">Uptime: 0s</div>

  <div class="section">
    <h2>Memory</h2>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">Heap Used</div>
        <div class="stat-value" id="heapUsed">-</div>
      </div>
      <div class="stat">
        <div class="stat-label">Heap Total</div>
        <div class="stat-value" id="heapTotal">-</div>
      </div>
      <div class="stat">
        <div class="stat-label">RSS</div>
        <div class="stat-value" id="rss">-</div>
      </div>
      <div class="stat">
        <div class="stat-label">External</div>
        <div class="stat-value" id="external">-</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Resources</h2>
    <div class="stats-grid">
      <div class="stat">
        <div class="stat-label">Windows</div>
        <div class="stat-value" id="windows">-</div>
      </div>
      <div class="stat">
        <div class="stat-label">Subscriptions</div>
        <div class="stat-value" id="subscriptions">-</div>
      </div>
      <div class="stat">
        <div class="stat-label">Discovery Streams</div>
        <div class="stat-value" id="discoveryStreams">-</div>
      </div>
      <div class="stat">
        <div class="stat-label">Timers/Intervals</div>
        <div class="stat-value" id="timers">-</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Leak Suspects (<span id="suspectCount">0</span>)</h2>
    <div class="suspects" id="suspects">
      <div style="color: #51cf66; padding: 10px;">No leaks detected</div>
    </div>
  </div>

  <div class="section">
    <h2>Event Log</h2>
    <div class="event-log" id="eventLog"></div>
  </div>

  <div class="section">
    <h2>Actions</h2>
    <div class="buttons">
      <button onclick="takeSnapshot()">📷 Heap Snapshot</button>
      <button onclick="forceGC()">🗑️ Force GC</button>
      <button onclick="exportReport()">📄 Export Report</button>
    </div>
  </div>

  <script>
    const {ipcRenderer} = require('electron')

    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1024 / 1024).toFixed(1) + ' MB'
    }

    function formatUptime(ms) {
      const s = Math.floor(ms / 1000)
      const m = Math.floor(s / 60)
      const h = Math.floor(m / 60)
      if (h > 0) return h + 'h ' + (m % 60) + 'm ' + (s % 60) + 's'
      if (m > 0) return m + 'm ' + (s % 60) + 's'
      return s + 's'
    }

    function updateUI(data) {
      const {report, eventLog, uptime} = data
      const current = report.current

      document.getElementById('uptime').textContent = 'Uptime: ' + formatUptime(uptime)
      document.getElementById('heapUsed').textContent = formatBytes(current.heapUsed)
      document.getElementById('heapTotal').textContent = formatBytes(current.heapTotal)
      document.getElementById('rss').textContent = formatBytes(current.rss)
      document.getElementById('external').textContent = formatBytes(current.external)

      document.getElementById('windows').textContent = current.trackedResources.windows
      document.getElementById('subscriptions').textContent = current.trackedResources.subscriptions
      document.getElementById('discoveryStreams').textContent = current.trackedResources.discoveryStreams
      document.getElementById('timers').textContent = current.trackedResources.timers + ' / ' + current.trackedResources.intervals

      // Update status
      const status = document.getElementById('status')
      if (report.leakSuspects.length > 0) {
        const hasHigh = report.leakSuspects.some(s => s.severity === 'high')
        status.className = hasHigh ? 'error' : 'warning'
        status.textContent = '⚠️ ' + report.leakSuspects.length + ' potential leak(s) detected'
      } else {
        status.className = 'ok'
        status.textContent = '✓ No leaks detected'
      }

      // Update suspects
      document.getElementById('suspectCount').textContent = report.leakSuspects.length
      const suspectsEl = document.getElementById('suspects')
      if (report.leakSuspects.length > 0) {
        suspectsEl.innerHTML = report.leakSuspects.map(s =>
          '<div class="suspect"><strong>' + s.type + '</strong> (' + s.severity + ') - ' + s.description + '</div>'
        ).join('')
      } else {
        suspectsEl.innerHTML = '<div style="color: #51cf66; padding: 10px;">No leaks detected</div>'
      }

      // Update event log
      const logEl = document.getElementById('eventLog')
      logEl.innerHTML = eventLog.slice().reverse().map(e =>
        '<div class="event"><span class="event-time">' + new Date(e.timestamp).toLocaleTimeString() + '</span>' +
        '<span class="event-type ' + e.type + '">' + e.type + '</span>' + e.details + '</div>'
      ).join('')
    }

    ipcRenderer.on('profiler:update', (event, data) => updateUI(data))

    ipcRenderer.on('profiler:event', (event, e) => {
      const logEl = document.getElementById('eventLog')
      const html = '<div class="event"><span class="event-time">' + new Date(e.timestamp).toLocaleTimeString() + '</span>' +
        '<span class="event-type ' + e.type + '">' + e.type + '</span>' + e.details + '</div>'
      logEl.innerHTML = html + logEl.innerHTML
    })

    async function takeSnapshot() {
      const path = await ipcRenderer.invoke('profiler:takeSnapshot')
      alert('Snapshot saved to:\\n' + path)
    }

    async function forceGC() {
      const result = await ipcRenderer.invoke('profiler:forceGC')
      if (!result) alert('GC not available. Run with --expose-gc flag.')
    }

    async function exportReport() {
      const path = await ipcRenderer.invoke('profiler:exportReport')
      alert('Report saved to:\\n' + path)
    }

    // Initial load
    ipcRenderer.invoke('profiler:getState').then(updateUI)
  </script>
</body>
</html>`
}

// Export final report on app quit
export function setupProfilerQuitHandler() {
  if (!isProfilerEnabled()) return

  app.on('before-quit', async (event) => {
    if (eventLog.length > 0) {
      try {
        const reportPath = await exportFinalReport()
        logger.info(`[PROFILER] Final report: ${reportPath}`)

        // Show dialog with report location
        const {dialog, shell} = require('electron')
        const result = await dialog.showMessageBox({
          type: 'info',
          title: 'Memory Profiler Report',
          message: 'Session report saved',
          detail: `Report saved to:\n${reportPath}`,
          buttons: ['Open Report', 'Open Folder', 'Close'],
        })

        if (result.response === 0) {
          shell.openPath(reportPath)
        } else if (result.response === 1) {
          shell.openPath(path.dirname(reportPath))
        }
      } catch (e) {
        logger.error('[PROFILER] Failed to save final report', e)
      }
    }
  })
}
