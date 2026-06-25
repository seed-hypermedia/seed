import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

export type DocumentCardActionOrigin = {
  parentDocumentId: UnpackedHypermediaId
  embedBlockId?: string
}

function hasDocumentPath(id: UnpackedHypermediaId) {
  return !!id.path?.length
}

/** Returns whether the Move action can be shown for a document in card/list menus. */
export function canShowMoveDocumentAction({
  id,
  selectedAccountUid,
  canWriteSource,
}: {
  id: UnpackedHypermediaId
  selectedAccountUid: string | null | undefined
  canWriteSource: boolean
}) {
  return hasDocumentPath(id) && !!selectedAccountUid && canWriteSource
}

/** Returns whether the Republish action can be shown for a document in card/list menus. */
export function canShowRepublishDocumentAction({
  id,
  selectedAccountUid,
}: {
  id: UnpackedHypermediaId
  selectedAccountUid: string | null | undefined
}) {
  return hasDocumentPath(id) && !!selectedAccountUid
}

/** Returns whether a document can be selected as a parent destination for new child documents. */
export function canUseDocumentAsDestinationParent(document: {visibility?: string} | null | undefined) {
  return document?.visibility !== 'PRIVATE'
}

/** Returns true when a Move target parent would put the source inside itself. */
export function isMoveTargetParentBlocked(sourceId: UnpackedHypermediaId, targetParentId: UnpackedHypermediaId | null) {
  if (!targetParentId) return false
  if (sourceId.uid !== targetParentId.uid) return false
  const sourcePath = sourceId.path || []
  const targetPath = targetParentId.path || []
  if (!sourcePath.length) return true
  return sourcePath.length <= targetPath.length && sourcePath.every((segment, index) => targetPath[index] === segment)
}
