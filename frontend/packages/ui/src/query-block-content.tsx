import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMQueryBlockItemSummary,
  HMQueryTableConfig,
} from '@seed-hypermedia/client/hm-types'
import {formattedDate, getMetadataName, useRouteLink} from '@shm/shared'
import {useInteractionSummaries} from '@shm/shared/models/interaction-summary'
import {type SortingState} from '@tanstack/react-table'
import {ArrowUpDown, ArrowUp, ArrowDown, FileText, Filter, MessageSquare, Search, Share2, X} from 'lucide-react'
import {ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {Switch} from './components/switch'
import {SelectField} from './form-fields'
import {Spinner} from './spinner'
import {cn} from './utils'
import {
  buildQueryTableColumns,
  filterQueryTableItems,
  getQuerySortColumns,
  getDocumentTags,
  getQueryTableColumnType,
  getQueryTableSortValue,
  getQueryTableValue,
  moveQueryTableColumn,
  type QueryTableColumn,
  type QueryTableFilter,
  type QueryTableValueContext,
  queryTableItemMatchesSearch,
} from './query-block-table-model'
import {QueryBlockTable} from './query-block-table'

const INITIAL_LIST_CHUNK_SIZE = 25
const LIST_CHUNK_SIZE = 25
const LIST_CHUNK_ROOT_MARGIN = '800px 0px'

export interface QueryBlockContentProps {
  items: HMDocumentInfo[]
  style: 'Card' | 'List' | 'Table'
  columnCount?: string | number
  banner?: boolean
  accountsMetadata: HMAccountsMetadata
  /** Per-item contributor UIDs (document authors + comment/mention authors), keyed by doc ID. */
  itemContributors?: Record<string, string[]>
  interactionSummaries?: Record<string, HMQueryBlockItemSummary>
  isDiscovering?: boolean
  prependItems?: ReactNode[]
  bannerContent?: ReactNode
  /** Render card titles as links (hover underline, navigate on first click) instead of whole-card navigation. */
  titleLinkOnly?: boolean
  /** Whether whole cards navigate on click (ignored for the title when titleLinkOnly). */
  navigateCards?: boolean
  tableConfig?: HMQueryTableConfig
  onTableConfigChange?: (config: HMQueryTableConfig) => void
  tableSorting?: SortingState
  onTableSortingChange?: (sorting: SortingState) => void
}

export function QueryBlockContent({
  items,
  style,
  columnCount = '3',
  banner = false,
  accountsMetadata,
  interactionSummaries,
  isDiscovering,
  prependItems,
  bannerContent,
  titleLinkOnly,
  navigateCards,
  tableConfig,
  onTableConfigChange,
  tableSorting,
  onTableSortingChange,
}: QueryBlockContentProps) {
  const descriptors = useMemo(() => buildQueryTableColumns(items), [items])

  const citationSummaries = useInteractionSummaries(items.map((item) => item.id))
  const citationCounts = useMemo(() => {
    const map: Record<string, number> = {}
    items.forEach((item, index) => {
      const summary = citationSummaries[index]
      map[item.id.id] = summary?.data?.citations ?? 0
    })
    return map
  }, [items, citationSummaries])

  const context: QueryTableValueContext = useMemo(
    () => ({
      accountsMetadata,
      interactionSummaries,
      citationCounts,
    }),
    [accountsMetadata, citationCounts, interactionSummaries],
  )

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<QueryTableFilter[]>([])
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnOrder, setColumnOrder] = useState<string[]>(descriptors.map((d) => d.id))
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(descriptors.map((d) => [d.id, d.defaultVisible])),
  )
  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({})

  const tableConfigKey = useMemo(() => JSON.stringify(tableConfig), [tableConfig])
  useEffect(() => {
    const cfg = tableConfig
    const nextOrder: string[] = []
    const nextVisibility: Record<string, boolean> = {}
    const nextSizing: Record<string, number> = {}
    for (const col of cfg?.columns ?? []) {
      nextOrder.push(col.id)
      nextVisibility[col.id] = col.visible
      if (col.width) nextSizing[col.id] = col.width
    }
    for (const descriptor of descriptors) {
      if (!nextOrder.includes(descriptor.id)) nextOrder.push(descriptor.id)
      if (!(descriptor.id in nextVisibility)) nextVisibility[descriptor.id] = descriptor.defaultVisible
    }
    setSorting(tableSorting ?? [])
    setColumnOrder(nextOrder)
    setColumnVisibility(nextVisibility)
    setColumnSizing(nextSizing)
  }, [descriptors, tableConfigKey, tableSorting])

  const getTableConfig = useCallback(
    (overrides?: {
      columnOrder?: string[]
      columnVisibility?: Record<string, boolean>
      columnSizing?: Record<string, number>
    }): HMQueryTableConfig => {
      const order = overrides?.columnOrder ?? columnOrder
      const visibility = overrides?.columnVisibility ?? columnVisibility
      const sizing = overrides?.columnSizing ?? columnSizing
      return {
        columns: order.map((id) => ({
          id,
          visible: visibility[id] !== false,
          width: sizing[id],
        })),
      }
    },
    [columnOrder, columnVisibility, columnSizing],
  )

  const persistTableConfig = useCallback(
    (overrides?: Parameters<typeof getTableConfig>[0]) => {
      onTableConfigChange?.(getTableConfig(overrides))
    },
    [getTableConfig, onTableConfigChange],
  )

  const setSortingAndPersist = useCallback(
    (next: SortingState) => {
      setSorting(next)
      onTableSortingChange?.(next)
    },
    [onTableSortingChange],
  )

  const filteredItems = useMemo(
    () =>
      filterQueryTableItems(items, filters, context, descriptors).filter((item) =>
        queryTableItemMatchesSearch(item, search, descriptors, context),
      ),
    [items, filters, context, search, descriptors],
  )

  const sortedItems = useMemo(() => {
    if (sorting.length === 0) return filteredItems
    const current = sorting[0]
    if (!current) return filteredItems
    const {id, desc} = current
    return [...filteredItems].sort((a, b) => {
      const aValue = getQueryTableSortValue(a, id, context)
      const bValue = getQueryTableSortValue(b, id, context)
      let cmp = 0
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        cmp = aValue - bValue
      } else {
        cmp = String(aValue).localeCompare(String(bValue), undefined, {numeric: true})
      }
      return desc ? -cmp : cmp
    })
  }, [filteredItems, sorting, context])

  const visibleColumnCount = useMemo(() => {
    if (Object.keys(columnVisibility).length === 0) {
      return descriptors.filter((d) => d.defaultVisible).length
    }
    return columnOrder.filter((id) => columnVisibility[id] !== false).length
  }, [columnOrder, columnVisibility, descriptors])

  const toggleColumnVisibility = useCallback(
    (id: string) => {
      setColumnVisibility((current) => {
        const next = {...current, [id]: !current[id]}
        persistTableConfig({columnVisibility: next})
        return next
      })
    },
    [persistTableConfig],
  )

  const moveColumn = useCallback(
    (id: string, offset: -1 | 1) => {
      setColumnOrder((current) => {
        const next = moveQueryTableColumn(current, id, offset)
        persistTableConfig({columnOrder: next})
        return next
      })
    },
    [persistTableConfig],
  )

  if (items.length === 0 && isDiscovering) {
    return (
      <div className="bg-background text-muted-foreground flex items-center gap-2 rounded-lg p-4 font-sans">
        <Spinner size="small" />
        <span className="italic">Searching for documents…</span>
      </div>
    )
  }

  const hasPrependItems = prependItems && prependItems.length > 0
  const hasItems = sortedItems.length > 0 || hasPrependItems

  return (
    <div className="border-border bg-background flex flex-col rounded-md border">
      <QueryBlockToolbar
        showAttributes={style === 'Table'}
        descriptors={descriptors}
        items={items}
        context={context}
        columnOrder={columnOrder}
        columnVisibility={columnVisibility}
        visibleColumnCount={visibleColumnCount}
        toggleColumnVisibility={toggleColumnVisibility}
        moveColumn={moveColumn}
        filters={filters}
        setFilters={setFilters}
        sorting={sorting}
        setSorting={setSortingAndPersist}
        search={search}
        setSearch={setSearch}
      />
      {!hasItems ? (
        <div className="text-muted-foreground flex h-28 items-center justify-center rounded-md border text-sm">
          {items.length === 0 ? 'No documents found.' : 'No documents match the current search and filters.'}
        </div>
      ) : style === 'Table' ? (
        <QueryBlockTable
          items={sortedItems}
          descriptors={descriptors}
          context={context}
          sorting={sorting}
          onSortingChange={setSortingAndPersist}
          columnOrder={columnOrder}
          onColumnOrderChange={setColumnOrder}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          columnSizing={columnSizing}
          onColumnSizingChange={setColumnSizing}
        />
      ) : style === 'Card' ? (
        <QueryBlockCards
          items={sortedItems}
          context={context}
          columnCount={columnCount}
          banner={banner}
          bannerContent={bannerContent}
          prependItems={prependItems}
          navigateCards={navigateCards}
          titleLinkOnly={titleLinkOnly}
        />
      ) : (
        <QueryBlockList items={sortedItems} prependItems={prependItems} context={context} />
      )}
    </div>
  )
}

