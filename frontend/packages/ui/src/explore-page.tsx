import type {
  ExplorePresentation,
  ExploreSortRule,
  ExplorePredicate,
  ExploreQueryNode,
  HMExploreContext,
  HMExploreResult,
  HMExploreResultType,
  ParsedExploreQuery,
  ExploreFacet,
} from '@shm/shared/explore'
import {
  exploreQueryChips,
  compileExploreQuery,
  cycleExploreSort,
  clearExploreConditions,
  removeExploreQueryChip,
  parseExploreQuery,
  exploreFacetValues,
  replaceExploreFacet,
  serializeExploreQuery,
  toggleExploreColumn,
} from '@shm/shared/explore'
import {DocumentSort, QueryDocumentsRequest} from '@shm/shared/client/grpc-types'
import {BUILTIN_METADATA_KEYS, DOCUMENT_ATTRIBUTE_DESCRIPTIONS} from '@seed-hypermedia/client/hm-types'
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
import {useEffect, useMemo, useReducer, useRef, useState, type ReactNode} from 'react'
import * as Ariakit from '@ariakit/react'
import {Button} from './button'
import {Input} from './components/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {cn} from './utils'
import {HMIcon} from './hm-icon'

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

/** Identifies metadata keys reserved by the document schema or Seed internals. */
export function isExploreSystemAttribute(name: string): boolean {
  return (
    BUILTIN_METADATA_KEYS.has(name) ||
    Object.prototype.hasOwnProperty.call(DOCUMENT_ATTRIBUTE_DESCRIPTIONS, name) ||
    name.startsWith('theme.') ||
    name.startsWith('seedExperimental') ||
    name.startsWith('display') ||
    name.startsWith('import') ||
    name.startsWith('originalPublish')
  )
}

/** Keeps only user-authored fields in Explore's attribute suggestions. */
export function filterExploreAttributeNames(names: string[]): string[] {
  return names.filter((name) => !isExploreSystemAttribute(name))
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
  accounts: Array<{value: string; label: string; metadata?: {name?: string; icon?: string}}>
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
  const selectedAccount =
    context.type === 'site' ? accounts.find((account) => account.value === context.id.uid) : undefined
  const scopeLabel = context.type === 'node' ? 'Whole node' : selectedAccount?.label || context.id.uid
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((value) => !value)}>
        {selectedAccount ? (
          <HMIcon
            id={hmId(selectedAccount.value)}
            name={selectedAccount.metadata?.name}
            icon={selectedAccount.metadata?.icon}
            size={18}
          />
        ) : null}
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
              <HMIcon id={hmId(account.value)} name={account.metadata?.name} icon={account.metadata?.icon} size={18} />
              <span className="truncate">{account.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ExploreFacetMenu({
  title,
  values,
  selected,
  counts,
  onChange,
  onApply,
  onClose,
  path,
  triggerRef,
}: {
  title: string
  values?: Array<{value: string; label: string; icon?: {id: string; name?: string; icon?: string}}>
  selected: string[]
  counts?: Record<string, number>
  onChange: (value: string) => void
  onApply: () => void
  onClose: () => void
  path?: string
  triggerRef?: {current: HTMLButtonElement | null}
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    menuRef.current?.focus()
    return () => triggerRef?.current?.focus()
  }, [triggerRef])
  return (
    <div
      ref={menuRef}
      tabIndex={-1}
      className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 min-w-64 rounded-xl border p-3 shadow-lg"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded p-1">
          <X className="size-4" aria-label="Close" />
        </button>
      </div>
      {path !== undefined ? (
        <Input
          value={path}
          onChangeText={onChange}
          placeholder="Any path"
          aria-label="Path filter"
          className="mb-3 h-9"
        />
      ) : (
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {(values ?? []).map((option) => {
            const checked = selected.includes(option.value)
            return (
              <button
                key={option.value}
                type="button"
                role="checkbox"
                aria-checked={checked}
                onClick={() => onChange(option.value)}
                onKeyDown={(event) => {
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.preventDefault()
                    onChange(option.value)
                  }
                }}
                className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'border-muted-foreground/50 flex size-4 items-center justify-center rounded border',
                    checked && 'bg-primary border-primary text-primary-foreground',
                  )}
                >
                  {checked ? <Check className="size-3" /> : null}
                </span>
                {option.icon ? (
                  <HMIcon id={hmId(option.icon.id)} name={option.icon.name} icon={option.icon.icon} size={18} />
                ) : null}
                <span className="flex-1 truncate">{option.label}</span>
                {counts?.[option.value] !== undefined ? (
                  <span className="text-muted-foreground text-xs">{counts[option.value]}</span>
                ) : null}
              </button>
            )
          })}
          {!values?.length ? <p className="text-muted-foreground px-2 py-3 text-sm">No options available.</p> : null}
        </div>
      )}
      <Button className="mt-3 w-full" size="sm" onClick={onApply}>
        Apply filters
      </Button>
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

