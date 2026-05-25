import {HMAccountsMetadata, HMDocumentInfo, HMQueryBlockItemSummary} from '@seed-hypermedia/client/hm-types'
import {ReactNode} from 'react'
import {DocumentCardGrid} from './blocks-content-utils'
import {DocumentListItem} from './document-list-item'
import {Spinner} from './spinner'

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

  if (items.length === 0 && !hasPrependItems && isDiscovering) {
    return (
      <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-lg p-4">
        <Spinner size="small" />
        <span className="italic">Searching for documents…</span>
      </div>
    )
  }

  return (
    <div className="my-4 flex w-full flex-col gap-1">
      {prependItems}
      {items.map((item) => {
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
    </div>
  )
}
