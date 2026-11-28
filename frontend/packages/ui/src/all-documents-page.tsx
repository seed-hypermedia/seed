import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getDocumentTitle, hmId} from '@shm/shared'
import {useAccount, useAccountsMetadata, useDirectory} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useDraftsForAccountSafe} from '@shm/shared/draft-breadcrumb-context'
import {
  buildDocumentTree,
  type DocumentTreeNode,
  type FlatRow,
  flattenTree,
  listSpaceDocuments,
} from '@shm/shared/utils/all-documents-tree'
import {ALL_DOCUMENTS_DEFAULT_ORDER, type AllDocumentsViewState} from '@shm/shared/utils/all-documents-view'
import {formattedDate} from '@shm/shared/utils/date'
import {type ColumnDef, flexRender, getCoreRowModel, useReactTable} from '@tanstack/react-table'
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  ListTree,
  Lock,
  MessageSquare,
  Rows3,
  Search,
  TextQuote,
} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Input} from './components/input'
import {SegmentedControl} from './components/segmented-control'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './components/table'
import {DocumentKindIcon, getDocumentKind, getDocumentKindLabel, type DocumentKind} from './document-kind-icon'
import {FacePile} from './face-pile'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {cn} from './utils'

/** Sortable All documents columns. `location` is the default sort. */
export type AllDocumentsSortColumn = 'title' | 'location' | 'type' | 'updated'

/** The All documents view state, mirrored in the route URL. Re-exported from shared. */
export type AllDocumentsPageState = AllDocumentsViewState

export interface AllDocumentsPageProps {
  siteId: UnpackedHypermediaId
  scopeId?: UnpackedHypermediaId
  state: AllDocumentsPageState
  onStateChange: (state: AllDocumentsPageState) => void
  onNavigateToDocument: (id: UnpackedHypermediaId, opts?: {newWindow?: boolean}) => void
}

/** Column descriptor for the All documents table, shaped for a future column picker. */
export type AllDocumentsColumn = {
  id: AllDocumentsSortColumn | 'authors' | 'citations' | 'comments'
  label: string
  type: 'text' | 'date' | 'list' | 'number'
  defaultVisible: boolean
}

/** The All documents table columns. Hidden ones stay as descriptors for a future picker. */
export const ALL_DOCUMENTS_COLUMNS: AllDocumentsColumn[] = [
  {id: 'title', label: 'Title', type: 'text', defaultVisible: true},
  {id: 'location', label: 'Location', type: 'text', defaultVisible: true},
  {id: 'type', label: 'Type', type: 'text', defaultVisible: true},
  {id: 'updated', label: 'Updated', type: 'date', defaultVisible: true},
  {id: 'authors', label: 'Authors', type: 'list', defaultVisible: false},
  {id: 'citations', label: 'Citations', type: 'number', defaultVisible: false},
  {id: 'comments', label: 'Comments', type: 'number', defaultVisible: false},
]

function pathKeyOf(doc: HMDocumentInfo) {
  return doc.path?.join('/') ?? ''
}

function titleOf(doc: HMDocumentInfo) {
  return getDocumentTitle(doc, 'Untitled')
}

function dateValue(doc: HMDocumentInfo) {
  const updateTime = doc.updateTime
  if (typeof updateTime === 'string') return new Date(updateTime).getTime() / 1000
  const seconds = updateTime?.seconds
  if (typeof seconds === 'bigint') return Number(seconds)
  if (typeof seconds === 'number') return seconds
  return 0
}

/** The display label for a document's kind. Private maps to "Document" (lock icon stays). */
function kindLabel(kind: DocumentKind): string {
  if (kind === 'private') return 'Document'
  return getDocumentKindLabel(kind)
}

/** A memoized pathKey → title map for ancestor lookups, used by locationTrail and location sort. */
function usePathTitleMap(directory: HMDocumentInfo[] | undefined) {
  return useMemo(() => {
    const map = new Map<string, string>()
    for (const d of directory ?? []) {
      if (d.path?.length) map.set(d.path.join('/'), titleOf(d))
    }
    return map
  }, [directory])
}

