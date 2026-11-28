import {unpackHmId, type HMDocumentInfo, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getDocumentTitle, hmId, useRouteLink} from '@shm/shared'
import {useDraftsForAccountSafe} from '@shm/shared/draft-breadcrumb-context'
import {useDirectory, useDocumentInfo, useResolvedHmId} from '@shm/shared/models/entity'
import {MAX_REDIRECT_HOPS} from '@shm/shared/redirects'
import {isDraftPathSegment} from '@shm/shared/utils/breadcrumbs'
import {latestId} from '@shm/shared/utils/entity-id-url'
import {filterDocumentsByTitle, listSpaceDocuments} from '@shm/shared/utils/all-documents-tree'
import {getIndexedCardNavigationTargets} from '@shm/shared/utils/card-navigation'
import {useNavRouteOrNull} from '@shm/shared/utils/navigation'
import {
  Blocks,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Grid3X3,
  Home,
  Layers,
  Lock,
  Plus,
  Search,
  X,
} from 'lucide-react'
import {useEffect, useMemo, useRef, useState, type ComponentProps} from 'react'
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
  onAfterNavigate?: () => void
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
  return getDocumentTitle(doc, 'Untitled Document')
}

function DocumentLink({
  documentId,
  onAfterNavigate,
  ...props
}: ComponentProps<'a'> & {documentId: UnpackedHypermediaId; onAfterNavigate?: () => void}) {
  const {href, onClick} = useRouteLink({key: 'document', id: documentId}, {onClick: onAfterNavigate})
  return <a {...props} href={href} onClick={onClick} />
}

