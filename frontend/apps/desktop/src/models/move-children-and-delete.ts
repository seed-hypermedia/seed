import type {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from '@shm/shared/content'
import {
  canUseDocumentDestination,
  getChildMoveDestinationPath,
  getChildMoveRoots,
} from '@shm/shared/utils/document-actions'
import {hmId} from '@shm/shared/utils/entity-id-url'

export type MoveChildrenAndDeleteInput = {
  parent: UnpackedHypermediaId
  /** The parent each child root moves under (`target/<last segment>`). */
  target: UnpackedHypermediaId
  signingAccountId: string
}

export type MoveChildrenAndDeleteDeps = MoveChildrenAndDeleteInput & {
  /** Every document in the space, including redirects (marked `isRedirect`). */
  listDocuments: () => Promise<Array<{path: string[]; isRedirect: boolean; metadata?: any}>>
  requestResource: (id: UnpackedHypermediaId) => Promise<HMResource | null>
  /** Recursively moves one subtree, leaving a redirect at the source path. */
  move: (move: {from: UnpackedHypermediaId; to: UnpackedHypermediaId}) => Promise<void>
  deleteParent: () => Promise<void>
}

/**
 * Moves the shallowest non-redirect children of `parent` under `target` — each move recursively
 * relocates its subtree and leaves a redirect at the old path — then deletes only `parent`.
 * Every destination is prechecked before anything is published, and the parent is never
 * deleted if a move fails partway.
 */
export async function moveChildrenAndDelete({parent, target, ...deps}: MoveChildrenAndDeleteDeps): Promise<void> {
  const docs = await deps.listDocuments()
  const rootPaths = getChildMoveRoots(parent.path || [], docs)
  if (!rootPaths.length) throw new Error('This document has no child documents to move.')
  const targetPath = target.path || []
  const moves = rootPaths.map((rootPath) => ({
    from: hmId(parent.uid, {path: rootPath}),
    to: hmId(target.uid, {path: getChildMoveDestinationPath(rootPath, targetPath)}),
  }))
  // Precheck every destination before publishing anything.
  for (const move of moves) {
    const destination = await deps.requestResource(move.to)
    if (!canUseDocumentDestination(destination, move.from))
      throw new Error(`A document already exists at ${move.to.id}. Choose a different location.`)
  }
  const parentTitle = getMetadataName(
    docs.find((doc) => doc.path.join('/') === (parent.path || []).join('/'))?.metadata,
  )
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    try {
      await deps.move(move)
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error)
      throw new Error(`Moved ${i} of ${moves.length} child documents. "${parentTitle}" was not deleted. ${cause}`)
    }
  }
  await deps.deleteParent()
}
