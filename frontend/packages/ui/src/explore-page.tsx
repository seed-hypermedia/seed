import type {
  ExplorePredicate,
  ExploreQueryNode,
  HMExploreResult,
  HMExploreResultType,
  ParsedExploreQuery,
} from '@shm/shared/explore'
import {
  exploreQueryChips,
  compileExploreQuery,
  parseExploreQuery,
  removeExploreQueryChip,
  serializeExploreQuery,
} from '@shm/shared/explore'
import {QueryDocumentsRequest} from '@shm/shared/client/grpc-types'
import {
  exploreDocumentKey,
  useExploreAccounts,
  useExploreAttributeNames,
  useExploreAttributeValues,
} from '@shm/shared/models/explore'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {FileText, Loader2, MessageSquare, Pilcrow, Search, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Button} from './button'
import {Input} from './components/input'
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
  error?: string | null
  hasMore?: boolean
  intersectionPending?: boolean
  intersectionTruncated?: boolean
  onLoadMore?: () => void
  onQueryChange: (query: string) => void
  onOpenResult: (result: HMExploreResult) => void
  accountUid?: string
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
    updateQuery(serializeExploreQuery({ast: nextAst, presentation: props.parsed.presentation, diagnostics: []}))
  }
  const addPredicate = (predicate: string) => {
    const next = parseExploreQuery(predicate).ast
    if (!next) return
    commitBuilderAst(appendExploreNode(builderAst, next))
    setMenu(null)
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-6 lg:px-8">
      <header className="border-border flex flex-col gap-4 border-b pb-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">Explore</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Advanced search</h1>
          </div>
          <span className="border-border bg-muted/30 text-muted-foreground rounded-md border px-3 py-2 text-xs">
            {props.contextLabel}
          </span>
        </div>
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder="Search documents, blocks, conversations, and attributes"
          aria-label="Explore query"
          className="bg-background h-11 font-mono text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
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
                    const existing = chips.find((chip) => chip.token === predicate)
                    if (existing) {
                      updateQuery(serializeExploreQuery(removeExploreQueryChip(props.parsed, existing.id)))
                    } else {
                      addPredicate(predicate)
                    }
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
        {props.isLoading || props.intersectionPending ? (
          <ExploreState
            icon={<Loader2 className="animate-spin" />}
            title="Searching"
            detail="Loading Explore results."
          />
        ) : null}
        {props.error ? (
          <ExploreState icon={<Search />} title="Search failed" detail={props.error} tone="error" />
        ) : null}
        {!props.isLoading && !props.intersectionPending && !props.error && !visibleResults.length ? (
          <ExploreState icon={<Search />} title="No results" detail="Try a broader search or remove a filter." />
        ) : null}
        {visibleResults.length ? (
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

function appendExploreNode(ast: ExploreQueryNode | null, next: ExploreQueryNode): ExploreQueryNode {
  if (!ast) return next
  if (ast.kind === 'and') return {kind: 'and', children: [...ast.children, next]}
  return {kind: 'and', children: [ast, next]}
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
  onFocusValue,
  onChange,
}: {
  ast: ExploreQueryNode | null
  attributeNames: string[]
  attributeValues: string[]
  accounts: Array<{value: string; label: string}>
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
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
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
              filter: compileExploreQuery({ast, presentation: {}, diagnostics: []}, {type: 'node'}).filter,
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
        <div className="text-muted-foreground mb-2 text-xs font-medium">Not</div>
        <BuilderNodeEditor
          node={node.child}
          path={[...path, 0]}
          attributeNames={attributeNames}
          attributeValues={attributeValues}
          accounts={accounts}
          onFocusValue={onFocusValue}
          onChange={onChange}
        />
      </div>
    )
  }
  return (
    <div className="border-border bg-background flex flex-col gap-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          value={node.kind}
          onChange={(event) => {
            const mode = event.target.value
            if (mode === 'not') onChange({kind: 'not', child: node})
            else onChange({...node, kind: mode as 'and' | 'or'})
          }}
        >
          <option value="and">All</option>
          <option value="or">Any</option>
          <option value="not">Not</option>
        </select>
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
            <Button size="xs" variant="ghost" onClick={() => replace(null)}>
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
            onChange(children.length === 1 ? children[0] ?? null : {...node, children})
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
      <Input
        list="explore-attribute-names"
        value={field}
        onChangeText={(next) => commit({field: next})}
        placeholder="field"
        className="h-8 w-36 text-xs"
      />
      <datalist id="explore-attribute-names">
        {[...attributeNames, '$space', '$path'].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <select
        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
        value={kind}
        onChange={(event) => commit({kind: event.target.value as typeof kind})}
      >
        <option value="comparison">Compare</option>
        <option value="contains">Contains</option>
        <option value="prefix">Starts with</option>
        <option value="exists">Exists</option>
        <option value="missing">Missing</option>
      </select>
      {kind === 'comparison' ? (
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          value={operator}
          onChange={(event) => commit({operator: event.target.value as typeof operator})}
        >
          <option>=</option>
          <option>!=</option>
          <option>&lt;</option>
          <option>&lt;=</option>
          <option>&gt;</option>
          <option>&gt;=</option>
        </select>
      ) : null}
      {kind !== 'exists' && kind !== 'missing' ? (
        <select
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          value={valueKind}
          onChange={(event) => commit({valueKind: event.target.value as typeof valueKind})}
        >
          <option value="string">Text</option>
          <option value="int">Integer</option>
          <option value="bool">Boolean</option>
        </select>
      ) : null}
      {kind !== 'exists' && kind !== 'missing' ? (
        <Input
          list="explore-attribute-values"
          value={value}
          onFocus={() => onFocusValue(field, valueKind)}
          onChangeText={(next) => commit({value: next})}
          placeholder="value"
          className="h-8 min-w-32 flex-1 text-xs"
        />
      ) : null}
      <datalist id="explore-attribute-values">
        {[...attributeValues, ...accounts.map((account) => account.value)].map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <Button size="iconSm" variant="ghost" aria-label="Remove condition" onClick={onRemove}>
        ×
      </Button>
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
