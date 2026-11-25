import {createContext, PropsWithChildren, useContext, useMemo} from 'react'
import {HMDocument, HMListedDraft, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {PinnedDocument} from './models/pins'
import type {DocumentCardActionOrigin} from './utils/document-actions'

export type DocumentActionsContextValue = {
  // Account info — card checks ownership/capabilities itself
  selectedAccountUid?: string
  myAccountIds?: string[]
  canWriteDocument?: (id: UnpackedHypermediaId) => boolean

  // Bookmark
  isBookmarked?: (id: UnpackedHypermediaId) => boolean
  onBookmarkToggle?: (
    id: UnpackedHypermediaId,
    metadata?: {title: string; commentId: string; targetUrl: string; authorAccountId: string},
  ) => void

  // Pinned documents (desktop app store)
  getPinsForSite?: (siteUid: string) => PinnedDocument[]
  isPinned?: (id: UnpackedHypermediaId) => boolean
  pinDocument?: (id: UnpackedHypermediaId, title: string, seenVersion: string | null) => void
  unpinDocument?: (id: UnpackedHypermediaId) => void
  movePin?: (siteUid: string, fromIndex: number, toIndex: number) => void
  acknowledgePin?: (id: UnpackedHypermediaId, seenVersion: string | null, title?: string) => void

  // Document actions — dialogs hoisted to provider
  onEditDocument?: (id: UnpackedHypermediaId, existingDraftId?: string) => void
  onMoveDocument?: (id: UnpackedHypermediaId, origin?: DocumentCardActionOrigin) => void
  onDeleteDocument?: (id: UnpackedHypermediaId, onSuccess?: () => void) => void
  onRepublishDocument?: (id: UnpackedHypermediaId, origin?: DocumentCardActionOrigin) => void
  onDuplicateDocument?: (id: UnpackedHypermediaId) => void
  onRestoreDocumentVersion?: (id: UnpackedHypermediaId, selectedVersion: HMDocument) => Promise<void> | void
  onExportDocument?: (doc: HMDocument) => void
  onCopyLink?: (id: UnpackedHypermediaId) => void

  // Draft lookup
  getDraftId?: (id: UnpackedHypermediaId) => string | undefined
  getDraft?: (id: UnpackedHypermediaId) => HMListedDraft | undefined
}

const DocumentActionsContext = createContext<DocumentActionsContextValue>({})

export function DocumentActionsProvider({children, ...value}: PropsWithChildren<DocumentActionsContextValue>) {
  const ctx = useMemo(
    () => value,
    [
      value.selectedAccountUid,
      value.myAccountIds,
      value.canWriteDocument,
      value.isBookmarked,
      value.onBookmarkToggle,
      value.getPinsForSite,
      value.isPinned,
      value.pinDocument,
      value.unpinDocument,
      value.movePin,
      value.acknowledgePin,
      value.onEditDocument,
      value.onMoveDocument,
      value.onDeleteDocument,
      value.onRepublishDocument,
      value.onDuplicateDocument,
      value.onRestoreDocumentVersion,
      value.onExportDocument,
      value.onCopyLink,
      value.getDraftId,
      value.getDraft,
    ],
  )
  return <DocumentActionsContext.Provider value={ctx}>{children}</DocumentActionsContext.Provider>
}

export function useDocumentActions(): DocumentActionsContextValue {
  return useContext(DocumentActionsContext)
}
