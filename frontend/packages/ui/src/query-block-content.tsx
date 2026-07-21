import {HMAccountsMetadata, HMDocumentInfo, HMQueryBlockItemSummary} from '@seed-hypermedia/client/hm-types'
import {ReactNode, useEffect, useRef, useState} from 'react'
import {DocumentCardGrid} from './blocks-content-utils'
import {DocumentListItem} from './document-list-item'
import {Spinner} from './spinner'

const INITIAL_LIST_CHUNK_SIZE = 25
const LIST_CHUNK_SIZE = 25
const LIST_CHUNK_ROOT_MARGIN = '800px 0px'

export interface QueryBlockContentProps {
  items: HMDocumentInfo[]
  style: 'Card' | 'List'
  columnCount?: string | number
  banner?: boolean
  accountsMetadata: HMAccountsMetadata
  /** Per-item contributor UIDs (document authors + comment/mention authors), keyed by doc ID. */
  itemContributors?: Record<string, string[]>
  interactionSummaries?: Record<string, HMQueryBlockItemSummary>
  isDiscovering?: boolean
  prependItems?: ReactNode[]
  bannerContent?: ReactNode
  /** Render card titles as links (hover underline, navigate on first click) instead of whole-card navigation. */
  titleLinkOnly?: boolean
  /** Whether whole cards navigate on click (ignored for the title when titleLinkOnly). */
  navigateCards?: boolean
}

export function QueryBlockContent({
  items,
  style,
  columnCount = '3',
  banner = false,
  accountsMetadata,
  itemContributors,
  interactionSummaries,
  isDiscovering,
  prependItems,
  bannerContent,
  titleLinkOnly,
  navigateCards,
}: QueryBlockContentProps) {
  if (style === 'Card') {
    return (
      <QueryBlockCardView
        items={items}
        banner={banner}
        columnCount={columnCount}
        accountsMetadata={accountsMetadata}
        itemContributors={itemContributors}
        interactionSummaries={interactionSummaries}
        isDiscovering={isDiscovering}
        prependItems={prependItems}
        bannerContent={bannerContent}
        titleLinkOnly={titleLinkOnly}
        navigateCards={navigateCards}
      />
    )
  }

  return (
    <QueryBlockListView
      items={items}
      accountsMetadata={accountsMetadata}
      itemContributors={itemContributors}
      interactionSummaries={interactionSummaries}
      isDiscovering={isDiscovering}
      prependItems={prependItems}
    />
  )
}

function QueryBlockCardView({
  items,
  banner,
  columnCount,
  accountsMetadata,
  itemContributors,
  interactionSummaries,
  isDiscovering,
  prependItems,
  bannerContent,
  titleLinkOnly,
  navigateCards,
}: {
  items: HMDocumentInfo[]
  banner: boolean
  columnCount: string | number
  accountsMetadata: HMAccountsMetadata
  itemContributors?: Record<string, string[]>
  interactionSummaries?: Record<string, HMQueryBlockItemSummary>
  isDiscovering?: boolean
  prependItems?: ReactNode[]
  bannerContent?: ReactNode
  titleLinkOnly?: boolean
  navigateCards?: boolean
}) {
  const firstItem = banner && !bannerContent ? items[0] : undefined
  const restItems = banner && !bannerContent ? items.slice(1) : items

  const columnCountNum = typeof columnCount === 'string' ? parseInt(columnCount, 10) : columnCount

  return (
    <DocumentCardGrid
      firstItem={firstItem}
      items={restItems}
      accountsMetadata={accountsMetadata}
      itemContributors={itemContributors}
      interactionSummaries={interactionSummaries}
      columnCount={columnCountNum}
      isDiscovering={isDiscovering}
      prependItems={prependItems}
      bannerContent={bannerContent}
      titleLinkOnly={titleLinkOnly}
      navigateCards={navigateCards}
    />
  )
}

function QueryBlockListView({
  items,
  accountsMetadata,
  itemContributors,
  interactionSummaries,
  isDiscovering,
  prependItems,
}: {
  items: HMDocumentInfo[]
  accountsMetadata: HMAccountsMetadata
  itemContributors?: Record<string, string[]>
  interactionSummaries?: Record<string, HMQueryBlockItemSummary>
  isDiscovering?: boolean
  prependItems?: ReactNode[]
}) {
  const hasPrependItems = prependItems && prependItems.length > 0
  const [visibleCount, setVisibleCount] = useState(() => Math.min(items.length, INITIAL_LIST_CHUNK_SIZE))
  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleCount(Math.min(items.length, INITIAL_LIST_CHUNK_SIZE))
  }, [items])

  useEffect(() => {
    if (visibleCount >= items.length) return
    if (typeof IntersectionObserver === 'undefined') {
      setVisibleCount(items.length)
      return
    }

    const el = loadMoreRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting) return
        setVisibleCount((count) => Math.min(items.length, count + LIST_CHUNK_SIZE))
      },
      {rootMargin: LIST_CHUNK_ROOT_MARGIN},
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [items.length, visibleCount])

  if (items.length === 0 && !hasPrependItems && isDiscovering) {
    return (
      <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-lg p-4">
        <Spinner size="small" />
        <span className="italic">Searching for documents…</span>
      </div>
    )
  }

  const visibleItems = items.slice(0, visibleCount)
  const hasMoreItems = visibleCount < items.length

  return (
    <div className="my-4 flex w-full flex-col gap-1">
      {prependItems}
      {visibleItems.map((item) => {
        return (
          <DocumentListItem
            key={item.id.id}
            item={item}
            accountsMetadata={accountsMetadata}
            contributorUids={itemContributors?.[item.id.id]}
            interactionSummary={interactionSummaries?.[item.id.id]}
          />
        )
      })}
      {hasMoreItems ? <div ref={loadMoreRef} className="h-6" aria-hidden="true" /> : null}
    </div>
  )
}
