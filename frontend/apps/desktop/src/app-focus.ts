let focusedWindowKey: string | null = null

const focusChangeHandlers = new Set<(focused: boolean) => void>()

/** Returns true if any app window currently has focus. */
export function isAnyWindowFocused(): boolean {
  return focusedWindowKey !== null
}

/** Subscribes to app focus changes and returns a cleanup callback. */
export function onAppFocusChange(handler: (focused: boolean) => void): () => void {
  focusChangeHandlers.add(handler)
  return () => {
    focusChangeHandlers.delete(handler)
  }
}

/** Marks the given app window as focused and notifies listeners on focus entry. */
export function markAppWindowFocused(windowId: string): void {
  const wasFocused = focusedWindowKey !== null
  focusedWindowKey = windowId
  if (!wasFocused) {
    focusChangeHandlers.forEach((handler) => handler(true))
  }
}

/** Marks the given app window as blurred and notifies listeners when all windows are unfocused. */
export function markAppWindowBlurred(windowId: string): void {
  if (focusedWindowKey === windowId) {
    focusedWindowKey = null
    // Defer the "all blurred" check so focus transfers do not emit a false blur.
    setTimeout(() => {
      if (focusedWindowKey === null) {
        focusChangeHandlers.forEach((handler) => handler(false))
      }
    }, 100)
  }
}