/** Renders published Card navigation, with directory search and unpublished drafts. */
export function SiteFileBrowser({
  siteId,
  activeDocumentId,
  onAfterNavigate,
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

  const {documents, unpublishedDraftIds} = useMemo(() => listSpaceDocuments(directory, drafts), [directory, drafts])
  const matches = useMemo(() => filterDocumentsByTitle(documents, query), [documents, query])
  const navigation: CardNavigationProps = {
    activeDocumentId,
    onAfterNavigate,
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
  const route = useNavRouteOrNull()
  const isAllDocumentsRoute = route?.key === 'all-documents'
  const isHomeActive = !isAllDocumentsRoute && activeDocumentId?.id === homeId.id
  // The All documents count equals the page's All count: published non-home docs plus unpublished drafts.
  const countDirectory = useDirectory(siteId, {mode: 'AllDescendants'})
  const allDocumentsCount = useMemo(() => {
    if (countDirectory.isLoading || countDirectory.isInitialLoading) return null
    const {documents: allDocs} = listSpaceDocuments(countDirectory.data, drafts)
    return allDocs.length
  }, [countDirectory.data, countDirectory.isLoading, countDirectory.isInitialLoading, drafts])
  const allDocumentsLink = useRouteLink({key: 'all-documents', id: hmId(siteId.uid)}, {onClick: onAfterNavigate})
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
            className={cn(
              'flex min-w-0 items-center rounded-md',
              isAllDocumentsRoute && 'bg-accent text-accent-foreground',
            )}
          >
            <a
              {...allDocumentsLink}
              aria-current={isAllDocumentsRoute ? 'page' : undefined}
              className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-5 text-left text-sm outline-none focus-visible:ring-2"
            >
              <Layers className="size-4 shrink-0" />
              <span className="truncate">All documents</span>
              {allDocumentsCount !== null && (
                <span className="text-muted-foreground ml-auto shrink-0 text-xs">{allDocumentsCount}</span>
              )}
            </a>
          </div>
          <div
            className={cn('flex min-w-0 items-center rounded-md', isHomeActive && 'bg-accent text-accent-foreground')}
          >
            <DocumentLink
              documentId={homeId}
              onAfterNavigate={onAfterNavigate}
              aria-current={isHomeActive ? 'page' : undefined}
              className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 pl-5 text-left text-sm outline-none focus-visible:ring-2"
            >
              <Home className="size-4 shrink-0" />
              <span className="truncate">Home</span>
            </DocumentLink>{' '}
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
                      <DocumentLink
                        documentId={navigationId}
                        onAfterNavigate={onAfterNavigate}
                        aria-current={isActive ? 'page' : undefined}
                        onPointerEnter={() => onPrefetch?.(navigationId)}
                        onFocus={() => onPrefetch?.(navigationId)}
                        className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left text-sm outline-none focus-visible:ring-2"
                      >
                        {kind === 'document' && unpublishedDraftIds.has(doc.id.id) ? (
                          <FileText aria-label="Unpublished draft" className="size-4 shrink-0 text-yellow-500" />
                        ) : (
                          <DocumentKindIcon kind={kind} className="size-4 shrink-0" />
                        )}
                        <span className="truncate">{titleOf(doc)}</span>
                      </DocumentLink>
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
                        <DocumentLink
                          documentId={doc.id}
                          onAfterNavigate={onAfterNavigate}
                          aria-current={doc.id.id === activeDocumentId?.id ? 'page' : undefined}
                          className={cn(
                            'hover:bg-accent/60 focus-visible:ring-ring flex h-8 w-full items-center gap-2 rounded-md pr-2 pl-5 text-left text-sm outline-none focus-visible:ring-2',
                            doc.id.id === activeDocumentId?.id && 'bg-accent text-accent-foreground',
                          )}
                        >
                          <FileText aria-label="Unpublished draft" className="size-4 shrink-0 text-yellow-500" />
                          <span className="truncate">{titleOf(doc)}</span>
                        </DocumentLink>
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

type CardNavigationProps = Pick<SiteFileBrowserProps, 'activeDocumentId' | 'onAfterNavigate' | 'onPrefetch'>

/** How a row reached its document through redirects. */
type RedirectWalk = {
  /** Addresses visited so far, starting with the Card's own target. */
  visited: string[]
  /** The first republish address on the way, which keeps presenting the target's document. */
  republishedAt: UnpackedHypermediaId | null
}

type CardNavigationBranchProps = CardNavigationProps & {
  id: UnpackedHypermediaId
  ancestors: string[]
  walk?: RedirectWalk
}

/**
 * One navigation row and, once expanded, its Card targets. Navigation follows Cards only; document paths play no part
 * in it. A row reads only the indexer's document info, which carries the title, kind, and navigation Cards, so it never
 * loads a document. A redirect in that info is followed to its target's info, by the same rules as the document
 * resolver: a move opens the target, while a republish keeps its own address and shows the target. Collapsed
 * descendants never mount. Rows read what is already available without subscribing: the app syncs followed spaces on
 * its own, and a Card into another space must not start syncing that space just by rendering its row.
 */
function CardNavigationBranch(props: CardNavigationBranchProps) {
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

/** Loads a row's document info and, when it is a redirect, hands the row on to the redirect's target. */
function CardNavigationRow({walk, ...props}: CardNavigationBranchProps) {
  const info = useDocumentInfo(props.id, {useErrorBoundary: false})
  const retry = () => void info.refetch()
  const redirect = info.data?.redirectInfo
  const walked = walk ?? {visited: [props.id.id], republishedAt: null}
  if (!redirect) {
    return (
      <CardNavigationEntry
        {...props}
        walk={walked}
        info={info.data ?? null}
        isLoading={info.isInitialLoading}
        onRetry={retry}
      />
    )
  }
  const target = unpackHmId(redirect.target)
  const next = target?.uid ? latestId(hmId(target.uid, {path: target.path})) : null
  if (!next || walked.visited.includes(next.id) || walked.visited.length > MAX_REDIRECT_HOPS) {
    // An unreadable, cyclic, or over-long redirect chain has no document to show.
    return <CardNavigationEntry {...props} walk={walked} info={null} isLoading={false} onRetry={retry} />
  }
  return (
    <CardNavigationBranch
      {...props}
      id={next}
      walk={{
        visited: [...walked.visited, next.id],
        republishedAt: walked.republishedAt ?? (redirect.republish ? props.id : null),
      }}
    />
  )
}

function CardNavigationEntry({
  id,
  ancestors,
  walk,
  info,
  isLoading,
  onRetry,
  ...props
}: CardNavigationProps & {
  id: UnpackedHypermediaId
  ancestors: string[]
  walk: RedirectWalk
  info: HMDocumentInfo | null
  isLoading: boolean
  onRetry: () => void
}) {
  // A move opens its target; a republish keeps presenting its own address.
  const navigationId = walk.republishedAt ? latestId(walk.republishedAt) : id
  const branchIds = [...ancestors, ...walk.visited, navigationId.id]
  const navigationCards = info?.navigationCards
  const targets = useMemo(() => getIndexedCardNavigationTargets(navigationCards ?? []), [navigationCards])
  const children = targets.filter((target) => !branchIds.includes(target.id))
  const isRoot = ancestors.length === 0
  const active = props.activeDocumentId
  const containsActive = children.some((child) => child.id === active?.id)
  const [expanded, setExpanded] = useState(containsActive)
  useEffect(() => {
    if (containsActive) setExpanded(true)
  }, [containsActive])

  // A moved address can resolve back to an ancestor even when its written link differs.
  if (ancestors.includes(id.id) || ancestors.includes(navigationId.id)) return null

  const title = info?.metadata?.name || navigationId.path?.at(-1) || 'Untitled Document'
  const isActive = !!active && (active.id === navigationId.id || walk.visited.includes(active.id))
  const unavailable = !isLoading && !info
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
          <button type="button" className="ml-1 underline" onClick={onRetry}>
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
        <DocumentLink
          documentId={navigationId}
          onAfterNavigate={props.onAfterNavigate}
          aria-current={isActive ? 'page' : undefined}
          onPointerEnter={() => props.onPrefetch?.(navigationId)}
          onFocus={() => props.onPrefetch?.(navigationId)}
          className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md pr-2 text-left text-sm outline-none focus-visible:ring-2"
        >
          <DocumentKindIcon
            kind={getDocumentKind({
              metadata: info?.metadata,
              visibility: info?.visibility,
              isCollection: info?.isCollection,
            })}
            className="size-4 shrink-0"
          />
          <span className="truncate">{title}</span>
        </DocumentLink>
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
