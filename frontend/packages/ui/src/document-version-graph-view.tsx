import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createInspectIpfsNavRoute, createInspectNavRoute} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {GitBranch, GitCommitHorizontal, GitMerge, GitPullRequestArrow, LinkIcon} from 'lucide-react'
import type {CSSProperties, ReactNode} from 'react'
import {useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {
  buildDocumentVersionGraph,
  type DocumentVersionGraphChange,
  type DocumentVersionGraphNode,
} from './document-version-graph'
import {cn} from './utils'

const ROW_HEIGHT = 62
const LANE_WIDTH = 30
const GRAPH_LEFT_PADDING = 22
const GRAPH_TOP_PADDING = 30
const DETAIL_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Renders a Git-tree-style dependency graph for document versions. */
export function DocumentVersionGraphView({
  changes,
  latestVersion,
  docId,
}: {
  changes: DocumentVersionGraphChange[] | undefined
  latestVersion?: string | null
  docId: UnpackedHypermediaId
}) {
  const graph = useMemo(() => buildDocumentVersionGraph({changes, latestVersion}), [changes, latestVersion])
  const [selectedId, setSelectedId] = useState<string | null>(graph.heads[0] || graph.nodes[0]?.id || null)
  const selectedNode = selectedId ? graph.nodesById[selectedId] || null : null
  const graphWidth = Math.max(96, GRAPH_LEFT_PADDING * 2 + (graph.maxLane + 1) * LANE_WIDTH)
  const graphHeight = Math.max(120, graph.nodes.length * ROW_HEIGHT + GRAPH_TOP_PADDING)

  useEffect(() => {
    if (selectedId && graph.nodesById[selectedId]) return
    setSelectedId(graph.heads[0] || graph.nodes[0]?.id || null)
  }, [graph, selectedId])

  if (!graph.nodes.length) {
    return (
      <div className="text-muted-foreground border-border bg-background rounded-xl border p-4 text-sm">
        No changes found.
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-col gap-4 xl:flex-row">
      <div className="border-border bg-background min-w-0 flex-1 overflow-auto rounded-xl border shadow-xs">
        <div className="relative" style={{height: graphHeight, minWidth: 680}}>
          <svg
            className="text-muted-foreground pointer-events-none absolute top-0 left-0 z-20"
            width={graphWidth}
            height={graphHeight}
            aria-hidden="true"
          >
            {graph.edges.map((edge) => {
              const from = graph.nodesById[edge.from]
              const to = graph.nodesById[edge.to]
              if (!from || !to) return null

              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={edgePath(from, to)}
                  className={cn(
                    'fill-none stroke-current',
                    selectedNode && (selectedNode.id === from.id || selectedNode.id === to.id)
                      ? 'text-foreground'
                      : 'text-muted-foreground/35',
                  )}
                  strokeWidth={selectedNode && (selectedNode.id === from.id || selectedNode.id === to.id) ? 2.5 : 1.75}
                  strokeLinecap="round"
                />
              )
            })}
            {graph.nodes.map((node) => (
              <g
                key={node.id}
                className={cn(
                  selectedNode?.id === node.id ? 'text-foreground' : laneColorClass(node.lane),
                  node.isMissing && 'text-muted-foreground',
                )}
              >
                <circle
                  cx={nodeX(node)}
                  cy={nodeY(node)}
                  r={node.isMerge ? 7 : 6}
                  className={cn(
                    'fill-current',
                    selectedNode?.id === node.id && 'stroke-background',
                    node.isMissing && 'fill-background stroke-current',
                  )}
                  strokeWidth={node.isMissing ? 2 : selectedNode?.id === node.id ? 3 : 0}
                />
                {node.isHead ? (
                  <circle
                    cx={nodeX(node)}
                    cy={nodeY(node)}
                    r={12}
                    className="fill-none stroke-current"
                    strokeWidth={2}
                  />
                ) : null}
              </g>
            ))}
          </svg>

          <div className="relative z-10">
            {graph.nodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={cn(
                  'border-border/60 hover:bg-accent/60 focus-visible:ring-ring grid w-full grid-cols-[var(--graph-width)_minmax(0,1fr)] items-center border-b text-left transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none',
                  selectedNode?.id === node.id && 'bg-accent hover:bg-accent',
                )}
                style={
                  {
                    height: ROW_HEIGHT,
                    '--graph-width': `${graphWidth}px`,
                  } as CSSProperties
                }
                aria-pressed={selectedNode?.id === node.id}
                aria-label={`Inspect version ${node.id}`}
                onClick={() => setSelectedId(node.id)}
              >
                <span />
                <span className="flex min-w-0 items-center gap-3 pr-4">
                  <VersionNodeIcon node={node} />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-foreground font-mono text-sm font-semibold">{node.shortId}</span>
                      {node.isHead ? <Badge>HEAD</Badge> : null}
                      {node.isGenesis ? <Badge>genesis</Badge> : null}
                      {node.isMerge ? <Badge>merge</Badge> : null}
                      {node.isMissing ? <Badge>missing</Badge> : null}
                    </span>
                    <span className="text-muted-foreground mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs">
                      {node.author ? <span className="max-w-full min-w-0 break-all">hm://{node.author}</span> : null}
                      {node.author && node.createTime ? <span>•</span> : null}
                      {node.createTime ? <span>{formatDate(node.createTime)}</span> : null}
                      {!node.author && !node.createTime ? <span>Dependency placeholder</span> : null}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <VersionDetails node={selectedNode} docId={docId} />
    </div>
  )
}

function VersionNodeIcon({node}: {node: DocumentVersionGraphNode}) {
  const Icon = node.isMerge
    ? GitMerge
    : node.isHead
      ? GitPullRequestArrow
      : node.isGenesis
        ? GitBranch
        : GitCommitHorizontal

  return (
    <span
      className={cn(
        'border-border bg-background text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border shadow-xs',
        node.isHead && 'text-foreground',
        node.isMissing && 'border-dashed',
      )}
    >
      <Icon className="size-4" />
    </span>
  )
}

function VersionDetails({node, docId}: {node: DocumentVersionGraphNode | null; docId: UnpackedHypermediaId}) {
  if (!node) {
    return (
      <aside className="border-border bg-background text-muted-foreground min-w-0 overflow-hidden rounded-xl border p-4 text-sm shadow-xs xl:w-80 xl:shrink-0">
        Select a version to inspect its dependencies.
      </aside>
    )
  }

  return (
    <aside className="border-border bg-background h-fit min-w-0 overflow-hidden rounded-xl border p-4 shadow-xs xl:w-80 xl:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 overflow-hidden">
          <h2 className="text-foreground text-sm font-semibold">Version details</h2>
          <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{node.id}</p>
        </div>
        {node.isHead ? <Badge>HEAD</Badge> : null}
      </div>

      <dl className="mt-4 space-y-3 text-sm">
        <DetailRow label="Author">{node.author ? `hm://${node.author}` : 'Unknown'}</DetailRow>
        <DetailRow label="Created">{node.createTime ? formatDate(node.createTime) : 'Unknown'}</DetailRow>
        <DetailRow label="Depth">{node.depth}</DetailRow>
        <DetailRow label="Lane">{node.lane + 1}</DetailRow>
        <DetailRow label="Dependencies">
          {node.deps.length ? (
            <span className="block min-w-0 space-y-1">
              {node.deps.map((dep) => (
                <span key={dep} className="block max-w-full overflow-hidden font-mono text-xs break-all">
                  {dep}
                </span>
              ))}
            </span>
          ) : (
            'None'
          )}
        </DetailRow>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {node.isMissing ? null : <ExactVersionLink docId={docId} version={node.id} />}
        <IpfsLink cid={node.id} />
      </div>
    </aside>
  )
}

function ExactVersionLink({docId, version}: {docId: UnpackedHypermediaId; version: string}) {
  const linkProps = useRouteLink(
    createInspectNavRoute({...docId, version, latest: null, blockRef: null, blockRange: null}, null, null, null, null),
  )

  return (
    <Button asChild size="sm" variant="outline">
      <a {...linkProps}>
        <LinkIcon className="size-4" />
        Exact version
      </a>
    </Button>
  )
}

function IpfsLink({cid}: {cid: string}) {
  const linkProps = useRouteLink(createInspectIpfsNavRoute(cid))

  return (
    <Button asChild size="sm" variant="outline">
      <a {...linkProps}>IPFS object</a>
    </Button>
  )
}

function DetailRow({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 gap-3">
      <dt className="text-muted-foreground w-24 shrink-0 text-xs font-medium">{label}</dt>
      <dd className="text-foreground min-w-0 flex-1 overflow-hidden break-all">{children}</dd>
    </div>
  )
}

function Badge({children}: {children: ReactNode}) {
  return (
    <span className="border-border bg-background text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-semibold tracking-wide uppercase">
      {children}
    </span>
  )
}

function nodeX(node: DocumentVersionGraphNode): number {
  return GRAPH_LEFT_PADDING + node.lane * LANE_WIDTH
}

function nodeY(node: DocumentVersionGraphNode): number {
  return GRAPH_TOP_PADDING + node.row * ROW_HEIGHT
}

function edgePath(from: DocumentVersionGraphNode, to: DocumentVersionGraphNode): string {
  const startX = nodeX(from)
  const startY = nodeY(from)
  const endX = nodeX(to)
  const endY = nodeY(to)
  const midY = startY + (endY - startY) / 2

  return `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return DETAIL_DATE_FORMAT.format(date)
}

function laneColorClass(lane: number): string {
  return (
    ['text-blue-600', 'text-amber-500', 'text-pink-600', 'text-emerald-600', 'text-violet-600'][lane % 5] ||
    'text-blue-600'
  )
}
