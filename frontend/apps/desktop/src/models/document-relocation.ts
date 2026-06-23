import type {CreateRedirectRefInput} from '@seed-hypermedia/client/ref'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'

/** Returns true when a path is a strict descendant of a parent document path. */
export function isChildDocumentPath(path: string[], parentPath: string[]) {
  return path.length > parentPath.length && parentPath.every((segment, index) => path[index] === segment)
}

/** Returns the destination path for a child document when its parent subtree is moved. */
export function getMovedChildPath(childPath: string[], fromPath: string[], toPath: string[]) {
  return [...toPath, ...childPath.slice(fromPath.length)]
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
