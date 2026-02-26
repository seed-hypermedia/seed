import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {HMDocument, UnpackedHypermediaId} from './hm-types'

export type DocumentActionsContextValue = {
  // Account info — card checks ownership/capabilities itself
  selectedAccountUid?: string
  myAccountIds?: string[]

  // Bookmark
  isBookmarked?: (id: UnpackedHypermediaId) => boolean
  onBookmarkToggle?: (id: UnpackedHypermediaId) => void

  // Document actions — dialogs hoisted to provider
  onEditDocument?: (id: UnpackedHypermediaId, existingDraftId?: string) => void
  onMoveDocument?: (id: UnpackedHypermediaId) => void
  onDeleteDocument?: (id: UnpackedHypermediaId, onSuccess?: () => void) => void
  onBranchDocument?: (id: UnpackedHypermediaId) => void
  onDuplicateDocument?: (id: UnpackedHypermediaId) => void
  onExportDocument?: (doc: HMDocument) => void
  onCopyLink?: (id: UnpackedHypermediaId) => void

  // Draft lookup
  getDraftId?: (id: UnpackedHypermediaId) => string | undefined
}

const DocumentActionsContext = createContext<DocumentActionsContextValue>({})

export function DocumentActionsProvider({children, ...value}: PropsWithChildren<DocumentActionsContextValue>) {
  const ctx = useMemo(
    () => value,
    [
      value.selectedAccountUid,
      value.myAccountIds,
      value.isBookmarked,
      value.onBookmarkToggle,
      value.onEditDocument,
      value.onMoveDocument,
      value.onDeleteDocument,
      value.onBranchDocument,
      value.onDuplicateDocument,
      value.onExportDocument,
      value.onCopyLink,
      value.getDraftId,
    ],
  )
  return <DocumentActionsContext.Provider value={ctx}>{children}</DocumentActionsContext.Provider>
}

export function useDocumentActions(): DocumentActionsContextValue {
  return useContext(DocumentActionsContext)
}
