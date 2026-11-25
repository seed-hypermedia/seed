import {combine} from '@atlaskit/pragmatic-drag-and-drop/combine'
import {draggable, dropTargetForElements} from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {pinnedDocumentId, pinnedDocumentToUnpackedId, resolvePins, type ResolvedPin} from '@shm/shared/models/pins'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {ChevronDown, ChevronRight, GripVertical, History, MoreHorizontal, Pin, PinOff, Trash} from 'lucide-react'
import {useCallback, useEffect, useId, useRef, useState} from 'react'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {Separator} from './separator'
import {Tooltip} from './tooltip'
import {cn} from './utils'

type Edge = 'before' | 'after'

/** Compact, personally pinned documents in the space sidebar, sharing its directory snapshot. */
export function SitePinnedDocuments({
  siteId,
  directory,
  activeDocumentId,
  onNavigate,
}: {
  siteId: UnpackedHypermediaId
  directory: HMDocumentInfo[] | undefined
  activeDocumentId: UnpackedHypermediaId | null
  onNavigate: (id: UnpackedHypermediaId) => void
}) {
  const actions = useDocumentActions()
  const pins = actions.getPinsForSite?.(siteId.uid) ?? []
  const [expanded, setExpanded] = useState(true)
  const [instanceId] = useState(() => Symbol('sidebar-pins'))
  const [announcement, setAnnouncement] = useState('')
  const instructionsId = useId()
  const move = useCallback(
    (sourceId: string, targetId: string, edge: Edge) => {
      const from = pins.findIndex((pin) => pinnedDocumentId(pin) === sourceId)
      const target = pins.findIndex((pin) => pinnedDocumentId(pin) === targetId)
      if (from < 0 || target < 0) return
      const insertion = target + (edge === 'after' ? 1 : 0)
      const to = insertion - (from < insertion ? 1 : 0)
      if (from === to) return
      actions.movePin?.(siteId.uid, from, to)
      setAnnouncement(`Moved ${pins[from]!.title || 'Untitled'} to position ${to + 1} of ${pins.length}.`)
    },
    [pins, actions.movePin, siteId.uid],
  )
  // An unavailable listing is not evidence that a document has disappeared.
  const resolved: ResolvedPin[] = directory
    ? resolvePins(pins, directory)
    : pins.map((pin) => ({pin, item: undefined, status: 'ok'}))
  if (!pins.length) return null

  return (
    <section aria-label="Pinned documents" className="mb-2">
      <button
        type="button"
        aria-label={expanded ? 'Collapse pinned documents' : 'Expand pinned documents'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="text-icon hover:bg-accent/60 focus-visible:ring-ring group flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-2"
      >
        <Pin className="size-3.5" />
        Pinned <span className="text-muted-foreground text-xs">{pins.length}</span>
        {expanded ? (
          <ChevronDown className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </button>
      <span id={instructionsId} className="sr-only">
        Drag to reorder, or press Alt and an arrow key to move up or down.
      </span>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {expanded &&
        resolved.map((resolvedPin, index) => (
          <PinnedRow
            key={pinnedDocumentId(resolvedPin.pin)}
            resolved={resolvedPin}
            instanceId={instanceId}
            instructionsId={instructionsId}
            activeDocumentId={activeDocumentId}
            onNavigate={onNavigate}
            onMove={move}
            onKeyboardMove={(direction) => {
              const target = pins[index + direction]
              if (target)
                move(pinnedDocumentId(resolvedPin.pin), pinnedDocumentId(target), direction < 0 ? 'before' : 'after')
            }}
          />
        ))}
      <Separator className="mt-2" />
    </section>
  )
}

function PinnedRow({
  resolved: {pin, item, status},
  instanceId,
  instructionsId,
  activeDocumentId,
  onNavigate,
  onMove,
  onKeyboardMove,
}: {
  resolved: ResolvedPin
  instanceId: symbol
  instructionsId: string
  activeDocumentId: UnpackedHypermediaId | null
  onNavigate: (id: UnpackedHypermediaId) => void
  onMove: (sourceId: string, targetId: string, edge: Edge) => void
  onKeyboardMove: (direction: -1 | 1) => void
}) {
  const actions = useDocumentActions()
  const rowRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLButtonElement>(null)
  const [edge, setEdge] = useState<Edge | null>(null)
  const [dragging, setDragging] = useState(false)
  const pinId = pinnedDocumentId(pin)
  const canReorder = !!actions.movePin
  useEffect(() => {
    const element = rowRef.current
    const dragHandle = handleRef.current
    if (!element || !dragHandle || !canReorder) return
    const data = {type: 'sidebar-pin', instanceId, pinId}
    return combine(
      draggable({
        element,
        dragHandle,
        getInitialData: () => data,
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element,
        canDrop: ({source}) =>
          source.data.type === 'sidebar-pin' && source.data.instanceId === instanceId && source.data.pinId !== pinId,
        getData: ({input}) => ({
          ...data,
          edge:
            input.clientY < element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2
              ? 'before'
              : 'after',
        }),
        onDrag: ({self}) => setEdge(self.data.edge as Edge),
        onDragEnter: ({self}) => setEdge(self.data.edge as Edge),
        onDragLeave: () => setEdge(null),
        onDrop: ({source, self, location}) => {
          setEdge(null)
          if (location.current.dropTargets[0]?.element === element)
            onMove(source.data.pinId as string, pinId, self.data.edge as Edge)
        },
      }),
    )
  }, [canReorder, instanceId, pinId, onMove])
  const id = latestId(pinnedDocumentToUnpackedId(pin))
  const title = item?.metadata?.name || pin.title || 'Untitled'
  const isActive = activeDocumentId?.id === id.id
  return (
    <div
      ref={rowRef}
      data-pin-id={pinId}
      className={cn(
        'group hover:bg-accent/60 relative flex min-w-0 items-center rounded-md',
        isActive && 'bg-accent text-accent-foreground',
        dragging && 'opacity-40',
      )}
    >
      {edge && (
        <div
          aria-hidden="true"
          data-drop-edge={edge}
          className={cn(
            'bg-primary pointer-events-none absolute right-0 left-0 z-10 h-0.5',
            edge === 'before' ? 'top-0' : 'bottom-0',
          )}
        />
      )}
      {canReorder && (
        <Tooltip content={dragging ? '' : 'Drag to reorder (Alt + ↑ / ↓)'} contentClassName="pointer-events-none">
          <button
            ref={handleRef}
            type="button"
            aria-label={`Reorder ${title}`}
            aria-describedby={instructionsId}
            onKeyDown={(event) => {
              if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                event.preventDefault()
                onKeyboardMove(event.key === 'ArrowUp' ? -1 : 1)
              }
            }}
            className="text-icon focus-visible:ring-ring flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-md opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-2 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
        </Tooltip>
      )}
      <button
        type="button"
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onNavigate(id)}
        className={cn(
          'focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-1 text-left text-sm outline-none focus-visible:ring-2',
          !canReorder && 'pl-5',
        )}
      >
        <span className={cn('truncate', status === 'deleted' && 'text-muted-foreground line-through')}>{title}</span>
        {status === 'outdated' && (
          <History aria-label="Document updated" className="size-3.5 shrink-0 text-orange-500" />
        )}
        {status === 'deleted' && (
          <Trash aria-label="Document unavailable" className="text-destructive size-3.5 shrink-0" />
        )}
      </button>
      <div className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
        {actions.unpinDocument && (
          <Tooltip content="Unpin">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label={`Unpin ${title}`}
              onClick={() => actions.unpinDocument?.(id)}
            >
              <PinOff className="size-3.5" />
            </Button>
          </Tooltip>
        )}
        {status === 'outdated' && actions.acknowledgePin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label={`Pin options for ${title}`}
                className="text-icon shrink-0"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => actions.acknowledgePin?.(id, item?.version ?? null, item?.metadata?.name)}
              >
                Mark as up to date
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
