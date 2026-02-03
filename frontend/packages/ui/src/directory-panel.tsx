import {UnpackedHypermediaId} from '@shm/shared/hm-types'
import {ReactNode} from 'react'
import {PanelContent} from './accessories'
import {
  DirectoryEmpty,
  DirectoryListViewWithActivity,
  useDirectoryDataWithActivity,
} from './directory-page'
import {Spinner} from './spinner'

export function DirectoryPanel({
  docId,
  header,
}: {
  docId: UnpackedHypermediaId
  header?: ReactNode
}) {
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
    <PanelContent header={header}>
      <DirectoryListViewWithActivity
        items={items}
        accountsMetadata={accountsMetadata}
      />
    </PanelContent>
  )
}
