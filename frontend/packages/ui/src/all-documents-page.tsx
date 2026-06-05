import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName, hmId} from '@shm/shared'
import {useAccountsMetadata, useDirectory} from '@shm/shared/models/entity'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {buildDocumentTree, type DocumentTreeNode, type FlatRow, flattenTree} from '@shm/shared/utils/all-documents-tree'
import {formattedDate} from '@shm/shared/utils/date'
import {type ColumnDef, flexRender, getCoreRowModel, type SortingState, useReactTable} from '@tanstack/react-table'
import {ChevronDown, ChevronRight, ChevronsUpDown, MessageSquare, Search, TextQuote} from 'lucide-react'
import {useMemo, useState} from 'react'
// Bulk selection is hidden until bulk actions exist. Keep this import with the commented selection code below.
// import {Checkbox} from './components/checkbox'
import {Input} from './components/input'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './components/table'
import {FacePile} from './face-pile'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {cn} from './utils'

export interface AllDocumentsPageProps {
  siteId: UnpackedHypermediaId
  scopeId?: UnpackedHypermediaId
  onNavigateToDocument: (id: UnpackedHypermediaId) => void
}

function pathKeyOf(doc: HMDocumentInfo) {
  return doc.path?.join('/') ?? ''
}

function titleOf(doc: HMDocumentInfo) {
  return getMetadataName(doc.metadata) || doc.path?.at(-1) || 'Untitled'
}

function pathLabelOf(doc: HMDocumentInfo) {
  return doc.path?.length ? `/${doc.path.join('/')}` : null
}

function dateValue(doc: HMDocumentInfo) {
  const updateTime = doc.updateTime
  if (typeof updateTime === 'string') return new Date(updateTime).getTime() / 1000
  const seconds = updateTime?.seconds
  if (typeof seconds === 'bigint') return Number(seconds)
  if (typeof seconds === 'number') return seconds
  return 0
}

function filterTree(nodes: DocumentTreeNode[], query: string): {nodes: DocumentTreeNode[]; expandedPaths: Set<string>} {
  const normalized = query.trim().toLowerCase()
  const expandedPaths = new Set<string>()
  if (!normalized) return {nodes, expandedPaths}

  function visit(node: DocumentTreeNode): DocumentTreeNode | null {
    const ownText = `${titleOf(node.doc)} ${node.doc.path?.join('/') ?? ''}`.toLowerCase()
    const matchingChildren = node.children.map(visit).filter((child): child is DocumentTreeNode => !!child)
    if (ownText.includes(normalized) || matchingChildren.length > 0) {
      if (matchingChildren.length > 0) expandedPaths.add(pathKeyOf(node.doc))
      return {...node, children: matchingChildren}
    }
    return null
  }

  return {nodes: nodes.map(visit).filter((node): node is DocumentTreeNode => !!node), expandedPaths}
}