export type ExploreEditorState = {
  activeTab: ResultTab
  menu: ExploreFacet | 'path' | null
  facetValues: string[]
  advancedOpen: boolean
  draft: string
  draftQuery: string
  builderAst: ExploreQueryNode | null
  builderQuery: string
  activeValueField: string
  activeValueKind: 'string' | 'int' | 'bool'
  columnsOpen: boolean
  sortOpen: boolean
}

export type ExploreEditorAction =
  | {type: 'set-active-tab'; tab: ResultTab}
  | {type: 'toggle-menu'; menu: ExploreFacet | 'path'; values?: string[]}
  | {type: 'set-facet-values'; values: string[]}
  | {type: 'toggle-advanced'}
  | {type: 'set-draft'; draft: string}
  | {type: 'commit-query'; query: string; builderAst?: ExploreQueryNode | null}
  | {type: 'set-builder'; ast: ExploreQueryNode | null; query: string}
  | {type: 'set-value-focus'; field: string; kind: 'string' | 'int' | 'bool'}
  | {type: 'toggle-columns'}
  | {type: 'toggle-sort'}
  | {type: 'close-menu'}

/** Creates the transient Explore editor state for a route query. */
export function createExploreEditorState(query: string, ast: ExploreQueryNode | null): ExploreEditorState {
  return {
    activeTab: 'all',
    menu: null,
    facetValues: [],
    advancedOpen: false,
    draft: query,
    draftQuery: query,
    builderAst: ast,
    builderQuery: query,
    activeValueField: '',
    activeValueKind: 'string',
    columnsOpen: false,
    sortOpen: false,
  }
}

/** Reduces transient Explore editing state without owning result-affecting URL state. */
export function exploreEditorReducer(state: ExploreEditorState, action: ExploreEditorAction): ExploreEditorState {
  switch (action.type) {
    case 'set-active-tab':
      return {...state, activeTab: action.tab}
    case 'toggle-menu':
      return {
        ...state,
        menu: state.menu === action.menu ? null : action.menu,
        facetValues: action.values ?? state.facetValues,
      }
    case 'set-facet-values':
      return {...state, facetValues: action.values}
    case 'toggle-advanced':
      return {...state, advancedOpen: !state.advancedOpen}
    case 'set-draft':
      return {...state, draft: action.draft}
    case 'commit-query':
      return {
        ...state,
        draft: action.query,
        draftQuery: action.query,
        builderAst: action.builderAst === undefined ? state.builderAst : action.builderAst,
        builderQuery: action.builderAst === undefined ? state.builderQuery : action.query,
      }
    case 'set-builder':
      return {
        ...state,
        builderAst: action.ast,
        builderQuery: action.query,
        draft: action.query,
        draftQuery: action.query,
      }
    case 'set-value-focus':
      return {...state, activeValueField: action.field, activeValueKind: action.kind}
    case 'toggle-columns':
      return {...state, columnsOpen: !state.columnsOpen, sortOpen: false}
    case 'toggle-sort':
      return {...state, sortOpen: !state.sortOpen, columnsOpen: false}
    case 'close-menu':
      return {...state, menu: null}
  }
}

