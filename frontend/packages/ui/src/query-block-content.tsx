import {type QueryBlockDraftSlotData} from '@shm/shared/query-block-drafts-context'
import * as Ariakit from '@ariakit/react'
import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMQueryBlockItemSummary,
  HMQueryBlockFilterOptions,
  HMQueryTableConfig,
} from '@seed-hypermedia/client/hm-types'
import {formattedDate, getMetadataName, useRouteLink} from '@shm/shared'
import {useInteractionSummaries} from '@shm/shared/models/interaction-summary'
import {getQueryBlockFilterOptions, matchesQueryFilterEquality} from '@shm/shared/models/query-block-filter'
import {useNavigate} from '@shm/shared/utils/navigation'
import {type SortingState} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  FileText,
  Filter,
  GitCompareArrows,
  Grid3X3,
  MessageSquare,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import {ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState} from 'react'
import {Button} from './button'
import {badgeVariants} from './components/badge'
import {Input} from './components/input'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {Switch} from './components/switch'
import {ActiveFilterChip, ActiveFilterChipRow} from './explore-filters'
import {SelectField} from './form-fields'
import {DocumentCard} from './newspaper'
import {QueryBlockTable} from './query-block-table'
import {
  buildQueryTableColumns,
  filterQueryTableItems,
  getDocumentTags,
  getQuerySortColumns,
  getQueryTableColumnType,
  getQueryTableSortValue,
  getQueryTableValue,
  moveQueryTableColumn,
  queryTableItemMatchesSearch,
  queryTableValueToString,
  type QueryTableColumn,
  type QueryTableFilter,
  type QueryTableValueContext,
} from './query-block-table-model'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {cn} from './utils'

const INITIAL_LIST_CHUNK_SIZE = 25
const LIST_CHUNK_SIZE = 25
const LIST_CHUNK_ROOT_MARGIN = '800px 0px'

type QueryTableState = {
  sorting: SortingState
  columnOrder: string[]
  columnVisibility: Record<string, boolean>
  columnSizing: Record<string, number>
}

type QueryTableStateAction =
  | {type: 'sync'; state: QueryTableState}
  | {type: 'sorting'; sorting: SortingState}
  | {type: 'columnOrder'; columnOrder: string[]}
  | {type: 'columnVisibility'; columnVisibility: Record<string, boolean>}
  | {type: 'columnSizing'; columnSizing: Record<string, number>}

function queryTableStateReducer(state: QueryTableState, action: QueryTableStateAction): QueryTableState {
  if (action.type === 'sync') return action.state
  if (action.type === 'sorting') return {...state, sorting: action.sorting}
  if (action.type === 'columnOrder') return {...state, columnOrder: action.columnOrder}
  if (action.type === 'columnVisibility') return {...state, columnVisibility: action.columnVisibility}
  return {...state, columnSizing: action.columnSizing}
}

function createQueryTableState(
  descriptors: QueryTableColumn[],
  tableConfig?: HMQueryTableConfig,
  sorting: SortingState = [],
): QueryTableState {
  const columnOrder: string[] = []
  const columnVisibility: Record<string, boolean> = {}
  const columnSizing: Record<string, number> = {}
  for (const column of tableConfig?.columns ?? []) {
    columnOrder.push(column.id)
    columnVisibility[column.id] = column.visible
    if (column.width) columnSizing[column.id] = column.width
  }
  for (const descriptor of descriptors) {
    if (!columnOrder.includes(descriptor.id)) columnOrder.push(descriptor.id)
    if (!(descriptor.id in columnVisibility)) columnVisibility[descriptor.id] = descriptor.defaultVisible
  }
  return {sorting, columnOrder, columnVisibility, columnSizing}
}