function QueryBlockToolbar({
  showAttributes,
  descriptors,
  items,
  context,
  columnOrder,
  columnVisibility,
  visibleColumnCount,
  toggleColumnVisibility,
  moveColumn,
  filters,
  setFilters,
  sorting,
  setSorting,
  search,
  setSearch,
}: {
  showAttributes: boolean
  descriptors: QueryTableColumn[]
  items: HMDocumentInfo[]
  context: QueryTableValueContext
  columnOrder: string[]
  columnVisibility: Record<string, boolean>
  visibleColumnCount: number
  toggleColumnVisibility: (id: string) => void
  moveColumn: (id: string, offset: -1 | 1) => void
  filters: QueryTableFilter[]
  setFilters: (filters: QueryTableFilter[]) => void
  sorting: SortingState
  setSorting: (sorting: SortingState) => void
  search: string
  setSearch: (value: string) => void
}) {
  return (
    <div className="border-border bg-muted/30 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
      <div className="flex items-center gap-2">
        <FilterPopover
          descriptors={descriptors}
          items={items}
          context={context}
          filters={filters}
          setFilters={setFilters}
        />
        <SortPopover
          descriptors={getQuerySortColumns(descriptors, columnVisibility)}
          sorting={sorting}
          setSorting={setSorting}
        />
        {showAttributes ? (
          <AttributesPopover
            descriptors={descriptors}
            columnOrder={columnOrder}
            columnVisibility={columnVisibility}
            visibleColumnCount={visibleColumnCount}
            toggleColumnVisibility={toggleColumnVisibility}
            moveColumn={moveColumn}
          />
        ) : null}
      </div>
      <div className="relative w-full sm:w-64">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search documents…"
          aria-label="Search documents"
          className="bg-white pl-9 dark:bg-black"
        />
      </div>
    </div>
  )
}

