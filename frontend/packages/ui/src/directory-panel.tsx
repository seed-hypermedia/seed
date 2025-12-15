import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useDirectoryWithDrafts} from '@shm/shared/models/entity'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Folder} from 'lucide-react'
import {ReactNode} from 'react'
import {AccessoryContent} from './accessories'
import {DocumentSmallListItem, getSiteNavDirectory} from './navigation'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {useScrollRestoration} from './use-scroll-restoration'

export function DirectoryPanel({
  docId,
  header,
}: {
  docId: UnpackedHypermediaId
  header?: ReactNode
}) {
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
        {header ? <div className="flex p-3">{header}</div> : null}
      </div>
    )
  }

  return (
    <AccessoryContent scrollRef={scrollRef} header={header}>
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
