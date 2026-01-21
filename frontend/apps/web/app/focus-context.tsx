import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'

export type FocusTarget = 'main' | 'panel'

interface FocusContextValue {
  focus: FocusTarget
  setFocus: (target: FocusTarget) => void
  /** Handler for click events - updates focus unless clicking interactive element */
  handleFocusClick: (target: FocusTarget, e: React.MouseEvent) => void
}

const FocusContext = createContext<FocusContextValue | null>(null)

export function FocusProvider({
  children,
  defaultFocus = 'main',
}: {
  children: ReactNode
  defaultFocus?: FocusTarget
}) {
  const [focus, setFocus] = useState<FocusTarget>(defaultFocus)

  // Sync focus state when defaultFocus changes (e.g., panel opens/closes)
  useEffect(() => {
    setFocus(defaultFocus)
  }, [defaultFocus])

  const handleFocusClick = useCallback(
    (target: FocusTarget, e: React.MouseEvent) => {
      // Don't change focus if clicking on an interactive element
      const htmlTarget = e.target as HTMLElement
      const isInteractive = htmlTarget.closest(
        'button, a, input, textarea, select, [role="button"], [data-no-focus]',
      )
      if (isInteractive) return

      if (focus !== target) {
        setFocus(target)
      }
    },
    [focus],
  )

  return (
    <FocusContext.Provider value={{focus, setFocus, handleFocusClick}}>
      {children}
    </FocusContext.Provider>
  )
}

export function useFocusContext() {
  const context = useContext(FocusContext)
  if (!context) {
    throw new Error('useFocusContext must be used within a FocusProvider')
  }
  return context
}

/** Returns focus state if inside provider, otherwise returns fallback */
export function useFocusSafe(fallback: FocusTarget = 'main'): FocusTarget {
  const context = useContext(FocusContext)
  return context?.focus ?? fallback
}
