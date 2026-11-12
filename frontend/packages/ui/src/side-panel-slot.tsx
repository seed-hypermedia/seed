import {Fragment, useEffect, useRef, type ReactNode} from 'react'
import {cn} from './utils'

/** A panel that can take the shared side panel. */
export type SidePanelEntry = {
  /** The panel wants the slot. */
  open: boolean
  /** Closes the panel. Only called while `open` is true. */
  close: () => void
  /** Open only because an earlier visit left it open: it never takes the slot from another open panel, and gives the slot up to one. */
  restored?: boolean
}

/** Keeps several panels in one side panel: whichever opens last closes the others. Returns the key of the panel shown now, or null. */
export function useSidePanelSlot<K extends string>(panels: ReadonlyArray<readonly [K, SidePanelEntry]>): K | null {
  // Panels open at the first render count as opening, so a restored Activity route beats a
  // restored assistant at launch — the first in the array wins.
  const previous = useRef<Record<K, boolean> | null>(null)
  useEffect(() => {
    const was = previous.current ?? ({} as Record<K, boolean>)
    const next = {} as Record<K, boolean>
    for (const [key, panel] of panels) next[key] = panel.open
    previous.current = next
    const opened = panels.find(([key, panel]) => panel.open && !panel.restored && !was[key])
    const holder = opened ?? panels.find(([, panel]) => panel.open && !panel.restored)
    if (!holder) return
    for (const [key, panel] of panels) {
      // The `opened || panel.restored` guard: when close() resolves asynchronously (a route
      // navigation) the panel stays open for another render, which must not close the panel
      // that just opened. A restored panel, though, always gives the slot up.
      if (key !== holder[0] && panel.open && (opened || panel.restored)) panel.close()
    }
  })
  const shown = panels.find(([, panel]) => panel.open && !panel.restored) ?? panels.find(([, panel]) => panel.open)
  return shown ? shown[0] : null
}

/** Body of the shared side panel. */
export function SidePanelSlotContent<K extends string>({
  active,
  panels,
}: {
  /** The panel holding the slot (from useSidePanelSlot), or null while the slot is closed. */
  active: K | null
  /** How each panel renders. A keepMounted panel stays mounted (hidden) once shown, so e.g. an open chat survives switching to Activity. */
  panels: Record<K, {render: () => ReactNode; keepMounted?: boolean}>
}) {
  // While the slot animates closed it keeps showing whatever was last in it.
  const lastActive = useRef<K | null>(active)
  if (active) lastActive.current = active
  const shown = active ?? lastActive.current
  const mounted = useRef(new Set<K>())
  if (shown) mounted.current.add(shown)
  return (
    <>
      {(Object.keys(panels) as K[]).map((key) => {
        const panel = panels[key]
        if (panel.keepMounted) {
          if (!mounted.current.has(key)) return null
          return (
            <div key={key} className={cn('h-full min-h-0', shown !== key && 'hidden')}>
              {panel.render()}
            </div>
          )
        }
        return shown === key ? <Fragment key={key}>{panel.render()}</Fragment> : null
      })}
    </>
  )
}
