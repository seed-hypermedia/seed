import * as log from './logger'

// Connection monitoring utility
export class ConnectionMonitor {
  private static instance: ConnectionMonitor
  private pendingRequests = new Map<
    string,
    {startTime: number; method: string}
  >()
  private connectionStats = {
    totalRequests: 0,
    pendingCount: 0,
    failedCount: 0,
    avgResponseTime: 0,
  }

  static getInstance(): ConnectionMonitor {
    if (!ConnectionMonitor.instance) {
      ConnectionMonitor.instance = new ConnectionMonitor()
    }
    return ConnectionMonitor.instance
  }

  trackRequest(requestId: string, method: string) {
    this.pendingRequests.set(requestId, {
      startTime: Date.now(),
      method,
    })
    this.connectionStats.totalRequests++
    this.connectionStats.pendingCount++

    log.debug(
      `📊 Request tracking: ${method} (${requestId}) - ${this.connectionStats.pendingCount} pending`,
    )
  }

  completeRequest(requestId: string, success: boolean = true) {
    const request = this.pendingRequests.get(requestId)
    if (request) {
      const duration = Date.now() - request.startTime
      this.pendingRequests.delete(requestId)
      this.connectionStats.pendingCount--

      if (!success) {
        this.connectionStats.failedCount++
      }

      // Update average response time
      this.connectionStats.avgResponseTime =
        (this.connectionStats.avgResponseTime + duration) / 2

      log.debug(
        `📈 Request completed: ${request.method} (${requestId}) - ${duration}ms`,
      )
    }
  }

  getStats() {
    return {
      ...this.connectionStats,
      pendingRequests: Array.from(this.pendingRequests.entries()).map(
        ([id, req]) => ({
          id,
          method: req.method,
          duration: Date.now() - req.startTime,
        }),
      ),
    }
  }

  logStats() {
    const stats = this.getStats()
    log.info('📊 Connection Stats:', stats)

    // Alert on stuck requests
    if (stats.pendingRequests.some((req) => req.duration > 10000)) {
      log.warn(
        '⚠️  Stuck requests detected (>10s):',
        stats.pendingRequests.filter((req) => req.duration > 10000),
      )
    }
  }
}

// Auto-log stats every 30 seconds
setInterval(() => {
  ConnectionMonitor.getInstance().logStats()
}, 30000)

export const connectionMonitor = ConnectionMonitor.getInstance()
