import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '@shm/shared'
import {useDirectory} from '@shm/shared/models/entity'
import {
  buildDocumentTree,
  filterDocumentsByTitle,
  flattenTree,
  getAncestorPathKeys,
} from '@shm/shared/utils/all-documents-tree'
import {ChevronDown, ChevronRight, Lock, Search} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {ScrollArea} from './components/scroll-area'
import {Spinner} from './spinner'
import {cn} from './utils'

/** Props for the shared site document browser. */
export interface SiteFileBrowserProps {
  siteId: UnpackedHypermediaId
  activeDocumentId: UnpackedHypermediaId | null
  onNavigate: (id: UnpackedHypermediaId) => void
  onPrefetch?: (id: UnpackedHypermediaId) => void
}

function titleOf(doc: HMDocumentInfo) {
  return getMetadataName(doc.metadata) || doc.path?.at(-1) || 'Untitled'
}

/** Renders the searchable, expandable document hierarchy for a site. */
export function SiteFileBrowser({siteId, activeDocumentId, onNavigate, onPrefetch}: SiteFileBrowserProps) {
  const directory = useDirectory(siteId, {mode: 'AllDescendants'})
  const [query, setQuery] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  useEffect(() => {
    const activeAncestors = getAncestorPathKeys(activeDocumentId?.path)
    if (!activeAncestors.length) return
    setExpandedPaths((current) => new Set(Array.from(current).concat(activeAncestors)))
  }, [activeDocumentId?.id])

  const documents = directory.data ?? []
  const tree = useMemo(() => buildDocumentTree(documents), [documents])
  const rows = useMemo(() => flattenTree(tree, expandedPaths), [expandedPaths, tree])
  const matches = useMemo(() => filterDocumentsByTitle(documents, query), [documents, query])
  const visibleDocuments = query.trim() ? matches : rows.map((row) => row.doc)
  const rowById = useMemo(() => new Map(rows.map((row) => [row.doc.id.id, row])), [rows])

  function toggle(pathKey: string) {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  }

  return (
    <div className="dark:bg-background flex h-full min-h-0 flex-col bg-white">
      <div className="border-border border-b p-3">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            aria-label="Filter documents"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter documents…"
            className="pl-9"
          />
        </div>
      </div>

      <ScrollArea className="scroll-area-full-height min-h-0 flex-1" viewportClassName="[&>div]:!block">
        <div className="p-2">
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
            <div role={query.trim() ? 'list' : 'tree'} aria-label="Site documents">
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
                      {doc.visibility === 'PRIVATE' ? (
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
