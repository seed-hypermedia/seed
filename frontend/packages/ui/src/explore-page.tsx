import type {
  ExploreBrowseKind,
  ExplorePresentation,
  ExploreQueryNode,
  HMExploreContext,
  HMExploreResult,
  HMExploreResultType,
  ParsedExploreQuery,
} from '@shm/shared/explore'
import {
  BROWSABLE_KINDS,
  exploreQueryChips,
  removeExploreQueryChip,
  serializeExploreQuery,
  toggleExplorePredicate,
} from '@shm/shared/explore'
import {useAccountsMetadata} from '@shm/shared/models/entity'
import {
  exploreDocumentKey,
  exploreStreamSelection,
  resultKey,
  useExploreAccounts,
  useExploreAttributeNames,
  useExploreResultDocuments,
} from '@shm/shared/models/explore'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {Check, FileText, Globe, Loader2, MessageSquare, Pilcrow, Search, User, X} from 'lucide-react'
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {ExploreChipButton, ExploreFilterMenu, ExploreScopeMenu, ExploreTypeMenu, typeOptions} from './explore-filters'
import {ExploreBrowse, ExploreJumpTo, ExploreLanding, ExploreYourSpaces} from './explore-landing'
import {ExploreState} from './explore-primitives'
import {exploreTableConfig, ExploreViewSwitcher, queryBlockStyle} from './explore-views'
import {QueryBlockContent} from './query-block-content'
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

/** Result orderings offered above the list. */
type ExploreSortOption = 'relevance' | 'recent' | 'oldest' | 'title'
const sortOptions: Array<{value: ExploreSortOption; label: string}> = [
  {value: 'relevance', label: 'Relevance'},
  {value: 'recent', label: 'Recently updated'},
  {value: 'oldest', label: 'Oldest first'},
  {value: 'title', label: 'Title'},
]

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
  onActiveTypeChange?: (type: HMExploreResultType | null) => void
}

type ResultTab = 'all' | HMExploreResultType
const tabs: Array<{id: ResultTab; label: string}> = [
  {id: 'all', label: 'All'},
  {id: 'document', label: 'Documents'},
  {id: 'block', label: 'Text blocks'},
  {id: 'comment', label: 'Conversations'},
  {id: 'space', label: 'Spaces'},
  {id: 'contact', label: 'People'},
]

