import type {
  ExplorePresentation,
  ExploreSortRule,
  ExplorePredicate,
  ExploreQueryNode,
  HMExploreContext,
  HMExploreResult,
  HMExploreResultType,
  ParsedExploreQuery,
} from '@shm/shared/explore'
import {
  exploreQueryChips,
  compileExploreQuery,
  cycleExploreSort,
  clearExploreConditions,
  removeExploreQueryChip,
  serializeExploreQuery,
  toggleExplorePredicate,
  toggleExploreColumn,
} from '@shm/shared/explore'
import {DocumentSort, QueryDocumentsRequest} from '@shm/shared/client/grpc-types'
import {
  exploreDocumentKey,
  useExploreAccounts,
  useExploreAttributeNames,
  useExploreAttributeValues,
} from '@shm/shared/models/explore'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  MessageSquare,
  Pilcrow,
  Search,
  X,
} from 'lucide-react'
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import * as Ariakit from '@ariakit/react'
import {Button} from './button'
import {Input} from './components/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {cn} from './utils'

/** Highlights query terms in text without interpreting them as a regular expression. */
export function highlightExploreText(text: string, terms: string[]): ReactNode {
  const normalized = terms.map((term) => term.replace(/^"|"$/g, '').trim()).filter(Boolean)
  if (!normalized.length || !text) return text
  const pattern = new RegExp(
    `(${normalized
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join('|')})`,
    'giu',
  )
  return text.split(pattern).map((part, index) =>
    normalized.some((term) => part.localeCompare(term, undefined, {sensitivity: 'accent'}) === 0) ? (
      <mark key={index} className="bg-brand-10 text-secondary-foreground">
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function exploreColumnLabel(column: string) {
  const builtIns: Record<string, string> = {
    title: 'Title',
    space: 'Space',
    path: 'Path',
    updated: 'Updated',
    version: 'Version',
  }
  return builtIns[column] ?? column
}

function ExploreScopePill({
  context,
  contextLabel,
  accounts,
  onChange,
}: {
  context: HMExploreContext
  contextLabel: string
  accounts: Array<{value: string; label: string}>
  onChange?: (scope: HMExploreContext) => void
}) {
  const [open, setOpen] = useState(false)
  if (!onChange) {
    return (
      <span className="border-border bg-muted/30 text-muted-foreground rounded-md border px-3 py-2 text-xs">
        {contextLabel}
      </span>
    )
  }
  const scopeLabel = context.type === 'node' ? 'Whole node' : context.id.uid
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
        {scopeLabel}
        <ChevronDown className="ml-1 size-3.5" aria-hidden />
      </Button>
      {open ? (
        <div className="bg-popover text-popover-foreground absolute top-full right-0 z-30 mt-2 min-w-48 rounded-md border p-1 shadow-md">
          <button
            type="button"
            className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
            onClick={() => {
              onChange({type: 'node'})
              setOpen(false)
            }}
          >
            {context.type === 'node' ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            Whole node
          </button>
          {accounts.map((account) => (
            <button
              key={account.value}
              type="button"
              className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
              onClick={() => {
                onChange({type: 'site', id: hmId(account.value)})
                setOpen(false)
              }}
            >
              {context.type === 'site' && context.id.uid === account.value ? (
                <Check className="size-3.5" />
              ) : (
                <span className="size-3.5" />
              )}
              {account.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ExploreColumnsMenu({
  columns,
  selected,
  onToggle,
}: {
  columns: string[]
  selected: string[]
  onToggle: (column: string) => void
}) {
  return (
    <div className="bg-popover text-popover-foreground absolute top-full right-24 z-30 mt-2 min-w-48 rounded-md border p-1 shadow-md">
      <p className="text-muted-foreground px-2 py-1.5 text-[11px] font-medium uppercase">Columns</p>
      {columns.map((column) => (
        <button
          type="button"
          key={column}
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
          onClick={() => onToggle(column)}
        >
          {selected.includes(column) ? <Check className="size-3.5" /> : <span className="size-3.5" />}
          {exploreColumnLabel(column)}
        </button>
      ))}
    </div>
  )
}

function ExploreSortMenu({
  rules,
  availableKeys,
  onCycleDirection,
  onRemove,
  onAdd,
}: {
  rules: ExploreSortRule[]
  availableKeys: string[]
  onCycleDirection: (key: string) => void
  onRemove: (key: string) => void
  onAdd: (key: string) => void
}) {
  const activeKeys = new Set(rules.map((rule) => rule.key))
  return (
    <div className="bg-popover text-popover-foreground absolute top-full right-0 z-30 mt-2 min-w-56 rounded-md border p-1 shadow-md">
      <p className="text-muted-foreground px-2 py-1.5 text-[11px] font-medium uppercase">Sort order</p>
      {rules.length
        ? rules.map((rule) => (
            <div key={rule.key} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs">
              <button
                type="button"
                className="hover:bg-accent rounded p-1"
                onClick={() => onCycleDirection(rule.key)}
                aria-label={`Change ${rule.key} sort direction`}
              >
                {rule.direction === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}
              </button>
              <span className="min-w-0 flex-1 truncate">{rule.key}</span>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded px-1 text-[11px]"
                onClick={() => onRemove(rule.key)}
                aria-label={`Remove ${rule.key} sort`}
              >
                Remove
              </button>
            </div>
          ))
        : null}
      <div className="border-border mt-1 border-t pt-1">
        <p className="text-muted-foreground px-2 py-1.5 text-[11px] font-medium uppercase">Add attribute sort</p>
        {availableKeys
          .filter((key) => !activeKeys.has(key))
          .map((key) => (
            <button
              key={key}
              type="button"
              className="hover:bg-accent flex w-full items-center rounded px-2 py-1.5 text-left text-xs"
              onClick={() => onAdd(key)}
            >
              {key}
            </button>
          ))}
        {!availableKeys.some((key) => !activeKeys.has(key)) ? (
          <p className="text-muted-foreground px-2 py-2 text-xs">
            {rules.length ? 'All attributes are already selected.' : 'No attribute names available.'}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export type ExplorePageProps = {
  contextLabel: string
  query: string
  parsed: ParsedExploreQuery
  results: HMExploreResult[]
  counts: Record<HMExploreResultType | 'all', number>
  textTerms: string[]
  diagnostics?: ParsedExploreQuery['diagnostics']
  blocksByDocument?: Record<string, Extract<HMExploreResult, {type: 'block'}>[]>
  isLoading?: boolean
  isRefetching?: boolean
  error?: string | null
  hasMore?: boolean
  intersectionPending?: boolean
  intersectionTruncated?: boolean
  onLoadMore?: () => void
  onQueryChange: (query: string) => void
  onOpenResult: (result: HMExploreResult) => void
  accountUid?: string
  context: HMExploreContext
  onScopeChange?: (scope: HMExploreContext) => void
}

type ResultTab = 'all' | HMExploreResultType
const tabs: Array<{id: ResultTab; label: string}> = [
  {id: 'all', label: 'All'},
  {id: 'document', label: 'Documents'},
  {id: 'block', label: 'Text blocks'},
  {id: 'comment', label: 'Conversations'},
]

/** Shared Explore search/results surface used by desktop and web wrappers. */
export function ExplorePage(props: ExplorePageProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('all')
  const [menu, setMenu] = useState<'type' | 'in' | 'attributes' | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [draft, setDraft] = useState(props.query)
  const [builderAst, setBuilderAst] = useState<ExploreQueryNode | null>(props.parsed.ast)
  const [activeValueField, setActiveValueField] = useState('')
  const [activeValueKind, setActiveValueKind] = useState<'string' | 'int' | 'bool'>('string')
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  const debounceRef = useRef<number | null>(null)
  const onQueryChangeRef = useRef(props.onQueryChange)
  onQueryChangeRef.current = props.onQueryChange
  useEffect(() => setDraft(props.query), [props.query])
  useEffect(() => setBuilderAst(props.parsed.ast), [props.parsed.ast])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft !== props.query) onQueryChangeRef.current(draft)
    }, 260)
    debounceRef.current = timer
    return () => {
      window.clearTimeout(timer)
      if (debounceRef.current === timer) debounceRef.current = null
    }
  }, [draft, props.query])

  const chips = useMemo(() => exploreQueryChips(props.parsed), [props.parsed])
  const accounts = useExploreAccounts(true)
  const attributeNames = useExploreAttributeNames(props.accountUid || '', true)
  const attributeValues = useExploreAttributeValues(activeValueField, activeValueKind, '', true)
  const visibleResults = props.results.filter((result) => activeTab === 'all' || result.type === activeTab)
  const documentOnly = activeTab !== 'all' && activeTab !== 'document'
  const updateQuery = (next: string) => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setDraft(next)
    onQueryChangeRef.current(next)
  }
  const commitBuilderAst = (nextAst: ExploreQueryNode | null) => {
    setBuilderAst(nextAst)
    const nextQuery = serializeExploreBuilderQuery(nextAst, props.parsed.presentation)
    if (nextQuery !== props.query) updateQuery(nextQuery)
  }
  const updatePresentation = (presentation: ExplorePresentation) =>
    updateQuery(withPresentation(props.parsed.ast, presentation))
  const builtInColumns = ['title', 'space', 'path', 'updated', 'version']
  const availableColumns = [...builtInColumns, ...(attributeNames.data ?? [])]
  const selectedColumns = props.parsed.presentation.columns?.length
    ? props.parsed.presentation.columns
    : ['title', 'space', 'path', 'updated']
  const sortRules = props.parsed.presentation.sort ?? []
  const cycleSort = (key: string) => {
    const nextRules = cycleExploreSort(sortRules, key)
    updatePresentation({...props.parsed.presentation, sort: nextRules.length ? nextRules : undefined})
  }
  const cycleSortDirection = (key: string) => {
    const nextRules = sortRules.map((rule) =>
      rule.key === key ? {...rule, direction: rule.direction === 'asc' ? ('desc' as const) : ('asc' as const)} : rule,
    )
    updatePresentation({...props.parsed.presentation, sort: nextRules})
  }
  const removeSort = (key: string) => {
    const nextRules = sortRules.filter((rule) => rule.key !== key)
    updatePresentation({...props.parsed.presentation, sort: nextRules.length ? nextRules : undefined})
  }
  const tableMode = props.parsed.presentation.view === 'table' && activeTab !== 'block' && activeTab !== 'comment'

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-6 lg:px-8">
      <header className="border-border flex flex-col gap-4 border-b pb-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">Explore</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Advanced search</h1>
          </div>
          <ExploreScopePill
            context={props.context}
            contextLabel={props.contextLabel}
            accounts={accounts.data ?? []}
            onChange={props.onScopeChange}
          />
        </div>
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder="Search documents, blocks, conversations, and attributes"
          aria-label="Explore query"
          className="bg-background h-11 font-mono text-sm"
        />
        <div className="relative flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={props.parsed.presentation.view === 'table' ? 'secondary' : 'outline'}
              onClick={() =>
                updatePresentation({
                  ...props.parsed.presentation,
                  view: props.parsed.presentation.view === 'table' ? 'list' : 'table',
                })
              }
            >
              {props.parsed.presentation.view === 'table' ? 'Table' : 'List'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!tableMode}
              onClick={() => setColumnsOpen((open) => !open)}
              title={!tableMode ? 'Columns are available for document results.' : undefined}
            >
              Columns
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!tableMode}
              onClick={() => setSortOpen((open) => !open)}
              title={!tableMode ? 'Sorting is available for document results.' : undefined}
            >
              Sort{sortRules.length ? ` (${sortRules.length})` : ''}
            </Button>
          </div>
          {columnsOpen ? (
            <ExploreColumnsMenu
              columns={availableColumns}
              selected={selectedColumns}
              onToggle={(column) => {
                const next = toggleExploreColumn(selectedColumns, column)
                updatePresentation({...props.parsed.presentation, columns: next.length ? next : ['title']})
              }}
            />
          ) : null}
          {sortOpen ? (
            <ExploreSortMenu
              rules={sortRules}
              availableKeys={attributeNames.data ?? []}
              onCycleDirection={cycleSortDirection}
              onRemove={removeSort}
              onAdd={cycleSort}
            />
          ) : null}
          {(['type', 'in', 'attributes'] as const).map((kind) => (
            <div key={kind} className="relative">
              <Button size="sm" variant="outline" onClick={() => setMenu(menu === kind ? null : kind)}>
                {kind[0]!.toUpperCase() + kind.slice(1)}
              </Button>
              {menu === kind ? (
                <ExploreFilterMenu
                  options={
                    kind === 'type'
                      ? ['type:document', 'type:block', 'type:comment']
                      : kind === 'in'
                        ? accounts.data?.map((account) => `in:${account.value}`) ?? []
                        : attributeNames.data?.map((name) => `has:${name}`) ?? []
                  }
                  activeTokens={chips.map((chip) => chip.token)}
                  onToggle={(predicate) => {
                    const next = toggleExplorePredicate(props.parsed, predicate)
                    updateQuery(serializeExploreQuery(next))
                    setMenu(null)
                  }}
                />
              ) : null}
            </div>
          ))}
          <Button
            size="sm"
            variant={advancedOpen ? 'secondary' : 'outline'}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            Advanced
          </Button>
        </div>
        {chips.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => updateQuery(serializeExploreQuery(removeExploreQueryChip(props.parsed, chip.id)))}
                className="border-border bg-muted/40 hover:bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-xs transition-colors"
              >
                {chip.label}
                <X className="size-3" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground px-2 text-xs"
              onClick={() => updateQuery('')}
            >
              Clear all
            </button>
          </div>
        ) : null}
        {props.diagnostics?.map((diagnostic, index) => (
          <p key={`${diagnostic.start}:${index}`} className="text-xs text-amber-700 dark:text-amber-300">
            {diagnostic.message}
          </p>
        ))}
      </header>

      {advancedOpen ? (
        <ExploreBuilder
          ast={builderAst}
          attributeNames={attributeNames.data ?? []}
          attributeValues={attributeValues.data ?? []}
          accounts={accounts.data ?? []}
          context={props.context}
          presentation={props.parsed.presentation}
          onFocusValue={(field, kind) => {
            setActiveValueField(field)
            setActiveValueKind(kind)
          }}
          onChange={commitBuilderAst}
        />
      ) : null}

      <nav className="border-border flex flex-wrap gap-1 border-b" role="tablist" aria-label="Explore result types">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm transition-colors',
              activeTab === tab.id
                ? 'border-foreground text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {tab.label} <span className="text-muted-foreground tabular-nums">{props.counts[tab.id]}</span>
          </button>
        ))}
      </nav>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{props.counts[activeTab]} results</p>
          {documentOnly ? (
            <p className="text-muted-foreground text-xs">Attribute sorting applies to documents.</p>
          ) : null}
        </div>
        <span className="text-muted-foreground text-xs">
          {props.textTerms.length ? 'Text matches highlighted below' : 'Attribute query'}
        </span>
      </div>

      <section aria-live="polite" className="min-h-48">
        {props.isLoading || props.intersectionPending || props.isRefetching ? (
          visibleResults.length ? (
            <p className="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Updating results…
            </p>
          ) : (
            <ExploreState
              icon={<Loader2 className="animate-spin" />}
              title="Searching"
              detail="Loading Explore results."
            />
          )
        ) : null}
        {props.error ? (
          <ExploreState icon={<Search />} title="Search failed" detail={props.error} tone="error" />
        ) : null}
        {!props.isLoading &&
        !props.intersectionPending &&
        !props.isRefetching &&
        !props.error &&
        !visibleResults.length ? (
          <ExploreState icon={<Search />} title="No results" detail="Try a broader search or remove a filter." />
        ) : null}
        {visibleResults.length && tableMode ? (
          <ExploreTable
            results={visibleResults.filter(
              (result): result is Extract<HMExploreResult, {type: 'document'}> => result.type === 'document',
            )}
            columns={selectedColumns}
            sortRules={sortRules}
            onSort={cycleSort}
            onOpen={props.onOpenResult}
          />
        ) : visibleResults.length ? (
          <div className="border-border divide-border bg-background overflow-hidden rounded-lg border">
            {visibleResults.map((result) => (
              <ExploreResultRow
                key={
                  result.type === 'comment'
                    ? `${result.type}:${result.commentId}`
                    : `${result.type}:${exploreDocumentKey(result.id)}`
                }
                result={result}
                terms={props.textTerms}
                blocks={
                  result.type === 'document' ? props.blocksByDocument?.[exploreDocumentKey(result.id)] : undefined
                }
                onOpen={props.onOpenResult}
              />
            ))}
          </div>
        ) : null}
        {props.intersectionTruncated ? (
          <p className="text-muted-foreground mt-3 text-xs">
            Some matches may be omitted because the document intersection reached its limit.
          </p>
        ) : null}
        {props.hasMore ? (
          <Button className="mt-4 w-full" variant="outline" onClick={props.onLoadMore}>
            Load more
          </Button>
        ) : visibleResults.length ? (
          <p className="text-muted-foreground mt-5 text-center text-xs">End of results</p>
        ) : null}
      </section>
    </main>
  )
}

function ExploreFilterMenu({
  options,
  activeTokens,
  onToggle,
}: {
  options: string[]
  activeTokens: string[]
  onToggle: (predicate: string) => void
}) {
  return (
    <div className="border-border bg-popover absolute top-10 left-0 z-10 flex min-w-44 flex-col rounded-md border p-1 shadow-md">
      {options.length ? (
        options.map((option) => (
          <button
            key={option}
            type="button"
            className={cn(
              'hover:bg-muted rounded px-2 py-1.5 text-left font-mono text-xs',
              activeTokens.includes(option) && 'bg-accent',
            )}
            onClick={() => onToggle(option)}
          >
            {option}
          </button>
        ))
      ) : (
        <p className="text-muted-foreground px-2 py-2 text-xs">No suggestions available.</p>
      )}
    </div>
  )
}

type BuilderNode = ExploreQueryNode

function builderPredicateIsComplete(predicate: ExplorePredicate) {
  if (predicate.kind === 'type') return Boolean(predicate.value)
  if (predicate.kind === 'scope') return Boolean(predicate.value.trim())
  if (predicate.operator === 'exists' || predicate.operator === 'missing') return Boolean(predicate.key.trim())
  return Boolean(predicate.key.trim() && 'value' in predicate && String(predicate.value).trim())
}

function serializableBuilderNode(node: ExploreQueryNode | null): ExploreQueryNode | null {
  if (!node || (node.kind === 'predicate' && !builderPredicateIsComplete(node.predicate))) return null
  if (node.kind === 'text' || node.kind === 'predicate') return node
  if (node.kind === 'not') {
    const child = serializableBuilderNode(node.child)
    return child ? {kind: 'not', child} : null
  }
  const children = node.children.flatMap((child) => {
    const next = serializableBuilderNode(child)
    return next ? [next] : []
  })
  return children.length ? {...node, children} : null
}

/** Serializes the completed portion of a builder AST while retaining pending UI nodes locally. */
export function serializeExploreBuilderQuery(ast: ExploreQueryNode | null, presentation: ExplorePresentation) {
  return serializeExploreQuery({ast: serializableBuilderNode(ast), presentation, diagnostics: []})
}

function appendExploreNode(ast: ExploreQueryNode | null, next: ExploreQueryNode): ExploreQueryNode {
  if (!ast) return next
  if (ast.kind === 'and') return {kind: 'and', children: [...ast.children, next]}
  return {kind: 'and', children: [ast, next]}
}

function withPresentation(ast: ExploreQueryNode | null, presentation: ExplorePresentation) {
  return serializeExploreQuery({ast, presentation, diagnostics: []})
}

function predicateToDraft(predicate: ExplorePredicate): {
  field: string
  kind: 'comparison' | 'contains' | 'prefix' | 'exists' | 'missing'
  operator: '=' | '!=' | '<' | '<=' | '>' | '>='
  valueKind: 'string' | 'int' | 'bool'
  value: string
} {
  if (predicate.kind === 'scope') {
    return {
      field: predicate.scope === 'path' ? '$path' : '$space',
      kind: predicate.scope === 'path' && predicate.prefix ? 'prefix' : 'contains',
      operator: '=',
      valueKind: 'string',
      value: predicate.value,
    }
  }
  if (predicate.kind === 'type') {
    return {field: 'type', kind: 'contains', operator: '=', valueKind: 'string', value: predicate.value}
  }
  if (predicate.operator === 'exists' || predicate.operator === 'missing')
    return {field: predicate.key, kind: predicate.operator, operator: '=', valueKind: 'string', value: ''}
  if (predicate.operator === 'contains' || predicate.operator === 'prefix')
    return {field: predicate.key, kind: predicate.operator, operator: '=', valueKind: 'string', value: predicate.value}
  if (predicate.operator !== 'comparison')
    return {field: predicate.key, kind: 'contains', operator: '=', valueKind: 'string', value: ''}
  return {
    field: predicate.key,
    kind: 'comparison',
    operator: predicate.comparison,
    valueKind: typeof predicate.value === 'number' ? 'int' : typeof predicate.value === 'boolean' ? 'bool' : 'string',
    value: String(predicate.value),
  }
}

function draftToPredicate(
  field: string,
  kind: 'comparison' | 'contains' | 'prefix' | 'exists' | 'missing',
  operator: '=' | '!=' | '<' | '<=' | '>' | '>=',
  valueKind: 'string' | 'int' | 'bool',
  value: string,
): ExplorePredicate | null {
  if (!field.trim()) return null
  if (field === 'type' && ['document', 'block', 'comment'].includes(value))
    return {kind: 'type', value: value as HMExploreResultType}
  if (field === '$space') return {kind: 'scope', scope: 'space', value: value.trim()}
  if (field === '$path') return {kind: 'scope', scope: 'path', value: value.trim() || '/', prefix: kind === 'prefix'}
  if (kind === 'exists' || kind === 'missing') return {kind: 'attribute', key: field.trim(), operator: kind}
  if (!value.trim()) return null
  if (kind === 'contains' || kind === 'prefix') return {kind: 'attribute', key: field.trim(), operator: kind, value}
  const typedValue = valueKind === 'int' ? Number(value) : valueKind === 'bool' ? value === 'true' : value
  return {kind: 'attribute', key: field.trim(), operator: 'comparison', comparison: operator, value: typedValue}
}

function ExploreBuilder({
  ast,
  attributeNames,
  attributeValues,
  accounts,
  context,
  presentation,
  onFocusValue,
  onChange,
}: {
  ast: ExploreQueryNode | null
  attributeNames: string[]
  attributeValues: string[]
  accounts: Array<{value: string; label: string}>
  context: HMExploreContext
  presentation: ExplorePresentation
  onFocusValue: (field: string, kind: 'string' | 'int' | 'bool') => void
  onChange: (ast: ExploreQueryNode | null) => void
}) {
  if (!ast) {
    return (
      <section className="border-border bg-muted/10 rounded-lg border p-4">
        <BuilderToolbar onAdd={(node) => onChange(node)} />
      </section>
    )
  }
  return (
    <section className="border-border bg-muted/10 flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.18em] uppercase">Query builder</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Edit document conditions without losing text or presentation directives.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange(clearExploreConditions(ast))}>
          Clear conditions
        </Button>
      </div>
      <BuilderNodeEditor
        node={ast}
        path={[]}
        attributeNames={attributeNames}
        attributeValues={attributeValues}
        accounts={accounts}
        onFocusValue={onFocusValue}
        onChange={onChange}
      />
      <BuilderToolbar onAdd={(node) => onChange(appendExploreNode(ast, node))} />
      <details className="border-border bg-background rounded-md border px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">Request preview</summary>
        <pre className="text-muted-foreground mt-2 overflow-auto text-[11px]">
          {JSON.stringify(
            new QueryDocumentsRequest({
              filter: compileExploreQuery({ast, presentation, diagnostics: []}, context).filter,
              sort: (presentation.sort ?? []).map(
                (rule) => new DocumentSort({key: rule.key, descending: rule.direction === 'desc'}),
              ),
            }).toJson(),
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  )
}

function BuilderToolbar({onAdd}: {onAdd: (node: ExploreQueryNode) => void}) {
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          onAdd({
            kind: 'predicate',
            predicate: {kind: 'attribute', key: '', operator: 'contains', value: ''},
          })
        }
      >
        Add condition
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAdd({kind: 'and', children: []})}>
        Add group
      </Button>
    </div>
  )
}

