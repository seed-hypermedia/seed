import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMQuery,
  HMQuerySort,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {getMetadataName, hmId} from '@shm/shared'
import {useAccountsMetadata, useDirectory} from '@shm/shared/models/entity'
import {queryQueryBlock} from '@shm/shared/models/queries'
import {useUniversalClient} from '@shm/shared/routing'
import {formattedDate} from '@shm/shared/utils/date'
import {CalendarDays, ChevronDown, Flag, MessageSquare, Pencil, Plus, Search, Sparkles} from 'lucide-react'
import {ReactNode, useMemo, useState} from 'react'
import {Button} from './button'
import {Badge} from './components/badge'
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from './components/dropdown-menu'
import {Input} from './components/input'
import {FacePile} from './face-pile'
import {SelectField, SwitchField} from './form-fields'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {cn} from './utils'
import {useQuery} from '@tanstack/react-query'

export const BOARD_COLUMNS = [
  {id: 'backlog', title: 'Backlog', tint: 'from-slate-500/10 to-slate-500/0'},
  {id: 'ready', title: 'Ready', tint: 'from-sky-500/10 to-sky-500/0'},
  {id: 'in-progress', title: 'In Progress', tint: 'from-amber-500/10 to-amber-500/0'},
  {id: 'review', title: 'Review', tint: 'from-violet-500/10 to-violet-500/0'},
  {id: 'done', title: 'Done', tint: 'from-emerald-500/10 to-emerald-500/0'},
] as const

export type BoardColumnId = (typeof BOARD_COLUMNS)[number]['id']
export type BoardPriority = 'High' | 'Medium' | 'Low'

const BOARD_LABELS = ['Product', 'Protocol', 'UI', 'Research', 'Docs', 'Ops'] as const
const BOARD_DUE_BADGES = ['Today', 'This week', 'Later'] as const
const BOARD_PRIORITIES: BoardPriority[] = ['High', 'Medium', 'Low']
const PLACEHOLDER_ASSIGNEES = ['Ada', 'Bea', 'Cal', 'Dee', 'Eli'] as const
const BOARD_ROOT_TARGET = '__site_root__'

export type BoardCardModel = {
  doc: HMDocumentInfo
  title: string
  pathLabel: string | null
  summary: string | null
  columnId: BoardColumnId
  labels: string[]
  due: string
  priority: BoardPriority
  placeholderAssignee: string
  searchText: string
}

export interface BoardPageProps {
  boardId: UnpackedHypermediaId
  items?: HMDocumentInfo[]
  isLoading?: boolean
  canAddCard?: boolean
  onAddCard?: () => void
  onNavigateToDocument: (id: UnpackedHypermediaId, opts?: {newWindow?: boolean}) => void
  hasQuery?: boolean
  queryCount?: number
  queryDescription?: string
  queryAction?: ReactNode
}

type BoardQueryMode = 'Children' | 'AllDescendants'
type BoardQuerySortTerm = HMQuerySort['term']

