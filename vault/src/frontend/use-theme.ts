import {useCallback, useSyncExternalStore} from 'react'

type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'vault-theme'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage may be unavailable.
  }
  return 'system'
}

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

// Module-level state for useSyncExternalStore.
let currentTheme: Theme = getStoredTheme()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Theme {
  return currentTheme
}

/** Apply theme on load and listen for system preference changes. */
export function initTheme() {
  applyTheme(currentTheme)

  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', () => {
    if (currentTheme === 'system') {
      applyTheme('system')
    }
  })
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot)

  const setTheme = useCallback((next: Theme) => {
    currentTheme = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Ignore storage errors.
    }
    applyTheme(next)
    notify()
  }, [])

  const resolvedTheme = theme === 'system' ? getSystemTheme() : theme

  return {theme, resolvedTheme, setTheme} as const
}
