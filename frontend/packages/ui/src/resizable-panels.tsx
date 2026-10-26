import {useEffect, useRef, useState, type ReactNode} from 'react'
import {
  Panel,
  Separator,
  type GroupProps,
  type Layout,
  type PanelImperativeHandle,
  type PanelProps,
} from 'react-resizable-panels'
import './resizable-panels.css'

type SavedLayout = {version: 1; layout: Layout; expanded: Layout}
type LayoutStorage = {getItem: (key: string) => string | null; setItem: (key: string, value: string) => void}

/** Reads application layouts or converts v2 percentage arrays in their original DOM order. */
export function readPanelLayout(raw: string | null, ids: string[], generatedIds = false): SavedLayout | undefined {
  try {
    const data = JSON.parse(raw || 'null')
    if (!data || typeof data !== 'object') return
    let layout: Layout
    let expanded: Layout = {}
    if ('version' in data) {
      if (data.version !== 1 || !data.layout || typeof data.layout !== 'object') return
      layout = data.layout
      expanded = data.expanded || {}
    } else {
      const key = [...ids].sort().join(',')
      const entry = data[key] ?? (generatedIds && Object.keys(data).length === 1 ? Object.values(data)[0] : undefined)
      if (!entry || !Array.isArray(entry.layout) || entry.layout.length !== ids.length) return
      layout = Object.fromEntries(ids.map((id, index) => [id, entry.layout[index]]))
      expanded = entry.expandToSizes || {}
    }
    if (
      Object.keys(layout).length !== ids.length ||
      !ids.every((id) => Number.isFinite(layout[id]) && layout[id]! >= 0 && layout[id]! <= 100)
    )
      return
    if (Math.abs(ids.reduce((sum, id) => sum + layout[id]!, 0) - 100) > 0.01) return
    return {
      version: 1,
      layout,
      expanded: Object.fromEntries(
        ids.flatMap((id) => {
          const size = layout[id]! > 0 ? layout[id] : expanded[id]
          return typeof size === 'number' && Number.isFinite(size) && size > 0 && size <= 100 ? [[id, size]] : []
        }),
      ),
    }
  } catch {
    return
  }
}

/** Records logical percentages, retaining the last nonzero size for reopening. */
export function updatePanelLayout(previous: SavedLayout | undefined, layout: Layout): SavedLayout {
  return {
    version: 1,
    layout,
    expanded: {...previous?.expanded, ...Object.fromEntries(Object.entries(layout).filter(([, size]) => size > 0))},
  }
}

/** Persists committed user resizes, with an explicit migration from v2 autoSaveId storage. */
export function useSavedPanelLayout(id: string, ids: string[], storage?: LayoutStorage, generatedIds = false) {
  const key = `seed.panel-layout.v1:${id}`
  const [saved] = useState(() => {
    try {
      const target = storage ?? window.localStorage
      return (
        readPanelLayout(target.getItem(key), ids) ??
        readPanelLayout(target.getItem(`react-resizable-panels:${id}`), ids, generatedIds)
      )
    } catch {
      return undefined
    }
  })
  const current = useRef(saved)
  const onLayoutChanged: NonNullable<GroupProps['onLayoutChanged']> = (layout, meta) => {
    // onResize observes the animated DOM and would save intermediate sizes. The group
    // callback supplies logical percentages; requestedLayout also survives window constraints.
    if (!meta.isUserInteraction) return
    current.current = updatePanelLayout(current.current, meta.requestedLayout ?? layout)
    try {
      ;(storage ?? window.localStorage).setItem(key, JSON.stringify(current.current))
    } catch {
      // Resizing still works when storage is unavailable.
    }
  }
  return {defaultLayout: saved?.layout, expanded: saved?.expanded, onLayoutChanged}
}

const transitions = new WeakMap<HTMLElement, {cancel: (settle: boolean) => void}>()

/**
 * App-owned motion for explicit open/close actions, not a library animation API.
 * Only direct sizing siblings transition; nested groups keep their own lifecycle.
 * v4 DOM and sizing contracts: https://react-resizable-panels.vercel.app/
 */
