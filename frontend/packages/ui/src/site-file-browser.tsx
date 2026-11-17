import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {
  isDraftPlaceholderPath,
  useDraftsForAccountSafe,
  type HMListedDraftWithLocation,
} from '@shm/shared/draft-breadcrumb-context'
import {deriveDocumentType} from '@shm/shared/models/document-machine'
import {useDirectory, useDocumentInfo, useResolvedHmId, useResource} from '@shm/shared/models/entity'
import {isDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {filterDocumentsByTitle} from '@shm/shared/utils/all-documents-tree'
import {getCardNavigationTargets, getIndexedCardNavigationTargets} from '@shm/shared/utils/card-navigation'
import {Blocks, Bot, ChevronDown, ChevronRight, FileText, Grid3X3, Home, Lock, Plus, Search, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {DocumentKindIcon, getDocumentKind} from './document-kind-icon'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {Input} from './components/input'
import {ScrollArea} from './components/scroll-area'
import type {MenuItemType} from './options-dropdown'
import {Spinner} from './spinner'
import {cn} from './utils'

/** Props for the shared site document browser. */
export type IncludeDocumentState = {disabled: boolean; pending: boolean; reason?: string}
export type IncludeDocumentContext = {parentId: UnpackedHypermediaId; signingAccountUid: string; capabilityId?: string}

export interface SiteFileBrowserProps {
  siteId: UnpackedHypermediaId
  activeDocumentId: UnpackedHypermediaId | null
  onNavigate: (id: UnpackedHypermediaId) => void
  onPrefetch?: (id: UnpackedHypermediaId) => void
  /** Shows the sidebar Documents heading with filter and creation actions. */
  showHeader?: boolean
  searchVisible?: boolean
  onSearchVisibleChange?: (visible: boolean) => void
  createMenuItem?: MenuItemType | null
  onCreate?: () => void
  onIncludeDocument?: (document: HMDocumentInfo, context: IncludeDocumentContext) => void
  getIncludeDocumentState?: (document: HMDocumentInfo, context?: IncludeDocumentContext) => IncludeDocumentState
}

function titleOf(doc: HMDocumentInfo) {
  const slug = doc.path?.at(-1)
  // An unpublished draft's slug is a placeholder id, not a readable name.
  if (isDraftPathSegment(slug)) return doc.metadata?.name || 'Untitled Document'
  return doc.metadata?.name || slug || 'Untitled Document'
}

/** Renders published Card navigation, with directory search and unpublished drafts. */
export function SiteFileBrowser({
  siteId,
  activeDocumentId,
  onNavigate,
  onPrefetch,
  showHeader = false,
  searchVisible = false,
  onSearchVisibleChange,
  createMenuItem,
  onCreate,
}: SiteFileBrowserProps) {
  const [query, setQuery] = useState('')
  // Only title search needs the whole space; navigation lists children per expanded row.
  const searching = query.trim().length > 0
  const directoryQuery = useDirectory(searching ? siteId : null, {mode: 'AllDescendants'})
  const draftsQuery = useDraftsForAccountSafe(siteId.uid)
  const directory = directoryQuery.data
  const drafts = draftsQuery.data ?? []
  const isLoading = directoryQuery.isInitialLoading || draftsQuery.isLoading
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchVisible) searchInputRef.current?.focus()
  }, [searchVisible])

  const {documents, unpublishedDraftIds} = useMemo(() => {
    const unpublished = drafts.flatMap((draft) => {
      const {editId, locationId} = draft as HMListedDraftWithLocation
      if (!locationId || (editId && !isDraftPlaceholderPath(editId.path, draft.id))) return []
      const path = [...(locationId.path ?? []), `-${draft.id}`]
      return [
        {
          id: editId ?? hmId(locationId.uid, {path}),
          path,
          metadata: draft.metadata,
          isCollection: draft.isCollection ?? false,
          visibility: draft.visibility ?? 'PUBLIC',
        } as HMDocumentInfo,
      ]
    })
    return {
      documents: [...(directory ?? []), ...unpublished],
      unpublishedDraftIds: new Set(unpublished.map((draft) => draft.id.id)),
    }
  }, [directory, drafts])
  const matches = useMemo(() => filterDocumentsByTitle(documents, query), [documents, query])
  const navigation: CardNavigationProps = {
    activeDocumentId,
    onNavigate,
    onPrefetch,
  }
  const createItems = createMenuItem?.children?.filter((item) =>
    [
      'new-document',
      'new-document-collection',
      'new-collection',
      'new-agent',
      'new-app',
      'new-private-document',
    ].includes(item.key),
  )

  function closeSearch() {
    setQuery('')
    onSearchVisibleChange?.(false)
  }

  const homeId = latestId(hmId(siteId.uid))
  const isHomeActive = activeDocumentId?.id === homeId.id
  const createButton = createItems?.length ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="iconSm" aria-label="Create root document" className="text-icon shrink-0">
          <Plus className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {createItems.map((item) => (
          <DropdownMenuItem
            key={item.key}
            onSelect={() => {
              item.onClick?.(undefined as never)
              onCreate?.()
            }}
          >
            {item.key === 'new-document' ? (
              <FileText className="size-4" />
            ) : item.key === 'new-document-collection' || item.key === 'new-collection' ? (
              <Grid3X3 className="size-4" />
            ) : item.key === 'new-agent' ? (
              <Bot className="size-4" />
            ) : item.key === 'new-app' ? (
              <Blocks className="size-4" />
            ) : (
              <Lock className="size-4" />
            )}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent">
      {showHeader && (
        <div className="flex h-12 shrink-0 items-center gap-1 px-3 pt-2">
          <span className="text-icon min-w-0 flex-1 text-xs font-semibold tracking-wide uppercase">Documents</span>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Filter documents"
            className="text-icon"
            onClick={() => onSearchVisibleChange?.(!searchVisible)}
          >
            <Search className="size-4" />
          </Button>
          {createButton}
        </div>
      )}
      {searchVisible ? (
        <div className="border-border border-b p-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              ref={searchInputRef}
              aria-label="Filter documents"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return
                event.preventDefault()
                event.stopPropagation()
                closeSearch()
              }}
              placeholder="Filter documents…"
              className="pr-9 pl-9"
            />
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="Close document search"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={closeSearch}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      <ScrollArea className="scroll-area-full-height min-h-0 flex-1" viewportClassName="[&>div]:!block">
        <div className="px-2 pb-4">
          <div
            className={cn('flex min-w-0 items-center rounded-md', isHomeActive && 'bg-accent text-accent-foreground')}
          >
            <button
              type="button"
              aria-current={isHomeActive ? 'page' : undefined}
              className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-5 text-left text-sm outline-none focus-visible:ring-2"
              onClick={() => onNavigate(homeId)}
            >
              <Home className="size-4 shrink-0" />
              <span className="truncate">Home</span>
            </button>{' '}
            {!showHeader && createButton}{' '}
          </div>
          {searching ? (
            isLoading ? (
              <div className="flex h-24 items-center justify-center" aria-label="Loading documents">
                <Spinner />
              </div>
            ) : matches.length === 0 ? (
              <p className="text-muted-foreground p-6 text-center text-sm">No documents found</p>
            ) : (
              <div role="list" aria-label="Space documents">
                {matches.map((doc) => {
                  const isActive = doc.id.id === activeDocumentId?.id
                  const navigationId = unpublishedDraftIds.has(doc.id.id) ? doc.id : latestId(doc.id)
                  const kind = getDocumentKind(doc)
                  return (
                    <div
                      key={doc.id.id}
                      role="listitem"
                      className={cn(
                        'flex min-w-0 items-center rounded-md',
                        isActive && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="h-8 w-5 shrink-0" />
                      <button
                        type="button"
                        aria-current={isActive ? 'page' : undefined}
                        onPointerEnter={() => onPrefetch?.(navigationId)}
                        onFocus={() => onPrefetch?.(navigationId)}
                        onClick={() => onNavigate(navigationId)}
                        className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left text-sm outline-none focus-visible:ring-2"
                      >
                        {kind === 'document' && unpublishedDraftIds.has(doc.id.id) ? (
                          <FileText aria-label="Unpublished draft" className="size-4 shrink-0 text-yellow-500" />
                        ) : (
                          <DocumentKindIcon kind={kind} className="size-4 shrink-0" />
                        )}
                        <span className="truncate">{titleOf(doc)}</span>
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          ) : (
            <>
              <div role="tree" aria-label="Space documents">
                <CardNavigationBranch key={homeId.id} id={homeId} ancestors={[]} {...navigation} />
              </div>
              {unpublishedDraftIds.size > 0 && (
                <div role="list" aria-label="Unpublished drafts" className="mt-3 border-t pt-2">
                  <p className="text-muted-foreground px-5 py-1 text-xs">Drafts</p>
                  {documents
                    .filter((doc) => unpublishedDraftIds.has(doc.id.id))
                    .map((doc) => (
                      <div key={doc.id.id} role="listitem">
                        <button
                          type="button"
                          aria-current={doc.id.id === activeDocumentId?.id ? 'page' : undefined}
                          className={cn(
                            'hover:bg-accent/60 focus-visible:ring-ring flex h-8 w-full items-center gap-2 rounded-md pr-2 pl-5 text-left text-sm outline-none focus-visible:ring-2',
                            doc.id.id === activeDocumentId?.id && 'bg-accent text-accent-foreground',
                          )}
                          onClick={() => onNavigate(doc.id)}
                        >
                          <FileText aria-label="Unpublished draft" className="size-4 shrink-0 text-yellow-500" />
                          <span className="truncate">{titleOf(doc)}</span>
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

type CardNavigationProps = Pick<SiteFileBrowserProps, 'activeDocumentId' | 'onNavigate' | 'onPrefetch'>

/**
 * One navigation row and, once expanded, its Card targets. Navigation follows Card embeds only; document paths play no
 * part in it. A row reads the indexer's document info, which carries the title, kind, and navigation Cards, so it never
 * loads document content. Only an address the info cannot answer, because it moved or is missing, loads the resource
 * to follow redirects. Collapsed descendants never mount. Rows read what is already available without subscribing: the
 * app syncs followed spaces on its own, and a Card into another space must not start syncing that space just by
 * rendering its row.
 */
function CardNavigationBranch(props: CardNavigationProps & {id: UnpackedHypermediaId; ancestors: string[]}) {
  // A Card may name its target by domain (hm://example.com/page). Resolve it to the
  // account first, as embeds do: document queries need an account ID.
  const isDomain = props.id.uid.includes('.')
  const resolved = useResolvedHmId(isDomain ? props.id.id : undefined)
  if (!isDomain) return <CardNavigationRow {...props} />
  if (resolved.id) {
    return <CardNavigationRow {...props} id={latestId(hmId(resolved.id.uid, {path: resolved.id.path}))} />
  }
  return (
    <div role="status" className="text-muted-foreground flex h-8 items-center gap-2 pl-5 text-xs">
      {resolved.isLoading ? (
        <>
          <Spinner />
          Loading…
        </>
      ) : (
        `Could not resolve ${props.id.id}.`
      )}
    </div>
  )
}

function CardNavigationRow({
  id,
  ancestors,
  ...props
}: CardNavigationProps & {
  id: UnpackedHypermediaId
  ancestors: string[]
}) {
  const info = useDocumentInfo(id, {useErrorBoundary: false})
  const indexed = info.data && !info.data.redirectInfo ? info.data : null
  const resource = useResource(info.isInitialLoading || indexed ? null : id, {useErrorBoundary: false})
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const resolvedId = indexed
    ? latestId(hmId(indexed.id.uid, {path: indexed.id.path}))
    : resource.data?.type === 'document'
      ? latestId(hmId(resource.data.id.uid, {path: resource.data.id.path}))
      : id
  const branchIds = [...ancestors, id.id, resolvedId.id]
  const navigationCards = indexed ? indexed.navigationCards ?? [] : null
  const targets = useMemo(
    () =>
      navigationCards
        ? getIndexedCardNavigationTargets(navigationCards)
        : getCardNavigationTargets(document?.content ?? []),
    [navigationCards, document?.content],
  )
  const children = targets.filter((target) => !branchIds.includes(target.id))
  const isRoot = ancestors.length === 0
  const active = props.activeDocumentId
  const containsActive = children.some((child) => child.id === active?.id)
  const [expanded, setExpanded] = useState(containsActive)
  useEffect(() => {
    if (containsActive) setExpanded(true)
  }, [containsActive])

  // A moved address can resolve back to an ancestor even when its written link differs.
  if (ancestors.includes(resolvedId.id)) return null

  const metadata = indexed ? indexed.metadata : document?.metadata
  const title = metadata?.name || id.path?.at(-1) || 'Untitled Document'
  const isActive = active?.id === id.id || active?.id === resolvedId.id
  const isLoading = info.isInitialLoading || (!indexed && (resource.isInitialLoading || resource.isDiscovering))
  const unavailable = !isLoading && !indexed && (!document || resource.isError)
  const hasChildren = children.length > 0
  const contents = (
    <>
      {isLoading ? (
        <div
          role="status"
          aria-label={`Loading ${isRoot ? 'navigation' : title}`}
          className="text-muted-foreground flex h-8 items-center gap-2 pl-5 text-xs"
        >
          <Spinner />
          Loading…
        </div>
      ) : unavailable ? (
        <div role="status" className="text-muted-foreground py-2 pl-5 text-xs">
          Could not load {isRoot ? 'navigation' : 'page'}.
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => {
              void info.refetch()
              void resource.refetch()
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        children.map((child) => <CardNavigationBranch key={child.id} id={child} ancestors={branchIds} {...props} />)
      )}
      {isRoot && !isLoading && !unavailable && children.length === 0 ? (
        <p className="text-muted-foreground px-5 py-2 text-xs">No pages in navigation</p>
      ) : null}
    </>
  )
  if (isRoot) return contents
  return (
    <div role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className={cn('flex min-w-0 items-center rounded-md', isActive && 'bg-accent text-accent-foreground')}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
            className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 w-5 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="h-8 w-5 shrink-0" />
        )}
        <button
          type="button"
          aria-current={isActive ? 'page' : undefined}
          onPointerEnter={() => props.onPrefetch?.(resolvedId)}
          onFocus={() => props.onPrefetch?.(resolvedId)}
          onClick={() => props.onNavigate(resolvedId)}
          className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left text-sm outline-none focus-visible:ring-2"
        >
          <DocumentKindIcon
            kind={getDocumentKind(
              indexed
                ? {metadata: indexed.metadata, visibility: indexed.visibility, isCollection: indexed.isCollection}
                : {
                    metadata: document?.metadata,
                    visibility: document?.visibility,
                    isCollection: deriveDocumentType(document?.content, resolvedId) === 'collection',
                  },
            )}
            className="size-4 shrink-0"
          />
          <span className="truncate">{title}</span>
        </button>
      </div>
      {expanded && hasChildren ? (
        <div role="group" className="pl-4">
          {contents}
        </div>
      ) : null}
      {!hasChildren && unavailable ? <div className="pl-4">{contents}</div> : null}
    </div>
  )
}
