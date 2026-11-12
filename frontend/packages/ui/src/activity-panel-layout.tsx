import {createContext, useContext, useMemo, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'

const ActivityPanelTarget = createContext<{
  target: HTMLDivElement | null
  setTarget: (target: HTMLDivElement | null) => void
} | null>(null)

/** Connects route-owned Activity content to an outer layout without losing its providers. */
export function ActivityPanelProvider({children}: {children: ReactNode}) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const value = useMemo(() => ({target, setTarget}), [target])
  return <ActivityPanelTarget.Provider value={value}>{children}</ActivityPanelTarget.Provider>
}

/** The outer panel's destination for the current document's Activity view. */
export function ActivityPanelOutlet() {
  const context = useContext(ActivityPanelTarget)
  return <div ref={context?.setTarget} className="bg-background flex h-full min-h-0 flex-col" />
}

/** Places Activity in the outer panel while retaining route and notification context. */
export function ActivityPanelPortal({active, children}: {active: boolean; children: ReactNode}) {
  const context = useContext(ActivityPanelTarget)
  // The outlet stays mounted through AnimatedPanel's close animation and focus restoration.
  const retained = useRef<ReactNode>(null)
  if (active) retained.current = children
  return context?.target ? createPortal(retained.current, context.target) : null
}