/** Builds the full parent trail for a document, starting with "Home", using the precomputed title map. */
function locationTrail(doc: HMDocumentInfo, pathTitles: Map<string, string>): string {
  const path = doc.path ?? []
  if (path.length === 0) return 'Home'
  const parts: string[] = ['Home']
  for (let i = 0; i < path.length - 1; i++) {
    const ancestorPath = path.slice(0, i + 1)
    const key = ancestorPath.join('/')
    const fallback = ancestorPath[ancestorPath.length - 1] ?? ''
    parts.push(pathTitles.get(key) ?? doc.breadcrumbs?.[i]?.name ?? fallback)
  }
  return parts.join(' / ')
}

/** Predicate matching the list view: tab filter + search (title OR location). */
function docMatches(doc: HMDocumentInfo, tab: string, q: string, pathTitles: Map<string, string>): boolean {
  if (tab !== 'all') {
    const kind = getDocumentKind(doc)
    if (tab === 'documents' && kind !== 'document' && kind !== 'private') return false
    if (tab === 'collections' && kind !== 'collection') return false
  }
  const normalized = q.trim().toLowerCase()
  if (!normalized) return true
  const title = titleOf(doc).toLowerCase()
  const location = locationTrail(doc, pathTitles).toLowerCase()
  return title.includes(normalized) || location.includes(normalized)
}

/**
 * Prunes a tree built from the full base list, keeping matches plus all their ancestors.
 * Ancestor-only nodes are marked `contextOnly` for muted rendering. Returns the pruned tree
 * and the set of ancestor paths to auto-expand.
 */
function pruneTree(
  nodes: DocumentTreeNode[],
  tab: string,
  q: string,
  pathTitles: Map<string, string>,
): {nodes: DocumentTreeNode[]; expandedPaths: Set<string>; matchCount: number} {
  const expandedPaths = new Set<string>()
  let matchCount = 0
  const hasFilter = tab !== 'all' || q.trim().length > 0

  function visit(node: DocumentTreeNode): DocumentTreeNode | null {
    const matched = docMatches(node.doc, tab, q, pathTitles)
    const childResults = node.children.map(visit).filter((c): c is DocumentTreeNode => !!c)
    if (matched) {
      matchCount++
      return {...node, children: childResults, contextOnly: false}
    }
    if (childResults.length > 0) {
      if (hasFilter) expandedPaths.add(pathKeyOf(node.doc))
      return {...node, children: childResults, contextOnly: true}
    }
    return null
  }

  const result = nodes.map(visit).filter((n): n is DocumentTreeNode => !!n)
  return {nodes: result, expandedPaths, matchCount}
}

function compareForSort(
  column: AllDocumentsSortColumn,
  desc: boolean,
  pathTitles: Map<string, string>,
): (a: DocumentTreeNode, b: DocumentTreeNode) => number {
  return (a, b) => {
    let result = 0
    if (column === 'updated') {
      result = dateValue(a.doc) - dateValue(b.doc)
    } else if (column === 'title') {
      result = titleOf(a.doc).localeCompare(titleOf(b.doc))
    } else if (column === 'type') {
      const ak = kindLabel(getDocumentKind(a.doc))
      const bk = kindLabel(getDocumentKind(b.doc))
      result = ak.localeCompare(bk) || titleOf(a.doc).localeCompare(titleOf(b.doc))
    } else {
      // location: depth-first path tree, siblings A–Z by title
      const ap = a.doc.path ?? []
      const bp = b.doc.path ?? []
      const len = Math.min(ap.length, bp.length)
      for (let i = 0; i < len; i++) {
        if (ap[i] !== bp[i]) {
          const aKey = ap.slice(0, i + 1).join('/')
          const bKey = bp.slice(0, i + 1).join('/')
          const aName = pathTitles.get(aKey) ?? ap[i] ?? ''
          const bName = pathTitles.get(bKey) ?? bp[i] ?? ''
          result = aName.localeCompare(bName)
          break
        }
      }
      if (result === 0) {
        if (ap.length === bp.length) result = titleOf(a.doc).localeCompare(titleOf(b.doc))
        else result = ap.length - bp.length
      }
    }
    return desc ? -result : result
  }
}

