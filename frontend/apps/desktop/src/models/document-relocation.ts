import {packHmId} from '@seed-hypermedia/client'
import type {CreateRedirectRefInput, CreateVersionRefInput} from '@seed-hypermedia/client/ref'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {planDocumentCardMoveOperations} from '@shm/shared/utils/document-card-cleanup'
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
  return planDocumentCardMoveOperations(from, to).map((operation) => ({
    ...operation,
    signingAccountUid,
    capabilityId:
      operation.operation === 'remove'
        ? sourceCapabilityId
        : operation.operation === 'add'
          ? targetCapabilityId
          : sourceCapabilityId || targetCapabilityId,
  }))
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
    // A fresh generation (the same choice the daemon's CreateRef makes) puts the redirect in its
    // own generation row, so any later publish at the destination path supersedes it cleanly —
    // reusing the source document's generation could land below an existing Ref at the
    // destination and be silently shadowed.
    generation: Date.now(),
    targetSpace: sourceId.uid,
    targetPath: hmIdPathToEntityQueryPath(sourceId.path),
    republish: true,
    capability: capabilityId || undefined,
  }
}

/** The two ref operations a move publishes: one at the destination, one (the redirect) at the source. */
export type DocumentMoveRefOperations = {
  /**
   * The ref to publish at the destination. A plain document forks its history (`version`); a
   * republish moves as a republish (`republish`) so the destination keeps tracking the original.
   */
  destination: ({kind: 'version'} & CreateVersionRefInput) | ({kind: 'republish'} & CreateRedirectRefInput)
  /** The move redirect to publish at the source, pointing at the destination. */
  sourceRedirect: CreateRedirectRefInput
}

/**
 * Decides the two refs a move publishes, from the followed source document.
 *
 * A move acts on whatever kind of thing lives at the source and keeps it that kind at the
 * destination: a plain document forks its history there, while a republish moves as a republish so
 * the destination keeps tracking the original's edits (forking it would freeze a snapshot and
 * silently sever the link). A source that has itself already moved is a pointer, not content —
 * there is nothing to move, so this throws. Fresh generations let both refs supersede any redirect
 * Ref already sitting at their paths — required for the republish case, where the source currently
 * holds the republish redirect the new move redirect must overtake.
 */
export function getDocumentMoveRefOperations({
  sourceId,
  targetId,
  doc,
  sourceRedirect,
  originalId,
  sourceCapabilityId,
  targetCapabilityId,
}: {
  sourceId: UnpackedHypermediaId
  targetId: UnpackedHypermediaId
  doc: HMDocument
  /** The redirect (if any) currently at the source, from following it to `doc`. */
  sourceRedirect: {republish: boolean; target: UnpackedHypermediaId} | null
  /** The address `doc` really lives at — the republish target when the source is a republish. */
  originalId: UnpackedHypermediaId
  sourceCapabilityId?: string
  targetCapabilityId?: string
}): DocumentMoveRefOperations {
  if (!doc.generationInfo) throw new Error('No generation info for document')
  if (sourceRedirect && !sourceRedirect.republish) {
    throw new Error(
      `${packHmId(sourceId)} has already moved to ${packHmId(sourceRedirect.target)}. ` +
        `Move ${packHmId(sourceRedirect.target)} instead.`,
    )
  }
  const genesis = doc.generationInfo.genesis
  const generation = Date.now()
  const destination: DocumentMoveRefOperations['destination'] = sourceRedirect?.republish
    ? {
        kind: 'republish',
        space: targetId.uid,
        path: hmIdPathToEntityQueryPath(targetId.path),
        genesis,
        generation,
        targetSpace: originalId.uid,
        targetPath: hmIdPathToEntityQueryPath(originalId.path),
        republish: true,
        capability: targetCapabilityId || undefined,
      }
    : {
        kind: 'version',
        space: targetId.uid,
        path: hmIdPathToEntityQueryPath(targetId.path),
        genesis,
        version: doc.version,
        generation,
        capability: targetCapabilityId || undefined,
      }
  const sourceRedirectOp: CreateRedirectRefInput = {
    space: sourceId.uid,
    path: hmIdPathToEntityQueryPath(sourceId.path),
    genesis,
    generation,
    targetSpace: targetId.uid,
    targetPath: hmIdPathToEntityQueryPath(targetId.path),
    capability: sourceCapabilityId || undefined,
  }
  return {destination, sourceRedirect: sourceRedirectOp}
}
