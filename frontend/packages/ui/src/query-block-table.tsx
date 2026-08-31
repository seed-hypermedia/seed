import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMQueryBlockItemSummary,
  HMQueryTableConfig,
} from '@seed-hypermedia/client/hm-types'
import {formattedDate, getMetadataName, useRouteLink} from '@shm/shared'
import {useInteractionSummaries} from '@shm/shared/models/interaction-summary'
import {
  type ColumnDef,
  type ColumnOrderState,
  type ColumnSizingState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {ChevronDown, ChevronUp, ChevronsUpDown, Columns3, Filter, Plus, Search, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from './components/table'
import {FacePile} from './face-pile'
import {Spinner} from './spinner'
import {
  buildQueryTableColumns,
  filterQueryTableItems,
  getQueryTableValue,
  moveQueryTableColumn,
  type QueryTableFilter,
  queryTableItemMatchesSearch,
} from './query-block-table-model'
import {cn} from './utils'

const INITIAL_ROWS = 25
const ROW_CHUNK = 25

/** Props for the shared read-only Query block Table view. */
export interface QueryBlockTableProps {
  items: HMDocumentInfo[]
  accountsMetadata: HMAccountsMetadata
  interactionSummaries?: Record<string, HMQueryBlockItemSummary>
  isDiscovering?: boolean
  tableConfig?: HMQueryTableConfig
  onTableConfigChange?: (config: HMQueryTableConfig) => void
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
}

function TitleCell({item}: {item: HMDocumentInfo}) {
  const linkProps = useRouteLink({key: 'document', id: item.id})
  return (
    <a {...linkProps} className="block truncate font-medium hover:underline">
      {getMetadataName(item.metadata) || item.path.at(-1) || 'Untitled'}
    </a>
  )
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Renders loaded Query results as an interactive TanStack Table. */
export function QueryBlockTable({
  items,
  accountsMetadata,
  interactionSummaries = {},
  isDiscovering,
  tableConfig,
  onTableConfigChange,
  sorting: controlledSorting,
  onSortingChange,
}: QueryBlockTableProps) {
  const descriptors = useMemo(() => buildQueryTableColumns(items), [items])
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<QueryTableFilter[]>([])
  const [sorting, setSorting] = useState<SortingState>(controlledSorting ?? [])
  const [visibleCount, setVisibleCount] = useState(() => Math.min(items.length, INITIAL_ROWS))
  const sentinelRef = useRef<HTMLDivElement>(null)
  const citationSummaries = useInteractionSummaries(items.map((item) => item.id))
  const citationCounts = useMemo(
    () => Object.fromEntries(items.map((item, index) => [item.id.id, citationSummaries[index]?.data?.citations ?? 0])),
    [citationSummaries, items],
  )

  const configuredColumns = tableConfig?.columns ?? []
  const initialOrder = [
    ...configuredColumns.map((column) => column.id),
    ...descriptors.map((column) => column.id).filter((id) => !configuredColumns.some((column) => column.id === id)),
  ]
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(initialOrder)
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    Object.fromEntries(
      descriptors.map((descriptor) => [
        descriptor.id,
        configuredColumns.find((column) => column.id === descriptor.id)?.visible ?? descriptor.defaultVisible,
      ]),
    ),
  )
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() =>
    Object.fromEntries(configuredColumns.flatMap((column) => (column.width ? [[column.id, column.width]] : []))),
  )

  useEffect(() => {
    setColumnOrder((current) => [
      ...current.filter((id) => descriptors.some((descriptor) => descriptor.id === id)),
      ...descriptors.map((descriptor) => descriptor.id).filter((id) => !current.includes(id)),
    ])
    setColumnVisibility((current) => ({
      ...Object.fromEntries(descriptors.map((descriptor) => [descriptor.id, descriptor.defaultVisible])),
      ...current,
    }))
  }, [descriptors])

  useEffect(() => {
    if (controlledSorting) setSorting(controlledSorting)
  }, [controlledSorting])

  const filteredItems = useMemo(
    () =>
      filterQueryTableItems(
        items.filter((item) => queryTableItemMatchesSearch(item, search)),
        filters,
      ),
    [filters, items, search],
  )

  useEffect(() => setVisibleCount(Math.min(filteredItems.length, INITIAL_ROWS)), [filteredItems])
  useEffect(() => {
    if (visibleCount >= filteredItems.length || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisibleCount((count) => Math.min(filteredItems.length, count + ROW_CHUNK))
      },
      {rootMargin: '800px 0px'},
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [filteredItems.length, visibleCount])

  const columns = useMemo<ColumnDef<HMDocumentInfo>[]>(
    () =>
      descriptors.map((descriptor) => ({
        id: descriptor.id,
        accessorFn: (item) => {
          if (descriptor.id === 'comments') {
            return interactionSummaries[item.id.id]?.comments ?? item.activitySummary?.commentCount ?? 0
          }
          if (descriptor.id === 'children') return interactionSummaries[item.id.id]?.children ?? 0
          if (descriptor.id === 'authors') {
            return item.authors
              .map((author) => accountsMetadata[author]?.metadata?.name || author)
              .join(', ')
              .toLocaleLowerCase()
          }
          if (descriptor.id === 'citations') return citationCounts[item.id.id] ?? 0
          return getQueryTableValue(item, descriptor.id)
        },
        header: descriptor.label,
        minSize: descriptor.id === 'title' ? 180 : 100,
        size: descriptor.id === 'title' ? 240 : 140,
        cell: ({row}) => {
          const item = row.original
          if (descriptor.id === 'title') return <TitleCell item={item} />
          if (descriptor.id === 'authors')
            return <FacePile accounts={item.authors} accountsMetadata={accountsMetadata} />
          if (descriptor.id === 'citations')
            return <span className="text-muted-foreground">{citationCounts[item.id.id] ?? 0}</span>
          if (descriptor.id === 'comments') {
            return <span>{interactionSummaries[item.id.id]?.comments ?? item.activitySummary?.commentCount ?? 0}</span>
          }
          if (descriptor.id === 'children') return <span>{interactionSummaries[item.id.id]?.children ?? 0}</span>
          if (descriptor.id === 'updated')
            return <span className="whitespace-nowrap">{formattedDate(item.updateTime)}</span>
          if (descriptor.id === 'created')
            return <span className="whitespace-nowrap">{formattedDate(item.createTime)}</span>
          return <span className="block truncate">{displayValue(getQueryTableValue(item, descriptor.id))}</span>
        },
      })),
    [accountsMetadata, citationCounts, descriptors, interactionSummaries],
  )

  const activeSorting = sorting
  const table = useReactTable({
    data: filteredItems,
    columns,
    state: {sorting: activeSorting, columnOrder, columnVisibility, columnSizing},
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(activeSorting) : updater
      setSorting(next)
      onSortingChange?.(next)
    },
    onColumnOrderChange: setColumnOrder,
    onColumnVisibilityChange: setColumnVisibility,
    onColumnSizingChange: setColumnSizing,
    columnResizeMode: 'onChange',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  function persistColumns(nextVisibility = columnVisibility) {
    onTableConfigChange?.({
      columns: columnOrder.map((id) => ({id, visible: nextVisibility[id] !== false, width: columnSizing[id]})),
      sorting: activeSorting,
    })
  }

  if (items.length === 0 && isDiscovering) {
    return (
      <div className="bg-muted text-muted-foreground my-4 flex items-center gap-2 rounded-lg p-4 font-sans">
        <Spinner size="small" />
        <span className="italic">Searching for documents…</span>
      </div>
    )
  }

  return (
    <div className="my-4 flex min-w-0 flex-col gap-2 font-sans">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search table…"
            aria-label="Search table"
            className="pl-9"
          />
        </div>
        <details className="relative">
          <summary className="border-border hover:bg-muted flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-sm">
            <Filter className="size-4" /> Filter <ChevronDown className="size-3" />
          </summary>
          <div className="bg-background border-border absolute right-0 z-30 mt-1 flex w-80 flex-col gap-2 rounded-md border p-3 shadow-lg">
            {filters.map((filter, index) => (
              <div key={index} className="flex gap-1">
                <select
                  aria-label="Filter attribute"
                  className="border-border min-w-0 flex-1 rounded border px-2 text-sm"
                  value={filter.columnId}
                  onChange={(event) =>
                    setFilters((current) =>
                      current.map((value, i) => (i === index ? {...value, columnId: event.target.value} : value)),
                    )
                  }
                >
                  {descriptors.map((descriptor) => (
                    <option key={descriptor.id} value={descriptor.id}>
                      {descriptor.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter operator"
                  className="border-border rounded border px-2 text-sm"
                  value={filter.operator}
                  onChange={(event) =>
                    setFilters((current) =>
                      current.map((value, i) =>
                        i === index ? {...value, operator: event.target.value as QueryTableFilter['operator']} : value,
                      ),
                    )
                  }
                >
                  <option value="contains">contains</option>
                  <option value="equals">equals</option>
                  <option value="greaterThan">is greater than</option>
                  <option value="lessThan">is less than</option>
                </select>
                <Input
                  value={filter.value}
                  onChangeText={(value) =>
                    setFilters((current) => current.map((item, i) => (i === index ? {...item, value} : item)))
                  }
                  aria-label="Filter value"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove filter"
                  onClick={() => setFilters((current) => current.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              onClick={() =>
                setFilters((current) => [
                  ...current,
                  {columnId: descriptors[0]?.id ?? 'title', operator: 'contains', value: ''},
                ])
              }
            >
              <Plus className="size-4" /> Add filter
            </Button>
          </div>
        </details>
        <details className="relative">
          <summary className="border-border hover:bg-muted flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border px-3 text-sm">
            <Columns3 className="size-4" /> Columns
          </summary>
          <div className="bg-background border-border absolute right-0 z-30 mt-1 w-56 rounded-md border p-2 shadow-lg">
            {table.getAllLeafColumns().map((column) => (
              <div key={column.id} className="hover:bg-muted flex items-center gap-1 rounded px-2 py-1.5 text-sm">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={column.getIsVisible()}
                    onChange={(event) => {
                      const next = {...columnVisibility, [column.id]: event.target.checked}
                      setColumnVisibility(next)
                      persistColumns(next)
                    }}
                  />
                  <span className="truncate">
                    {descriptors.find((descriptor) => descriptor.id === column.id)?.label}
                  </span>
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${column.id} column left`}
                  onClick={() => {
                    const next = moveQueryTableColumn(columnOrder, column.id, -1)
                    setColumnOrder(next)
                    onTableConfigChange?.({
                      columns: next.map((id) => ({
                        id,
                        visible: columnVisibility[id] !== false,
                        width: columnSizing[id],
                      })),
                      sorting: activeSorting,
                    })
                  }}
                >
                  <ChevronUp className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${column.id} column right`}
                  onClick={() => {
                    const next = moveQueryTableColumn(columnOrder, column.id, 1)
                    setColumnOrder(next)
                    onTableConfigChange?.({
                      columns: next.map((id) => ({
                        id,
                        visible: columnVisibility[id] !== false,
                        width: columnSizing[id],
                      })),
                      sorting: activeSorting,
                    })
                  }}
                >
                  <ChevronDown className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        </details>
      </div>

      {filteredItems.length === 0 ? (
        <div className="text-muted-foreground flex h-28 items-center justify-center rounded-md border text-sm">
          {items.length === 0 ? 'No documents found.' : 'No documents match the current search and filters.'}
        </div>
      ) : (
        <div className="border-border max-w-full touch-pan-x overflow-x-auto overscroll-x-contain rounded-md border">
          <Table className="table-fixed" style={{width: '100%', minWidth: table.getCenterTotalSize()}}>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn('relative', header.column.id === 'title' && 'bg-background sticky left-0 z-20')}
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
                      <button
                        type="button"
                        aria-label={`Resize ${header.column.id} column`}
                        className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize touch-none"
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseUp={() => persistColumns()}
                        onTouchEnd={() => persistColumns()}
                      />
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
                        className={cn(
                          'overflow-hidden',
                          cell.column.id === 'title' && 'bg-background sticky left-0 z-10',
                        )}
                        style={{width: cell.column.getSize()}}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          {visibleCount < filteredItems.length ? <div ref={sentinelRef} className="h-6" aria-hidden="true" /> : null}
        </div>
      )}
    </div>
  )
}
