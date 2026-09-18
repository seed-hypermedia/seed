import {getMetadataName} from '@shm/shared/content'
import type {ExploreBrowseKind, ExploreView, HMExploreContext, HMExploreResultType} from '@shm/shared/explore'
import {useAccountsMetadata} from '@shm/shared/models/entity'
import {
  exploreDocumentKey,
  useExploreAccountList,
  useExploreJoinedSpaces,
  useExploreRecentDocuments,
  useExploreSpacePeople,
} from '@shm/shared/models/explore'
import {FileText, Globe, Loader2, Search, User} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Button} from './button'
import {ExploreDocumentCard, ExplorePersonCard, ExploreSpaceCard} from './explore-cards'
import {ExploreState} from './explore-primitives'
import {exploreTableConfig, ExploreViewSwitcher, queryBlockStyle} from './explore-views'
import {QueryBlockContent} from './query-block-content'
import {cn} from './utils'

// How many spaces are shown before the section has to be expanded.
const COLLAPSED_SPACE_COUNT = 3

/**
 * Everything of one kind in scope, listed without a search term. Reached from a "Jump to" pill, and
 * left by clearing the type chip.
 */
export function ExploreBrowse({
  kind,
  context,
  view,
  onViewChange,
}: {
  kind: ExploreBrowseKind
  context: HMExploreContext
  view: ExploreView
  onViewChange: (view: ExploreView) => void
}) {
  const results = useExploreRecentDocuments(context, {
    enabled: kind !== 'contact',
    pageSize: 50,
    rootsOnly: kind === 'space',
  })
  const spaceId = context.type === 'site' ? context.id : null
  const spacePeople = useExploreSpacePeople(spaceId, {enabled: kind === 'contact'})
  const allAccounts = useExploreAccountList({enabled: kind === 'contact' && !spaceId})
  const accounts = spaceId ? spacePeople : allAccounts
  const heading = kind === 'space' ? 'Spaces' : kind === 'contact' ? 'People' : 'Documents'
  const authorUids = useMemo(
    () => Array.from(new Set((results.data ?? []).flatMap((document) => document.authors ?? []))),
    [results.data],
  )
  const accountsMetadata = useAccountsMetadata(authorUids).data ?? {}
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
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {results.data.length} {heading.toLowerCase()}
        </h2>
        <ExploreViewSwitcher view={view} onChange={onViewChange} />
      </div>
      <QueryBlockContent
        items={results.data}
        style={queryBlockStyle(view)}
        accountsMetadata={accountsMetadata}
        tableConfig={exploreTableConfig(kind !== 'space')}
      />
    </section>
  )
}

/** The spaces this identity has joined, shown before anything is searched for. */
export function ExploreYourSpaces() {
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
 * Types that explorer can list without a search term. Comments and text blocks are deliberately absent:
 * `ListComments` needs a specific target document, and blocks exist only as full-text matches, so
 * neither can be enumerated. They stay available in the type filter, where they narrow a search.
 */
const jumpToOptions: Array<{value: ExploreBrowseKind; label: string; icon: typeof FileText}> = [
  {value: 'document', label: 'Documents', icon: FileText},
  {value: 'space', label: 'Spaces', icon: Globe},
  {value: 'contact', label: 'People', icon: User},
]

// Shortcuts into one kind of result.
export function ExploreJumpTo({
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

// What explorer shows before anything is searched for.
export function ExploreLanding({context}: {context: HMExploreContext}) {
  const recent = useExploreRecentDocuments(context)
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