function CitationCell({docId}: {docId: UnpackedHypermediaId}) {
  const summary = useInteractionSummary(docId)
  return (
    <div className="text-muted-foreground flex items-center gap-1.5">
      <TextQuote className="size-3.5" />
      <span>{summary.isLoading ? '…' : summary.data?.citations ?? 0}</span>
    </div>
  )
}

function TypePill({doc}: {doc: HMDocumentInfo}) {
  const kind = getDocumentKind(doc)
  const isCollection = kind === 'collection'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
        isCollection
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {kind === 'private' ? (
        <Lock className="size-3" aria-label="Private document" />
      ) : (
        <DocumentKindIcon kind={kind} className="size-3" />
      )}
      {kindLabel(kind)}
    </span>
  )
}

export function AllDocumentsPage({siteId, scopeId, state, onStateChange, onNavigateToDocument}: AllDocumentsPageProps) {
  const queryScopeId = scopeId ?? hmId(siteId.uid)
  const directory = useDirectory(queryScopeId, {mode: 'AllDescendants'})
  const draftsQuery = useDraftsForAccountSafe(siteId.uid)
  const drafts = draftsQuery.data ?? []
  const account = useAccount(siteId.uid)
  const spaceName = account.data?.metadata?.name || 'this space'

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const {documents, unpublishedDraftIds} = useMemo(
    () => listSpaceDocuments(directory.data, drafts),
    [directory.data, drafts],
  )

  const pathTitles = usePathTitleMap(directory.data)

  // Build the tree from the full base list (not pre-filtered) so ancestors stay attached.
  const fullTree = useMemo(() => buildDocumentTree(documents), [documents])

  // Prune the tree with the same predicate as list view, keeping ancestors for context.
  const {
    nodes: prunedTree,
    expandedPaths: filterExpandedPaths,
    matchCount,
  } = useMemo(() => pruneTree(fullTree, state.tab, state.q, pathTitles), [fullTree, state.tab, state.q, pathTitles])

  // List view rows: flat, matching docs only, in active sort order.
  const listRows = useMemo(() => {
    const sortFn = compareForSort(state.sort, state.order === 'desc', pathTitles)
    const matching = documents.filter((doc) => docMatches(doc, state.tab, state.q, pathTitles))
    return [...matching]
      .sort((a, b) => sortFn({doc: a, children: [], depth: 0}, {doc: b, children: [], depth: 0}))
      .map((doc) => ({doc, depth: 0, hasChildren: false, pathKey: pathKeyOf(doc)}))
  }, [documents, state.sort, state.order, state.tab, state.q, pathTitles])

  const sortFn = useMemo(
    () => compareForSort(state.sort, state.order === 'desc', pathTitles),
    [state.sort, state.order, pathTitles],
  )

  // Tree view: when a filter is active, auto-expand ancestor paths of matches.
  const effectiveExpandedPaths = useMemo(() => {
    if (state.view !== 'tree') return new Set<string>()
    const hasFilter = state.tab !== 'all' || state.q.trim().length > 0
    if (!hasFilter) return expandedPaths
    const merged = new Set<string>()
    expandedPaths.forEach((p) => merged.add(p))
    filterExpandedPaths.forEach((p) => merged.add(p))
    return merged
  }, [expandedPaths, filterExpandedPaths, state.view, state.tab, state.q])

  const treeRows = useMemo(
    () => flattenTree(prunedTree, effectiveExpandedPaths, sortFn),
    [prunedTree, effectiveExpandedPaths, sortFn],
  )

  const rows = state.view === 'tree' ? treeRows : listRows
  const visibleCount = state.view === 'tree' ? matchCount : listRows.length

  const authorUids = useMemo(() => {
    const uids = new Set<string>()
    for (const row of rows) {
      for (const author of row.doc.authors || []) uids.add(author)
    }
    return Array.from(uids)
  }, [rows])
  const accountsMetadata = useAccountsMetadata(authorUids)

  const visibleColumnIds = useMemo(
    () => new Set(ALL_DOCUMENTS_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id)),
    [],
  )

  function toggleExpanded(pathKey: string) {
    setExpandedPaths((current) => {
      const next = new Set<string>()
      current.forEach((path) => next.add(path))
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  }

  function setSort(column: AllDocumentsSortColumn) {
    if (state.sort === column) {
      onStateChange({...state, order: state.order === 'asc' ? 'desc' : 'asc'})
    } else {
      onStateChange({...state, sort: column, order: ALL_DOCUMENTS_DEFAULT_ORDER[column]})
    }
  }

  const columns = useMemo<ColumnDef<FlatRow>[]>(
    () =>
      ALL_DOCUMENTS_COLUMNS.filter((c) => visibleColumnIds.has(c.id)).map((descriptor) => {
        if (descriptor.id === 'title') {
          return {
            id: 'title',
            accessorFn: (row) => titleOf(row.doc),
            header: 'Title',
            cell: ({row}) => {
              const item = row.original
              const isDraft = unpublishedDraftIds.has(item.doc.id.id)
              const nested = state.view === 'tree' && item.depth > 0
              const muted = state.view === 'tree' && item.contextOnly
              return (
                <div
                  className={cn(
                    'flex min-w-0 items-center gap-1',
                    nested && 'border-muted-foreground/20 border-l-2',
                    muted && 'opacity-60',
                  )}
                  style={{paddingLeft: nested ? (item.depth - 1) * 24 + 4 : 0}}
                >
                  {state.view === 'tree' && item.hasChildren ? (
                    <button
                      type="button"
                      aria-label={effectiveExpandedPaths.has(item.pathKey) ? 'Collapse document' : 'Expand document'}
                      className="hover:bg-muted flex size-6 shrink-0 items-center justify-center rounded"
                      onClick={() => toggleExpanded(item.pathKey)}
                    >
                      {effectiveExpandedPaths.has(item.pathKey) ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                  ) : state.view === 'tree' ? (
                    <span className="size-6 shrink-0" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {isDraft ? (
                        <FileText aria-label="Unpublished draft" className="size-4 shrink-0 text-yellow-500" />
                      ) : (
                        <DocumentKindIcon kind={getDocumentKind(item.doc)} className="size-4 shrink-0" />
                      )}
                      <button
                        type="button"
                        className="block min-w-0 truncate text-left font-medium hover:underline"
                        onClick={(event) => {
                          if (event.shiftKey) onNavigateToDocument(item.doc.id, {newWindow: true})
                          else onNavigateToDocument(item.doc.id)
                        }}
                      >
                        {titleOf(item.doc)}
                      </button>
                      {isDraft && <span className="text-muted-foreground shrink-0 text-xs italic">Draft</span>}
                    </div>
                  </div>
                </div>
              )
            },
          }
        }
        if (descriptor.id === 'location') {
          return {
            id: 'location',
            header: 'Location',
            cell: ({row}) => {
              const trail = locationTrail(row.original.doc, pathTitles)
              return (
                <span className="text-muted-foreground block truncate text-sm" title={trail}>
                  {trail}
                </span>
              )
            },
          }
        }
        if (descriptor.id === 'type') {
          return {
            id: 'type',
            header: 'Type',
            cell: ({row}) => <TypePill doc={row.original.doc} />,
          }
        }
        if (descriptor.id === 'updated') {
          return {
            id: 'updated',
            header: 'Updated',
            cell: ({row}) => {
              const time = row.original.doc.updateTime
              return <span className="text-muted-foreground text-sm whitespace-nowrap">{formattedDate(time)}</span>
            },
          }
        }
        if (descriptor.id === 'authors') {
          return {
            id: 'authors',
            header: 'Authors',
            cell: ({row}) => (
              <FacePile accounts={row.original.doc.authors || []} accountsMetadata={accountsMetadata.data} />
            ),
          }
        }
        if (descriptor.id === 'citations') {
          return {
            id: 'citations',
            header: 'Citations',
            cell: ({row}) => <CitationCell docId={row.original.doc.id} />,
          }
        }
        return {
          id: 'comments',
          header: 'Comments',
          cell: ({row}) => (
            <div className="text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              <span>{row.original.doc.activitySummary?.commentCount ?? 0}</span>
            </div>
          ),
        }
      }),
    [
      accountsMetadata.data,
      pathTitles,
      unpublishedDraftIds,
      effectiveExpandedPaths,
      onNavigateToDocument,
      state.view,
      visibleColumnIds,
    ],
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  })

  const isLoading = directory.isLoading || draftsQuery.isLoading
  const countLabel = `${visibleCount} ${visibleCount === 1 ? 'document' : 'documents'}`

  return (
    <div className="flex h-full min-h-[520px] flex-col px-6">
      <div className="flex flex-col gap-3 px-2 pt-6 pb-4">
        <SizableText size="3xl" weight="bold">
          All documents
        </SizableText>
        <p className="text-muted-foreground text-sm">
          Everything in {spaceName}, wherever it lives. The sidebar shows how the space is organised; here you can
          search, filter and sort every document in one place.
        </p>
      </div>
      <div className="border-border bg-muted/30 flex flex-1 flex-col rounded-lg border p-2 sm:p-3">
        <div className="flex flex-wrap items-center gap-3 pb-2 sm:pb-3">
          <div className="relative w-full min-w-0 sm:w-auto sm:min-w-60 sm:flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={state.q}
              onChange={(event) => onStateChange({...state, q: event.target.value})}
              placeholder="Search all documents"
              className="pl-9"
              aria-label="Search all documents"
            />
          </div>
          <SegmentedControl
            value={state.tab}
            onChange={(tab) => onStateChange({...state, tab})}
            options={[
              {value: 'all', label: 'All'},
              {value: 'documents', label: 'Documents'},
              {value: 'collections', label: 'Collections'},
            ]}
          />
          <SegmentedControl
            value={state.view}
            onChange={(view) => onStateChange({...state, view})}
            options={[
              {value: 'list', label: 'List', icon: Rows3},
              {value: 'tree', label: 'Tree', icon: ListTree},
            ]}
            aria-label="View mode"
          />
          <span className="text-muted-foreground ml-auto text-sm">{countLabel}</span>
        </div>
        <div className="bg-background flex-1 overflow-auto rounded-lg border p-2">
          {isLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Spinner />
            </div>
          ) : visibleCount === 0 ? (
            <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
              {state.q.trim() ? 'No documents match your search.' : 'No documents found.'}
            </div>
          ) : (
            <Table className="table-fixed">
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const columnId = header.column.id as AllDocumentsSortColumn
                      const canSort = (['title', 'location', 'type', 'updated'] as const).includes(columnId)
                      const isLocation = columnId === 'location'
                      const isType = columnId === 'type'
                      const hiddenOnSmall = isLocation || isType
                      return (
                        <TableHead
                          key={header.id}
                          className={cn(
                            'text-muted-foreground text-xs font-medium tracking-wide uppercase',
                            isLocation
                              ? 'w-auto'
                              : isType
                                ? 'w-32'
                                : columnId === 'updated'
                                  ? 'w-24 sm:w-36'
                                  : 'overflow-hidden',
                            hiddenOnSmall && 'hidden sm:table-cell',
                          )}
                          aria-sort={
                            state.sort === columnId
                              ? state.order === 'asc'
                                ? 'ascending'
                                : 'descending'
                              : canSort
                                ? 'none'
                                : undefined
                          }
                        >
                          {canSort ? (
                            <button
                              type="button"
                              className="hover:text-foreground flex items-center gap-1"
                              onClick={() => setSort(columnId)}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {state.sort === columnId ? (
                                state.order === 'asc' ? (
                                  <ChevronDown className="size-3 rotate-180" />
                                ) : (
                                  <ChevronDown className="size-3" />
                                )
                              ) : (
                                <ChevronsUpDown className="size-3.5" />
                              )}
                            </button>
                          ) : (
                            flexRender(header.column.columnDef.header, header.getContext())
                          )}
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.original.pathKey}
                    className={cn(row.original.depth > 0 && 'bg-muted/30', row.original.depth > 1 && 'bg-muted/50')}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const isTitle = cell.column.id === 'title'
                      const isLocation = cell.column.id === 'location'
                      const isType = cell.column.id === 'type'
                      const hiddenOnSmall = isLocation || isType
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            isTitle && 'max-w-0 overflow-hidden',
                            !isTitle && 'overflow-hidden',
                            hiddenOnSmall && 'hidden sm:table-cell',
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  )
}