/** Shared collection results and controls for table, list, and card views. */
export interface QueryBlockContentProps {
  /** Existing collection view and settings controls, shown after the search controls. */
  toolbarActions?: ReactNode
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
  /** Drafts rendered as table rows with a separate actions column. */
  tableDrafts?: QueryBlockDraftSlotData
  /** Creates a document in the query target when the results are empty. */
  onCreateDocument?: () => void
  bannerContent?: ReactNode
  /** Render card titles as links (hover underline, navigate on first click) instead of whole-card navigation. */
  titleLinkOnly?: boolean
  /** Whether whole cards navigate on click (ignored for the title when titleLinkOnly). */
  navigateCards?: boolean
  tableConfig?: HMQueryTableConfig
  onTableConfigChange?: (config: HMQueryTableConfig) => void
  tableSorting?: SortingState
  onTableSortingChange?: (sorting: SortingState) => void
  viewerSearch?: string
  onViewerSearchChange?: (search: string) => void
  viewerFilters?: QueryTableFilter[]
  onViewerFiltersChange?: (filters: QueryTableFilter[]) => void
  totalMatches?: number
  /** Values from the full collection, before viewer filters and the display limit. */
  filterOptions?: HMQueryBlockFilterOptions
  isUpdating?: boolean
  viewerQueryApplied?: boolean
}

