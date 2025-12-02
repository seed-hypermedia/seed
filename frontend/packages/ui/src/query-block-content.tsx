import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@shm/shared'
import {DocumentCardGrid} from './blocks-content'
import {DocumentListItem} from './document-list-item'

export interface QueryBlockContentProps {
  items: HMDocumentInfo[]
  style: 'Card' | 'List'
  columnCount?: string | number
  banner?: boolean
  accountsMetadata: HMAccountsMetadata
  getEntity: (id: UnpackedHypermediaId) => HMResourceFetchResult | null
}

export function QueryBlockContent({
  items,
  style,
  columnCount = '3',
  banner = false,
  accountsMetadata,
  getEntity,
}: QueryBlockContentProps) {
  if (style === 'Card') {
    return (
      <QueryBlockCardView
        items={items}
        banner={banner}
        columnCount={columnCount}
        accountsMetadata={accountsMetadata}
        getEntity={getEntity}
      />
    )
  }

  return (
    <QueryBlockListView items={items} accountsMetadata={accountsMetadata} />
  )
}

function QueryBlockCardView({
  items,
  banner,
  columnCount,
  accountsMetadata,
  getEntity,
}: {
  items: HMDocumentInfo[]
  banner: boolean
  columnCount: string | number
  accountsMetadata: HMAccountsMetadata
  getEntity: (id: UnpackedHypermediaId) => HMResourceFetchResult | null
}) {
  const firstItem = banner ? items[0] : undefined
  const restItems = banner ? items.slice(1) : items

  const columnCountNum =
    typeof columnCount === 'string' ? parseInt(columnCount, 10) : columnCount

  return (
    <DocumentCardGrid
      firstItem={firstItem}
      items={restItems}
      getEntity={getEntity}
      accountsMetadata={accountsMetadata}
      columnCount={columnCountNum}
    />
  )
}

function QueryBlockListView({
  items,
  accountsMetadata,
}: {
  items: HMDocumentInfo[]
  accountsMetadata: HMAccountsMetadata
}) {
  return (
    <div className="my-4 flex w-full flex-col gap-1">
      {items.map((item) => {
        return (
          <DocumentListItem
            key={item.id.id}
            item={item}
            accountsMetadata={accountsMetadata}
          />
        )
      })}
    </div>
  )
}
