import {NewSubDocumentButton} from '@/pages/document'
import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useDirectoryWithDrafts} from '@shm/shared/models/entity'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {AccessoryContent} from '@shm/ui/accessories'
import {DocumentSmallListItem, getSiteNavDirectory} from '@shm/ui/navigation'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useScrollRestoration} from '@shm/ui/use-scroll-restoration'
import {Folder} from 'lucide-react'

export function DirectoryPanel({docId}: {docId: UnpackedHypermediaId}) {
  const route = useNavRoute()
  const scrollRef = useScrollRestoration({
    scrollId: `directory-${docId.id}`,
    getStorageKey: () => getRouteKey(route),
    debug: true,
  })
  const {directory, drafts, isInitialLoading} = useDirectoryWithDrafts(docId, {
    mode: 'Children',
  })

  const directoryItems = getSiteNavDirectory({
    id: docId,
    directory,
    drafts,
  })


  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }
  if (directoryItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-4">
        <Folder className="text-muted-foreground size-25" />
        <SizableText color="muted" weight="medium" size="xl">
          There are no children documents
        </SizableText>
        <div className="flex p-3">
          <NewSubDocumentButton locationId={docId} importDropdown={false} />
        </div>
      </div>
    )
  }

  return (
    <AccessoryContent
      scrollRef={scrollRef}
      header={
        <NewSubDocumentButton locationId={docId} importDropdown={false} />
      }
    >
      <div className="flex h-full flex-col gap-2">
        {directoryItems.map((item) => {
          return (
            <DocumentSmallListItem
              key={item.id?.path?.join('/') || item.id?.id || item.draftId}
              metadata={item.metadata}
              id={item.id}
              draftId={item.draftId}
              isPublished={item.isPublished}
            />
          )
        })}
      </div>
    </AccessoryContent>
  )
}