export function transitionPanel(
  group: HTMLElement,
  change: () => void,
  complete: () => void,
  property: 'flex-grow' | 'width' = 'flex-grow',
) {
  transitions.get(group)?.cancel(false)
  const view = group.ownerDocument.defaultView!
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)')
  let active = true
  let frame = 0
  let observer: ResizeObserver | undefined
  const finish = (settle: boolean) => {
    if (!active) return
    active = false
    view.cancelAnimationFrame(frame)
    view.removeEventListener('pointerdown', interruptPointer, true)
    group.removeEventListener('keydown', interruptKey, true)
    view.removeEventListener('resize', interrupt)
    reduced?.removeEventListener('change', interrupt)
    observer?.disconnect()
    if (settle) {
      delete group.dataset.panelMotion
      transitions.delete(group)
      complete()
    }
  }
  const interrupt = () => finish(true)
  const interruptKey = (event: KeyboardEvent) => {
    if ((event.target as Element).closest('[data-separator]')) interrupt()
  }
  const interruptPointer = (event: PointerEvent) => {
    const target = event.target as Element
    if (!group.contains(target)) return
    const panel = target.closest('[data-panel]')
    const rect = panel?.getBoundingClientRect()
    if (
      target.closest('[data-separator]') ||
      (rect && (Math.abs(event.clientX - rect.left) <= 10 || Math.abs(event.clientX - rect.right) <= 10))
    )
      interrupt()
  }
  transitions.set(group, {cancel: finish})
  if (!reduced?.matches) group.dataset.panelMotion = property
  // Establish the starting style before React commits the new flex-grow values.
  group.getBoundingClientRect()
  change()
  view.addEventListener('pointerdown', interruptPointer, true)
  group.addEventListener('keydown', interruptKey, true)
  view.addEventListener('resize', interrupt)
  reduced?.addEventListener('change', interrupt)
  if (typeof ResizeObserver !== 'undefined') {
    const initialWidth = group.getBoundingClientRect().width
    observer = new ResizeObserver(([entry]) => {
      if (entry && Math.abs(group.getBoundingClientRect().width - initialWidth) > 1) interrupt()
    })
    observer.observe(group)
  }
  frame = view.requestAnimationFrame(() => {
    const animations =
      group.getAnimations?.({subtree: true}).filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target
        return (
          target instanceof Element &&
          target.parentElement === group &&
          target.hasAttribute(property === 'width' ? 'data-panel-width' : 'data-panel') &&
          'transitionProperty' in animation &&
          animation.transitionProperty === property
        )
      }) ?? []
    // The finished promises settle for both completion and cancellation, including
    // reduced motion and a toggle that does not change any constrained size.
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (active) finish(true)
    })
  })
  return () => finish(true)
}

/** Controlled collapsible panel with a stable shell and focus-safe retained content. */
export function AnimatedPanel({
  open,
  children,
  defaultSize,
  openSize,
  keepMounted = false,
  animate = true,
  ...props
}: Omit<PanelProps, 'panelRef' | 'elementRef' | 'collapsible'> & {
  open: boolean
  /** Optional opening constraint; dragging still uses the Panel min/max sizes. */
  openSize?: number | string
  keepMounted?: boolean
  animate?: boolean
}) {
  const panelRef = useRef<PanelImperativeHandle>(null)
  const elementRef = useRef<HTMLDivElement>(null)
  const previousOpen = useRef(open)
  const initialSize = useRef(open ? defaultSize : '0%')
  const rememberedSize = useRef(defaultSize)
  const hasOpened = useRef(open)
  const retained = useRef<ReactNode>(open ? children : null)
  const [closing, setClosing] = useState(false)
  const cancel = useRef<(() => void) | undefined>(undefined)
  const returnFocus = useRef<HTMLElement | null>(null)
  if (open) retained.current = children

  useEffect(() => {
    const element = elementRef.current
    const panel = panelRef.current
    if (!element || !panel) return
    const group = element.parentElement!
    if (!open && element.contains(element.ownerDocument.activeElement)) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus()
      else {
        group.tabIndex = -1
        group.focus({preventScroll: true})
      }
    }
    element.inert = !open
    if (!hasOpened.current) rememberedSize.current = defaultSize
    if (previousOpen.current === open) return
    previousOpen.current = open
    if (open) {
      hasOpened.current = true
      returnFocus.current = element.ownerDocument.activeElement as HTMLElement
    } else {
      const size = panel.getSize().asPercentage
      // getSize can observe an intermediate animated width. The group layout is
      // authoritative; the inline flex-grow is its current target percentage.
      const target = Number(element.style.flexGrow)
      if (target > 0) rememberedSize.current = `${target}%`
      else if (size > 0) rememberedSize.current = `${size}%`
      setClosing(true)
    }
    const change = () => {
      if (open) panel.resize(openSize ?? rememberedSize.current ?? defaultSize ?? '25%')
      else panel.collapse()
    }
    const complete = () => setClosing(false)
    if (animate) cancel.current = transitionPanel(group, change, complete)
    else {
      cancel.current?.()
      change()
      complete()
    }
  }, [open, animate, defaultSize, openSize])

  useEffect(() => () => cancel.current?.(), [])

  return (
    <Panel
      {...props}
      disabled={!open && !closing && !previousOpen.current}
      panelRef={panelRef}
      elementRef={elementRef}
      collapsible
      defaultSize={initialSize.current}
      aria-hidden={!open || undefined}
      onResize={(size, id, previousSize) => {
        if (open && size.asPercentage > 0 && !elementRef.current?.parentElement?.hasAttribute('data-panel-motion'))
          rememberedSize.current = `${size.asPercentage}%`
        props.onResize?.(size, id, previousSize)
      }}
      style={{overflow: 'hidden', ...props.style}}
    >
      {open ? children : keepMounted || closing || previousOpen.current ? retained.current : null}
    </Panel>
  )
}

/** Keeps the separator's space stable while excluding a closed panel's handle from input. */
export function PanelSeparator({
  open = true,
  className = 'panel-resize-handle',
  onCollapse,
}: {
  open?: boolean
  className?: string
  onCollapse?: () => void
}) {
  return (
    <Separator
      className={className}
      disabled={!open}
      aria-hidden={!open || undefined}
      style={{visibility: open ? undefined : 'hidden'}}
      onKeyDownCapture={(event) => {
        // The library's Enter shortcut controls only the preceding panel.
        // Right-side panels need their own explicit close action.
        if (event.key === 'Enter' && onCollapse) {
          event.preventDefault()
          const group = event.currentTarget.parentElement!
          group.tabIndex = -1
          group.focus({preventScroll: true})
          onCollapse()
        }
      }}
    />
  )
}
