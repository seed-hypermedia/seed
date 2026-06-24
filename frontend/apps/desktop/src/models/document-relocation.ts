import type {CreateRedirectRefInput} from '@seed-hypermedia/client/ref'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'

/** Returns true when a path is a strict descendant of a parent document path. */
export function isChildDocumentPath(path: string[], parentPath: string[]) {
  return path.length > parentPath.length && parentPath.every((segment, index) => path[index] === segment)
}

/** Returns the destination path for a child document when its parent subtree is moved. */
export function getMovedChildPath(childPath: string[], fromPath: string[], toPath: string[]) {
  return [...toPath, ...childPath.slice(fromPath.length)]
}

export type DocumentCardReconciliationInput = {
  operation: 'remove' | 'add' | 'rewrite'
  parentDocumentId: string
  sourceDocumentId?: string
  targetDocumentId?: string
  signingAccountUid: string
  capabilityId?: string
}

function parentIdForDocument(id: UnpackedHypermediaId) {
  const path = id.path || []
  if (!path.length) return null
  return hmId(id.uid, {path: path.slice(0, -1)})
}

function sameParent(a: UnpackedHypermediaId, b: UnpackedHypermediaId) {
  const aParentPath = (a.path || []).slice(0, -1)
  const bParentPath = (b.path || []).slice(0, -1)
  return a.uid === b.uid && aParentPath.join('/') === bParentPath.join('/')
}

export function getDocumentCardReconciliationInputsForMove({
  from,
  to,
  signingAccountUid,
  sourceCapabilityId,
  targetCapabilityId,
}: {
  from: UnpackedHypermediaId
  to: UnpackedHypermediaId
  signingAccountUid: string
  sourceCapabilityId?: string
  targetCapabilityId?: string
}): DocumentCardReconciliationInput[] {
  const oldParent = parentIdForDocument(from)
  const newParent = parentIdForDocument(to)
  if (!oldParent || !newParent) return []

  if (sameParent(from, to)) {
    return [
      {
        operation: 'rewrite',
        parentDocumentId: oldParent.id,
        sourceDocumentId: from.id,
        targetDocumentId: to.id,
        signingAccountUid,
        capabilityId: sourceCapabilityId || targetCapabilityId,
      },
    ]
  }

  return [
    {
      operation: 'remove',
      parentDocumentId: oldParent.id,
      sourceDocumentId: from.id,
      signingAccountUid,
      capabilityId: sourceCapabilityId,
    },
    {
      operation: 'add',
      parentDocumentId: newParent.id,
      targetDocumentId: to.id,
      signingAccountUid,
      capabilityId: targetCapabilityId,
    },
  ]
}

export function getDocumentCardReconciliationInputForRepublish({
  to,
  signingAccountUid,
  capabilityId,
}: {
  to: UnpackedHypermediaId
  signingAccountUid: string
  capabilityId?: string
}): DocumentCardReconciliationInput | null {
  const parent = parentIdForDocument(to)
  if (!parent) return null
  return {
    operation: 'add',
    parentDocumentId: parent.id,
    targetDocumentId: to.id,
    signingAccountUid,
    capabilityId,
  }
}

/** Builds the signed-ref operation for creating a protocol-level republish redirect. */
export function createRepublishRefOperation({
  sourceId,
  destinationId,
  sourceDocument,
  capabilityId,
}: {
  sourceId: UnpackedHypermediaId
  destinationId: UnpackedHypermediaId
  sourceDocument: HMDocument
  capabilityId?: string
}): CreateRedirectRefInput {
  if (!sourceDocument.generationInfo) throw new Error('No generation info for document')
  return {
    space: destinationId.uid,
    path: hmIdPathToEntityQueryPath(destinationId.path),
    genesis: sourceDocument.generationInfo.genesis,
    generation: Number(sourceDocument.generationInfo.generation),
    targetSpace: sourceId.uid,
    targetPath: hmIdPathToEntityQueryPath(sourceId.path),
    republish: true,
    capability: capabilityId || undefined,
  }
}
