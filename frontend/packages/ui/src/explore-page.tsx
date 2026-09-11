import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '@shm/shared/content'
import type {
  ExplorePresentation,
  ExploreQueryNode,
  ExploreSortRule,
  HMExploreContext,
  HMExploreResult,
  HMExploreResultType,
  ParsedExploreQuery,
} from '@shm/shared/explore'
import {
  cycleExploreSort,
  exploreQueryChips,
  isExploreSpaceId,
  removeExploreQueryChip,
  serializeExploreQuery,
  toggleExplorePredicate,
} from '@shm/shared/explore'
import {useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {useAccountsMetadata, useCapabilities} from '@shm/shared/models/entity'
import type {ExploreAccount} from '@shm/shared/models/explore'
import {
  exploreDocumentKey,
  exploreStreamSelection,
  resultKey,
  useExploreAccountList,
  useExploreAccounts,
  useExploreAttributeNames,
  useExploreJoinedSpaces,
  useExploreRecentDocuments,
} from '@shm/shared/models/explore'
import {useInteractionSummary} from '@shm/shared/models/interaction-summary'
import {useRouteLink} from '@shm/shared/routing'
import {formattedDate, formattedDateMedium} from '@shm/shared/utils/date'
import {activitySlugToFilter, hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {
  Check,
  ChevronDown,
  FileText,
  GitBranch,
  Globe,
  Loader2,
  MessageSquare,
  Pilcrow,
  Search,
  User,
  X,
} from 'lucide-react'
import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {Button} from './button'
import {Checkbox} from './components/checkbox'
import {Input} from './components/input'
import {FacePile} from './face-pile'
import {HMIcon} from './hm-icon'
import {PrivateBadge} from './private-badge'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
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

/** Space picker opened by the scope chip. */
function ExploreScopeMenu({
  context,
  accounts,
  onChange,
}: {
  context: HMExploreContext
  accounts: Array<{value: string; label: string}>
  onChange: (scope: HMExploreContext) => void
}) {
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 max-h-80 min-w-56 overflow-auto rounded-md border p-1 shadow-md">
      <button
        type="button"
        className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
        onClick={() => onChange({type: 'node'})}
      >
        {context.type === 'node' ? <Check className="size-3.5" /> : <span className="size-3.5" />}
        All spaces
      </button>
      {accounts.map((account) => (
        <button
          key={account.value}
          type="button"
          className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
          onClick={() => onChange({type: 'site', id: hmId(account.value)})}
        >
          {context.type === 'site' && context.id.uid === account.value ? (
            <Check className="size-3.5" />
          ) : (
            <span className="size-3.5" />
          )}
          <span className="truncate">{account.label}</span>
        </button>
      ))}
    </div>
  )
}

/** Trigger for one dropdown in the Explore filter row. */
function ExploreChipButton({
  label,
  active,
  open,
  onClick,
}: {
  label: string
  active?: boolean
  open?: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      aria-expanded={!!open}
      className={cn('rounded-full', (active || open) && 'border-primary text-primary')}
    >
      {label}
      <ChevronDown className="ml-1 size-3.5" aria-hidden />
    </Button>
  )
}

const typeOptions: Array<{value: HMExploreResultType; label: string}> = [
  {value: 'document', label: 'Documents'},
  {value: 'block', label: 'Text blocks'},
  {value: 'comment', label: 'Conversations'},
  {value: 'space', label: 'Spaces'},
  {value: 'contact', label: 'People'},
]

/**
 * Multi-select of result types, applied in one go rather than per click.
 * The counts are already loaded results, so they move as more pages arrive.
 */
function ExploreTypeMenu({
  counts,
  showCounts,
  selected,
  onApply,
}: {
  counts: Record<HMExploreResultType | 'all', number>
  showCounts: boolean
  selected: HMExploreResultType[]
  onApply: (types: HMExploreResultType[]) => void
}) {
  const [draft, setDraft] = useState<HMExploreResultType[]>(selected)
  return (
    <div className="bg-popover text-popover-foreground absolute top-full left-0 z-30 mt-2 min-w-60 rounded-md border p-2 shadow-md">
      {typeOptions.map((option) => {
        const checked = draft.includes(option.value)
        return (
          <label
            key={option.value}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
          >
            <Checkbox
              className="border-muted-foreground/50 border"
              checked={checked}
              onCheckedChange={() =>
                setDraft(checked ? draft.filter((value) => value !== option.value) : [...draft, option.value])
              }
            />
            <span className="flex-1">{option.label}</span>
            {showCounts ? <span className="text-muted-foreground tabular-nums">{counts[option.value]}</span> : null}
          </label>
        )
      })}
      <Button size="sm" variant="brand" className="mt-2 w-full" onClick={() => onApply(draft)}>
        Apply filters
      </Button>
    </div>
  )
}

// Card shell shared by the Explore landing sections.
const exploreCardClassName =
  'border-border hover:border-primary/40 flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:bg-black'

// Card of a recently updated document on the Explore landing page.
function ExploreDocumentCard({document, spaceName}: {document: HMDocumentInfo; spaceName?: string}) {
  const id = document.id
  const linkProps = useRouteLink({key: 'document', id})
  const commentsLink = useRouteLink({key: 'comments', id})
  const citationsLink = useRouteLink({key: 'activity', id, filterEventType: activitySlugToFilter('citations')})
  const interactions = useInteractionSummary(id)
  const authorUids = document.authors ?? []
  const accountsMetadata = useAccountsMetadata(authorUids)
  const authorName = authorUids.length
    ? getMetadataName(accountsMetadata.data?.[authorUids[0]!]?.metadata) || undefined
    : undefined
  const tag =
    spaceName ||
    document.breadcrumbs?.[0]?.name ||
    (isExploreSpaceId(id) ? getMetadataName(document.metadata) : undefined) ||
    id.uid.slice(0, 8)
  const trail = (document.breadcrumbs ?? [])
    .slice(1, -1)
    .map((crumb) => crumb.name)
    .filter(Boolean)
  const updated = document.activitySummary?.latestChangeTime ?? document.updateTime
  const citations = interactions.data?.citations ?? 0
  const comments = interactions.data?.comments ?? 0
  return (
    <div className={cn(exploreCardClassName, 'relative')}>
      <div className="flex items-start justify-between gap-3">
        <span className="bg-brand-12 text-brand-3 dark:bg-brand-3/25 dark:text-brand-8 min-w-0 truncate rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
          {tag}
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {trail.length ? `${trail.join(' / ')} · ` : ''}
          {updated ? formattedDate(updated) : ''}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <a {...linkProps} className="min-w-0 flex-1 after:absolute after:inset-0 after:content-['']">
          <SizableText weight="bold" className="truncate font-sans">
            {getMetadataName(document.metadata) || id.path?.at(-1) || 'Untitled'}
          </SizableText>
        </a>
        {document.visibility === 'PRIVATE' ? <PrivateBadge size="sm" /> : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        {authorUids.length ? (
          <span className="flex min-w-0 items-center gap-2">
            <FacePile accounts={authorUids} accountsMetadata={accountsMetadata.data ?? {}} />
            {authorName ? (
              <SizableText size="sm" className="truncate font-sans">
                {authorName}
              </SizableText>
            ) : null}
          </span>
        ) : (
          <span />
        )}
        {citations || comments ? (
          <span className="border-border relative z-10 flex shrink-0 items-center overflow-hidden rounded-md border">
            {citations ? (
              <Tooltip content="Citations">
                <a
                  {...citationsLink}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-1 px-2.5 py-1 text-xs transition-colors"
                >
                  <GitBranch className="size-3.5" aria-hidden />
                  {citations}
                </a>
              </Tooltip>
            ) : null}
            {comments ? (
              <Tooltip content="Conversations">
                <a
                  {...commentsLink}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground border-border flex items-center gap-1 px-2.5 py-1 text-xs transition-colors [&:not(:first-child)]:border-l"
                >
                  <MessageSquare className="size-3.5" aria-hidden />
                  {comments}
                </a>
              </Tooltip>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// Card of a joined space
function ExploreSpaceCard({space}: {space: HMDocumentInfo}) {
  const id = hmId(space.id.uid)
  const capability = useSelectedAccountCapability(id)
  const linkProps = useRouteLink({key: 'document', id})
  const name = getMetadataName(space.metadata) || space.id.uid.slice(0, 8)
  const updated = space.activitySummary?.latestChangeTime ?? space.updateTime
  return (
    <a {...linkProps} className={exploreCardClassName}>
      <div className="flex items-center gap-2">
        <HMIcon size={24} id={id} name={name} icon={space.metadata?.icon} />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        {capability?.role ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
            {capability.role}
          </span>
        ) : null}
      </div>
      {updated ? <span className="text-muted-foreground text-xs">Updated {formattedDateMedium(updated)}</span> : null}
    </a>
  )
}

// How many spaces are shown before the section has to be expanded.
const COLLAPSED_SPACE_COUNT = 3

/** Kinds Explore can list without a search term. */
type ExploreBrowseKind = 'document' | 'space' | 'contact'
const BROWSABLE_KINDS: ExploreBrowseKind[] = ['document', 'space', 'contact']

/** Names a capability role the way the space People tab does. */
function exploreRoleLabel(role: string | undefined) {
  if (role === 'writer') return 'Writer'
  if (role === 'agent') return 'Device'
  if (role === 'owner') return 'Owner'
  if (role === 'member') return 'Member'
  return role
}

/** One account in the Explore People list, with its role when the list is scoped to a space. */
function ExplorePersonCard({account}: {account: ExploreAccount & {role?: string}}) {
  const id = hmId(account.uid)
  const linkProps = useRouteLink({key: 'profile', id})
  const metadata = useAccountsMetadata([account.uid])
  const name = account.name || getMetadataName(metadata.data?.[account.uid]?.metadata) || account.uid.slice(0, 8)
  const role = exploreRoleLabel(account.role)
  return (
    <a {...linkProps} className={cn(exploreCardClassName, 'gap-2')}>
      <span className="flex min-w-0 items-center gap-2">
        <HMIcon size={24} id={id} name={name} icon={account.icon} />
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        {role ? (
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
            {role}
          </span>
        ) : null}
      </span>
    </a>
  )
}

/**
 * Everything of one kind in scope, listed without a search term. Reached from a Jump to pill, and
 * left by clearing the type chip.
 */
function ExploreBrowse({kind, context}: {kind: ExploreBrowseKind; context: HMExploreContext}) {
  const results = useExploreRecentDocuments(context, {
    enabled: kind !== 'contact',
    pageSize: 50,
    rootsOnly: kind === 'space',
  })
  const spaceId = context.type === 'site' ? context.id : null
  const capabilities = useCapabilities(kind === 'contact' ? spaceId : null)
  const allAccounts = useExploreAccountList({enabled: kind === 'contact' && !spaceId})
  const accounts = spaceId
    ? {
        isLoading: capabilities.isLoading,
        // Filter out agent capabilities.
        data: Object.values(
          (capabilities.data ?? [])
            .filter((capability) => capability.role !== 'agent')
            .reduce<Record<string, {uid: string; role: string}>>((byAccount, capability) => {
              const existing = byAccount[capability.accountUid]
              const rank = (role: string) => ['owner', 'writer', 'member'].indexOf(role)
              if (!existing || rank(capability.role) < rank(existing.role)) {
                byAccount[capability.accountUid] = {uid: capability.accountUid, role: capability.role}
              }
              return byAccount
            }, {}),
        ),
      }
    : allAccounts
  const heading = kind === 'space' ? 'Spaces' : kind === 'contact' ? 'People' : 'Documents'
  if (kind === 'contact') {
    if (accounts.isLoading) {
      return <ExploreState icon={<Loader2 className="animate-spin" />} title="Loading" detail="Finding people." />
    }
    if (!accounts.data?.length) {
      return <ExploreState icon={<Search />} title="No people" detail="This node knows no accounts yet." />
    }
    return (
      <section aria-label={heading} className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{heading}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.data.map((account) => (
            <ExplorePersonCard key={account.uid} account={account} />
          ))}
        </div>
      </section>
    )
  }
  if (results.isLoading) {
    return (
      <ExploreState
        icon={<Loader2 className="animate-spin" />}
        title="Loading"
        detail={`Finding ${heading.toLowerCase()}.`}
      />
    )
  }
  if (!results.data?.length) {
    return (
      <ExploreState icon={<Search />} title={`No ${heading.toLowerCase()}`} detail="Nothing here yet in this scope." />
    )
  }
  return (
    <section aria-label={heading} className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="flex flex-col gap-2">
        {results.data.map((document) => (
          <ExploreDocumentCard key={exploreDocumentKey(document.id)} document={document} />
        ))}
      </div>
    </section>
  )
}

/** The spaces this identity has joined, shown before anything is searched for. */
function ExploreYourSpaces() {
  const spaces = useExploreJoinedSpaces()
  const [expanded, setExpanded] = useState(false)
  if (spaces.isLoading || !spaces.data?.length) return null
  const total = spaces.data.length
  const visible = expanded ? spaces.data : spaces.data.slice(0, COLLAPSED_SPACE_COUNT)
  return (
    <section aria-label="Your spaces" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your Spaces</h2>
        {total > COLLAPSED_SPACE_COUNT ? (
          <Button variant="link" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show less' : `View all ${total}`}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((space) => (
          <ExploreSpaceCard key={space.id.uid} space={space} />
        ))}
      </div>
    </section>
  )
}

/**
 * Types that explore can list without a search term. Comments and text blocks are deliberately absent:
 * `ListComments` needs a specific target document, and blocks exist only as full-text matches, so
 * neither can be enumerated. They stay available in the type filter, where they narrow a search.
 */
const jumpToOptions: Array<{value: ExploreBrowseKind; label: string; icon: typeof FileText}> = [
  {value: 'document', label: 'Documents', icon: FileText},
  {value: 'space', label: 'Spaces', icon: Globe},
  {value: 'contact', label: 'People', icon: User},
]

// Shortcuts into one kind of result.
function ExploreJumpTo({
  active,
  kinds,
  onJump,
}: {
  active: HMExploreResultType[]
  kinds: ExploreBrowseKind[]
  onJump: (type: ExploreBrowseKind) => void
}) {
  const options = jumpToOptions.filter((option) => kinds.includes(option.value))
  if (!options.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-sm">Jump to:</span>
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant="outline"
          className={cn('rounded-full', active.includes(option.value) && 'border-primary text-primary')}
          onClick={() => onJump(option.value)}
        >
          <option.icon className="size-4" aria-hidden />
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/**
 * What Explore shows before anything is searched for: the documents most recently active in scope.
 * Reuses the shared document row, so these read the same as they do in a directory listing.
 */
function ExploreLanding({context}: {context: HMExploreContext}) {
  const recent = useExploreRecentDocuments(context)
  // Same query as the Your Spaces section, so this is served from cache rather than refetched.
  const spaces = useExploreJoinedSpaces()
  const spaceNames = useMemo(() => {
    const names: Record<string, string> = {}
    for (const space of spaces.data ?? []) {
      const name = getMetadataName(space.metadata)
      if (name) names[space.id.uid] = name
    }
    return names
  }, [spaces.data])
  if (recent.isLoading) {
    return <ExploreState icon={<Loader2 className="animate-spin" />} title="Loading" detail="Finding recent work." />
  }
  if (!recent.data?.length) {
    return (
      <ExploreState
        icon={<Search />}
        title="Start exploring"
        detail="Search documents, conversations, text blocks, spaces and people."
      />
    )
  }
  return (
    <section aria-label="Recently updated documents" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Recently Updated Documents</h2>
      <div className="flex flex-col gap-2">
        {recent.data.map((document) => (
          <ExploreDocumentCard
            key={exploreDocumentKey(document.id)}
            document={document}
            spaceName={spaceNames[document.id.uid]}
          />
        ))}
      </div>
    </section>
  )
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
  const [menu, setMenu] = useState<'scope' | 'type' | 'in' | 'attributes' | 'sort' | null>(null)
  const [sortBy, setSortBy] = useState<ExploreSortOption>('relevance')
  const [draft, setDraft] = useState(props.query)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<number | null>(null)
  const onQueryChangeRef = useRef(props.onQueryChange)
  onQueryChangeRef.current = props.onQueryChange
  useEffect(() => setDraft(props.query), [props.query])
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
  const streams = exploreStreamSelection(props.parsed, props.context)
  const willSearch = streams.text || streams.documents
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
  const selectedColumns = props.parsed.presentation.columns?.length
    ? props.parsed.presentation.columns
    : ['title', 'space', 'path', 'updated']
  const sortRules = props.parsed.presentation.sort ?? []
  const cycleSort = (key: string) => {
    const nextRules = cycleExploreSort(sortRules, key)
    updatePresentation({...props.parsed.presentation, sort: nextRules.length ? nextRules : undefined})
  }
  // Contacts carry none of the table's columns, so People stays a list.
  const tableMode =
    props.parsed.presentation.view === 'table' &&
    activeTab !== 'block' &&
    activeTab !== 'comment' &&
    activeTab !== 'contact'

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
                showCounts={willSearch}
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
      ) : null}

      {willSearch ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {props.counts[activeTab]} results
            {props.textTerms.length ? <> for &ldquo;{props.textTerms.join(' ')}&rdquo;</> : null}
          </p>
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
                browseKinds.map((kind) => <ExploreBrowse key={kind} kind={kind} context={props.context} />)
              ) : searchOnlyTypes.length ? null : (
                <>
                  <ExploreYourSpaces />
                  <ExploreLanding context={props.context} />
                </>
              )}
            </div>
          )
        ) : null}
        {visibleResults.length && tableMode ? (
          <ExploreTable
            results={sortedResults.filter(
              (result): result is Extract<HMExploreResult, {type: 'document' | 'space'}> =>
                result.type === 'document' || result.type === 'space',
            )}
            columns={selectedColumns}
            sortRules={sortRules}
            onSort={cycleSort}
            onOpen={props.onOpenResult}
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
  options: Array<{token: string; label: string}>
  activeTokens: string[]
  onToggle: (predicate: string) => void
}) {
  return (
    <div className="border-border bg-popover absolute top-10 left-0 z-10 flex min-w-44 flex-col rounded-md border p-1 shadow-md">
      {options.length ? (
        options.map((option) => (
          <button
            key={option.token}
            type="button"
            className={cn(
              'hover:bg-muted truncate rounded px-2 py-1.5 text-left text-sm',
              activeTokens.includes(option.token) && 'bg-accent',
            )}
            onClick={() => onToggle(option.token)}
          >
            {option.label}
          </button>
        ))
      ) : (
        <p className="text-muted-foreground px-2 py-2 text-xs">No suggestions available.</p>
      )}
    </div>
  )
}

function withPresentation(ast: ExploreQueryNode | null, presentation: ExplorePresentation) {
  return serializeExploreQuery({ast, presentation, diagnostics: []})
}

function tableCellValue(result: Extract<HMExploreResult, {type: 'document' | 'space'}>, column: string) {
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
  results: Extract<HMExploreResult, {type: 'document' | 'space'}>[]
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
            <tr key={resultKey(result)} className="hover:bg-muted/20 border-b last:border-b-0">
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

/**
 * Row heading for a result. Documents and spaces use their own name. The rest fall back to the
 * last breadcrumb, then to a label naming the kind, so a row is never blank.
 */
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
