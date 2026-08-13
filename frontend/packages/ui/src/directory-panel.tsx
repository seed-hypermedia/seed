import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useDocumentActions} from '@shm/shared/document-actions-context'
import {ReactNode} from 'react'
import {PanelContent} from './accessories'
import {
  DirectoryEmpty,
  DirectoryListViewWithActivity,
  DirectoryPinnedDocuments,
  useDirectoryDataWithActivity,
} from './directory-page'
import {Spinner} from './spinner'

export function DirectoryPanel({docId, header}: {docId: UnpackedHypermediaId; header?: ReactNode}) {
  const {items, accountsMetadata, isInitialLoading} = useDirectoryDataWithActivity(docId)
  const actions = useDocumentActions()
  const hasPins = (actions.getPinsForSite?.(docId.uid).length ?? 0) > 0

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }

  if (items.length === 0 && !hasPins) {
    return (
      <div className="p-4">
        <DirectoryEmpty />
        {header ? <div className="flex justify-center p-3">{header}</div> : null}
      </div>
    )
  }

  return (
    <PanelContent header={header}>
      <DirectoryPinnedDocuments docId={docId} />
      {items.length === 0 ? (
        <DirectoryEmpty />
      ) : (
        <DirectoryListViewWithActivity items={items} accountsMetadata={accountsMetadata} />
      )}
    </PanelContent>
  )
}
