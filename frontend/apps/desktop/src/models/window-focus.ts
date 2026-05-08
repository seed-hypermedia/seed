/**
 * Renderer-side window focus tracking.
 *
 * Each Electron window has its own focus state (independent of whether other
 * Seed windows are focused). When the local window loses focus we pause its
 * outbound entity subscriptions so the daemon does not keep polling discovery
 * for documents the user is not actively looking at; when the window regains
 * focus we resume them. A grace period absorbs quick focus-stealing events so
 * a brief alt-tab does not churn the daemon.
 */

const FOCUSED_AT_LOAD =
  typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : true

let windowFocused = FOCUSED_AT_LOAD

const focusListeners = new Set<(focused: boolean) => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    if (windowFocused) return
    windowFocused = true
    focusListeners.forEach((l) => l(true))
  })
  window.addEventListener('blur', () => {
    if (!windowFocused) return
    windowFocused = false
    focusListeners.forEach((l) => l(false))
  })
}

/** Returns the current focus state of this Electron renderer window. */
export function isThisWindowFocused(): boolean {
  return windowFocused
}

/**
 * Subscribes to focus transitions of this window. The handler receives `true`
 * when the window gains focus and `false` when it loses focus. Returns a
 * cleanup callback.
 */
export function onThisWindowFocusChange(handler: (focused: boolean) => void): () => void {
  focusListeners.add(handler)
  return () => {
    focusListeners.delete(handler)
  }
}
