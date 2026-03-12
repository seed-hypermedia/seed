import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {ReactNode} from 'react'
import {DocumentCardGrid} from './blocks-content'
import {DocumentListItem} from './document-list-item'

export interface QueryBlockContentProps {
  items: HMDocumentInfo[]
  style: 'Card' | 'List'
  columnCount?: string | number
  banner?: boolean
  accountsMetadata: HMAccountsMetadata
  /** Per-item contributor UIDs (document authors + comment/mention authors), keyed by doc ID. */
  itemContributors?: Record<string, string[]>
  getEntity: (id: UnpackedHypermediaId) => HMResourceFetchResult | null
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
  getEntity,
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
        getEntity={getEntity}
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
  getEntity,
  isDiscovering,
  prependItems,
  bannerContent,
}: {
  items: HMDocumentInfo[]
  banner: boolean
  columnCount: string | number
  accountsMetadata: HMAccountsMetadata
  itemContributors?: Record<string, string[]>
  getEntity: (id: UnpackedHypermediaId) => HMResourceFetchResult | null
  isDiscovering?: boolean
  prependItems?: ReactNode[]
  bannerContent?: ReactNode
}) {
  // When bannerContent is provided, it takes the banner slot — don't split items
  const firstItem = banner && !bannerContent ? items[0] : undefined
  const restItems = banner && !bannerContent ? items.slice(1) : items

  const columnCountNum = typeof columnCount === 'string' ? parseInt(columnCount, 10) : columnCount

  return (
    <DocumentCardGrid
      firstItem={firstItem}
      items={restItems}
      getEntity={getEntity}
      accountsMetadata={accountsMetadata}
      itemContributors={itemContributors}
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
  isDiscovering,
  prependItems,
}: {
  items: HMDocumentInfo[]
  accountsMetadata: HMAccountsMetadata
  itemContributors?: Record<string, string[]>
  isDiscovering?: boolean
  prependItems?: ReactNode[]
}) {
  const hasPrependItems = prependItems && prependItems.length > 0

  // Show loading state when discovering and no items yet
  if (items.length === 0 && !hasPrependItems && isDiscovering) {
    return (
      <div className="bg-muted flex items-center rounded-lg p-4">
        <span className="text-muted-foreground italic">Searching for documents...</span>
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
          />
        )
      })}
    </div>
  )
}
