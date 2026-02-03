import {getMetadataName, useRouteLink} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMListedDraft,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {
  useAccountsMetadata,
  useDirectoryWithDrafts,
} from '@shm/shared/models/entity'
import {normalizeDate} from '@shm/shared/utils/date'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Folder, Search} from 'lucide-react'
import {ChangeEvent, ReactNode, useMemo, useState} from 'react'
import {Button} from './button'
import {Input} from './components/input'
import {DocumentListItem} from './document-list-item'
import {DraftBadge} from './draft-badge'
import {DocumentSmallListItem, getSiteNavDirectory} from './navigation'
import {PageLayout} from './page-layout'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {useScrollRestoration} from './use-scroll-restoration'

/**
 * Full-page directory content component.
 * This is the first implementation of the panel-to-page pattern.
 * Can be used standalone (page) or wrapped in AccessoryLayout (panel).
 */
export function DirectoryPageContent({
  docId,
  canCreate,
  header,
  headerRight,
  showSearch = true,
  showTitle = true,
  contentMaxWidth,
}: {
  docId: UnpackedHypermediaId
  canCreate?: boolean
  header?: ReactNode
  headerRight?: ReactNode
  showSearch?: boolean
  showTitle?: boolean
  contentMaxWidth?: number
}) {
  const route = useNavRoute()
  const [searchQuery, setSearchQuery] = useState('')

  const scrollRef = useScrollRestoration({
    scrollId: `directory-page-${docId.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: false,
  })

  const {items, accountsMetadata, isInitialLoading} =
    useDirectoryDataWithActivity(docId)

  // Filter items based on search query
  const filteredItems = searchQuery
    ? items.filter(
        (item) =>
          item.metadata?.name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()),
      )
    : items

  if (isInitialLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Spinner className="size-8" />
      </div>
    )
  }

  const searchBox =
    showSearch && items.length > 0 ? (
      <div className="relative w-full">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          placeholder="Filter documents..."
          value={searchQuery}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setSearchQuery(e.target.value)
          }
          className="pl-9"
        />
      </div>
    ) : null

  return (
    <PageLayout
      title={showTitle ? 'Directory' : undefined}
      headerRight={
        <>
          {searchBox}
          {headerRight}
        </>
      }
      centered
      contentMaxWidth={contentMaxWidth}
    >
      {/* Optional header slot (for create button, etc.) */}
      {header && (
        <div className="border-border border-b px-6 py-3">{header}</div>
      )}

      {/* Content */}
      <div className="p-6" ref={scrollRef}>
        {items.length === 0 ? (
          <DirectoryEmpty canCreate={canCreate} />
        ) : filteredItems.length === 0 ? (
          <DirectoryNoResults searchQuery={searchQuery} />
        ) : (
          <DirectoryListViewWithActivity
            items={filteredItems}
            accountsMetadata={accountsMetadata}
          />
        )}
      </div>
    </PageLayout>
  )
}

function DirectoryNoResults({searchQuery}: {searchQuery: string}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Search className="text-muted-foreground size-16" />
      <SizableText color="muted" weight="medium" size="xl">
        No results found
      </SizableText>
      <SizableText color="muted" size="sm">
        No documents match "{searchQuery}"
      </SizableText>
    </div>
  )
}

export type DirectoryItem = ReturnType<typeof getSiteNavDirectory>[number]

export function DirectoryListView({items}: {items: DirectoryItem[]}) {
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <DocumentSmallListItem
          key={item.id?.path?.join('/') || item.id?.id || item.draftId}
          metadata={item.metadata}
          id={item.id}
          draftId={item.draftId}
          isPublished={item.isPublished}
          visibility={item.visibility}
        />
      ))}
    </div>
  )
}

export function DirectoryEmpty({canCreate}: {canCreate?: boolean}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Folder className="text-muted-foreground size-16" />
      <SizableText color="muted" weight="medium" size="xl">
        There are no documents here
      </SizableText>
      {canCreate && (
        <SizableText color="muted" size="sm">
          Create a new document to get started
        </SizableText>
      )}
    </div>
  )
}

/** Hook to fetch directory data with drafts */
export function useDirectoryData(docId: UnpackedHypermediaId) {
  const {directory, drafts, isInitialLoading} = useDirectoryWithDrafts(docId, {
    mode: 'Children',
  })

  const directoryItems = getSiteNavDirectory({
    id: docId,
    directory,
    drafts,
  })

  return {directoryItems, isInitialLoading}
}

/** Directory item with activity data */
export type DirectoryItemWithActivity =
  | (HMDocumentInfo & {
      draftId?: string
      isPublished: true
    })
  | {
      draftId: string
      isPublished: false
      id: UnpackedHypermediaId
      metadata: HMMetadata
      sortTime: Date
    }

/** Get the most recent activity time for sorting */
function getActivityTime(item: DirectoryItemWithActivity): number {
  if (!item.isPublished) return item.sortTime?.getTime() || 0
  const activity = item.activitySummary
  if (!activity) return item.sortTime?.getTime() || 0

  const changeTime = normalizeDate(activity.latestChangeTime)?.getTime() || 0
  const commentTime = normalizeDate(activity.latestCommentTime)?.getTime() || 0

  return Math.max(changeTime, commentTime) || item.sortTime?.getTime() || 0
}

/** Hook to fetch directory data with activity info for rich display */
export function useDirectoryDataWithActivity(docId: UnpackedHypermediaId) {
  const {directory, drafts, isInitialLoading} = useDirectoryWithDrafts(docId, {
    mode: 'Children',
  })

  const items = useMemo(() => {
    const draftsArray = Array.isArray(drafts) ? drafts : []
    const editIds = new Map<string, string>()
    draftsArray.forEach((draft: HMListedDraft) => {
      // @ts-expect-error editId exists on drafts
      if (draft.editId?.id) {
        // @ts-expect-error editId exists on drafts
        editIds.set(draft.editId.id, draft.id)
      }
    })

    // Map published items with draft info
    const publishedItems: DirectoryItemWithActivity[] = (directory ?? []).map(
      (item) => ({
        ...item,
        draftId: editIds.get(item.id.id),
        isPublished: true as const,
      }),
    )

    // Add unpublished drafts (new docs not yet published) that belong to this directory
    const unpublishedDraftItems: DirectoryItemWithActivity[] = draftsArray
      // @ts-expect-error locationId exists on drafts
      .filter((draft) => draft.locationId && draft.locationId.id === docId.id)
      .map((draft) => ({
        draftId: draft.id,
        isPublished: false as const,
        id: docId,
        metadata: draft.metadata,
        sortTime: new Date(draft.lastUpdateTime),
      }))

    const allItems = [...publishedItems, ...unpublishedDraftItems]

    // Sort by activity time (most recent first)
    allItems.sort((a, b) => getActivityTime(b) - getActivityTime(a))

    return allItems
  }, [directory, drafts, docId.id])

  // Collect all author uids for fetching metadata
  const authorUids = useMemo(() => {
    const uids = new Set<string>()
    items.forEach((item) => {
      if (item.isPublished && 'authors' in item) {
        item.authors?.forEach((uid) => uids.add(uid))
      }
    })
    return Array.from(uids)
  }, [items])

  const accountsMetadata = useAccountsMetadata(authorUids)

  return {
    items,
    accountsMetadata: accountsMetadata.data,
    isInitialLoading,
    isLoadingMetadata: accountsMetadata.isLoading,
  }
}

/** Directory list view with rich activity display like Library */
export function DirectoryListViewWithActivity({
  items,
  accountsMetadata,
}: {
  items: DirectoryItemWithActivity[]
  accountsMetadata?: HMAccountsMetadata
}) {
  return (
    <div className="flex flex-col gap-1">
      {items.map((item) =>
        item.isPublished ? (
          <DocumentListItem
            key={item.id.id}
            item={item}
            draftId={item.draftId}
            accountsMetadata={accountsMetadata}
          />
        ) : (
          <DraftListItem
            key={item.draftId}
            draftId={item.draftId}
            metadata={item.metadata}
          />
        ),
      )}
    </div>
  )
}

function DraftListItem({
  draftId,
  metadata,
}: {
  draftId: string
  metadata: HMMetadata
}) {
  const linkProps = useRouteLink({key: 'draft', id: draftId})
  return (
    <Button
      asChild
      variant="ghost"
      className="h-auto w-full items-center justify-start border-none bg-transparent bg-white px-4 py-2 shadow-sm hover:shadow-md dark:bg-black"
    >
      <a {...linkProps}>
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          <SizableText className="truncate text-left font-sans">
            {getMetadataName(metadata)}
          </SizableText>
          <DraftBadge />
        </div>
      </a>
    </Button>
  )
}
