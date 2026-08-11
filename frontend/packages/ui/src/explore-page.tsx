import type {HMExploreResult, HMExploreResultType, HMExploreSort} from '@shm/shared/explore'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {FileText, Loader2, MessageSquare, Pilcrow, Search} from 'lucide-react'
import {useMemo, useState, type ReactNode} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {cn} from './utils'

/** Data required by the shared Explore page UI. */
export type ExplorePageProps = {
  contextLabel: string
  query: string
  sort?: HMExploreSort
  results: HMExploreResult[]
  isLoading?: boolean
  error?: string | null
  onQueryChange: (query: string) => void
  onSortChange?: (sort: HMExploreSort) => void
  onOpenResult: (result: HMExploreResult) => void
}

type ResultTab = 'all' | HMExploreResultType

const tabs: ResultTab[] = ['all', 'document', 'block', 'comment']

function tabLabel(tab: ResultTab) {
  if (tab === 'all') return 'All'
  if (tab === 'document') return 'Documents'
  if (tab === 'block') return 'Blocks'
  return 'Comments'
}

function resultTitle(result: HMExploreResult) {
  if (result.type === 'document') return result.document?.metadata?.name || result.matchText || packHmId(result.id)
  if (result.type === 'block') return result.breadcrumb?.at(-1) || packHmId(result.id)
  return result.breadcrumb?.at(-1) || 'Comment match'
}

function resultSubtitle(result: HMExploreResult) {
  if (result.type === 'comment') return result.matchText
  if (result.type === 'block') return result.matchText
  return result.matchedFields?.map((field) => `${field.label}: ${field.value}`).join(' · ') || result.matchText
}

function resultIcon(result: HMExploreResult) {
  if (result.type === 'document') return <FileText className="size-4" />
  if (result.type === 'block') return <Pilcrow className="size-4" />
  return <MessageSquare className="size-4" />
}

/** Shared Explore search/results surface used by desktop and web wrappers. */
export function ExplorePage({
  contextLabel,
  query,
  sort = 'relevance',
  results,
  isLoading,
  error,
  onQueryChange,
  onSortChange,
  onOpenResult,
}: ExplorePageProps) {
  const [activeTab, setActiveTab] = useState<ResultTab>('all')
  const counts = useMemo(
    () => ({
      all: results.length,
      document: results.filter((result) => result.type === 'document').length,
      block: results.filter((result) => result.type === 'block').length,
      comment: results.filter((result) => result.type === 'comment').length,
    }),
    [results],
  )
  const visibleResults = activeTab === 'all' ? results : results.filter((result) => result.type === activeTab)

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-6 lg:px-8">
      <header className="border-border flex flex-col gap-4 border-b pb-5">
        <div className="space-y-1">
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-[0.18em] uppercase">
            <Search className="size-3.5" /> Explore
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Explore</h1>
          <p className="text-muted-foreground max-w-2xl text-sm">
            Search documents, block content, comments, and document attributes in the selected context.
          </p>
        </div>
        <div className="border-border bg-muted/20 flex flex-col gap-3 rounded-lg border p-3 shadow-sm sm:flex-row sm:items-center">
          <span className="bg-background border-border text-muted-foreground inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium">
            {contextLabel}
          </span>
          <Input
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search, e.g. roadmap type:block status:active"
            aria-label="Explore query"
            className="bg-background min-w-0 flex-1"
          />
          {onSortChange ? (
            <select
              className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              value={sort}
              onChange={(event) => onSortChange(event.target.value as HMExploreSort)}
              aria-label="Explore sort"
            >
              <option value="relevance">Relevance</option>
              <option value="recently_updated">Recently updated</option>
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="title">Title</option>
            </select>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Explore result types">
        {tabs.map((tab) => (
          <Button
            key={tab}
            size="sm"
            variant={activeTab === tab ? 'secondary' : 'outline'}
            onClick={() => setActiveTab(tab)}
            role="tab"
            aria-selected={activeTab === tab}
          >
            {tabLabel(tab)} <span className="text-muted-foreground tabular-nums">{counts[tab]}</span>
          </Button>
        ))}
      </div>

      <section aria-live="polite" className="min-h-48">
        {isLoading && !results.length ? (
          <ExploreState
            icon={<Loader2 className="animate-spin" />}
            title="Searching"
            detail="Loading Explore results."
          />
        ) : null}
        {error ? <ExploreState icon={<Search />} title="Search failed" detail={error} tone="error" /> : null}
        {!isLoading && !error && !visibleResults.length ? (
          <ExploreState icon={<Search />} title="No results" detail="Try a broader search or remove a filter." />
        ) : null}
        {visibleResults.length ? (
          <div className="divide-border border-border bg-background overflow-hidden rounded-lg border shadow-sm">
            {visibleResults.map((result, index) => (
              <button
                key={`${result.type}:${index}:${result.type === 'comment' ? result.commentId : packHmId(result.id)}`}
                type="button"
                className="hover:bg-muted/50 focus-visible:ring-ring/50 flex w-full gap-3 px-4 py-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
                onClick={() => onOpenResult(result)}
              >
                <span
                  className={cn(
                    'border-border bg-muted text-muted-foreground mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md border',
                    result.type === 'block' && 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
                    result.type === 'comment' && 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
                  )}
                >
                  {resultIcon(result)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{resultTitle(result)}</span>
                    <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5 text-[11px] capitalize">
                      {result.type}
                    </span>
                  </span>
                  {result.breadcrumb?.length ? (
                    <span className="text-muted-foreground mt-0.5 block truncate text-xs">
                      {result.breadcrumb.join(' / ')}
                    </span>
                  ) : null}
                  {resultSubtitle(result) ? (
                    <span className="text-muted-foreground mt-1 line-clamp-2 block text-sm">
                      {resultSubtitle(result)}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </main>
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