/** Renders collection controls and results while retaining viewer state across view changes. */
export function QueryBlockContent({
  toolbarActions,
  items,
  style,
  columnCount = '3',
  banner = false,
  accountsMetadata,
  interactionSummaries,
  isDiscovering,
  prependItems,
  tableDrafts,
  onCreateDocument,
  bannerContent,
  titleLinkOnly,
  navigateCards,
  itemContributors,
  tableConfig,
  onTableConfigChange,
  tableSorting,
  onTableSortingChange,
  viewerSearch,
  onViewerSearchChange,
  viewerFilters,
  onViewerFiltersChange,
  totalMatches,
  filterOptions,
  isUpdating,
  viewerQueryApplied = true,
}: QueryBlockContentProps) {
  const availableFilterOptions = useMemo(
    () => filterOptions ?? getQueryBlockFilterOptions(items),
    [filterOptions, items],
  )
  const descriptors = useMemo(
    () => buildQueryTableColumns(items, availableFilterOptions),
    [items, availableFilterOptions],
  )

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
  const effectiveSearch = viewerSearch ?? search
  const effectiveFilters = viewerFilters ?? filters
  const setEffectiveSearch = onViewerSearchChange ?? setSearch
  const setEffectiveFilters = onViewerFiltersChange ?? setFilters
  const usesRemoteViewerQuery = (!!onViewerSearchChange || !!onViewerFiltersChange) && viewerQueryApplied
  const [tableState, updateTableState] = useReducer(queryTableStateReducer, undefined, () =>
    createQueryTableState(descriptors, tableConfig, tableSorting),
  )
  const {sorting, columnOrder, columnVisibility, columnSizing} = tableState

  const tableConfigKey = useMemo(() => JSON.stringify(tableConfig), [tableConfig])
  useEffect(() => {
    updateTableState({type: 'sync', state: createQueryTableState(descriptors, tableConfig, tableSorting)})
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
      updateTableState({type: 'sorting', sorting: next})
      onTableSortingChange?.(next)
    },
    [onTableSortingChange],
  )

  const filteredItems = useMemo(
    () =>
      usesRemoteViewerQuery
        ? items
        : filterQueryTableItems(items, effectiveFilters, context, descriptors).filter((item) =>
            queryTableItemMatchesSearch(item, effectiveSearch, descriptors, context),
          ),
    [items, usesRemoteViewerQuery, effectiveFilters, context, effectiveSearch, descriptors],
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

  const visibleDescriptors = useMemo(() => {
    const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
    return columnOrder
      .filter((id) => columnVisibility[id] !== false)
      .map((id) => byId.get(id))
      .filter((descriptor): descriptor is QueryTableColumn => !!descriptor)
  }, [columnOrder, columnVisibility, descriptors])

  const toggleColumnVisibility = useCallback(
    (id: string) => {
      const next = {...columnVisibility, [id]: !columnVisibility[id]}
      updateTableState({type: 'columnVisibility', columnVisibility: next})
      persistTableConfig({columnVisibility: next})
    },
    [columnVisibility, persistTableConfig],
  )

  const moveColumn = useCallback(
    (id: string, offset: -1 | 1) => {
      const next = moveQueryTableColumn(columnOrder, id, offset)
      updateTableState({type: 'columnOrder', columnOrder: next})
      persistTableConfig({columnOrder: next})
    },
    [columnOrder, persistTableConfig],
  )

  const hasPrependItems = prependItems && prependItems.length > 0
  const hasItems = sortedItems.length > 0 || hasPrependItems || !!tableDrafts?.drafts.length || !!bannerContent

  return (
    <div className="border-border bg-background @container/collection flex min-w-0 flex-col rounded-md border">
      <QueryBlockToolbar
        actions={toolbarActions}
        documentCount={usesRemoteViewerQuery ? totalMatches ?? items.length : filteredItems.length}
        descriptors={descriptors}
        items={items}
        context={context}
        columnOrder={columnOrder}
        columnVisibility={columnVisibility}
        toggleColumnVisibility={toggleColumnVisibility}
        moveColumn={moveColumn}
        filters={effectiveFilters}
        setFilters={setEffectiveFilters}
        sorting={sorting}
        setSorting={setSortingAndPersist}
        search={effectiveSearch}
        setSearch={setEffectiveSearch}
        filterOptions={availableFilterOptions}
        filterOptionsComplete={filterOptions !== undefined}
        loadedCount={filteredItems.length}
        isUpdating={isUpdating}
      />
      {items.length === 0 && isDiscovering ? (
        <div className="bg-background text-muted-foreground flex items-center gap-2 rounded-lg p-4 font-sans">
          <Spinner size="small" />
          <span className="italic">Searching for documents…</span>
        </div>
      ) : !hasItems ? (
        <div className="text-muted-foreground flex h-28 items-center justify-center rounded-md border text-sm">
          {effectiveFilters.length || effectiveSearch ? (
            'No documents match the current search and filters.'
          ) : onCreateDocument ? (
            <Button type="button" variant="outline" size="sm" onClick={onCreateDocument}>
              <Plus className="size-4" />
              New Document
            </Button>
          ) : (
            'No documents found.'
          )}
        </div>
      ) : style === 'Table' ? (
        <>
          {sortedItems.length > 0 || tableDrafts?.drafts.length ? (
            <QueryBlockTable
              items={sortedItems}
              tableDrafts={tableDrafts}
              descriptors={descriptors}
              context={context}
              sorting={sorting}
              onSortingChange={setSortingAndPersist}
              columnOrder={columnOrder}
              onColumnOrderChange={(columnOrder) => updateTableState({type: 'columnOrder', columnOrder})}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={(columnVisibility) =>
                updateTableState({type: 'columnVisibility', columnVisibility})
              }
              columnSizing={columnSizing}
              onColumnSizingChange={(columnSizing) => updateTableState({type: 'columnSizing', columnSizing})}
              onColumnSizingCommit={(nextSizing) => persistTableConfig({columnSizing: nextSizing})}
            />
          ) : null}
        </>
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
          itemContributors={itemContributors}
          visibleDescriptors={visibleDescriptors}
        />
      ) : (
        <QueryBlockList
          items={sortedItems}
          prependItems={prependItems}
          context={context}
          visibleDescriptors={visibleDescriptors}
        />
      )}
    </div>
  )
}

function QueryBlockToolbar({
  actions,
  descriptors,
  items,
  context,
  columnOrder,
  columnVisibility,
  toggleColumnVisibility,
  moveColumn,
  filters,
  setFilters,
  sorting,
  setSorting,
  search,
  setSearch,
  filterOptions,
  filterOptionsComplete,
  documentCount,
  loadedCount,
  isUpdating,
}: {
  actions?: ReactNode
  descriptors: QueryTableColumn[]
  items: HMDocumentInfo[]
  context: QueryTableValueContext
  columnOrder: string[]
  columnVisibility: Record<string, boolean>
  toggleColumnVisibility: (id: string) => void
  moveColumn: (id: string, offset: -1 | 1) => void
  filters: QueryTableFilter[]
  setFilters: (filters: QueryTableFilter[]) => void
  sorting: SortingState
  setSorting: (sorting: SortingState) => void
  search: string
  setSearch: (value: string) => void
  filterOptions: HMQueryBlockFilterOptions
  filterOptionsComplete: boolean
  documentCount: number
  loadedCount: number
  isUpdating?: boolean
}) {
  const [searchExpanded, setSearchExpanded] = useState(false)
  return (
    <div
      data-query-block-toolbar
      className="border-border bg-muted/30 flex min-w-0 flex-col gap-3 border-b px-2 py-3 @sm/collection:px-4 @3xl/collection:flex-row @3xl/collection:items-center"
      onMouseDown={(event) => {
        // Let the popover open before its trigger moves as search loses focus.
        if (searchExpanded && (event.target as HTMLElement).closest('button[aria-haspopup="dialog"]')) {
          event.preventDefault()
        }
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div
          className={cn(
            'relative min-w-0 shrink transition-[width] duration-(--duration-normal) ease-(--ease-out-smooth) motion-reduce:transition-none',
            searchExpanded ? 'w-64' : search ? 'w-40' : 'w-24',
          )}
        >
          {searchExpanded ? (
            <>
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                autoFocus
                value={search}
                onChangeText={setSearch}
                onBlur={() => setSearchExpanded(false)}
                placeholder="Search documents…"
                aria-label="Search documents"
                className="bg-background h-8 pl-8"
              />
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="w-full min-w-0 justify-start"
              aria-label="Search documents"
              onClick={() => setSearchExpanded(true)}
            >
              <Search className="size-4" />
              <span className="truncate">{search || 'Search'}</span>
            </Button>
          )}
        </div>
        <FilterPopover
          descriptors={descriptors}
          items={items}
          context={context}
          filters={filters}
          setFilters={setFilters}
          filterOptions={filterOptions}
          filterOptionsComplete={filterOptionsComplete}
        />
        <SortPopover
          descriptors={getQuerySortColumns(descriptors, columnVisibility)}
          sorting={sorting}
          setSorting={setSorting}
        />
        <AttributesPopover
          descriptors={descriptors}
          columnOrder={columnOrder}
          columnVisibility={columnVisibility}
          toggleColumnVisibility={toggleColumnVisibility}
          moveColumn={moveColumn}
        />
        <Tooltip
          content={
            loadedCount < documentCount
              ? `Showing ${loadedCount} of ${documentCount} matches`
              : `${documentCount} documents`
          }
        >
          <span
            className="border-border bg-background text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap tabular-nums"
            aria-label={`${documentCount} documents`}
          >
            {isUpdating ? <Spinner size="small" /> : null}
            <span className="sr-only" aria-live="polite">
              {isUpdating ? 'Updating results…' : ''}
            </span>
            {documentCount}
            <span className="hidden @sm/collection:inline">{documentCount === 1 ? 'document' : 'documents'}</span>
          </span>
        </Tooltip>
      </div>
      {actions ? <div className="flex shrink-0 items-center justify-end gap-2">{actions}</div> : null}
    </div>
  )
}

function FilterPopover({
  descriptors,
  items,
  context,
  filters,
  setFilters,
  filterOptions,
  filterOptionsComplete,
}: {
  descriptors: QueryTableColumn[]
  items: HMDocumentInfo[]
  context: QueryTableValueContext
  filters: QueryTableFilter[]
  setFilters: (filters: QueryTableFilter[]) => void
  filterOptions: HMQueryBlockFilterOptions
  filterOptionsComplete: boolean
}) {
  const supportedDescriptors = descriptors.filter(
    (descriptor) => descriptor.id !== 'authors' && descriptor.id !== 'citations' && descriptor.id !== 'space',
  )
  const appliedCount = filters.filter((filter) => filter.value.trim()).length
  const filterLabel = appliedCount ? `Filters: ${appliedCount} applied` : 'Filter'
  return (
    <Popover>
      <Tooltip content={filterLabel}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={filterLabel}
            className={cn('relative', appliedCount > 0 && 'border-primary bg-accent text-primary')}
          >
            <Filter className="size-4" />
            {appliedCount ? (
              <span
                aria-hidden
                className="bg-primary text-primary-foreground absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs tabular-nums"
              >
                {appliedCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-3">
          {appliedCount ? (
            <ActiveFilterChipRow>
              {filters.map((filter, index) => {
                if (!filter.value.trim()) return null
                const column = descriptors.find((descriptor) => descriptor.id === filter.columnId)
                const rawLabel = filter.columnId.replace(/^metadata:/, '')
                const label = column?.label ?? rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)
                const condition =
                  filter.operator === 'equals' ? 'IS' : filter.operator === 'notEquals' ? 'IS NOT' : filter.operator
                const text = `${label} ${condition} ${filter.value}`
                return (
                  <ActiveFilterChip
                    key={`${filter.columnId}:${index}`}
                    removeLabel={`Remove filter: ${text}`}
                    onRemove={() => setFilters(filters.filter((_, filterIndex) => filterIndex !== index))}
                  >
                    {text}
                  </ActiveFilterChip>
                )
              })}
            </ActiveFilterChipRow>
          ) : null}
          {filters.length ? (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setFilters([])}>
              Clear filters
            </Button>
          ) : null}
          {filters.map((filter, index) => (
            <div
              key={index}
              className="bg-muted/30 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 rounded-md border p-2"
            >
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs">Attribute</span>
                <SelectField
                  id={`filter-column-${index}`}
                  className="w-full"
                  options={supportedDescriptors.map((d) => ({value: d.id, label: d.label}))}
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
                              value: '',
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
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs">Condition</span>
                <SelectField
                  id={`filter-operator-${index}`}
                  className="w-full"
                  options={getFilterOperatorOptions(filter.columnId, items, context, descriptors)}
                  value={filter.operator}
                  onValue={(value) =>
                    setFilters(
                      filters.map((f, i) =>
                        i === index
                          ? {
                              ...f,
                              operator: value as QueryTableFilter['operator'],
                              value:
                                (value === 'equals' || value === 'notEquals') &&
                                f.operator !== 'equals' &&
                                f.operator !== 'notEquals'
                                  ? filterOptions[f.columnId]?.values.find((option) =>
                                      matchesQueryFilterEquality(option, f.value),
                                    ) ?? ''
                                  : f.value,
                            }
                          : f,
                      ),
                    )
                  }
                />
              </div>
              <Tooltip content="Remove filter" asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove filter"
                  className="self-end"
                  onClick={() => setFilters(filters.filter((_, i) => i !== index))}
                >
                  <X className="size-4" />
                </Button>
              </Tooltip>
              <div className="col-span-full flex min-w-0 flex-col gap-1 text-sm">
                <span className="text-muted-foreground text-xs">Value</span>
                {filter.operator === 'equals' || filter.operator === 'notEquals' ? (
                  <FilterValuePicker
                    key={filter.columnId}
                    value={filter.value}
                    options={filterOptions[filter.columnId]?.values ?? []}
                    onValue={(value) => setFilters(filters.map((f, i) => (i === index ? {...f, value} : f)))}
                  />
                ) : (
                  <Input
                    value={filter.value}
                    onChangeText={(value) => setFilters(filters.map((f, i) => (i === index ? {...f, value} : f)))}
                    aria-label="Filter value"
                  />
                )}
              </div>
            </div>
          ))}
          {!filterOptionsComplete &&
          filters.some((filter) => filter.operator === 'equals' || filter.operator === 'notEquals') ? (
            <p className="text-muted-foreground text-xs">Values from loaded documents only.</p>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setFilters([
                ...filters,
                {columnId: supportedDescriptors[0]?.id ?? 'title', operator: 'contains', value: ''},
              ])
            }
          >
            <Plus className="size-3" />
            Add filter
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FilterValuePicker({
  value,
  options,
  onValue,
}: {
  value: string
  options: string[]
  onValue: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const combobox = Ariakit.useComboboxStore({value: search, setValue: setSearch, open, setOpen})
  const matchingOptions = options.filter((option) => option.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const unavailable = value && !options.some((option) => matchesQueryFilterEquality(option, value))

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setSearch('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="border-border focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm font-normal transition-[color,box-shadow] outline-none hover:border-black/10 focus-visible:ring-[3px]"
          aria-label="Filter value"
        >
          <span className={cn('min-w-0 truncate', !value && 'text-muted-foreground')}>
            {value || 'Select value…'}
            {unavailable ? ' (unavailable)' : ''}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-(--radix-popover-trigger-width) flex-col gap-1 p-1">
        <Ariakit.Combobox
          store={combobox}
          autoSelect={false}
          aria-label="Search filter values"
          placeholder="Search values…"
          render={<Input />}
        />
        <Ariakit.ComboboxList store={combobox} className="max-h-60 overflow-y-auto">
          {matchingOptions.map((option) => (
            <Ariakit.ComboboxItem
              key={option}
              store={combobox}
              value={option}
              setValueOnClick={false}
              className="hover:bg-accent hover:text-accent-foreground data-[active-item]:bg-accent data-[active-item]:text-accent-foreground flex cursor-default items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm break-words select-none"
              onClick={() => {
                onValue(option)
                setOpen(false)
              }}
            >
              <span className="min-w-0">{option}</span>
              {matchesQueryFilterEquality(option, value) ? <Check className="size-4 shrink-0" /> : null}
            </Ariakit.ComboboxItem>
          ))}
        </Ariakit.ComboboxList>
        {!matchingOptions.length ? (
          <p role="status" className="text-muted-foreground p-2 text-sm">
            {options.length ? 'No matching values.' : 'No values available.'}
          </p>
        ) : null}
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
    {value: 'equals', label: 'IS'},
    {value: 'notEquals', label: 'IS NOT'},
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
      <Tooltip content="Sort">
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Sort">
            <ArrowUpDown className="size-4" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="start" className="w-72">
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Sort by</span>
            <SelectField
              id="sort-column"
              className="w-full"
              options={descriptors.map((d) => ({value: d.id, label: d.label}))}
              value={columnId}
              onValue={(value) => setSorting([{id: value, desc}])}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Direction</span>
            <div className="flex gap-2">
              <Button
                variant={!desc ? 'secondary' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setSorting([{id: columnId, desc: false}])}
              >
                <ArrowUp className="size-4" />
                Ascending
              </Button>
              <Button
                variant={desc ? 'secondary' : 'outline'}
                size="sm"
                className="flex-1"
                onClick={() => setSorting([{id: columnId, desc: true}])}
              >
                <ArrowDown className="size-4" />
                Descending
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setSorting([])}>
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
  toggleColumnVisibility,
  moveColumn,
}: {
  descriptors: QueryTableColumn[]
  columnOrder: string[]
  columnVisibility: Record<string, boolean>
  toggleColumnVisibility: (id: string) => void
  moveColumn: (id: string, offset: -1 | 1) => void
}) {
  const orderedDescriptors = useMemo(() => {
    const byId = new Map(descriptors.map((d) => [d.id, d]))
    return columnOrder.map((id) => byId.get(id)).filter((d): d is QueryTableColumn => !!d)
  }, [columnOrder, descriptors])

  return (
    <Popover>
      <Tooltip content="Attributes">
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Attributes">
            <SlidersHorizontal className="size-4" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
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
                <Tooltip content={`Move ${descriptor.label} left`}>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${descriptor.label} left`}
                    disabled={index === 0}
                    onClick={() => moveColumn(descriptor.id, -1)}
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                </Tooltip>
                <Tooltip content={`Move ${descriptor.label} right`}>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${descriptor.label} right`}
                    disabled={index === orderedDescriptors.length - 1}
                    onClick={() => moveColumn(descriptor.id, 1)}
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                </Tooltip>
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

  // Clamp rather than reset.
  useEffect(() => {
    setVisibleCount((count) => Math.min(Math.max(count, INITIAL_LIST_CHUNK_SIZE), items.length))
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
  visibleDescriptors,
}: {
  items: HMDocumentInfo[]
  prependItems?: ReactNode[]
  context: QueryTableValueContext
  visibleDescriptors: QueryTableColumn[]
}) {
  const {visibleCount, sentinelRef} = useProgressiveChunk(items)
  return (
    <div className="flex flex-col">
      {prependItems}
      {items.slice(0, visibleCount).map((item) => (
        <QueryBlockListItem key={item.id.id} item={item} context={context} visibleDescriptors={visibleDescriptors} />
      ))}
      {visibleCount < items.length ? <div ref={sentinelRef} className="h-6" aria-hidden="true" /> : null}
    </div>
  )
}

function QueryBlockListItem({
  item,
  context,
  visibleDescriptors,
}: {
  item: HMDocumentInfo
  context: QueryTableValueContext
  visibleDescriptors: QueryTableColumn[]
}) {
  const title = getMetadataName(item.metadata) || item.path.at(-1) || 'Untitled'
  return (
    <div
      data-testid="query-row"
      className="group border-border hover:bg-muted/30 flex items-center justify-between gap-3 border-b bg-white px-4 py-3 transition-colors last:border-b-0 dark:bg-black"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="bg-muted text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
          {item.isCollection ? (
            <Grid3X3 aria-label="Collection" className="size-5" />
          ) : (
            <FileText aria-label="Document" className="size-5" />
          )}
        </div>
        <QueryBlockItemTitle item={item} className="truncate font-medium hover:underline">
          {title}
        </QueryBlockItemTitle>
      </div>
      <SelectedAttributes
        item={item}
        context={context}
        descriptors={visibleDescriptors}
        className="min-w-0 justify-end"
      />
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
  itemContributors,
  visibleDescriptors,
}: {
  items: HMDocumentInfo[]
  context: QueryTableValueContext
  columnCount: string | number
  banner?: boolean
  bannerContent?: ReactNode
  prependItems?: ReactNode[]
  navigateCards?: boolean
  titleLinkOnly?: boolean
  itemContributors?: Record<string, string[]>
  visibleDescriptors: QueryTableColumn[]
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
            banner
            navigateCards={navigateCards}
            titleLinkOnly={titleLinkOnly}
            contributorUids={itemContributors?.[firstItem.id.id]}
            visibleDescriptors={visibleDescriptors}
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
            contributorUids={itemContributors?.[item.id.id]}
            visibleDescriptors={visibleDescriptors}
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
  banner,
  navigateCards,
  titleLinkOnly,
  contributorUids,
  visibleDescriptors,
}: {
  item: HMDocumentInfo
  context: QueryTableValueContext
  banner?: boolean
  navigateCards?: boolean
  titleLinkOnly?: boolean
  contributorUids?: string[]
  visibleDescriptors: QueryTableColumn[]
}) {
  return (
    <DocumentCard
      docId={item.id}
      entity={null}
      metadata={item.metadata}
      firstImageInContent={item.firstImageInContent}
      isCollection={item.isCollection}
      visibility={item.visibility}
      version={item.version}
      interactionSummary={context.interactionSummaries?.[item.id.id]}
      accountsMetadata={context.accountsMetadata}
      contributorUids={contributorUids}
      banner={banner}
      navigate={navigateCards}
      titleLinkOnly={titleLinkOnly}
      showSummary
      details={
        <SelectedAttributes
          item={item}
          context={context}
          descriptors={visibleDescriptors}
          kind="values"
          className="mt-3 flex-wrap"
        />
      }
      showCommentAction={false}
      actionDetails={
        <SelectedAttributes
          item={item}
          context={context}
          descriptors={visibleDescriptors}
          kind="counts"
          commentAction
        />
      }
    />
  )
}

function SelectedAttributes({
  item,
  context,
  descriptors,
  kind = 'all',
  commentAction = false,
  className,
}: {
  item: HMDocumentInfo
  context: QueryTableValueContext
  descriptors: QueryTableColumn[]
  kind?: 'all' | 'values' | 'counts'
  commentAction?: boolean
  className?: string
}) {
  const navigate = useNavigate()
  const attributes = descriptors.filter((descriptor) => {
    if (descriptor.id === 'title') return false
    const isCount = descriptor.id === 'children' || descriptor.id === 'comments' || descriptor.id === 'citations'
    return kind === 'all' || (kind === 'counts' ? isCount : !isCount)
  })
  if (attributes.length === 0) return null

  return (
    <div
      data-testid={kind === 'counts' ? 'selected-attribute-counts' : undefined}
      className={cn('text-muted-foreground flex items-center gap-1 text-sm', className)}
    >
      {attributes.map((descriptor) => {
        const value = getQueryTableValue(item, descriptor.id, context)
        if (descriptor.id === 'tags') {
          const tags = getDocumentTags(item)
          return tags.map((tag) => (
            <span
              key={`${descriptor.id}:${tag}`}
              className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-green-800 dark:bg-green-900 dark:text-green-100"
            >
              {tag}
            </span>
          ))
        }
        if (descriptor.id === 'children' || descriptor.id === 'comments' || descriptor.id === 'citations') {
          const Icon =
            descriptor.id === 'children' ? FileText : descriptor.id === 'comments' ? MessageSquare : GitCompareArrows
          if (descriptor.id === 'comments' && commentAction) {
            return (
              <Button
                key={descriptor.id}
                variant="ghost"
                size="sm"
                className="no-window-drag h-auto gap-1 p-1 text-xs"
                title={descriptor.label}
                aria-label={`View discussions (${queryTableValueToString(value) || '0'})`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  navigate({key: 'comments', id: item.id})
                }}
              >
                <Icon className="size-3.5" />
                {queryTableValueToString(value) || '0'}
              </Button>
            )
          }
          return (
            <span key={descriptor.id} className="inline-flex items-center gap-1" title={descriptor.label}>
              <Icon className="size-3.5" />
              {queryTableValueToString(value) || '0'}
            </span>
          )
        }
        const displayValue =
          descriptor.id === 'updated' || descriptor.id === 'created'
            ? value
              ? formattedDate(value as any)
              : ''
            : queryTableValueToString(value)
        if (!displayValue) return null
        return (
          <Tooltip key={descriptor.id} content={`${descriptor.label}: ${displayValue}`} asChild>
            <span
              className={cn(
                badgeVariants({variant: 'outline'}),
                'text-muted-foreground flex max-w-full min-w-0 items-center gap-1 text-sm',
              )}
              tabIndex={0}
            >
              <span className="truncate">{displayValue}</span>
            </span>
          </Tooltip>
        )
      })}
    </div>
  )
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