function BuilderNodeEditor({
  node,
  path,
  attributeNames,
  attributeValues,
  accounts,
  onFocusValue,
  onChange,
}: {
  node: BuilderNode
  path: number[]
  attributeNames: string[]
  attributeValues: string[]
  accounts: Array<{value: string; label: string}>
  onFocusValue: (field: string, kind: 'string' | 'int' | 'bool') => void
  onChange: (ast: ExploreQueryNode | null) => void
}) {
  const replace = (next: ExploreQueryNode | null) => onChange(next)
  if (node.kind === 'text') {
    return <div className="bg-muted/40 rounded-md px-3 py-2 font-mono text-xs">Text: {node.value || '(empty)'}</div>
  }
  if (node.kind === 'predicate') {
    const draft = predicateToDraft(node.predicate)
    return (
      <BuilderCondition
        draft={draft}
        attributeNames={attributeNames}
        attributeValues={attributeValues}
        accounts={accounts}
        onFocusValue={onFocusValue}
        onChange={(next) => replace(next ? {kind: 'predicate', predicate: next} : null)}
        onRemove={() => replace(null)}
      />
    )
  }
  if (node.kind === 'not') {
    return (
      <div className="border-border border-l-2 pl-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-muted-foreground text-xs font-medium">Not</div>
          <Button size="xs" variant="ghost" onClick={() => onChange(node.child)}>
            Remove Not
          </Button>
        </div>
        <BuilderNodeEditor
          node={node.child}
          path={[...path, 0]}
          attributeNames={attributeNames}
          attributeValues={attributeValues}
          accounts={accounts}
          onFocusValue={onFocusValue}
          onChange={(next) => onChange(next ? {kind: 'not', child: next} : null)}
        />
      </div>
    )
  }
  return (
    <div className="border-border bg-background flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <Select
          value={node.kind}
          onValueChange={(mode) =>
            onChange(mode === 'not' ? {kind: 'not', child: node} : {...node, kind: mode as 'and' | 'or'})
          }
        >
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">All</SelectItem>
            <SelectItem value="or">Any</SelectItem>
            <SelectItem value="not">Not</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              onChange({
                kind: node.kind,
                children: [
                  ...node.children,
                  {kind: 'predicate', predicate: {kind: 'attribute', key: '', operator: 'exists'}},
                ],
              })
            }
          >
            Add condition
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onChange({kind: node.kind, children: [...node.children, {kind: 'and', children: []}]})}
          >
            Add group
          </Button>
          {path.length ? (
            <Button size="xs" variant="ghost" onClick={() => replace(clearExploreConditions(node))}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      {node.children.map((child, index) => (
        <BuilderNodeEditor
          key={`${path.join('.')}.${index}`}
          node={child}
          path={[...path, index]}
          attributeNames={attributeNames}
          attributeValues={attributeValues}
          accounts={accounts}
          onFocusValue={onFocusValue}
          onChange={(next) => {
            const children = [...node.children]
            if (next) children[index] = next
            else children.splice(index, 1)
            onChange(children.length ? {...node, children} : null)
          }}
        />
      ))}
    </div>
  )
}