function compareRows(columnId: string, desc: boolean) {
  return (a: DocumentTreeNode, b: DocumentTreeNode) => {
    let result = 0
    if (columnId === 'comments') {
      result = (a.doc.activitySummary?.commentCount ?? 0) - (b.doc.activitySummary?.commentCount ?? 0)
    } else if (columnId === 'updated') {
      result = dateValue(a.doc) - dateValue(b.doc)
    } else {
      result = titleOf(a.doc).localeCompare(titleOf(b.doc))
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

export function AllDocumentsPage({siteId, scopeId, onNavigateToDocument}: AllDocumentsPageProps) {
  const queryScopeId = scopeId ?? hmId(siteId.uid)
  const directory = useDirectory(queryScopeId, {mode: 'AllDescendants'})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [sorting, setSorting] = useState<SortingState>([])
  // Bulk selection is hidden until bulk actions exist. Keep this state with the commented selection code below.
  // const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildDocumentTree(directory.data ?? []), [directory.data])
  const filtered = useMemo(() => filterTree(tree, filter), [tree, filter])
  const effectiveExpandedPaths = useMemo(() => {
    if (!filter.trim()) return expandedPaths
    const merged = new Set<string>()
    expandedPaths.forEach((path) => merged.add(path))
    filtered.expandedPaths.forEach((path) => merged.add(path))
    return merged
  }, [expandedPaths, filter, filtered.expandedPaths])
  const sortFn = useMemo(() => {
    const sort = sorting[0]
    if (!sort) return undefined
    return compareRows(sort.id, sort.desc)
  }, [sorting])
  const rows = useMemo(
    () => flattenTree(filtered.nodes, effectiveExpandedPaths, sortFn),
    [filtered.nodes, effectiveExpandedPaths, sortFn],
  )

  const authorUids = useMemo(() => {
    const uids = new Set<string>()
    for (const row of rows) {
      for (const author of row.doc.authors || []) uids.add(author)
    }
    return Array.from(uids)
  }, [rows])
  const accountsMetadata = useAccountsMetadata(authorUids)

  // Bulk selection is hidden until bulk actions exist.
  // const visiblePathKeys = useMemo(() => rows.map((row) => row.pathKey), [rows])
  // const selectedVisibleCount = visiblePathKeys.filter((key) => selectedPaths.has(key)).length
  // const allVisibleSelected = visiblePathKeys.length > 0 && selectedVisibleCount === visiblePathKeys.length

  function toggleExpanded(pathKey: string) {
    setExpandedPaths((current) => {
      const next = new Set<string>()
      current.forEach((path) => next.add(path))
      if (next.has(pathKey)) next.delete(pathKey)
      else next.add(pathKey)
      return next
    })
  }

  // Bulk selection is hidden until bulk actions exist.
  // function toggleSelected(pathKey: string, checked: boolean) {
  //   setSelectedPaths((current) => {
  //     const next = new Set<string>()
  //     current.forEach((path) => next.add(path))
  //     if (checked) next.add(pathKey)
  //     else next.delete(pathKey)
  //     return next
  //   })
  // }

  const columns = useMemo<ColumnDef<FlatRow>[]>(
    () => [
      // Bulk selection is hidden until bulk actions exist.
      // {
      //   id: 'select',
      //   size: 40,
      //   header: () => (
      //     <Checkbox
      //       aria-label="Select all visible documents"
      //       checked={allVisibleSelected ? true : selectedVisibleCount > 0 ? 'indeterminate' : false}
      //       onCheckedChange={(checked) => {
      //         const shouldSelect = checked === true
      //         setSelectedPaths((current) => {
      //           const next = new Set<string>()
      //           current.forEach((path) => next.add(path))
      //           for (const key of visiblePathKeys) {
      //             if (shouldSelect) next.add(key)
      //             else next.delete(key)
      //           }
      //           return next
      //         })
      //       }}
      //     />
      //   ),
      //   cell: ({row}) => (
      //     <Checkbox
      //       aria-label={`Select ${titleOf(row.original.doc)}`}
      //       checked={selectedPaths.has(row.original.pathKey)}
      //       onCheckedChange={(checked) => toggleSelected(row.original.pathKey, checked === true)}
      //     />
      //   ),
      // },
      {
        id: 'title',
        accessorFn: (row) => titleOf(row.doc),
        header: 'Title',
        cell: ({row}) => {
          const item = row.original
          const nested = item.depth > 0
          const pathLabel = pathLabelOf(item.doc)
          return (
            <div
              className={cn('flex min-w-0 items-center gap-1', nested && 'border-muted-foreground/20 border-l-2')}
              style={{paddingLeft: nested ? (item.depth - 1) * 24 + 4 : 0}}
            >
              {item.hasChildren ? (
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
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  className="block min-w-0 truncate text-left font-medium hover:underline"
                  onClick={() => onNavigateToDocument(item.doc.id)}
                >
                  {titleOf(item.doc)}
                </button>
                {pathLabel ? <p className="text-muted-foreground truncate text-xs">{pathLabel}</p> : null}
              </div>
            </div>
          )
        },
      },
      {
        id: 'authors',
        size: 120,
        header: 'Authors',
        cell: ({row}) => (
          <FacePile accounts={row.original.doc.authors || []} accountsMetadata={accountsMetadata.data} />
        ),
      },
      {
        id: 'citations',
        size: 90,
        header: 'Citations',
        cell: ({row}) => <CitationCell docId={row.original.doc.id} />,
      },
      {
        id: 'comments',
        size: 100,
        accessorFn: (row) => row.doc.activitySummary?.commentCount ?? 0,
        header: 'Comments',
        cell: ({row}) => (
          <div className="text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="size-3.5" />
            <span>{row.original.doc.activitySummary?.commentCount ?? 0}</span>
          </div>
        ),
      },
      {
        id: 'updated',
        size: 140,
        accessorFn: (row) => dateValue(row.doc),
        header: 'Updated',
        cell: ({row}) => (
          <span className="text-muted-foreground whitespace-nowrap">{formattedDate(row.original.doc.updateTime)}</span>
        ),
      },
      {
        id: 'actions',
        size: 50,
        header: '',
        cell: () => null,
      },
    ],
    [accountsMetadata.data, effectiveExpandedPaths, onNavigateToDocument],
  )

  const table = useReactTable({
    data: rows,
    columns,
    state: {sorting},
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
  })

  return (
    <div className="flex h-full min-h-[520px] flex-col px-6">
      <div className="border-border flex flex-wrap items-end gap-4 border-b px-2 py-6">
        <div className="flex min-w-0 flex-col gap-2">
          <SizableText size="3xl" weight="bold">
            All Documents
          </SizableText>
          <p className="text-muted-foreground text-xs">{directory.data?.length ?? 0} documents in this site</p>
        </div>
        {/* Bulk selection is hidden until bulk actions exist.
        {selectedPaths.size > 0 ? (
          <div className="bg-muted rounded-full px-3 py-1 text-sm">{selectedPaths.size} selected</div>
        ) : null} */}
        <div className="relative ml-auto w-full max-w-sm">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter documents by title…"
            className="pl-9"
            aria-label="Filter documents"
          />
        </div>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-6">
        {directory.isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-muted-foreground flex h-48 items-center justify-center text-sm">
            {filter.trim() ? 'No documents match your filter.' : 'No documents found.'}
          </div>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const canSort =
                      header.column.getCanSort() &&
                      !['select', 'authors', 'citations', 'actions'].includes(header.column.id)
                    const isTitle = header.column.id === 'title'
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(isTitle ? 'w-auto' : 'overflow-hidden')}
                        style={isTitle ? undefined : {width: header.getSize()}}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            className="hover:text-foreground flex items-center gap-1"
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <ChevronsUpDown className="size-3.5" />
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
                  // Bulk selection is hidden until bulk actions exist.
                  // data-state={selectedPaths.has(row.original.pathKey) ? 'selected' : undefined}
                  className={cn(row.original.depth > 0 && 'bg-muted/30', row.original.depth > 1 && 'bg-muted/50')}
                >
                  {row.getVisibleCells().map((cell) => {
                    const isTitle = cell.column.id === 'title'
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(isTitle && 'max-w-0 overflow-hidden', !isTitle && 'overflow-hidden')}
                        style={isTitle ? undefined : {width: cell.column.getSize()}}
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
  )
}
