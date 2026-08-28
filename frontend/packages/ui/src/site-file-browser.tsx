import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName, hmId} from '@shm/shared'
import {useDraftsForAccountSafe} from '@shm/shared/draft-breadcrumb-context'
import {useDirectory} from '@shm/shared/models/entity'
import {
  buildDocumentTree,
  filterDocumentsByTitle,
  flattenTree,
  getAncestorPathKeys,
} from '@shm/shared/utils/all-documents-tree'
import {ChevronDown, ChevronRight, FileText, Folder, Grid3X3, Lock, Plus, Search, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {ScrollArea} from './components/scroll-area'
import {Spinner} from './spinner'
import {cn} from './utils'
import type {MenuItemType} from './options-dropdown'

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
  return getMetadataName(doc.metadata) || doc.path?.at(-1) || 'Untitled'
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
  const directory = useDirectory(siteId, {mode: 'AllDescendants'})
  const drafts = useDraftsForAccountSafe(siteId.uid)
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

  const documents = useMemo(() => {
    const listedDrafts = drafts.data ?? []
    const draftFolderStatus = new Map(
      listedDrafts.filter((draft) => draft.editId).map((draft) => [draft.editId!.id, draft.isFolder ?? false]),
    )
    const published = (directory.data ?? []).map((document) => ({
      ...document,
      isFolder: draftFolderStatus.get(document.id.id) ?? document.isFolder,
    }))
    const publishedIds = new Set(published.map((document) => document.id.id))
    const unpublished = listedDrafts.flatMap((draft) => {
      if (draft.editId || !draft.locationId || draft.locationId.uid !== siteId.uid) return []
      const path = [
        ...(draft.locationId.path ?? []),
        `${draft.visibility === 'PRIVATE' ? '-private-' : '-'}${draft.id}`,
      ]
      const id = hmId(siteId.uid, {path})
      if (publishedIds.has(id.id)) return []
      return [
        {
          id,
          path,
          metadata: draft.metadata,
          isFolder: draft.isFolder ?? false,
          visibility: draft.visibility ?? 'PUBLIC',
        } as HMDocumentInfo,
      ]
    })
    return [...published, ...unpublished]
  }, [directory.data, drafts.data, siteId.uid])
  const tree = useMemo(() => buildDocumentTree(documents), [documents])
  const rows = useMemo(() => flattenTree(tree, expandedPaths), [expandedPaths, tree])
  const matches = useMemo(() => filterDocumentsByTitle(documents, query), [documents, query])
  const visibleDocuments = query.trim() ? matches : rows.map((row) => row.doc)
  const rowById = useMemo(() => new Map(rows.map((row) => [row.doc.id.id, row])), [rows])
  const createItems = createMenuItem?.children?.filter((item) =>
    ['new-document', 'new-document-folder', 'new-folder', 'new-private-document'].includes(item.key),
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
                      ) : item.key === 'new-document-folder' || item.key === 'new-folder' ? (
                        <Folder className="size-4" />
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
          {directory.isLoading ? (
            <div className="flex h-24 items-center justify-center" aria-label="Loading documents">
              <Spinner />
            </div>
          ) : directory.isError ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center text-sm">
              <p>Couldn’t load documents.</p>
              <Button size="sm" variant="outline" onClick={() => directory.refetch()}>
                Retry
              </Button>
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
                      {doc.isFolder ? (
                        <Grid3X3 aria-label="Folder" className="size-3 shrink-0" />
                      ) : doc.visibility === 'PRIVATE' ? (
                        <Lock aria-label="Private document" className="size-3 shrink-0" />
                      ) : null}
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
