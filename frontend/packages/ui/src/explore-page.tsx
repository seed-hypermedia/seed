import type {HMExploreResult, HMExploreResultType, ParsedExploreQuery} from '@shm/shared/explore'
import {exploreQueryChips, removeExploreQueryChip, serializeExploreQuery} from '@shm/shared/explore'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {FileText, Loader2, MessageSquare, Pilcrow, Search, X} from 'lucide-react'
import {useEffect, useMemo, useState, type ReactNode} from 'react'
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
      <mark key={index} className="bg-yellow-200/80 text-inherit dark:bg-yellow-500/30">
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
  const [draft, setDraft] = useState(props.query)
  useEffect(() => setDraft(props.query), [props.query])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft !== props.query) props.onQueryChange(draft)
    }, 260)
    return () => window.clearTimeout(timer)
  }, [draft, props])

  const chips = useMemo(() => exploreQueryChips(props.parsed), [props.parsed])
  const visibleResults = props.results.filter((result) => activeTab === 'all' || result.type === activeTab)
  const documentOnly = activeTab !== 'all' && activeTab !== 'document'
  const updateQuery = (next: string) => {
    setDraft(next)
    props.onQueryChange(next)
  }
  const addPredicate = (predicate: string) => {
    updateQuery(draft ? `${draft} ${predicate}` : predicate)
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
              {menu === kind ? <ExploreFilterMenu kind={kind} onAdd={addPredicate} /> : null}
            </div>
          ))}
          <span className="text-muted-foreground ml-auto hidden text-xs md:inline">
            Advanced builder arrives in phase 4
          </span>
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
                    : `${result.type}:${packHmId(result.id)}`
                }
                result={result}
                terms={props.textTerms}
                blocks={result.type === 'document' ? props.blocksByDocument?.[packHmId(result.id)] : undefined}
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

function ExploreFilterMenu({kind, onAdd}: {kind: 'type' | 'in' | 'attributes'; onAdd: (predicate: string) => void}) {
  const options =
    kind === 'type'
      ? ['type:document', 'type:block', 'type:comment']
      : kind === 'in'
        ? ['in:alice', 'in:bob']
        : ['status:"In Progress"', 'priority:high', 'has:project.phase']
  return (
    <div className="border-border bg-popover absolute top-10 left-0 z-10 flex min-w-44 flex-col rounded-md border p-1 shadow-md">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="hover:bg-muted rounded px-2 py-1.5 text-left font-mono text-xs"
          onClick={() => onAdd(option)}
        >
          {option}
        </button>
      ))}
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
