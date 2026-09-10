import type {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

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
export function canUseDocumentAsDestinationParent(
  document: {visibility?: string; version?: string} | null | undefined,
) {
  return !!document?.version && document.visibility !== 'PRIVATE'
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

/** Returns true when a Move target belongs to the same site as the source document. */
export function isMoveTargetSameSite(sourceId: UnpackedHypermediaId, targetParentId: UnpackedHypermediaId | null) {
  if (!targetParentId) return false
  return sourceId.uid === targetParentId.uid
}

/** Returns true when a parent is a valid Move destination candidate for the source. */
export function canUseMoveTargetParent(sourceId: UnpackedHypermediaId, targetParentId: UnpackedHypermediaId | null) {
  return isMoveTargetSameSite(sourceId, targetParentId) && !isMoveTargetParentBlocked(sourceId, targetParentId)
}

/** Allows empty destinations, or a move back over a direct move redirect to its current source. */
export function canUseDocumentDestination(resource: HMResource | null | undefined, moveSource?: UnpackedHypermediaId) {
  if (resource?.type === 'not-found' || resource?.type === 'tombstone') return true
  if (resource?.type !== 'redirect' || resource.republish || !moveSource) return false
  const target = resource.redirectTarget
  const sourcePath = moveSource.path || []
  const targetPath = target.path || []
  return (
    target.uid === moveSource.uid &&
    !target.version &&
    !target.blockRef &&
    targetPath.length === sourcePath.length &&
    targetPath.every((part, index) => part === sourcePath[index])
  )
}