function stableHash(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function pickByHash<T>(values: readonly T[], hash: number): T {
  return values[hash % values.length]!
}

function pathKeyOf(doc: HMDocumentInfo): string {
  return doc.path?.join('/') ?? doc.id.id
}

function titleOf(doc: HMDocumentInfo): string {
  return getMetadataName(doc.metadata) || doc.path?.at(-1) || 'Untitled'
}

function pathLabelOf(doc: HMDocumentInfo): string | null {
  return doc.path?.length ? `/${doc.path.join('/')}` : null
}

function summaryOf(doc: HMDocumentInfo): string | null {
  const summary = doc.metadata?.summary?.trim()
  return summary || null
}

export function getBoardColumnIdForDocument(doc: HMDocumentInfo): BoardColumnId {
  return pickByHash(BOARD_COLUMNS, stableHash(doc.id.id || pathKeyOf(doc))).id
}

export function getBoardCardModel(doc: HMDocumentInfo): BoardCardModel {
  const key = doc.id.id || pathKeyOf(doc)
  const hash = stableHash(key)
  const title = titleOf(doc)
  const pathLabel = pathLabelOf(doc)
  const summary = summaryOf(doc)
  const firstLabelIndex = hash % BOARD_LABELS.length
  const labelCount = hash % 3 === 0 ? 2 : 1
  const labels = Array.from(
    {length: labelCount},
    (_, index) => BOARD_LABELS[(firstLabelIndex + index) % BOARD_LABELS.length]!,
  )
  const due = pickByHash(BOARD_DUE_BADGES, hash >>> 3)
  const priority = pickByHash(BOARD_PRIORITIES, hash >>> 5)
  const placeholderAssignee = pickByHash(PLACEHOLDER_ASSIGNEES, hash >>> 7)
  const columnId = getBoardColumnIdForDocument(doc)
  const searchText = [title, pathLabel, summary, ...labels, due, priority, placeholderAssignee, ...(doc.authors ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return {
    doc,
    title,
    pathLabel,
    summary,
    columnId,
    labels,
    due,
    priority,
    placeholderAssignee,
    searchText,
  }
}

function priorityClass(priority: BoardPriority): string {
  switch (priority) {
    case 'High':
      return 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'Medium':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    case 'Low':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
}

function BoardAssignee({card, accountsMetadata}: {card: BoardCardModel; accountsMetadata: HMAccountsMetadata}) {
  const authors = card.doc.authors ?? []
  if (authors.length > 0) {
    return <FacePile accounts={authors.slice(0, 3)} accountsMetadata={accountsMetadata} />
  }

  return (
    <div className="bg-muted text-muted-foreground flex size-6 items-center justify-center rounded-full text-[10px] font-semibold">
      {card.placeholderAssignee.slice(0, 1)}
    </div>
  )
}

function BoardCard({
  card,
  accountsMetadata,
  onNavigateToDocument,
}: {
  card: BoardCardModel
  accountsMetadata: HMAccountsMetadata
  onNavigateToDocument: BoardPageProps['onNavigateToDocument']
}) {
  return (
    <button
      type="button"
      aria-label={`Open ${card.title}`}
      className={cn(
        'group/card border-border/80 bg-card text-card-foreground w-full rounded-xl border p-3 text-left shadow-xs',
        'hover:border-primary/35 focus-visible:border-ring focus-visible:ring-ring/40 transition-all outline-none hover:shadow-md focus-visible:ring-[3px]',
        'active:scale-[0.99]',
      )}
      onClick={(event) => {
        if (event.shiftKey) onNavigateToDocument(card.doc.id, {newWindow: true})
        else onNavigateToDocument(card.doc.id)
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="group-hover/card:text-primary line-clamp-2 text-sm font-semibold transition-colors">
            {card.title}
          </div>
          {card.pathLabel ? (
            <div className="text-muted-foreground mt-1 truncate text-[11px]">{card.pathLabel}</div>
          ) : null}
        </div>
        <Badge variant="outline" className={cn('px-1.5 py-0.5', priorityClass(card.priority))}>
          <Flag className="size-3" />
          {card.priority}
        </Badge>
      </div>

      {card.summary ? (
        <p className="text-muted-foreground mt-2 line-clamp-2 text-xs leading-5">{card.summary}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {card.labels.map((label) => (
          <span
            key={label}
            className="border-border/70 bg-muted/70 text-muted-foreground rounded-full border px-2 py-0.5 text-[11px] font-medium"
          >
            {label}
          </span>
        ))}
      </div>

      <div className="text-muted-foreground mt-3 flex items-center justify-between gap-2 text-[11px]">
        <div className="flex min-w-0 items-center gap-2">
          <BoardAssignee card={card} accountsMetadata={accountsMetadata} />
          <span className="flex items-center gap-1 whitespace-nowrap">
            <CalendarDays className="size-3" />
            {card.due}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <MessageSquare className="size-3" />
          {card.doc.activitySummary?.commentCount ?? 0}
        </div>
      </div>
    </button>
  )
}

function BoardColumn({
  column,
  cards,
  accountsMetadata,
  isEmptyBoard,
  hasQuery,
  canAddCard,
  onAddCard,
  onNavigateToDocument,
}: {
  column: (typeof BOARD_COLUMNS)[number]
  cards: BoardCardModel[]
  accountsMetadata: HMAccountsMetadata
  isEmptyBoard: boolean
  hasQuery?: boolean
  canAddCard?: boolean
  onAddCard?: () => void
  onNavigateToDocument: BoardPageProps['onNavigateToDocument']
}) {
  return (
    <section
      className="border-border/70 bg-background/80 flex min-h-[420px] w-72 shrink-0 flex-col rounded-2xl border shadow-xs"
      data-board-column={column.id}
      aria-label={`${column.title} column`}
    >
      <div className={cn('rounded-t-2xl bg-gradient-to-b p-3', column.tint)}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{column.title}</h2>
          <span className="bg-background/80 text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
            {cards.length}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {cards.map((card) => (
          <BoardCard
            key={card.doc.id.id}
            card={card}
            accountsMetadata={accountsMetadata}
            onNavigateToDocument={onNavigateToDocument}
          />
        ))}
        {isEmptyBoard && column.id === 'backlog' ? (
          <div className="border-border/80 text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-5 text-center text-sm">
            <Sparkles className="size-8" />
            <div>
              <div className="text-foreground font-medium">No cards yet.</div>
              <div>
                {hasQuery
                  ? 'No documents match the board query yet.'
                  : 'Configure the Board query to choose which documents appear here.'}
              </div>
            </div>
            {onAddCard ? (
              <Button size="sm" variant="outline" disabled={!canAddCard} onClick={onAddCard}>
                <Plus className="size-4" />
                Add Card
              </Button>
            ) : null}
          </div>
        ) : cards.length === 0 ? (
          <div className="border-border/60 text-muted-foreground rounded-xl border border-dashed p-4 text-center text-xs">
            No cards in {column.title.toLowerCase()}.
          </div>
        ) : null}
      </div>
    </section>
  )
}

function BoardQueryEditor({
  targetValue,
  targetOptions,
  mode,
  sortTerm,
  reverse,
  limitEnabled,
  limitValue,
  onTargetValue,
  onMode,
  onSortTerm,
  onReverse,
  onLimitEnabled,
  onLimitValue,
}: {
  targetValue: string
  targetOptions: Array<{value: string; label: string}>
  mode: BoardQueryMode
  sortTerm: BoardQuerySortTerm
  reverse: boolean
  limitEnabled: boolean
  limitValue: string
  onTargetValue: (value: string) => void
  onMode: (mode: BoardQueryMode) => void
  onSortTerm: (term: BoardQuerySortTerm) => void
  onReverse: (reverse: boolean) => void
  onLimitEnabled: (enabled: boolean) => void
  onLimitValue: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">
          <Pencil className="size-4" />
          Edit Query
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="flex w-80 flex-col gap-4 p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <div className="font-medium">Board Query</div>
          <div className="text-muted-foreground text-xs">Choose which documents this site-level Board computes.</div>
        </div>
        <SelectField
          value={targetValue}
          onValue={onTargetValue}
          label="Document"
          id="board-query-document"
          options={targetOptions}
        />
        <SelectField
          value={mode}
          onValue={(value) => onMode(value as BoardQueryMode)}
          label="Scope"
          id="board-query-scope"
          options={[
            {label: 'Direct children', value: 'Children'},
            {label: 'All descendants', value: 'AllDescendants'},
          ]}
        />
        <SelectField
          value={sortTerm}
          onValue={(value) => onSortTerm(value as BoardQuerySortTerm)}
          label="Sort by"
          id="board-query-sort"
          options={[
            {label: 'Update time', value: 'UpdateTime'},
            {label: 'Create time', value: 'CreateTime'},
            {label: 'Display time', value: 'DisplayTime'},
            {label: 'Latest activity', value: 'ActivityTime'},
            {label: 'Title', value: 'Title'},
          ]}
        />
        <SwitchField label="Reverse" id="board-query-reverse" checked={reverse} onCheckedChange={onReverse} />
        <SwitchField
          label="Limit result count"
          id="board-query-limit-enabled"
          checked={limitEnabled}
          onCheckedChange={onLimitEnabled}
        />
        {limitEnabled ? (
          <Input
            type="number"
            min={1}
            value={limitValue}
            onChangeText={onLimitValue}
            placeholder="Item count"
            aria-label="Board query item count"
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function BoardPage({
  boardId,
  items,
  isLoading,
  canAddCard,
  onAddCard,
  onNavigateToDocument,
  hasQuery = true,
  queryCount = hasQuery ? 1 : 0,
  queryDescription,
  queryAction,
}: BoardPageProps) {
  const [filter, setFilter] = useState('')
  const cards = useMemo(() => (items ?? []).map(getBoardCardModel), [items])
  const authorUids = useMemo(() => Array.from(new Set(cards.flatMap((card) => card.doc.authors ?? []))), [cards])
  const accountsMetadata = useAccountsMetadata(authorUids)
  const normalizedFilter = filter.trim().toLowerCase()
  const filteredCards = useMemo(() => {
    if (!normalizedFilter) return cards
    return cards.filter((card) => card.searchText.includes(normalizedFilter))
  }, [cards, normalizedFilter])
  const cardsByColumn = useMemo(() => {
    const result = new Map<BoardColumnId, BoardCardModel[]>()
    for (const column of BOARD_COLUMNS) result.set(column.id, [])
    for (const card of filteredCards) result.get(card.columnId)?.push(card)
    return result
  }, [filteredCards])
  const boardName = boardId.path?.at(-1) || 'Site'
  const isEmptyBoard = !isLoading && cards.length === 0
  const noFilterResults = !isLoading && cards.length > 0 && filteredCards.length === 0
  const queryLabel = queryCount === 1 ? '1 query' : `${queryCount} queries`

  return (
    <div className="bg-background flex h-full min-h-[620px] flex-col overflow-hidden">
      <div className="border-border/80 bg-background/95 border-b px-5 py-5 backdrop-blur md:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs font-medium tracking-[0.18em] uppercase">
              <span>Board AppView</span>
              <span>·</span>
              <span>
                {filteredCards.length} of {cards.length} cards
              </span>
              <span className="tracking-normal normal-case">{hasQuery ? queryLabel : 'No query'}</span>
              {items?.length ? (
                <span className="tracking-normal normal-case">Updated {formattedDate(items[0]?.updateTime)}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SizableText size="3xl" weight="bold" className="truncate">
                {boardName} Board
              </SizableText>
              <Badge variant="outline" className="bg-muted/70 px-2 py-1">
                Placeholder workflow metadata
              </Badge>
            </div>
            <p className="text-muted-foreground max-w-3xl text-sm">
              Cards are computed from this Board AppView query, independent of the site home document. Workflow columns,
              card placement, labels, assignees, due dates, and priorities are placeholder data until board-owned
              workflow state is persisted.
            </p>
            {queryDescription ? <p className="text-muted-foreground text-xs">{queryDescription}</p> : null}
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
            <div className="relative min-w-0 flex-1 xl:w-80 xl:flex-none">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                value={filter}
                onChangeText={setFilter}
                placeholder="Filter cards…"
                aria-label="Filter board cards"
                className="pl-9"
              />
            </div>
            {queryAction}
            {onAddCard ? (
              <Button
                disabled={!canAddCard}
                onClick={onAddCard}
                title={canAddCard ? undefined : 'Sign in with edit permission to add cards'}
              >
                <Plus className="size-4" />
                Add Card
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 md:p-6">
          {noFilterResults ? (
            <div className="text-muted-foreground mb-4 rounded-xl border border-dashed p-4 text-sm">
              No cards match “{filter.trim()}”.
            </div>
          ) : null}
          <div className="flex min-w-max gap-4 pb-4">
            {BOARD_COLUMNS.map((column) => (
              <BoardColumn
                key={column.id}
                column={column}
                cards={cardsByColumn.get(column.id) ?? []}
                accountsMetadata={accountsMetadata.data}
                isEmptyBoard={isEmptyBoard}
                hasQuery={hasQuery}
                canAddCard={canAddCard}
                onAddCard={onAddCard}
                onNavigateToDocument={onNavigateToDocument}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function BoardAppViewPage({
  siteId,
  onNavigateToDocument,
}: {
  siteId: UnpackedHypermediaId
  onNavigateToDocument: BoardPageProps['onNavigateToDocument']
}) {
  const client = useUniversalClient()
  const directory = useDirectory(hmId(siteId.uid), {mode: 'AllDescendants'})
  const [targetValue, setTargetValue] = useState(BOARD_ROOT_TARGET)
  const [mode, setMode] = useState<BoardQueryMode>('AllDescendants')
  const [sortTerm, setSortTerm] = useState<BoardQuerySortTerm>('UpdateTime')
  const [reverse, setReverse] = useState(true)
  const [limitEnabled, setLimitEnabled] = useState(false)
  const [limitValue, setLimitValue] = useState('50')
  const limit = limitEnabled ? parseInt(limitValue, 10) : undefined
  const targetPath = targetValue === BOARD_ROOT_TARGET ? '' : targetValue
  const targetOptions = useMemo(() => {
    const seen = new Set<string>()
    const options = [{value: BOARD_ROOT_TARGET, label: 'Site root'}]
    for (const doc of directory.data ?? []) {
      const path = doc.path?.join('/') ?? ''
      if (!path || seen.has(path)) continue
      seen.add(path)
      const name = getMetadataName(doc.metadata) || doc.path?.at(-1) || 'Untitled'
      options.push({value: path, label: `${name} — /${path}`})
    }
    return options
  }, [directory.data])
  const targetLabel = useMemo(() => {
    if (targetValue === BOARD_ROOT_TARGET) return 'site root'
    return targetOptions.find((option) => option.value === targetValue)?.label ?? `/${targetValue}`
  }, [targetOptions, targetValue])
  const query = useMemo<HMQuery>(
    () => ({
      includes: [{space: siteId.uid, path: targetPath, mode}],
      sort: [{term: sortTerm, reverse}],
      limit: limit && limit > 0 ? limit : undefined,
    }),
    [siteId.uid, targetPath, mode, sortTerm, reverse, limit],
  )
  const queryResult = useQuery(queryQueryBlock(client, {query}))
  const queryDescription = `${
    mode === 'AllDescendants' ? 'All descendants' : 'Direct children'
  } of ${targetLabel} · sorted by ${sortTerm}${reverse ? ' descending' : ' ascending'}${
    limitEnabled && limit && limit > 0 ? ` · limited to ${limit}` : ''
  }`

  return (
    <BoardPage
      boardId={{...siteId, path: null}}
      items={queryResult.data?.results ?? []}
      isLoading={queryResult.isLoading}
      hasQuery
      queryCount={1}
      queryDescription={queryDescription}
      queryAction={
        <BoardQueryEditor
          targetValue={targetValue}
          targetOptions={targetOptions}
          mode={mode}
          sortTerm={sortTerm}
          reverse={reverse}
          limitEnabled={limitEnabled}
          limitValue={limitValue}
          onTargetValue={setTargetValue}
          onMode={setMode}
          onSortTerm={setSortTerm}
          onReverse={setReverse}
          onLimitEnabled={setLimitEnabled}
          onLimitValue={setLimitValue}
        />
      }
      onNavigateToDocument={onNavigateToDocument}
    />
  )
}
