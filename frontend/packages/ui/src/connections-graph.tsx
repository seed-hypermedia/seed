import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useRouteLink} from '@shm/shared'
import {buildConnectionsGraph, type ConnectionGraphNode, type DocumentConnection} from '@shm/shared/connections'
import {useDraftsForAccountSafe} from '@shm/shared/draft-breadcrumb-context'
import {useCanSeePrivateDocs} from '@shm/shared/models/capabilities'
import {useDirectory, useResource} from '@shm/shared/models/entity'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'
import {Expand, Network, Shuffle} from 'lucide-react'
import {enableZoom} from 'pele/lazy'
import {useEffect, useId, useMemo, useRef, useState} from 'react'
import {flushSync} from 'react-dom'
import {Button} from './button'
import {Dialog, DialogContent, DialogTitle, DialogTrigger} from './components/dialog'
import {getSiteNavDirectory} from './navigation'
import {cn} from './utils'
import './diagram.css'

/** Shows incoming citations, child documents, and outgoing links with a full-size graph dialog. */
export function ConnectionsGraph({
  docId,
  groups,
  expandedIds,
  onSelect,
}: {
  docId: UnpackedHypermediaId
  groups: DocumentConnection[]
  expandedIds: Set<string>
  onSelect: (id: string) => void
}) {
  const resource = useResource(docId)
  const directory = useDirectory(docId)
  const drafts = useDraftsForAccountSafe(docId.uid)
  const canSeePrivate = useCanSeePrivateDocs(docId)
  const [open, setOpen] = useState(false)
  const [chromeVisible, setChromeVisible] = useState(true)
  const transitionName = `connections-graph-${useId().replace(/:/g, '')}`
  const activeTransition = useRef<ReturnType<typeof globalThis.document.startViewTransition> | null>(null)
  const transitionRequest = useRef(0)
  useEffect(
    () => () => {
      transitionRequest.current++
      activeTransition.current?.skipTransition()
    },
    [],
  )
  const changeOpen = (nextOpen: boolean) => {
    const request = ++transitionRequest.current
    activeTransition.current?.skipTransition()
    if (!globalThis.document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setChromeVisible(true)
      setOpen(nextOpen)
      return
    }
    // Hide chrome before the old snapshot too, so closing only moves the graph.
    flushSync(() => setChromeVisible(false))
    const transition = globalThis.document.startViewTransition(() => {
      if (request === transitionRequest.current) flushSync(() => setOpen(nextOpen))
    })
    activeTransition.current = transition
    // Interruption or a hidden tab can skip the animation without failing the state update.
    void transition.ready.catch(() => {})
    // Skipped transitions still apply their update; only the latest request may change the dialog.
    void transition.finished
      .finally(() => {
        if (activeTransition.current === transition) {
          activeTransition.current = null
          if (request === transitionRequest.current) setChromeVisible(true)
        }
      })
      .catch(() => {})
  }
  const [organized, setOrganized] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const nodes = useMemo(
    () =>
      buildConnectionsGraph(
        docId,
        groups,
        getSiteNavDirectory({id: docId, directory: directory.data, drafts: drafts.data, includePrivate: canSeePrivate}),
        document?.content ?? [],
      ),
    [docId, groups, directory.data, drafts.data, canSeePrivate, document?.content],
  )
  const selected = nodes.find((node) => node.key === selectedKey)
  const graph = (
    <GraphCanvas
      transitionName={transitionName}
      nodes={nodes}
      title={document?.metadata.name || 'This document'}
      expanded={open}
      organized={organized}
      expandedIds={expandedIds}
      selectedKey={selectedKey}
      onSelect={(node) => {
        setSelectedKey(node.key)
        if (node.citation) onSelect(node.key)
      }}
    />
  )
  const layoutToggle = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="bg-background shadow-sm"
      onClick={() => setOrganized((value) => !value)}
      title={organized ? 'Use constellation layout' : 'Organize graph into rings'}
    >
      {organized ? <Shuffle className="size-4" /> : <Network className="size-4" />}
      {organized ? 'Constellation' : 'Organize'}
    </Button>
  )
  const legend = (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="bg-brand-4 size-2 rounded-full" />
        Citations {nodes.filter((node) => node.citation).length}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-muted-foreground/50 size-2 rounded-full" />
        Children & links {nodes.filter((node) => !node.citation).length}
      </span>
    </div>
  )
  const status = (
    <>
      {(directory.isInitialLoading || drafts.isLoading) && (
        <p className="text-muted-foreground px-3 pb-2 text-xs" role="status">
          Loading child documents…
        </p>
      )}
      {directory.isError && (
        <div className="px-3 pb-2 text-xs" role="alert">
          Could not load child documents.{' '}
          <Button size="sm" variant="ghost" onClick={() => directory.refetch()}>
            Try again
          </Button>
        </div>
      )}
    </>
  )
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <style>{`
        ::view-transition-group(${transitionName}) {
          animation-duration: var(--duration-normal);
          animation-timing-function: var(--ease-out-smooth);
        }
        ::view-transition-old(${transitionName}),
        ::view-transition-new(${transitionName}) {
          height: 100%;
          width: 100%;
        }
        @media (prefers-reduced-motion: reduce) {
          ::view-transition-group(${transitionName}),
          ::view-transition-old(${transitionName}),
          ::view-transition-new(${transitionName}) {
            animation: none;
          }
        }
      `}</style>
      <div className="border-border bg-muted/30 relative overflow-hidden rounded-lg border">
        <div className="h-72">{!open && graph}</div>
        <div className="absolute top-2 left-2">{layoutToggle}</div>
        <DialogTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="bg-background absolute top-2 right-2 shadow-sm"
            aria-label="Expand connections graph"
            title="Expand connections graph"
          >
            <Expand className="size-4" />
          </Button>
        </DialogTrigger>
        {legend}
        {!open && selected && <GraphSelection node={selected} />}
        {!open && status}
      </div>
      {open && (
        <DialogContent
          className="connections-graph-dialog h-9/10 w-11/12 max-w-7xl rounded-xl border data-[state=closed]:animate-none data-[state=open]:animate-none"
          contentClassName="gap-0 overflow-hidden p-0"
          overlayClassName="data-[state=open]:animate-none data-[state=closed]:animate-none"
          aria-describedby={undefined}
          data-chrome-visible={chromeVisible}
        >
          <DialogTitle data-graph-chrome className="border-b px-4 py-3 text-sm font-medium">
            Connections · {document?.metadata.name || 'This document'}
          </DialogTitle>
          <div className="relative min-h-0 flex-1">
            {graph}
            <div data-graph-chrome className="absolute top-2 left-2">
              {layoutToggle}
            </div>
          </div>
          <div data-graph-chrome>
            {legend}
            {status}
          </div>
          <div data-graph-chrome className="h-12 shrink-0">
            {selected ? (
              <GraphSelection node={selected} />
            ) : (
              <p className="text-muted-foreground px-3 py-2 text-sm">Select a node to open its document.</p>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

function GraphCanvas({
  transitionName,
  nodes,
  title,
  expanded,
  organized,
  expandedIds,
  selectedKey,
  onSelect,
}: {
  transitionName: string
  nodes: ConnectionGraphNode[]
  title: string
  expanded: boolean
  organized: boolean
  expandedIds: Set<string>
  selectedKey: string | null
  onSelect: (node: ConnectionGraphNode) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({width: 380, height: 288})
  useIsomorphicLayoutEffect(() => {
    const element = container.current
    if (!element) return
    // Commit the destination fit before the browser captures the shared transition.
    const {width, height} = element.getBoundingClientRect()
    if (width > 0 && height > 0) setViewport({width, height})
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const {width, height} = entry.contentRect
      if (width > 0 && height > 0) {
        setViewport((previous) => (previous.width === width && previous.height === height ? previous : {width, height}))
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const layout = useMemo(() => {
    if (!organized) {
      const positioned: {node: ConnectionGraphNode; x: number; y: number}[] = []
      const spread = Math.max(150, Math.sqrt(nodes.length) * 22)
      for (const node of nodes) {
        // Seed each document so selection and expansion never shuffle the graph.
        let seed = 2166136261
        for (const character of node.key) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
        const random = () => {
          seed += 0x6d2b79f5
          let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
          value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
          return ((value ^ (value >>> 14)) >>> 0) / 4294967296
        }
        let best = {x: 0, y: 0, clearance: -Infinity}
        for (let attempt = 0; attempt < 40; attempt++) {
          const angle = random() * Math.PI * 2
          const radius = Math.sqrt(-2 * Math.log(Math.max(random(), 0.01))) * spread
          const x = Math.cos(angle) * radius
          const y = Math.sin(angle) * radius * 0.8
          // Leave room for the current document and avoid overlapping hit targets.
          let clearance = Math.hypot(x, y) - 70
          for (const point of positioned) {
            clearance = Math.min(clearance, Math.hypot(x - point.x, y - point.y))
          }
          if (clearance > best.clearance) best = {x, y, clearance}
          if (clearance >= 34) break
        }
        positioned.push({node, x: best.x, y: best.y})
      }
      return positioned
    }
    const citations = nodes.filter((node) => node.citation)
    const others = nodes.filter((node) => !node.citation)
    const innerRadius = Math.max(140, citations.length * 14)
    const positioned = [
      ...citations.map((node, index) => {
        const angle = (index * Math.PI * 2) / citations.length - Math.PI / 2
        return {node, x: Math.cos(angle) * innerRadius, y: Math.sin(angle) * innerRadius}
      }),
      ...others.map((node, index) => {
        const angle = index * Math.PI * (3 - Math.sqrt(5))
        const radius = innerRadius + 80 + Math.sqrt(index + 1) * 26
        return {node, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius}
      }),
    ]
    return positioned
  }, [nodes, organized])
  // Fit the actual bounds, including the current document, rather than a square around the origin.
  const minX = Math.min(0, ...layout.map(({x}) => x))
  const maxX = Math.max(0, ...layout.map(({x}) => x))
  const minY = Math.min(0, ...layout.map(({y}) => y))
  const maxY = Math.max(0, ...layout.map(({y}) => y))
  const sidePadding = nodes.length <= 20 ? 88 : 24
  const scale = Math.min(
    Math.max(1, viewport.width - sidePadding * 2) / Math.max(1, maxX - minX),
    Math.max(1, viewport.height - 96) / Math.max(1, maxY - minY),
  )
  const offsetX = viewport.width / 2 - ((minX + maxX) / 2) * scale
  // Reserve space above for the controls and below for node labels.
  const offsetY = (viewport.height + 16) / 2 - ((minY + maxY) / 2) * scale
  useIsomorphicLayoutEffect(() => {
    const element = container.current
    if (!element) return
    const zoom = enableZoom(element, {always: true, maxScale: 4, controls: expanded})
    return () => zoom.destroy()
  }, [layout, expanded, viewport])
  return (
    <div
      ref={container}
      style={{viewTransitionName: transitionName}}
      className="bg-background pele focus-visible:ring-ring relative flex size-full min-h-0 touch-none items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
      tabIndex={0}
      aria-label="Document connections graph. Use plus and minus to zoom, arrow keys to pan, and zero to reset."
    >
      <svg
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        className="size-full"
        role="group"
        aria-label="Document connections graph"
      >
        <g transform={`translate(${offsetX} ${offsetY})`}>
          <g aria-hidden="true">
            {layout.map(({node, x, y}) => (
              <line
                key={node.key}
                x1="0"
                y1="0"
                x2={x * scale}
                y2={y * scale}
                className={node.citation ? 'stroke-brand-4/60' : 'stroke-muted-foreground/15'}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          {layout.map(({node, x, y}) => {
            const Node = node.citation ? CitationGraphNode : GraphNode
            return (
              <Node
                key={node.key}
                node={node}
                x={x * scale}
                y={y * scale}
                selected={selectedKey === node.key || expandedIds.has(node.key)}
                showLabel={nodes.length <= 20 || node.key === selectedKey}
                onSelect={() => onSelect(node)}
              />
            )
          })}
          <g aria-label={`Current document: ${title}`} className="pointer-events-none">
            <circle r="10" className="fill-brand-4 stroke-background" strokeWidth="2" />
            <text
              y="28"
              textAnchor="middle"
              fontSize="13"
              className="fill-foreground stroke-background font-semibold"
              strokeWidth="6"
              paintOrder="stroke"
            >
              <title>{title}</title>
              {title.length > 26 ? `${title.slice(0, 25)}…` : title}
            </text>
          </g>
        </g>
      </svg>
    </div>
  )
}

type GraphNodeProps = {
  node: ConnectionGraphNode
  x: number
  y: number
  selected: boolean
  showLabel: boolean
  onSelect: () => void
  name?: string
}

function CitationGraphNode(props: GraphNodeProps) {
  const resource = useResource(props.node.name ? null : props.node.id)
  const name = resource.data?.type === 'document' ? resource.data.document.metadata.name : undefined
  return <GraphNode {...props} name={name} />
}

function GraphNode({node, x, y, selected, showLabel, onSelect, name: resolvedName}: GraphNodeProps) {
  const name = node.name || resolvedName || (node.draftId ? 'Untitled draft' : 'Linked document')
  const [hovered, setHovered] = useState(false)
  return (
    <g
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.citation ? 'Show connections from' : 'Select'} ${name}`}
      aria-pressed={selected}
      className="group cursor-pointer outline-none"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          onSelect()
        }
      }}
    >
      <title>
        {name}
        {node.citation ? ' · Citation' : ''}
        {node.child ? ' · Child document' : ''}
        {node.outgoing ? ' · Outgoing link' : ''}
      </title>
      <circle r="12" fill="transparent" />
      <circle
        r={node.citation ? 7 : 5}
        className={cn(
          'stroke-background group-focus-visible:stroke-ring group-hover:stroke-ring',
          node.citation ? 'fill-brand-4' : 'fill-muted-foreground/50',
          selected && 'stroke-ring',
        )}
        strokeWidth={selected ? 3 : 1}
      />
      {(showLabel || hovered) && (
        <text
          y="22"
          textAnchor="middle"
          fontSize="12"
          className="fill-foreground stroke-background pointer-events-none"
          strokeWidth="5"
          paintOrder="stroke"
        >
          {name.length > 25 ? `${name.slice(0, 24)}…` : name}
        </text>
      )}
    </g>
  )
}

function GraphSelection({node}: {node: ConnectionGraphNode}) {
  const resource = useResource(node.name ? null : node.id)
  const name =
    node.name ||
    (resource.data?.type === 'document' ? resource.data.document.metadata.name : undefined) ||
    'Untitled document'
  const link = useRouteLink(
    node.draftId && !node.id ? {key: 'draft', id: node.draftId} : node.id ? {key: 'document', id: node.id} : null,
  )
  return (
    <div className="border-border flex items-center gap-3 border-t px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate" title={name}>
        {name}
      </span>
      <Button asChild variant="ghost" size="sm">
        <a {...link}>{node.draftId && !node.id ? 'Open draft' : 'Open document'}</a>
      </Button>
    </div>
  )
}
