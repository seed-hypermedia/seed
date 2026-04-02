import {
  HMAccountsMetadata,
  HMBlockImage,
  HMBlockNode,
  HMDocumentInfo,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {ReactNode, useMemo} from 'react'
import {BlankQueryBlockMessage} from './entity-card'
import {DocumentCard} from './newspaper'
import {cn} from './utils'

/** CSS class string for standard block content width. */
export const blockStyles = 'w-full flex-1 self-center'

/** Recursively finds a block node by ID in a tree of block nodes. */
export function getBlockNodeById(blocks: Array<HMBlockNode>, blockId: string): HMBlockNode | null {
  if (!blockId) return null

  let res: HMBlockNode | undefined
  blocks.find((bn) => {
    if (bn.block?.id == blockId) {
      res = bn
      return true
    } else if (bn.children?.length) {
      const foundChild = getBlockNodeById(bn.children, blockId)
      if (foundChild) {
        res = foundChild
        return true
      }
    }
    return false
  })
  return res || null
}

/** Finds a block node by ID with support for undefined input. */
export function getBlockNode(blockNodes: HMBlockNode[] | undefined, blockId: string): HMBlockNode | null {
  if (!blockNodes) return null
  for (const node of blockNodes) {
    if (node.block.id === blockId) return node
    if (node.children) {
      const found = getBlockNode(node.children, blockId)
      if (found) return found
    }
  }
  return null
}

/** Item in the document-wide image gallery list. */
export type ImageGalleryItem = {
  blockId: string
  link: string
  name?: string
}

/** Recursively collects all Image blocks with a truthy link in DFS (document) order. */
export function collectImageBlocks(blocks: HMBlockNode[]): ImageGalleryItem[] {
  const result: ImageGalleryItem[] = []
  for (const node of blocks) {
    if (node.block?.type === 'Image' && node.block.link) {
      result.push({
        blockId: node.block.id,
        link: node.block.link,
        name: (node.block as HMBlockImage).attributes?.name,
      })
    }
    if (node.children) {
      result.push(...collectImageBlocks(node.children))
    }
  }
  return result
}

/** Returns the next/prev index for gallery navigation, or null at boundaries. */
export function resolveGalleryNavigation(
  images: ImageGalleryItem[],
  currentIndex: number,
  direction: 'prev' | 'next',
): number | null {
  if (images.length === 0) return null
  if (direction === 'prev') return currentIndex > 0 ? currentIndex - 1 : null
  return currentIndex < images.length - 1 ? currentIndex + 1 : null
}

const SWIPE_THRESHOLD = 50 // px — must exceed, not equal

/** Determines swipe direction from horizontal delta, or null if below threshold. */
export function resolveSwipeDirection(deltaX: number): 'prev' | 'next' | null {
  if (deltaX < -SWIPE_THRESHOLD) return 'next' // swipe left → next
  if (deltaX > SWIPE_THRESHOLD) return 'prev' // swipe right → prev
  return null
}

/** Renders a grid of document cards with optional banner and prepended items. */
export function DocumentCardGrid({
  firstItem,
  items,
  getEntity,
  accountsMetadata,
  itemContributors,
  columnCount = 1,
  isDiscovering,
  prependItems,
  bannerContent,
}: {
  firstItem: HMDocumentInfo | undefined
  items: Array<HMDocumentInfo>
  getEntity: (id: UnpackedHypermediaId) => HMResourceFetchResult | null
  accountsMetadata?: HMAccountsMetadata
  itemContributors?: Record<string, string[]>
  columnCount?: number
  isDiscovering?: boolean
  prependItems?: ReactNode[]
  bannerContent?: ReactNode
}) {
  const columnClasses = useMemo(() => {
    return cn('basis-full', columnCount == 2 && 'sm:basis-1/2', columnCount == 3 && 'sm:basis-1/2 md:basis-1/3')
  }, [columnCount])
  const hasPrependItems = prependItems && prependItems.length > 0
  const hasItems = items?.length > 0
  return (
    <div className="flex w-full flex-col">
      {bannerContent ? (
        <div className="flex">{bannerContent}</div>
      ) : firstItem ? (
        <div className="flex">
          <DocumentCard
            banner
            entity={getEntity(firstItem.id)}
            docId={firstItem.id}
            accountsMetadata={accountsMetadata}
            contributorUids={itemContributors?.[firstItem.id.id]}
            showSummary
          />
        </div>
      ) : null}
      {hasPrependItems || hasItems ? (
        <div className="-mx-3 mt-2 flex flex-wrap justify-center">
          {prependItems?.map((item, i) => (
            <div className={cn(columnClasses, 'flex p-3')} key={`prepend-${i}`}>
              {item}
            </div>
          ))}
          {items.map((item) => {
            if (!item) return null
            return (
              <div className={cn(columnClasses, 'flex p-3')} key={item.id.id}>
                <DocumentCard
                  docId={item.id}
                  entity={getEntity(item.id)}
                  accountsMetadata={accountsMetadata}
                  contributorUids={itemContributors?.[item.id.id]}
                  showSummary
                />
              </div>
            )
          })}
        </div>
      ) : null}
      {!hasItems && !hasPrependItems && isDiscovering ? (
        <BlankQueryBlockMessage message="Searching for documents..." />
      ) : !hasItems && !hasPrependItems ? (
        <BlankQueryBlockMessage message="No Documents found in this Query Block." />
      ) : null}
    </div>
  )
}