/** Shared Explore search/results surface used by desktop and web wrappers. */
export function ExplorePage(props: ExplorePageProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('all')
  // Set once the reader picks a tab, so the default below never overrides a deliberate choice.
  const [tabPicked, setTabPicked] = useState(false)
  const [menu, setMenu] = useState<'scope' | 'type' | 'in' | 'attributes' | 'sort' | null>(null)
  const [sortBy, setSortBy] = useState<ExploreSortOption>('relevance')
  const [draft, setDraft] = useState(props.query)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)
  const onQueryChangeRef = useRef(props.onQueryChange)
  onQueryChangeRef.current = props.onQueryChange
  useEffect(() => setDraft(props.query), [props.query])
  // view, cols, and sort are in the same query string as the search, so compare the
  // search alone. Switching the view must not throw the reader back to the default tab.
  const searchKey = useMemo(() => serializeExploreQuery(props.parsed.ast), [props.parsed.ast])
  useEffect(() => {
    setTabPicked(false)
    setActiveTab('all')
  }, [searchKey])
  // Open the documents tab by default, if documents were found.
  useEffect(() => {
    if (tabPicked || activeTab !== 'all') return
    if (props.counts.document > 0) setActiveTab('document')
    else if (props.counts.space > 0) setActiveTab('space')
  }, [tabPicked, activeTab, props.counts.document, props.counts.space])
  // Report the tab so the caller can narrow its query to it.
  const onActiveTypeChangeRef = useRef(props.onActiveTypeChange)
  onActiveTypeChangeRef.current = props.onActiveTypeChange
  useEffect(() => {
    onActiveTypeChangeRef.current?.(activeTab === 'all' ? null : activeTab)
  }, [activeTab])
  // Dismiss an open dropdown on blur.
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-explore-menu]')) setMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menu])
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
  const visibleResults = props.results.filter((result) => activeTab === 'all' || result.type === activeTab)
  // The scope chip reads the space's own name where we have it, falling back to the uid so it is
  // never blank while accounts are still loading.
  const scopeUid = props.context.type === 'site' ? props.context.id.uid : null
  const scopeLabel = scopeUid
    ? accounts.data?.find((account) => account.value === scopeUid)?.label ?? props.contextLabel ?? scopeUid
    : 'All spaces'
  const selectedTypes = chips
    .filter((chip) => chip.kind === 'type')
    .map((chip) => chip.token.replace(/^type:/, '') as HMExploreResultType)
  // Rewrites the type predicates to exactly the chosen set, one toggle per difference.
  const applyTypes = (next: HMExploreResultType[]) => {
    let parsed = props.parsed
    for (const type of selectedTypes) {
      if (!next.includes(type)) parsed = toggleExplorePredicate(parsed, `type:${type}`)
    }
    for (const type of next) {
      if (!selectedTypes.includes(type)) parsed = toggleExplorePredicate(parsed, `type:${type}`)
    }
    updateQuery(serializeExploreQuery(parsed))
  }
  // Ordering is applied to the results already loaded rather than to the query.
  const sortedResults = useMemo(() => {
    if (sortBy === 'relevance') return visibleResults
    const ordered = [...visibleResults]
    if (sortBy === 'title') {
      ordered.sort((a, b) => exploreResultTitle(a).localeCompare(exploreResultTitle(b)))
      return ordered
    }
    const time = (result: HMExploreResult) => (result.versionTime ? new Date(result.versionTime).getTime() : 0)
    ordered.sort((a, b) => (sortBy === 'recent' ? time(b) - time(a) : time(a) - time(b)))
    return ordered
  }, [visibleResults, sortBy])
  // With no search term, a single browsable type turns the landing into a plain listing of that
  // kind. Clearing the chip returns to the landing.
  const jumpToKinds: ExploreBrowseKind[] = props.context.type === 'site' ? ['document', 'contact'] : BROWSABLE_KINDS
  const browseKinds = selectedTypes.filter((type): type is ExploreBrowseKind =>
    BROWSABLE_KINDS.includes(type as ExploreBrowseKind),
  )
  // Comments and text blocks have no listing API, so selecting them can only narrow a later search.
  const searchOnlyTypes = selectedTypes.filter((type) => !BROWSABLE_KINDS.includes(type as ExploreBrowseKind))
  /** Scope chips carry a raw account uid. Show the space's name where the account list knows it. */
  const chipDisplayLabel = (chip: (typeof chips)[number]) => {
    if (chip.kind !== 'scope' || !chip.token.startsWith('in:')) return chip.label
    const uid = chip.token.slice('in:'.length)
    const name = accounts.data?.find((account) => account.value === uid)?.label
    return name && name !== uid ? `In ${name}` : chip.label
  }
  // A results tab can use the Collections views only when every row in it is a document or a space.
  // Search returns matched text and an id, so those rows are hydrated into records first.
  const viewableResults = activeTab === 'document' || activeTab === 'space'
  const view = props.parsed.presentation.view ?? 'list'
  const resultDocuments = useExploreResultDocuments(sortedResults, {enabled: viewableResults})
  const hydratedItems = useMemo(
    () =>
      sortedResults.flatMap((result) => {
        if (result.type !== 'document' && result.type !== 'space') return []
        const document = resultDocuments.data[exploreDocumentKey(result.id)]
        return document ? [document] : []
      }),
    [sortedResults, resultDocuments.data],
  )
  const resultAuthorUids = useMemo(
    () => Array.from(new Set(hydratedItems.flatMap((document) => document.authors ?? []))),
    [hydratedItems],
  )
  const resultAccountsMetadata = useAccountsMetadata(resultAuthorUids).data ?? {}
  const streams = exploreStreamSelection(props.parsed, props.context)
  const willSearch = streams.text || streams.documents
  // Counts describe the results loaded so far, never the total,
  // so show a plus if there are more results than can be counted.
  const countLabel = (count: number) => (props.hasMore ? `${count}+` : `${count}`)
  const showsCount = (tab: ResultTab) =>
    (activeTab === 'all' || tab === activeTab) && (!props.hasMore || props.counts[tab] > 0)
  const busy = Boolean(props.isLoading || props.isRefetching || props.intersectionPending)
  const autoLoad = useExploreAutoLoad({
    enabled: Boolean(props.hasMore),
    busy,
    resetKey: searchKey,
    onLoadMore: props.onLoadMore,
  })
  const updateQuery = (next: string) => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    setDraft(next)
    onQueryChangeRef.current(next)
  }
  const updatePresentation = (presentation: ExplorePresentation) =>
    updateQuery(withPresentation(props.parsed.ast, presentation))

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-6 lg:px-8">
      <header className="border-border flex flex-col gap-4 border-b pb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold tracking-tight">Explore</h1>
          <div className="relative w-full sm:max-w-xl">
            <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" aria-hidden />
            <Input
              ref={inputRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={scopeUid ? `Search in ${scopeLabel}` : 'Search across all your spaces...'}
              aria-label="Search"
              className="bg-background h-11 pl-9 text-sm"
            />
          </div>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          {props.onScopeChange ? (
            <div className="relative" data-explore-menu>
              <ExploreChipButton
                label={scopeLabel}
                active={props.context.type === 'site'}
                open={menu === 'scope'}
                onClick={() => setMenu(menu === 'scope' ? null : 'scope')}
              />
              {menu === 'scope' ? (
                <ExploreScopeMenu
                  context={props.context}
                  accounts={accounts.data ?? []}
                  onChange={(scope) => {
                    props.onScopeChange?.(scope)
                    setMenu(null)
                  }}
                />
              ) : null}
            </div>
          ) : null}
          <div className="relative" data-explore-menu>
            <ExploreChipButton
              label={selectedTypes.length ? `${selectedTypes.length} types` : 'All types'}
              active={selectedTypes.length > 0}
              open={menu === 'type'}
              onClick={() => setMenu(menu === 'type' ? null : 'type')}
            />
            {menu === 'type' ? (
              <ExploreTypeMenu
                counts={props.counts}
                showCounts={willSearch && activeTab === 'all'}
                selected={selectedTypes}
                onApply={(types) => {
                  applyTypes(types)
                  setMenu(null)
                }}
              />
            ) : null}
          </div>
          <div className="relative" data-explore-menu>
            <ExploreChipButton
              label="Attributes"
              active={chips.some((chip) => chip.kind === 'attribute')}
              open={menu === 'attributes'}
              onClick={() => setMenu(menu === 'attributes' ? null : 'attributes')}
            />
            {menu === 'attributes' ? (
              <ExploreFilterMenu
                options={(attributeNames.data ?? []).map((name) => ({token: `has:${name}`, label: name}))}
                activeTokens={chips.map((chip) => chip.token)}
                onToggle={(predicate) => {
                  const next = toggleExplorePredicate(props.parsed, predicate)
                  updateQuery(serializeExploreQuery(next))
                  setMenu(null)
                }}
              />
            ) : null}
          </div>
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
                {chipDisplayLabel(chip)}
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

      {willSearch ? (
        <nav className="border-border flex flex-wrap gap-1 border-b" role="tablist" aria-label="Explore result types">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => {
                setTabPicked(true)
                setActiveTab(tab.id)
              }}
              className={cn(
                'border-b-2 px-3 py-2 text-sm transition-colors',
                activeTab === tab.id
                  ? 'border-foreground text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {tab.label}{' '}
              {showsCount(tab.id) ? (
                <span className="text-muted-foreground tabular-nums">{countLabel(props.counts[tab.id])}</span>
              ) : null}
            </button>
          ))}
        </nav>
      ) : null}

      {willSearch ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {countLabel(props.counts[activeTab])} results
            {props.textTerms.length ? <> for &ldquo;{props.textTerms.join(' ')}&rdquo;</> : null}
          </p>
          <div className="flex items-center gap-2">
            {viewableResults ? (
              <ExploreViewSwitcher
                view={view}
                onChange={(next) => updatePresentation({...props.parsed.presentation, view: next})}
              />
            ) : null}
            <div className="relative" data-explore-menu>
              <ExploreChipButton
                label={`Sort by ${sortOptions.find((option) => option.value === sortBy)?.label ?? 'Relevance'}`}
                active={sortBy !== 'relevance'}
                open={menu === 'sort'}
                onClick={() => setMenu(menu === 'sort' ? null : 'sort')}
              />
              {menu === 'sort' ? (
                <div className="bg-popover text-popover-foreground absolute top-full right-0 z-30 mt-2 min-w-48 rounded-md border p-1 shadow-md">
                  {sortOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
                      onClick={() => {
                        setSortBy(option.value)
                        setMenu(null)
                      }}
                    >
                      {sortBy === option.value ? <Check className="size-3.5" /> : <span className="size-3.5" />}
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

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
          willSearch ? (
            <ExploreState icon={<Search />} title="No results" detail="Try a broader search or remove a filter." />
          ) : (
            // Filters alone never run a search, so a type chip on its own must not empty the page.
            <div className="flex flex-col gap-6">
              <ExploreJumpTo
                active={selectedTypes}
                kinds={jumpToKinds}
                onJump={(type) =>
                  applyTypes(
                    selectedTypes.includes(type)
                      ? selectedTypes.filter((value) => value !== type)
                      : [...selectedTypes, type],
                  )
                }
              />
              {searchOnlyTypes.length ? (
                <p className="text-muted-foreground text-sm">
                  {searchOnlyTypes
                    .map((type) => typeOptions.find((option) => option.value === type)?.label ?? type)
                    .join(' and ')}{' '}
                  can only be found by searching. Add a term above.
                </p>
              ) : null}
              {browseKinds.length ? (
                browseKinds.map((kind) => (
                  <ExploreBrowse
                    key={kind}
                    kind={kind}
                    context={props.context}
                    view={props.parsed.presentation.view ?? 'list'}
                    onViewChange={(view) => updatePresentation({...props.parsed.presentation, view})}
                  />
                ))
              ) : searchOnlyTypes.length ? null : (
                <>
                  <ExploreYourSpaces />
                  <ExploreLanding context={props.context} />
                </>
              )}
            </div>
          )
        ) : null}
        {visibleResults.length && viewableResults ? (
          <QueryBlockContent
            items={hydratedItems}
            style={queryBlockStyle(view)}
            accountsMetadata={resultAccountsMetadata}
            isDiscovering={resultDocuments.isLoading}
            tableConfig={exploreTableConfig(activeTab !== 'space')}
          />
        ) : visibleResults.length ? (
          <div className="border-border divide-border bg-background overflow-hidden rounded-lg border">
            {sortedResults.map((result) => (
              <ExploreResultRow
                key={resultKey(result)}
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
          <>
            <div ref={autoLoad.sentinelRef} className="h-px" aria-hidden />
            <Button className="mt-4 w-full" variant="outline" disabled={busy} onClick={props.onLoadMore}>
              {busy ? 'Loading…' : 'Load more'}
            </Button>
          </>
        ) : visibleResults.length ? (
          <p className="text-muted-foreground mt-5 text-center text-xs">End of results</p>
        ) : null}
      </section>
    </main>
  )
}

// How many pages scrolling may fetch before the reader has to ask again.
export const AUTO_LOAD_PAGE_LIMIT = 5

// Fetches the next page when the sentinel scrolls into view.
export function useExploreAutoLoad({
  enabled,
  busy,
  resetKey,
  onLoadMore,
}: {
  enabled: boolean
  busy: boolean
  resetKey: string
  onLoadMore?: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [autoLoads, setAutoLoads] = useState(0)
  // props.onLoadMore is rebuilt every render, so hold it in a ref rather than observing it.
  const onLoadMoreRef = useRef(onLoadMore)
  onLoadMoreRef.current = onLoadMore
  useEffect(() => setAutoLoads(0), [resetKey])
  const exhausted = autoLoads >= AUTO_LOAD_PAGE_LIMIT
  useEffect(() => {
    // Waiting for a page in flight, or the observer would fire again on the same sentinel.
    if (!enabled || busy || exhausted || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setAutoLoads((count) => count + 1)
        onLoadMoreRef.current?.()
      },
      {rootMargin: '600px 0px'},
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [enabled, busy, exhausted])
  return {sentinelRef, exhausted}
}

function withPresentation(ast: ExploreQueryNode | null, presentation: ExplorePresentation) {
  return serializeExploreQuery({ast, presentation, diagnostics: []})
}

function exploreResultTitle(result: HMExploreResult) {
  if (result.type === 'document' || result.type === 'space') {
    return result.document?.metadata?.name || result.matchText || packHmId(result.id)
  }
  if (result.type === 'contact') return result.matchText || result.breadcrumb?.at(-1) || packHmId(result.id)
  return result.breadcrumb?.at(-1) || (result.type === 'comment' ? 'Conversation' : 'Text block')
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
  const title = exploreResultTitle(result)
  const Icon =
    result.type === 'document'
      ? FileText
      : result.type === 'block'
        ? Pilcrow
        : result.type === 'space'
          ? Globe
          : result.type === 'contact'
            ? User
            : MessageSquare
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
