import type {HMDocumentInfo, HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {isDraftPlaceholderPath, type HMListedDraftWithLocation} from '@shm/shared/draft-breadcrumb-context'
import {useDirectoryWithDrafts} from '@shm/shared/models/entity'
import {
  buildDocumentTree,
  filterDocumentsByTitle,
  flattenTree,
  getAncestorPathKeys,
} from '@shm/shared/utils/all-documents-tree'
import {ChevronDown, ChevronRight, FileText, Grid3X3, Lock, Plus, Search, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {Input} from './components/input'
import {ScrollArea} from './components/scroll-area'
import type {MenuItemType} from './options-dropdown'
import {Spinner} from './spinner'
import {cn} from './utils'

/** Props for the shared site document browser. */
export interface SiteFileBrowserProps {
  siteId: UnpackedHypermediaId
  activeDocumentId: UnpackedHypermediaId | null
  onNavigate: (id: UnpackedHypermediaId) => void
  onPrefetch?: (id: UnpackedHypermediaId) => void
  searchVisible?: boolean
  onSearchVisibleChange?: (visible: boolean) => void
  createMenuItem?: MenuItemType | null
  onCreate?: () => void
}

function titleOf(doc: HMDocumentInfo) {
  return doc.metadata?.name || doc.path?.at(-1) || 'Untitled Document'
}

/** Renders the searchable, expandable document hierarchy for a site. */
export function SiteFileBrowser({
  siteId,
  activeDocumentId,
  onNavigate,
  onPrefetch,
  searchVisible = false,
  onSearchVisibleChange,
  createMenuItem,
  onCreate,
}: SiteFileBrowserProps) {
  const {directory, drafts, isLoading} = useDirectoryWithDrafts(siteId, {mode: 'AllDescendants'})
  const [query, setQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (searchVisible) searchInputRef.current?.focus()
  }, [searchVisible])

  useEffect(() => {
    const activeAncestors = getAncestorPathKeys(activeDocumentId?.path)
    if (!activeAncestors.length) return
    setExpandedPaths((current) => new Set(Array.from(current).concat(activeAncestors)))
  }, [activeDocumentId?.id])

  const {documents, unpublishedDraftIds} = useMemo(() => {
    const draftEdits = new Map(
      drafts
        .filter((draft): draft is HMListedDraft & {editId: UnpackedHypermediaId} =>
          Boolean((draft as HMListedDraftWithLocation).editId),
        )
        .map((draft) => [draft.editId.id, draft]),
    )
    const published = (directory ?? []).map((document) => {
      const draft = draftEdits.get(document.id.id)
      return draft
        ? {
            ...document,
            metadata: {...document.metadata, ...draft.metadata},
            isCollection: draft.isCollection ?? document.isCollection,
          }
        : document
    })
    const unpublished = drafts.flatMap((draft) => {
      const {editId, locationId} = draft as HMListedDraftWithLocation
      if (!locationId || (editId && !isDraftPlaceholderPath(editId.path, draft.id))) return []
      const path = [...(locationId.path ?? []), `-${draft.id}`]
      return [
        {
          id: hmId(locationId.uid, {path}),
          path,
          metadata: draft.metadata,
          isCollection: draft.isCollection ?? false,
          visibility: draft.visibility ?? 'PUBLIC',
        } as HMDocumentInfo,
      ]
    })
    return {
      documents: [...published, ...unpublished],
      unpublishedDraftIds: new Set(unpublished.map((draft) => draft.id.id)),
    }
  }, [directory, drafts])
  const tree = useMemo(() => buildDocumentTree(documents), [documents])
  const rows = useMemo(() => flattenTree(tree, expandedPaths), [expandedPaths, tree])
  const matches = useMemo(() => filterDocumentsByTitle(documents, query), [documents, query])
  const visibleDocuments = query.trim() ? matches : rows.map((row) => row.doc)
  const rowById = useMemo(() => new Map(rows.map((row) => [row.doc.id.id, row])), [rows])
  const createItems = createMenuItem?.children?.filter((item) =>
    ['new-document', 'new-document-collection', 'new-collection', 'new-private-document'].includes(item.key),
  )

  function toggle(pathKey: string) {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  }

  function closeSearch() {
    setQuery('')
    onSearchVisibleChange?.(false)
  }

  return (
    <div className="dark:bg-background flex h-full min-h-0 flex-col bg-white">
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
        <div className="p-2">
          <div
            className={cn(
              'mb-1 flex min-w-0 items-center rounded-md',
              !activeDocumentId?.path?.length && 'bg-accent text-accent-foreground',
            )}
          >
            <button
              type="button"
              aria-current={!activeDocumentId?.path?.length ? 'page' : undefined}
              className="hover:bg-accent/60 focus-visible:ring-ring flex h-8 min-w-0 flex-1 items-center rounded-md px-2 text-left text-sm font-medium outline-none focus-visible:ring-2"
              onClick={() => onNavigate(siteId)}
            >
              <span className="truncate">Home</span>
            </button>
            {createItems?.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="iconSm" aria-label="Create root document" className="ml-auto shrink-0">
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
                      ) : (
                        <Lock className="size-4" />
                      )}
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
          {isLoading ? (
            <div className="flex h-24 items-center justify-center" aria-label="Loading documents">
              <Spinner />
            </div>
          ) : visibleDocuments.length === 0 ? (
            <p className="text-muted-foreground p-6 text-center text-sm">
              {query.trim() ? 'No documents found' : 'No documents to browse'}
            </p>
          ) : (
            <div role={query.trim() ? 'list' : 'tree'} aria-label="Space documents">
              {visibleDocuments.map((doc) => {
                const row = rowById.get(doc.id.id)
                const isFiltered = !!query.trim()
                const isActive = doc.id.id === activeDocumentId?.id
                const isExpanded = row ? expandedPaths.has(row.pathKey) : false
                return (
                  <div
                    key={doc.id.id}
                    role={isFiltered ? 'listitem' : 'treeitem'}
                    aria-expanded={!isFiltered && row?.hasChildren ? isExpanded : undefined}
                    style={{paddingLeft: isFiltered ? 0 : (row?.depth ?? 0) * 16}}
                    className={cn(
                      'flex min-w-0 items-center rounded-md',
                      isActive && 'bg-accent text-accent-foreground',
                    )}
                  >
                    {!isFiltered && row?.hasChildren ? (
                      <button
                        type="button"
                        className="hover:bg-accent/60 focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-md p-0 outline-none focus-visible:ring-2"
                        aria-label={isExpanded ? `Collapse ${titleOf(doc)}` : `Expand ${titleOf(doc)}`}
                        onClick={() => toggle(row.pathKey)}
                      >
                        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                    ) : (
                      <span className="size-6 shrink-0" />
                    )}
                    <button
                      type="button"
                      aria-current={isActive ? 'page' : undefined}
                      onPointerEnter={() => onPrefetch?.(doc.id)}
                      onFocus={() => onPrefetch?.(doc.id)}
                      onClick={() => onNavigate(doc.id)}
                      className="hover:bg-accent/60 focus-visible:ring-ring flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-sm outline-none focus-visible:ring-2"
                    >
                      {doc.isCollection ? (
                        <Grid3X3 aria-label="Collection" className="size-3 shrink-0" />
                      ) : doc.visibility === 'PRIVATE' ? (
                        <Lock aria-label="Private document" className="size-3 shrink-0" />
                      ) : unpublishedDraftIds.has(doc.id.id) ? (
                        <FileText aria-label="Unpublished draft" className="size-3 shrink-0 text-yellow-500" />
                      ) : (
                        <FileText aria-label="Document" className="text-muted-foreground size-3 shrink-0" />
                      )}
                      <span className="truncate">{titleOf(doc)}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
