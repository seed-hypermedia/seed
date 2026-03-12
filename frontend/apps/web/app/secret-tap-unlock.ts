/**
 * Creates a tap-based secret unlock mechanism.
 * Calls `onUnlock` after `requiredTaps` taps within `windowMs` milliseconds.
 * Once unlocked, further taps are ignored.
 */
export function createSecretTapUnlock({
  requiredTaps,
  windowMs,
  onUnlock,
}: {
  requiredTaps: number
  windowMs: number
  onUnlock: () => void
}) {
  let tapCount = 0
  let timeout: ReturnType<typeof setTimeout> | null = null
  let unlocked = false

  function tap() {
    if (unlocked) return

    tapCount += 1

    if (timeout) {
      clearTimeout(timeout)
    }

    if (tapCount >= requiredTaps) {
      unlocked = true
      tapCount = 0
      timeout = null
      onUnlock()
      return
    }

    timeout = setTimeout(() => {
      tapCount = 0
      timeout = null
    }, windowMs)
  }

  function dispose() {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  return {tap, dispose}
}
