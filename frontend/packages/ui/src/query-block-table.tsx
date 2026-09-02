import {HMDocumentInfo, type HMQueryTableConfig} from '@seed-hypermedia/client/hm-types'
import {formattedDate, getMetadataName, useRouteLink} from '@shm/shared'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {ChevronDown, ChevronUp, ChevronsUpDown, FileText, MessageSquare, Share2} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './components/table'
import {FacePile} from './face-pile'
import {
  getDocumentTags,
  getQueryTableSortValue,
  getQueryTableValue,
  queryTableValueToString,
  type QueryTableColumn,
  type QueryTableValueContext,
} from './query-block-table-model'
import {cn} from './utils'

const INITIAL_ROWS = 25
const ROW_CHUNK = 25

export interface QueryBlockTableProps {
  items: HMDocumentInfo[]
  descriptors: QueryTableColumn[]
  context: QueryTableValueContext
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
  columnVisibility?: Record<string, boolean>
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void
  columnSizing?: Record<string, number>
  onColumnSizingChange?: (sizing: Record<string, number>) => void
  tableConfig?: HMQueryTableConfig
  onTableConfigChange?: (config: HMQueryTableConfig) => void
  isDiscovering?: boolean
}

export function QueryBlockTable({
  items,
  descriptors,
  context,
  sorting,
  onSortingChange,
  columnOrder,
  onColumnOrderChange,
  columnVisibility,
  onColumnVisibilityChange,
  columnSizing,
  onColumnSizingChange,
}: QueryBlockTableProps) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(items.length, INITIAL_ROWS))
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(Math.min(items.length, INITIAL_ROWS))
  }, [items])

  useEffect(() => {
    if (visibleCount >= items.length || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((count) => Math.min(items.length, count + ROW_CHUNK))
        }
      },
      {rootMargin: '800px 0px'},
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [items.length, visibleCount])

  const columns = useMemo<ColumnDef<HMDocumentInfo>[]>(
    () =>
      descriptors.map((descriptor) => ({
        id: descriptor.id,
        accessorFn: (item) => getQueryTableSortValue(item, descriptor.id, context),
        header: descriptor.label,
        size: descriptor.id === 'title' ? 240 : descriptor.id === 'tags' ? 180 : 140,
        minSize: descriptor.id === 'title' ? 180 : 100,
        cell: ({row}) => {
          const item = row.original
          if (descriptor.id === 'title') return <TitleCell item={item} />
          if (descriptor.id === 'tags') {
            const tags = getDocumentTags(item)
            return tags.length ? (
              <span className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-100"
                  >
                    {tag}
                  </span>
                ))}
              </span>
            ) : null
          }
          if (descriptor.id === 'authors')
            return <FacePile accounts={item.authors} accountsMetadata={context.accountsMetadata ?? {}} />
          const value = getQueryTableValue(item, descriptor.id, context)
          if (descriptor.id === 'updated' || descriptor.id === 'created') {
            return <span className="whitespace-nowrap">{formattedDate(value as any)}</span>
          }
          if (descriptor.id === 'children' || descriptor.id === 'comments' || descriptor.id === 'citations') {
            const icon =
              descriptor.id === 'children' ? (
                <FileText className="size-4" />
              ) : descriptor.id === 'comments' ? (
                <MessageSquare className="size-4" />
              ) : (
                <Share2 className="size-4" />
              )
            return (
              <span className="inline-flex items-center gap-1">
                {icon}
                {String(value)}
              </span>
            )
          }
          return <span className="block truncate">{queryTableValueToString(value)}</span>
        },
      })),
    [context, descriptors],
  )

  const activeSorting = sorting ?? []
  const activeColumnOrder = columnOrder ?? descriptors.map((d) => d.id)
  const activeColumnVisibility = columnVisibility ?? {}

  const table = useReactTable({
    data: items,
    columns,
    state: {
      sorting: activeSorting,
      columnOrder: activeColumnOrder,
      columnVisibility: activeColumnVisibility,
      columnSizing: columnSizing ?? {},
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(activeSorting) : updater
      onSortingChange?.(next)
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === 'function' ? updater(activeColumnOrder) : updater
      onColumnOrderChange?.(next)
    },
    onColumnVisibilityChange: (updater) => {
      const next = typeof updater === 'function' ? updater(activeColumnVisibility) : updater
      onColumnVisibilityChange?.(next)
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(columnSizing ?? {}) : updater
      onColumnSizingChange?.(next)
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (items.length === 0) {
    return (
      <div className="text-muted-foreground flex h-28 items-center justify-center rounded-md border text-sm">
        No documents found.
      </div>
    )
  }

  return (
    <div className="border-border max-w-full overflow-x-auto overscroll-x-contain rounded-b-md border-x border-b">
      <Table style={{width: '100%', minWidth: table.getTotalSize()}}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={cn(
                    'text-muted-foreground relative text-xs font-medium tracking-wide uppercase',
                    header.column.id === 'title' && 'bg-background sticky left-0 z-20',
                  )}
                  style={{width: header.getSize()}}
                  aria-sort={
                    header.column.getIsSorted() === 'asc'
                      ? 'ascending'
                      : header.column.getIsSorted() === 'desc'
                        ? 'descending'
                        : 'none'
                  }
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      className="absolute inset-0 flex w-full items-center justify-start gap-1 px-2"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {header.column.getIsSorted() === 'asc' ? (
                        <ChevronUp className="size-3" />
                      ) : header.column.getIsSorted() === 'desc' ? (
                        <ChevronDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3" />
                      )}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table
            .getRowModel()
            .rows.slice(0, visibleCount)
            .map((row) => (
              <TableRow key={row.original.id.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn('overflow-hidden', cell.column.id === 'title' && 'bg-background sticky left-0 z-10')}
                    style={{width: cell.column.getSize()}}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {visibleCount < items.length ? <div ref={sentinelRef} className="h-6" aria-hidden="true" /> : null}
    </div>
  )
}

function TitleCell({item}: {item: HMDocumentInfo}) {
  const linkProps = useRouteLink({key: 'document', id: item.id})
  return (
    <a
      {...linkProps}
      className="block truncate font-medium hover:underline"
      title={getMetadataName(item.metadata) || item.path.at(-1) || 'Untitled'}
    >
      {getMetadataName(item.metadata) || item.path.at(-1) || 'Untitled'}
    </a>
  )
}