/** Shared Explore search/results surface used by desktop and web wrappers. */
export function ExplorePage(props: ExplorePageProps) {
  const [editor, dispatch] = useReducer(
    exploreEditorReducer,
    {query: props.query, ast: props.parsed.ast},
    ({query, ast}) => createExploreEditorState(query, ast),
  )
  const debounceRef = useRef<number | null>(null)
  const debounceVersionRef = useRef(0)
  const latestQueryRef = useRef(props.query)
  latestQueryRef.current = props.query
  const draft = editor.draftQuery === props.query ? editor.draft : props.query
  const builderAst = editor.builderQuery === props.query ? editor.builderAst : props.parsed.ast
  const activeTab = editor.activeTab
  const menu = editor.menu
  const advancedOpen = editor.advancedOpen
  const activeValueField = editor.activeValueField
  const activeValueKind = editor.activeValueKind
  const columnsOpen = editor.columnsOpen
  const sortOpen = editor.sortOpen
  const facetValues = editor.facetValues
  const facetButtonRefs = useRef<Record<ExploreFacet, {current: HTMLButtonElement | null}>>({
    space: {current: null},
    type: {current: null},
    path: {current: null},
  })

  const chips = useMemo(() => exploreQueryChips(props.parsed), [props.parsed])
  const editingParsed = draft === props.query ? props.parsed : parseExploreQuery(draft)
  const accounts = useExploreAccounts(true)
  const attributeNames = useExploreAttributeNames(props.accountUid || '', true)
  const attributeValues = useExploreAttributeValues(activeValueField, activeValueKind, '', true)
  const visibleAttributeNames = filterExploreAttributeNames(attributeNames.data ?? [])
  const selectedSpaces = exploreFacetValues(editingParsed, 'space')
  const selectedTypes = exploreFacetValues(editingParsed, 'type')
  const selectedPath = exploreFacetValues(editingParsed, 'path')[0] ?? ''
  const selectedSpaceLabels = selectedSpaces.map(
    (value) => accounts.data?.find((account) => account.value === value)?.label ?? value,
  )
  const spaceLabel =
    selectedSpaceLabels.length === 0
      ? 'All spaces'
      : `${selectedSpaceLabels.slice(0, 2).join(', ')}${
          selectedSpaceLabels.length > 2 ? ` +${selectedSpaceLabels.length - 2}` : ''
        }`
  const visibleResults = props.results.filter((result) => activeTab === 'all' || result.type === activeTab)
  const documentOnly = activeTab !== 'all' && activeTab !== 'document'
  const cancelPendingDraft = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    debounceVersionRef.current += 1
  }
  const commitQuery = (next: string, nextBuilderAst?: ExploreQueryNode | null) => {
    cancelPendingDraft()
    dispatch({type: 'commit-query', query: next, builderAst: nextBuilderAst})
    props.onQueryChange(next)
  }
  const updateDraft = (next: string) => {
    dispatch({type: 'set-draft', draft: next})
    cancelPendingDraft()
    const version = debounceVersionRef.current
    const timer = window.setTimeout(() => {
      if (version !== debounceVersionRef.current) return
      debounceRef.current = null
      if (next !== latestQueryRef.current) commitQuery(next)
    }, 260)
    debounceRef.current = timer
  }
  const updateQuery = (next: string, nextBuilderAst?: ExploreQueryNode | null) => {
    commitQuery(next, nextBuilderAst)
  }
  const commitBuilderAst = (nextAst: ExploreQueryNode | null) => {
    const nextQuery = serializeExploreBuilderQuery(nextAst, editingParsed.presentation)
    dispatch({type: 'set-builder', ast: nextAst, query: nextQuery})
    if (nextQuery !== props.query) commitQuery(nextQuery, nextAst)
  }
  const updatePresentation = (presentation: ExplorePresentation) =>
    updateQuery(withPresentation(editingParsed.ast, presentation))
  const builtInColumns = ['title', 'space', 'path', 'updated', 'version']
  const availableColumns = [...builtInColumns, ...visibleAttributeNames]
  const selectedColumns = editingParsed.presentation.columns?.length
    ? editingParsed.presentation.columns
    : ['title', 'space', 'path', 'updated']
  const sortRules = editingParsed.presentation.sort ?? []
  const cycleSort = (key: string) => {
    const nextRules = cycleExploreSort(sortRules, key)
    updatePresentation({...editingParsed.presentation, sort: nextRules.length ? nextRules : undefined})
  }
  const cycleSortDirection = (key: string) => {
    const nextRules = sortRules.map((rule) =>
      rule.key === key ? {...rule, direction: rule.direction === 'asc' ? ('desc' as const) : ('asc' as const)} : rule,
    )
    updatePresentation({...editingParsed.presentation, sort: nextRules})
  }
  const removeSort = (key: string) => {
    const nextRules = sortRules.filter((rule) => rule.key !== key)
    updatePresentation({...editingParsed.presentation, sort: nextRules.length ? nextRules : undefined})
  }
  const toggleFacetValue = (value: string) => {
    dispatch({
      type: 'set-facet-values',
      values: facetValues.includes(value) ? facetValues.filter((item) => item !== value) : [...facetValues, value],
    })
  }
  const openFacet = (facet: ExploreFacet) => {
    dispatch({
      type: 'toggle-menu',
      menu: facet,
      values:
        facet === 'space' ? selectedSpaces : facet === 'type' ? selectedTypes : selectedPath ? [selectedPath] : [],
    })
  }
  const applyFacet = (facet: ExploreFacet) => {
    updateQuery(serializeExploreQuery(replaceExploreFacet(editingParsed, facet, facetValues)))
    dispatch({type: 'close-menu'})
  }
  const tableMode = editingParsed.presentation.view === 'table' && activeTab !== 'block' && activeTab !== 'comment'

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
          onChangeText={updateDraft}
          placeholder="Search documents, blocks, conversations, and attributes"
          aria-label="Explore query"
          className="bg-background h-11 font-mono text-sm"
        />
        <div className="relative flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={editingParsed.presentation.view === 'table' ? 'secondary' : 'outline'}
              onClick={() =>
                updatePresentation({
                  ...editingParsed.presentation,
                  view: editingParsed.presentation.view === 'table' ? 'list' : 'table',
                })
              }
            >
              {editingParsed.presentation.view === 'table' ? 'Table' : 'List'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!tableMode}
              onClick={() => dispatch({type: 'toggle-columns'})}
              title={!tableMode ? 'Columns are available for document results.' : undefined}
            >
              Columns
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!tableMode}
              onClick={() => dispatch({type: 'toggle-sort'})}
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
                updatePresentation({...editingParsed.presentation, columns: next.length ? next : ['title']})
              }}
            />
          ) : null}
          {sortOpen ? (
            <ExploreSortMenu
              rules={sortRules}
              availableKeys={visibleAttributeNames}
              onCycleDirection={cycleSortDirection}
              onRemove={removeSort}
              onAdd={cycleSort}
            />
          ) : null}
          {[
            {
              facet: 'space' as const,
              label: spaceLabel,
              options: (accounts.data ?? []).map((account) => ({
                value: account.value,
                label: account.label,
                icon: {id: account.value, name: account.metadata?.name, icon: account.metadata?.icon},
              })),
            },
            {
              facet: 'type' as const,
              label: selectedTypes.length
                ? selectedTypes.map((type) => type[0]!.toUpperCase() + type.slice(1)).join(', ')
                : 'All types',
              options: [
                {value: 'document', label: 'Documents'},
                {value: 'block', label: 'Text blocks'},
                {value: 'comment', label: 'Conversations'},
              ],
            },
          ].map(({facet, label, options}) => (
            <div key={facet} className="relative">
              <Button
                ref={(element) => {
                  facetButtonRefs.current[facet].current = element
                }}
                size="sm"
                variant={menu === facet ? 'secondary' : 'outline'}
                onClick={() => openFacet(facet)}
              >
                {label}
                <ChevronDown className="ml-1 size-3.5" />
              </Button>
              {menu === facet ? (
                <ExploreFacetMenu
                  title={facet === 'space' ? 'Spaces' : 'Types'}
                  values={options}
                  selected={facetValues}
                  counts={
                    facet === 'type' && selectedTypes.length === 0
                      ? {
                          document: props.counts.document,
                          block: props.counts.block,
                          comment: props.counts.comment,
                        }
                      : undefined
                  }
                  onChange={toggleFacetValue}
                  onApply={() => applyFacet(facet)}
                  onClose={() => dispatch({type: 'close-menu'})}
                  triggerRef={facetButtonRefs.current[facet]}
                />
              ) : null}
            </div>
          ))}
          <div className="relative">
            <Button
              ref={(element) => {
                facetButtonRefs.current.path.current = element
              }}
              size="sm"
              variant={menu === 'path' ? 'secondary' : 'outline'}
              onClick={() => openFacet('path')}
            >
              {selectedPath ? `In ${selectedPath}` : 'In'}
              <ChevronDown className="ml-1 size-3.5" />
            </Button>
            {menu === 'path' ? (
              <ExploreFacetMenu
                title="Path"
                path={facetValues[0] ?? ''}
                selected={facetValues}
                onChange={(value) => dispatch({type: 'set-facet-values', values: [value]})}
                onApply={() => applyFacet('path')}
                onClose={() => dispatch({type: 'close-menu'})}
                triggerRef={facetButtonRefs.current.path}
              />
            ) : null}
          </div>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground px-2 text-sm underline-offset-4 hover:underline"
            onClick={() => dispatch({type: 'toggle-advanced'})}
          >
            {advancedOpen ? 'Hide all filters' : 'See all filters'}
          </button>
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
          attributeNames={visibleAttributeNames}
          attributeValues={attributeValues.data ?? []}
          accounts={accounts.data ?? []}
          context={props.context}
          presentation={editingParsed.presentation}
          onFocusValue={(field, kind) => dispatch({type: 'set-value-focus', field, kind})}
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
            onClick={() => dispatch({type: 'set-active-tab', tab: tab.id})}
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
            accounts={accounts.data ?? []}
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
                accounts={accounts.data ?? []}
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
  if (!field.trim()) {
    if (kind === 'exists' || kind === 'missing') return {kind: 'attribute', key: '', operator: kind}
    if (kind === 'comparison') return {kind: 'attribute', key: '', operator: 'comparison', comparison: operator, value}
    return {kind: 'attribute', key: '', operator: kind, value}
  }
  if (field === 'type' && ['document', 'block', 'comment'].includes(value))
    return {kind: 'type', value: value as HMExploreResultType}
  if (field === '$space') return {kind: 'scope', scope: 'space', value: value.trim()}
  if (field === '$path') return {kind: 'scope', scope: 'path', value: value.trim() || '/', prefix: kind === 'prefix'}
  if (kind === 'exists' || kind === 'missing') return {kind: 'attribute', key: field.trim(), operator: kind}
  if (!value.trim()) return null
  if (kind === 'contains') return {kind: 'attribute', key: field.trim(), operator: 'contains', value}
  if (kind === 'prefix') return {kind: 'attribute', key: field.trim(), operator: 'prefix', value}
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
  accounts: Array<{value: string; label: string; metadata?: {name?: string; icon?: string}}>
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
  const commit = (next: Partial<typeof draft>) => {
    const merged = {...draft, ...next}
    onChange(draftToPredicate(merged.field, merged.kind, merged.operator, merged.valueKind, merged.value))
  }
  return (
    <div className="border-border flex flex-wrap items-center gap-2 rounded-md border p-2">
      <ExploreAutocomplete
        value={draft.field}
        options={[...attributeNames, '$space', '$path']}
        onChange={(next) => commit({field: next})}
        placeholder="field"
        className="h-8 w-36 text-xs"
      />
      <Select value={draft.kind} onValueChange={(next) => commit({kind: next as typeof draft.kind})}>
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
      {draft.kind === 'comparison' ? (
        <Select value={draft.operator} onValueChange={(next) => commit({operator: next as typeof draft.operator})}>
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
      {draft.kind !== 'exists' && draft.kind !== 'missing' ? (
        <Select value={draft.valueKind} onValueChange={(next) => commit({valueKind: next as typeof draft.valueKind})}>
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
      {draft.kind !== 'exists' && draft.kind !== 'missing' ? (
        <ExploreAutocomplete
          value={draft.value}
          options={attributeValues.length ? attributeValues : accounts.map((account) => account.value)}
          onFocus={() => onFocusValue(draft.field, draft.valueKind)}
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

function tableCellValue(
  result: Extract<HMExploreResult, {type: 'document'}>,
  column: string,
  accounts: Array<{value: string; label: string; metadata?: {name?: string; icon?: string}}>,
) {
  const document = result.document
  if (column === 'title') return document?.metadata?.name || result.matchText || 'Untitled'
  if (column === 'space') {
    const account = accounts.find((account) => account.value === result.id.uid)
    return account?.label || result.id.uid
  }
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
  accounts,
  onSort,
  onOpen,
}: {
  results: Extract<HMExploreResult, {type: 'document'}>[]
  columns: string[]
  sortRules: ExploreSortRule[]
  accounts: Array<{value: string; label: string; metadata?: {name?: string; icon?: string}}>
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
                      {tableCellValue(result, column, accounts)}
                    </button>
                  ) : (
                    tableCellValue(result, column, accounts)
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
  accounts,
  onOpen,
}: {
  result: HMExploreResult
  terms: string[]
  blocks?: Extract<HMExploreResult, {type: 'block'}>[]
  accounts: Array<{value: string; label: string; metadata?: {name?: string; icon?: string}}>
  onOpen: (result: HMExploreResult) => void
}) {
  const accountUid = result.type === 'comment' ? result.documentId.uid : result.id.uid
  const spaceAccount = accounts.find((account) => account.value === accountUid)
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
          <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-xs">
            {spaceAccount ? (
              <HMIcon
                id={hmId(accountUid)}
                name={spaceAccount.metadata?.name}
                icon={spaceAccount.metadata?.icon}
                size={14}
              />
            ) : null}
            <span className="truncate">{spaceAccount?.label || accountUid}</span>
            {' · '}
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
