import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useDirectoryWithDrafts} from '@shm/shared/models/entity'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Folder, Search} from 'lucide-react'
import {ChangeEvent, ReactNode, useState} from 'react'
import {Input} from './components/input'
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

  const {directoryItems, isInitialLoading} = useDirectoryData(docId)

  // Filter items based on search query
  const filteredItems = searchQuery
    ? directoryItems.filter(
        (item) =>
          item.metadata?.name
            ?.toLowerCase()
            .includes(searchQuery.toLowerCase()),
      )
    : directoryItems

  if (isInitialLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Spinner className="size-8" />
      </div>
    )
  }

  const searchBox =
    showSearch && directoryItems.length > 0 ? (
      <div className="relative w-64">
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
      title={showTitle ? 'Children Documents' : undefined}
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
        {directoryItems.length === 0 ? (
          <DirectoryEmpty canCreate={canCreate} />
        ) : filteredItems.length === 0 ? (
          <DirectoryNoResults searchQuery={searchQuery} />
        ) : (
          <DirectoryListView items={filteredItems} />
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
        There are no children documents
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
