import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {PushResourceStatus} from '@shm/ui/push-toast'

/**
 * Per-window stream of the currently running (or recently finished) push
 * triggered by publishing. The window footer renders it as a status indicator.
 */
export type ActivePushState = {
  status: 'loading' | 'success' | 'error'
  pushStatus: StateStream<PushResourceStatus | null>
  errorMessage?: string
}

const [setActivePush, activePushStream] = writeableStateStream<ActivePushState | null>(null)

/** How long a finished push stays visible in the footer. */
const SUCCESS_LINGER_MS = 5000
const ERROR_LINGER_MS = 10000

let clearTimer: ReturnType<typeof setTimeout> | null = null

export function getActivePushStream(): StateStream<ActivePushState | null> {
  return activePushStream
}

/**
 * Surface a push's lifecycle in the footer. The `pushStatus` stream keeps the
 * per-host progress current while `promise` settles; the final state lingers
 * briefly so the user can see the outcome, then clears. A new push replaces
 * whatever was showing.
 */
export function trackPushInFooter(promise: Promise<unknown>, pushStatus: StateStream<PushResourceStatus | null>) {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  setActivePush({status: 'loading', pushStatus})

  const finish = (state: ActivePushState) => {
    setActivePush(state)
    clearTimer = setTimeout(
      () => {
        // Only clear if no newer push has replaced this state.
        if (activePushStream.get() === state) setActivePush(null)
        clearTimer = null
      },
      state.status === 'error' ? ERROR_LINGER_MS : SUCCESS_LINGER_MS,
    )
  }

  promise.then(
    () => finish({status: 'success', pushStatus}),
    (err) => finish({status: 'error', pushStatus, errorMessage: err?.message}),
  )
}
