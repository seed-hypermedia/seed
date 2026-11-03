import {IS_DESKTOP} from '@shm/shared/constants'
import {getRoutePanel} from '@shm/shared/routes'
import {useNavigate, useNavRouteOrNull} from '@shm/shared/utils/navigation'
import {createContext, useContext, useMemo, useRef, useState, type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Group, Panel} from 'react-resizable-panels'
import {AnimatedPanel, PanelSeparator, useSavedPanelLayout} from './resizable-panels'
import {useMedia} from './use-media'

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

/** Gives web desktop Activity a panel beside the complete site shell. */
export function WebActivityPanelLayout({children}: {children: ReactNode}) {
  const media = useMedia()
  if (IS_DESKTOP || media.xs) return <>{children}</>
  return (
    <ActivityPanelProvider>
      <WebActivityPanelGroup>{children}</WebActivityPanelGroup>
    </ActivityPanelProvider>
  )
}

function WebActivityPanelGroup({children}: {children: ReactNode}) {
  const saved = useSavedPanelLayout('web-activity', ['site', 'activity'])
  const route = useNavRouteOrNull()
  const navigate = useNavigate()
  const open = !!route && getRoutePanel(route)?.key === 'feed'
  const close = () => {
    if (route && 'panel' in route) navigate({...route, panel: null})
  }
  return (
    <Group
      orientation="horizontal"
      className="h-dvh max-h-full min-h-0"
      onLayoutChanged={(layout, meta) => {
        saved.onLayoutChanged(layout, meta)
        if (meta.isUserInteraction && open && layout.activity === 0) close()
      }}
    >
      <Panel id="site" minSize="50%">
        {children}
      </Panel>
      <PanelSeparator open={open} onCollapse={close} />
      <AnimatedPanel
        id="activity"
        open={open}
        minSize="250px"
        maxSize="50%"
        defaultSize={saved.expanded?.activity ? `${saved.expanded.activity}%` : '320px'}
        className="border-l"
      >
        <ActivityPanelOutlet />
      </AnimatedPanel>
    </Group>
  )
}