function FilterPopover({
  descriptors,
  items,
  context,
  filters,
  setFilters,
}: {
  descriptors: QueryTableColumn[]
  items: HMDocumentInfo[]
  context: QueryTableValueContext
  filters: QueryTableFilter[]
  setFilters: (filters: QueryTableFilter[]) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="size-4" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <div className="flex flex-col gap-3">
          {filters.map((filter, index) => (
            <div key={index} className="flex items-center gap-2">
              <SelectField
                id={`filter-column-${index}`}
                options={descriptors.map((d) => ({value: d.id, label: d.label}))}
                value={filter.columnId}
                onValue={(value) => {
                  const nextColumnType = getQueryTableColumnType(
                    value,
                    items[0] ? getQueryTableValue(items[0], value, context) : undefined,
                    descriptors.find((d) => d.id === value),
                  )
                  setFilters(
                    filters.map((f, i) =>
                      i === index
                        ? {
                            ...f,
                            columnId: value,
                            operator:
                              (nextColumnType === 'text' || nextColumnType === 'list') &&
                              (f.operator === 'greaterThan' || f.operator === 'lessThan')
                                ? 'contains'
                                : f.operator,
                          }
                        : f,
                    ),
                  )
                }}
                className="flex-1"
              />
              <SelectField
                id={`filter-operator-${index}`}
                options={getFilterOperatorOptions(filter.columnId, items, context, descriptors)}
                value={filter.operator}
                onValue={(value) =>
                  setFilters(
                    filters.map((f, i) => (i === index ? {...f, operator: value as QueryTableFilter['operator']} : f)),
                  )
                }
              />
              <Input
                value={filter.value}
                onChangeText={(value) => setFilters(filters.map((f, i) => (i === index ? {...f, value} : f)))}
                aria-label="Filter value"
                className="flex-1"
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove filter"
                onClick={() => setFilters(filters.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilters([...filters, {columnId: descriptors[0]?.id ?? 'title', operator: 'contains', value: ''}])
            }
          >
            Add filter
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function getFilterOperatorOptions(
  columnId: string,
  items: HMDocumentInfo[],
  context: QueryTableValueContext,
  descriptors: QueryTableColumn[],
) {
  const descriptor = descriptors.find((d) => d.id === columnId)
  const value = items[0] ? getQueryTableValue(items[0], columnId, context) : undefined
  const type = getQueryTableColumnType(columnId, value, descriptor)
  const options = [
    {value: 'contains', label: 'contains'},
    {value: 'equals', label: 'equals'},
  ]
  if (type !== 'text' && type !== 'list') {
    options.push({value: 'greaterThan', label: '>'}, {value: 'lessThan', label: '<'})
  }
  return options
}

function SortPopover({
  descriptors,
  sorting,
  setSorting,
}: {
  descriptors: QueryTableColumn[]
  sorting: SortingState
  setSorting: (sorting: SortingState) => void
}) {
  const current = sorting[0]
  const columnId = current?.id ?? descriptors[0]?.id ?? 'title'
  const desc = current?.desc ?? false

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown className="size-4" />
          Sort
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex flex-col gap-3">
          <SelectField
            id="sort-column"
            label="Sort by"
            options={descriptors.map((d) => ({value: d.id, label: d.label}))}
            value={columnId}
            onValue={(value) => setSorting([{id: value, desc}])}
          />
          <div className="flex gap-2">
            <Button
              variant={!desc ? 'secondary' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setSorting([{id: columnId, desc: false}])}
            >
              <ArrowUp className="size-4" />
              Asc
            </Button>
            <Button
              variant={desc ? 'secondary' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setSorting([{id: columnId, desc: true}])}
            >
              <ArrowDown className="size-4" />
              Desc
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSorting([])}>
            Clear sort
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function AttributesPopover({
  descriptors,
  columnOrder,
  columnVisibility,
  visibleColumnCount,
  toggleColumnVisibility,
  moveColumn,
}: {
  descriptors: QueryTableColumn[]
  columnOrder: string[]
  columnVisibility: Record<string, boolean>
  visibleColumnCount: number
  toggleColumnVisibility: (id: string) => void
  moveColumn: (id: string, offset: -1 | 1) => void
}) {
  const orderedDescriptors = useMemo(() => {
    const byId = new Map(descriptors.map((d) => [d.id, d]))
    return columnOrder.map((id) => byId.get(id)).filter((d): d is QueryTableColumn => !!d)
  }, [columnOrder, descriptors])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="M4 6h16" />
            <path d="M8 12h12" />
            <path d="M4 18h16" />
          </svg>
          Attributes ({visibleColumnCount})
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <div className="flex flex-col gap-1">
          {orderedDescriptors.map((descriptor, index) => (
            <div key={descriptor.id} className="hover:bg-muted flex items-center gap-2 rounded-md px-2 py-1.5">
              <Switch
                id={`column-${descriptor.id}`}
                checked={columnVisibility[descriptor.id] !== false}
                onCheckedChange={() => toggleColumnVisibility(descriptor.id)}
              />
              <label htmlFor={`column-${descriptor.id}`} className="flex-1 cursor-pointer text-sm">
                {descriptor.label}
              </label>
              <div className="flex items-center">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${descriptor.label} left`}
                  disabled={index === 0}
                  onClick={() => moveColumn(descriptor.id, -1)}
                >
                  <ArrowUp className="size-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Move ${descriptor.label} right`}
                  disabled={index === orderedDescriptors.length - 1}
                  onClick={() => moveColumn(descriptor.id, 1)}
                >
                  <ArrowDown className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function useProgressiveChunk<T>(items: T[]) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(items.length, INITIAL_LIST_CHUNK_SIZE))
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(Math.min(items.length, INITIAL_LIST_CHUNK_SIZE))
  }, [items])

  useEffect(() => {
    if (visibleCount >= items.length || typeof IntersectionObserver === 'undefined') return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisibleCount((count) => Math.min(items.length, count + LIST_CHUNK_SIZE))
        }
      },
      {rootMargin: LIST_CHUNK_ROOT_MARGIN},
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [items.length, visibleCount])

  return {visibleCount, sentinelRef}
}

function QueryBlockList({
  items,
  prependItems,
  context,
}: {
  items: HMDocumentInfo[]
  prependItems?: ReactNode[]
  context: QueryTableValueContext
}) {
  const {visibleCount, sentinelRef} = useProgressiveChunk(items)
  return (
    <div className="flex flex-col">
      {prependItems}
      {items.slice(0, visibleCount).map((item) => (
        <QueryBlockListItem key={item.id.id} item={item} context={context} />
      ))}
      {visibleCount < items.length ? <div ref={sentinelRef} className="h-6" aria-hidden="true" /> : null}
    </div>
  )
}

function QueryBlockListItem({item, context}: {item: HMDocumentInfo; context: QueryTableValueContext}) {
  const title = getMetadataName(item.metadata) || item.path.at(-1) || 'Untitled'
  const tags = getDocumentTags(item)
  return (
    <div
      data-testid="query-row"
      className="group border-border hover:bg-muted/30 flex items-center justify-between gap-3 border-b bg-white px-4 py-3 transition-colors last:border-b-0 dark:bg-black"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          <FileText className="size-5" />
        </div>
        <QueryBlockItemTitle item={item} className="truncate font-medium hover:underline">
          {title}
        </QueryBlockItemTitle>
      </div>
      <div className="flex min-w-0 items-center gap-4">
        {tags.length > 0 && (
          <span className="flex flex-wrap items-center justify-end gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-100"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
        <ItemCounts item={item} context={context} className="shrink-0" />
      </div>
    </div>
  )
}

function QueryBlockCards({
  items,
  context,
  columnCount,
  banner,
  bannerContent,
  prependItems,
  navigateCards,
  titleLinkOnly,
}: {
  items: HMDocumentInfo[]
  context: QueryTableValueContext
  columnCount: string | number
  banner?: boolean
  bannerContent?: ReactNode
  prependItems?: ReactNode[]
  navigateCards?: boolean
  titleLinkOnly?: boolean
}) {
  const firstItem = banner && !bannerContent ? items[0] : undefined
  const restItems = firstItem ? items.slice(1) : items
  const {visibleCount, sentinelRef} = useProgressiveChunk(restItems)
  const count = typeof columnCount === 'number' ? columnCount : Number.parseInt(columnCount, 10) || 3
  // Cards are responsive regardless of the saved column count: one column on
  // narrow screens, two on medium, and only reach the saved count (max three)
  // on large screens.
  const gridCols =
    count === 1
      ? 'grid-cols-1'
      : count === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
  const hasPrependItems = prependItems && prependItems.length > 0

  return (
    <div className="flex flex-col gap-3 p-4">
      {hasPrependItems ? prependItems : null}
      {bannerContent}
      {firstItem && (
        <div className={count === 1 ? '' : 'col-span-full'}>
          <QueryBlockCard
            item={firstItem}
            context={context}
            navigateCards={navigateCards}
            titleLinkOnly={titleLinkOnly}
          />
        </div>
      )}
      <div className={cn('grid gap-4', gridCols)}>
        {restItems.slice(0, visibleCount).map((item) => (
          <QueryBlockCard
            key={item.id.id}
            item={item}
            context={context}
            navigateCards={navigateCards}
            titleLinkOnly={titleLinkOnly}
          />
        ))}
      </div>
      {visibleCount < restItems.length ? <div ref={sentinelRef} className="h-6" aria-hidden="true" /> : null}
    </div>
  )
}

function QueryBlockCard({
  item,
  context,
  navigateCards,
  titleLinkOnly,
}: {
  item: HMDocumentInfo
  context: QueryTableValueContext
  navigateCards?: boolean
  titleLinkOnly?: boolean
}) {
  const title = getMetadataName(item.metadata) || item.path.at(-1) || 'Untitled'
  const updated = getQueryTableValue(item, 'updated', context)
  const linkProps = useRouteLink({key: 'document', id: item.id})
  const titleNode = titleLinkOnly ? (
    <a {...linkProps} className="font-semibold hover:underline">
      {title}
    </a>
  ) : (
    <span className="font-semibold">{title}</span>
  )
  const body = (
    <div className="border-border flex flex-col gap-3 rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm dark:bg-black">
      <div className="bg-muted text-muted-foreground flex h-9 w-9 items-center justify-center rounded-md">
        <FileText className="size-5" />
      </div>
      <div className="flex flex-col gap-1">
        {titleNode}
        <span className="text-muted-foreground text-sm">{formattedDate(updated as any)}</span>
      </div>
      <div className="mt-auto flex justify-end">
        <ItemCounts item={item} context={context} />
      </div>
    </div>
  )

  if (navigateCards && !titleLinkOnly) {
    return (
      <a {...linkProps} className="block no-underline">
        {body}
      </a>
    )
  }

  return body
}

function QueryBlockItemTitle({
  item,
  className,
  children,
}: {
  item: HMDocumentInfo
  className?: string
  children: ReactNode
}) {
  const linkProps = useRouteLink({key: 'document', id: item.id})
  return (
    <a {...linkProps} className={className}>
      {children}
    </a>
  )
}

function ItemCounts({
  item,
  context,
  className,
}: {
  item: HMDocumentInfo
  context: QueryTableValueContext
  className?: string
}) {
  const children = Number(getQueryTableValue(item, 'children', context)) || 0
  const comments = Number(getQueryTableValue(item, 'comments', context)) || 0
  const citations = Number(getQueryTableValue(item, 'citations', context)) || 0
  return (
    <div className={cn('text-muted-foreground flex items-center gap-3 text-sm', className)}>
      <Count icon={FileText} value={children} />
      <Count icon={MessageSquare} value={comments} />
      <Count icon={Share2} value={citations} />
    </div>
  )
}

function Count({icon: Icon, value}: {icon: React.ComponentType<{className?: string}>; value: number}) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="size-4" />
      {value}
    </span>
  )
}
