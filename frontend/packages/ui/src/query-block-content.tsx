import {
  HMAccountsMetadata,
  HMDocumentInfo,
  UnpackedHypermediaId,
} from '@shm/shared'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useMemo} from 'react'
import {DocumentCardGrid} from './document-content'
import {DocumentListItem} from './document-list-item'

export interface QueryBlockContentProps {
  items: HMDocumentInfo[]
  style: 'Card' | 'List'
  columnCount?: string | number
  banner?: boolean
  accountsMetadata: HMAccountsMetadata
  getEntity?: (path: string[]) => any
  onDocumentClick: (id: UnpackedHypermediaId) => void
  isWeb?: boolean
}

export function QueryBlockContent({
  items,
  style,
  columnCount = '3',
  banner = false,
  accountsMetadata,
  getEntity,
  onDocumentClick,
  isWeb = false,
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
    <QueryBlockListView
      items={items}
      accountsMetadata={accountsMetadata}
      onDocumentClick={onDocumentClick}
      isWeb={isWeb}
    />
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
  getEntity?: (path: string[]) => any
}) {
  const docs = useMemo(() => {
    return items.map((item) => {
      const id = hmId(item.account, {
        path: item.path,
        latest: true,
      })
      return {id, item}
    })
  }, [items])

  const firstItem = banner ? docs[0] : null
  const restItems = banner ? docs.slice(1) : docs

  const columnCountNum =
    typeof columnCount === 'string' ? parseInt(columnCount, 10) : columnCount

  return (
    <DocumentCardGrid
      // @ts-ignore
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
  onDocumentClick,
  isWeb,
}: {
  items: HMDocumentInfo[]
  accountsMetadata: HMAccountsMetadata
  onDocumentClick: (id: UnpackedHypermediaId) => void
  isWeb?: boolean
}) {
  return (
    <div className="my-4 flex w-full flex-col gap-1">
      {items.map((item) => {
        return (
          <DocumentListItem
            key={`${item.account}-${item.path?.join('/')}`}
            item={item}
            accountsMetadata={accountsMetadata}
            onClick={onDocumentClick}
            isWeb={isWeb}
          />
        )
      })}
    </div>
  )
}
