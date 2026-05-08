import {observable} from '@trpc/server/observable'
import {t} from './app-trpc'

const invalidationHandlers = new Set<(queryKey: any) => void>()
const accountInvalidationHandlers = new Set<(uid: string) => void>()

const PROFILE_ENABLED = process.env.SEED_SYNC_PROFILE === '1'

let broadcastCount = 0
let broadcastWindowStart = Date.now()
const BROADCAST_LOG_WINDOW_MS = 60_000

export function getInvalidationHandlerCount(): number {
  return invalidationHandlers.size
}

export function appInvalidateQueries(queryKey: any) {
  if (PROFILE_ENABLED) {
    broadcastCount++
    const now = Date.now()
    if (now - broadcastWindowStart >= BROADCAST_LOG_WINDOW_MS) {
      const elapsedSec = (now - broadcastWindowStart) / 1000
      const rate = (broadcastCount / elapsedSec).toFixed(2)
      console.log(
        `[SyncProfile] invalidations: ${broadcastCount} in ${elapsedSec.toFixed(1)}s (${rate}/s) handlers=${
          invalidationHandlers.size
        }`,
      )
      broadcastCount = 0
      broadcastWindowStart = now
    }
    const keyPrefix = Array.isArray(queryKey) ? String(queryKey[0]) : String(queryKey)
    console.log(`[SyncProfile] invalidate key=${keyPrefix} handlers=${invalidationHandlers.size}`)
  }
  invalidationHandlers.forEach((handler) => handler(queryKey))
}

export const queryInvalidation = t.procedure.subscription(() => {
  return observable((emit) => {
    function handler(value: unknown[]) {
      emit.next(value)
    }
    invalidationHandlers.add(handler)
    return () => {
      invalidationHandlers.delete(handler)
    }
  })
})

/**
 * Trigger a targeted account-and-aliases invalidation across every renderer.
 * Each renderer's `accountInvalidation` subscriber receives the uid and runs
 * the local cache scan, so accounts aliased to `uid` get refreshed even if
 * different windows have different cached aliases.
 */
export function appInvalidateAccountAndAliases(uid: string) {
  accountInvalidationHandlers.forEach((handler) => handler(uid))
}

export const accountInvalidation = t.procedure.subscription(() => {
  return observable<string>((emit) => {
    function handler(uid: string) {
      emit.next(uid)
    }
    accountInvalidationHandlers.add(handler)
    return () => {
      accountInvalidationHandlers.delete(handler)
    }
  })
})
