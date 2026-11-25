import {BrowserWindow, WebContents} from 'electron'

const QUERY_INVALIDATION_CHANNEL = 'query_invalidation'

const PROFILE_ENABLED = process.env.SEED_SYNC_PROFILE === '1'
const INVALIDATION_LOG_ENABLED = PROFILE_ENABLED || process.env.SEED_INVALIDATION_LOG === '1'

let broadcastCount = 0
let broadcastWindowStart = Date.now()
const BROADCAST_LOG_WINDOW_MS = 60_000

export function getInvalidationTargetWindowCount(): number {
  return BrowserWindow.getAllWindows().filter((window) => {
    return !window.isDestroyed() && !window.webContents.isDestroyed()
  }).length
}

/**
 * Broadcasts a query-key invalidation to every renderer window.
 *
 * `except` skips one window: a renderer that forwarded its own invalidation
 * over IPC has already invalidated its query client, so echoing the key back
 * would make it refetch twice.
 */
export function appInvalidateQueries(queryKey: any, opts?: {except?: WebContents}) {
  if (INVALIDATION_LOG_ENABLED) {
    broadcastCount++
    const now = Date.now()
    if (now - broadcastWindowStart >= BROADCAST_LOG_WINDOW_MS) {
      const elapsedSec = (now - broadcastWindowStart) / 1000
      const rate = (broadcastCount / elapsedSec).toFixed(2)
      console.log(
        `[SyncInvalidation] invalidations: ${broadcastCount} in ${elapsedSec.toFixed(
          1,
        )}s (${rate}/s) windows=${getInvalidationTargetWindowCount()}`,
      )
      broadcastCount = 0
      broadcastWindowStart = now
    }
    const keyPrefix = Array.isArray(queryKey) ? String(queryKey[0]) : String(queryKey)
    const serializedKey = JSON.stringify(queryKey)
    console.log(
      `[SyncInvalidation] send key=${keyPrefix} queryKey=${serializedKey} windows=${getInvalidationTargetWindowCount()}`,
    )
  }
  BrowserWindow.getAllWindows().forEach((window) => {
    if (window.isDestroyed()) return
    if (window.webContents.isDestroyed()) return
    if (opts?.except && window.webContents.id === opts.except.id) return
    window.webContents.send(QUERY_INVALIDATION_CHANNEL, queryKey)
  })
}