function BuilderCondition({
  draft,
  attributeNames,
  attributeValues,
  accounts,
  onFocusValue,
  onChange,
  onRemove,
}: {
  draft: ReturnType<typeof predicateToDraft>
  attributeNames: string[]
  attributeValues: string[]
  accounts: Array<{value: string; label: string}>
  onFocusValue: (field: string, kind: 'string' | 'int' | 'bool') => void
  onChange: (predicate: ExplorePredicate | null) => void
  onRemove: () => void
}) {
  const [field, setField] = useState(draft.field)
  const [kind, setKind] = useState(draft.kind)
  const [operator, setOperator] = useState(draft.operator)
  const [valueKind, setValueKind] = useState(draft.valueKind)
  const [value, setValue] = useState(draft.value)
  useEffect(() => {
    setField(draft.field)
    setKind(draft.kind)
    setOperator(draft.operator)
    setValueKind(draft.valueKind)
    setValue(draft.value)
  }, [draft.field, draft.kind, draft.operator, draft.valueKind, draft.value])
  const commit = (next: Partial<typeof draft>) => {
    const merged = {field, kind, operator, valueKind, value, ...next}
    setField(merged.field)
    setKind(merged.kind)
    setOperator(merged.operator)
    setValueKind(merged.valueKind)
    setValue(merged.value)
    onChange(draftToPredicate(merged.field, merged.kind, merged.operator, merged.valueKind, merged.value))
  }
  return (
    <div className="border-border flex flex-wrap items-center gap-2 rounded-md border p-2">
      <ExploreAutocomplete
        value={field}
        options={[...attributeNames, '$space', '$path']}
        onChange={(next) => commit({field: next})}
        placeholder="field"
        className="h-8 w-36 text-xs"
      />
      <Select value={kind} onValueChange={(next) => commit({kind: next as typeof kind})}>
        <SelectTrigger size="sm" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="comparison">Compare</SelectItem>
          <SelectItem value="contains">Contains</SelectItem>
          <SelectItem value="prefix">Starts with</SelectItem>
          <SelectItem value="exists">Exists</SelectItem>
          <SelectItem value="missing">Missing</SelectItem>
        </SelectContent>
      </Select>
      {kind === 'comparison' ? (
        <Select value={operator} onValueChange={(next) => commit({operator: next as typeof operator})}>
          <SelectTrigger size="sm" className="w-16">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['=', '!=', '<', '<=', '>', '>='].map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {kind !== 'exists' && kind !== 'missing' ? (
        <Select value={valueKind} onValueChange={(next) => commit({valueKind: next as typeof valueKind})}>
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="string">Text</SelectItem>
            <SelectItem value="int">Integer</SelectItem>
            <SelectItem value="bool">Boolean</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      {kind !== 'exists' && kind !== 'missing' ? (
        <ExploreAutocomplete
          value={value}
          options={attributeValues.length ? attributeValues : accounts.map((account) => account.value)}
          onFocus={() => onFocusValue(field, valueKind)}
          onChange={(next) => commit({value: next})}
          placeholder="value"
          className="h-8 min-w-32 flex-1 text-xs"
        />
      ) : null}
      <Button size="iconSm" variant="ghost" aria-label="Remove condition" onClick={onRemove}>
        ×
      </Button>
    </div>
  )
}

function ExploreAutocomplete({
  value,
  options,
  onChange,
  onFocus,
  placeholder,
  className,
}: {
  value: string
  options: string[]
  onChange: (value: string) => void
  onFocus?: () => void
  placeholder: string
  className?: string
}) {
  const store = Ariakit.useComboboxStore({value, setValue: onChange})
  const query = value.trim().toLocaleLowerCase()
  const suggestions = options.filter((option) => !query || option.toLocaleLowerCase().includes(query)).slice(0, 50)
  return (
    <div className="relative min-w-0 flex-1">
      <Ariakit.Combobox
        store={store}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        onFocus={onFocus}
        placeholder={placeholder}
        className={cn(
          'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-md border px-2 text-xs outline-none focus-visible:ring-2',
          className,
        )}
      />
      <Ariakit.ComboboxPopover
        store={store}
        gutter={4}
        sameWidth
        className="bg-popover text-popover-foreground z-50 max-h-48 overflow-auto rounded-md border p-1 shadow-md"
      >
        {suggestions.map((suggestion) => (
          <Ariakit.ComboboxItem
            key={suggestion}
            store={store}
            value={suggestion}
            className="hover:bg-accent focus:bg-accent w-full rounded px-2 py-1 text-left text-xs outline-none"
          />
        ))}
      </Ariakit.ComboboxPopover>
    </div>
  )
}

function tableCellValue(result: Extract<HMExploreResult, {type: 'document'}>, column: string) {
  const document = result.document
  if (column === 'title') return document?.metadata?.name || result.matchText || 'Untitled'
  if (column === 'space') return result.id.uid
  if (column === 'path') return `/${result.id.path?.join('/') || ''}`
  if (column === 'updated') return result.versionTime || '—'
  if (column === 'version') return result.id.version || '—'
  let value: unknown = document?.metadata
  for (const segment of column.split('.')) {
    if (!value || typeof value !== 'object') return '—'
    value = (value as Record<string, unknown>)[segment]
  }
  return value === undefined || value === null ? '—' : typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function ExploreTable({
  results,
  columns,
  sortRules,
  onSort,
  onOpen,
}: {
  results: Extract<HMExploreResult, {type: 'document'}>[]
  columns: string[]
  sortRules: ExploreSortRule[]
  onSort: (key: string) => void
  onOpen: (result: HMExploreResult) => void
}) {
  return (
    <div className="border-border bg-background overflow-x-auto rounded-lg border">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            {columns.map((column) => {
              const sort = sortRules.find((rule) => rule.key === column)
              const sortable = !['title', 'space', 'path', 'updated', 'version'].includes(column)
              return (
                <th key={column} className="border-border border-b px-3 py-2 font-medium whitespace-nowrap">
                  <button
                    type="button"
                    className={cn(
                      'rounded px-1 text-left',
                      sortable
                        ? 'hover:bg-muted focus-visible:ring-ring outline-none focus-visible:ring-2'
                        : 'cursor-default',
                    )}
                    disabled={!sortable}
                    onClick={() => onSort(column)}
                    aria-label={sortable ? `Sort by ${column}` : undefined}
                  >
                    {column}
                    {sort ? <span className="ml-1">{sort.direction === 'asc' ? '↑' : '↓'}</span> : null}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={exploreDocumentKey(result.id)} className="hover:bg-muted/20 border-b last:border-b-0">
              {columns.map((column) => (
                <td key={column} className="max-w-80 px-3 py-2 align-top">
                  {column === 'title' ? (
                    <button
                      type="button"
                      className="text-foreground focus-visible:ring-ring rounded text-left outline-none hover:underline focus-visible:ring-2"
                      onClick={() => onOpen(result)}
                    >
                      {tableCellValue(result, column)}
                    </button>
                  ) : (
                    tableCellValue(result, column)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ExploreResultRow({
  result,
  terms,
  blocks,
  onOpen,
}: {
  result: HMExploreResult
  terms: string[]
  blocks?: Extract<HMExploreResult, {type: 'block'}>[]
  onOpen: (result: HMExploreResult) => void
}) {
  const title =
    result.type === 'document'
      ? result.document?.metadata?.name || result.matchText || packHmId(result.id)
      : result.breadcrumb?.at(-1) || (result.type === 'comment' ? 'Conversation' : 'Text block')
  const Icon = result.type === 'document' ? FileText : result.type === 'block' ? Pilcrow : MessageSquare
  return (
    <article className="hover:bg-muted/20 border-b p-4 last:border-b-0">
      <button type="button" className="flex w-full gap-3 text-left" onClick={() => onOpen(result)}>
        <span className="border-border bg-muted text-muted-foreground mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border">
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">{highlightExploreText(title, terms)}</span>
            <span className="text-muted-foreground text-[10px] font-semibold tracking-widest uppercase">
              {result.type}
            </span>
          </span>
          <span className="text-muted-foreground mt-1 block text-xs">
            {result.breadcrumb?.join(' · ') || 'Explore result'}
            {result.versionTime ? ` · ${new Date(result.versionTime).toLocaleDateString()}` : ''}
          </span>
          {result.matchText ? (
            <span className="text-muted-foreground mt-2 block text-sm leading-6">
              {highlightExploreText(result.matchText, terms)}
            </span>
          ) : null}
          {result.matchedFields?.length ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {result.matchedFields.map((field) => (
                <span key={field.label} className="bg-muted rounded px-2 py-1 font-mono text-[11px]">
                  {field.label} {field.value}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      {blocks?.length ? (
        <div className="mt-3 pl-11">
          <p className="text-muted-foreground text-xs font-medium">{blocks.length} matching blocks</p>
          {blocks.map((block) => (
            <div key={packHmId(block.id)} className="border-border mt-2 border-l-2 pl-3 text-sm">
              <p className="text-muted-foreground">{highlightExploreText(block.matchText || '', terms)}</p>
              <button
                type="button"
                className="text-primary mt-1 text-xs underline underline-offset-2"
                onClick={() => onOpen(block)}
              >
                Jump to source
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function ExploreState({icon, title, detail, tone}: {icon: ReactNode; title: string; detail: string; tone?: 'error'}) {
  return (
    <div
      className={cn(
        'border-border bg-muted/20 flex min-h-48 flex-col items-center justify-center rounded-lg border p-6 text-center',
        tone === 'error' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <span className={cn('text-muted-foreground mb-3', tone === 'error' && 'text-destructive')}>{icon}</span>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{detail}</p>
    </div>
  )
}
