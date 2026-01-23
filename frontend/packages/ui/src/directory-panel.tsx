import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {ReactNode} from 'react'
import {SelectionContent} from './accessories'
import {
  DirectoryEmpty,
  DirectoryListViewWithActivity,
  useDirectoryDataWithActivity,
} from './directory-page'
import {Spinner} from './spinner'
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
    debug: false,
  })

  const {items, accountsMetadata, isInitialLoading} =
    useDirectoryDataWithActivity(docId)

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="p-4">
        <DirectoryEmpty />
        {header ? (
          <div className="flex justify-center p-3">{header}</div>
        ) : null}
      </div>
    )
  }

  return (
    <SelectionContent scrollRef={scrollRef} header={header}>
      <DirectoryListViewWithActivity
        items={items}
        accountsMetadata={accountsMetadata}
      />
    </SelectionContent>
  )
}
