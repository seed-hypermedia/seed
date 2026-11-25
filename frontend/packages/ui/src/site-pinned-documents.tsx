import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {pinnedDocumentId, pinnedDocumentToUnpackedId, resolvePins} from '@shm/shared/models/pins'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {ChevronDown, ChevronRight, History, MoreHorizontal, Pin, Trash} from 'lucide-react'
import {useState} from 'react'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {cn} from './utils'

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
  // An unavailable listing is not evidence that a document has disappeared.
  const resolved = directory ? resolvePins(pins, directory) : pins.map((pin) => ({pin, item: undefined, status: 'ok'}))
  if (!pins.length) return null

  return (
    <section aria-label="Pinned documents" className="mb-2">
      <button
        type="button"
        aria-label={expanded ? 'Collapse pinned documents' : 'Expand pinned documents'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="text-icon focus-visible:ring-ring flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs font-semibold tracking-wide uppercase outline-none focus-visible:ring-2"
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        Pinned <span className="font-normal">({pins.length})</span>
      </button>
      {expanded &&
        resolved.map(({pin, item, status}, index) => {
          const id = latestId(pinnedDocumentToUnpackedId(pin))
          const title = item?.metadata?.name || pin.title || 'Untitled'
          const isActive = activeDocumentId?.id === id.id
          return (
            <div
              key={pinnedDocumentId(pin)}
              className={cn(
                'group flex min-w-0 items-center rounded-md',
                isActive && 'bg-accent text-accent-foreground',
              )}
            >
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onNavigate(id)}
                className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-1 pl-5 text-left text-sm outline-none focus-visible:ring-2"
              >
                <Pin className="text-icon size-3.5 shrink-0" />
                <span className={cn('truncate', status === 'deleted' && 'text-muted-foreground line-through')}>
                  {title}
                </span>
                {status === 'outdated' && (
                  <History aria-label="Document updated" className="size-3.5 shrink-0 text-orange-500" />
                )}
                {status === 'deleted' && (
                  <Trash aria-label="Document unavailable" className="text-destructive size-3.5 shrink-0" />
                )}
              </button>
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
                  {status === 'outdated' && actions.acknowledgePin && (
                    <DropdownMenuItem
                      onSelect={() => actions.acknowledgePin?.(id, item?.version ?? null, item?.metadata?.name)}
                    >
                      Mark as up to date
                    </DropdownMenuItem>
                  )}
                  {actions.movePin && index > 0 && (
                    <DropdownMenuItem onSelect={() => actions.movePin?.(siteId.uid, index, index - 1)}>
                      Move up
                    </DropdownMenuItem>
                  )}
                  {actions.movePin && index < pins.length - 1 && (
                    <DropdownMenuItem onSelect={() => actions.movePin?.(siteId.uid, index, index + 1)}>
                      Move down
                    </DropdownMenuItem>
                  )}
                  {actions.movePin && index > 0 && (
                    <DropdownMenuItem onSelect={() => actions.movePin?.(siteId.uid, index, 0)}>
                      Move to top
                    </DropdownMenuItem>
                  )}
                  {actions.unpinDocument && (
                    <DropdownMenuItem onSelect={() => actions.unpinDocument?.(id)}>
                      {status === 'deleted' ? 'Remove pin' : 'Unpin'}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )
        })}
    </section>
  )
}
