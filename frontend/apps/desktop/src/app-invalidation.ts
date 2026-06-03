import {BrowserWindow} from 'electron'

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

export function appInvalidateQueries(queryKey: any) {
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
    window.webContents.send(QUERY_INVALIDATION_CHANNEL, queryKey)
  })
}
