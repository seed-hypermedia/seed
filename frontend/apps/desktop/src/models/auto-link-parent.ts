import {client} from '@/trpc'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {DocumentCardActionOrigin} from '@shm/shared/utils/document-actions'
import {appendDraftCardToEditorBlocks, removeDraftCardFromEditorBlocks} from '@shm/shared/utils/document-card-cleanup'
import {nanoid} from 'nanoid'

export {documentContainsLinkToChild, documentHasSelfQuery} from '@seed-hypermedia/client'

/** Acknowledgement of durable parent maintenance, not completion of its side effects. */
export type AutoLinkParentResult =
  | {kind: 'skipped'; reason: 'at-root' | 'should-not-link' | 'no-account'}
  | {kind: 'queued'; parentId: UnpackedHypermediaId}

/** Queue first-publication maintenance; eligibility is checked against the current published parent by the worker. */
export async function autoLinkParentAfterPublish({
  childId,
  childDraftId,
  signingAccountUid,
  isPrivate,
}: {
  childId: UnpackedHypermediaId
  childDraftId?: string
  signingAccountUid: string | undefined
  isPrivate: boolean
}): Promise<AutoLinkParentResult> {
  if (!signingAccountUid) return {kind: 'skipped', reason: 'no-account'}
  if (isPrivate) return {kind: 'skipped', reason: 'should-not-link'}
  if (!childId.path?.length) return {kind: 'skipped', reason: 'at-root'}
  const parentId = hmId(childId.uid, {path: childId.path.slice(0, -1)})
  await client.documentCardCleanup.enqueue.mutate({
    operation: 'add',
    parentDocumentId: parentId.id,
    targetDocumentId: childId.id,
    childDraftId,
    signingAccountUid,
  })
  return {kind: 'queued', parentId}
}

/** Queue a relocation destination card with the same reference/query suppression as first publication. */
export async function appendDocumentCardToParent(input: {
  childId: UnpackedHypermediaId
  signingAccountUid: string | undefined
}): Promise<AutoLinkParentResult> {
  return autoLinkParentAfterPublish({...input, isPrivate: false})
}

/** Queue removal of the selected card from its explicit container, never authored inline links. */
export async function removeRelocatedDocumentCardFromParent({
  sourceId,
  origin,
  signingAccountUid,
}: {
  sourceId: UnpackedHypermediaId
  origin: DocumentCardActionOrigin
  signingAccountUid: string
}) {
  await client.documentCardCleanup.enqueue.mutate({
    operation: 'remove',
    sourceDocumentId: sourceId.id,
    parentDocumentId: origin.parentDocumentId.id,
    targetBlockId: origin.embedBlockId,
    signingAccountUid,
  })
  return {kind: 'queued' as const, parentId: origin.parentDocumentId}
}

/** Queue independent source and destination repairs after a successful relocation. */
export async function updateParentCardsAfterDocumentRelocation({
  from,
  to,
  signingAccountUid,
  origin,
}: {
  from: UnpackedHypermediaId
  to: UnpackedHypermediaId
  signingAccountUid: string
  origin: DocumentCardActionOrigin
}) {
  const [removed, added] = await Promise.all([
    removeRelocatedDocumentCardFromParent({sourceId: from, origin, signingAccountUid}),
    appendDocumentCardToParent({childId: to, signingAccountUid}),
  ])
  return {removed, added}
}

/** Durable relocation maintenance acknowledgement. */
export type ParentCardsAfterRelocationResult = Awaited<ReturnType<typeof updateParentCardsAfterDocumentRelocation>>

/** Result of moving unpublished draft-card embeds between parent drafts. */
export type MoveDraftCardBetweenParentDraftsResult = {
  removed?: {parentId: UnpackedHypermediaId; parentDraftId: string; removedBlockIds: string[]}
  added?: {parentId: UnpackedHypermediaId; parentDraftId: string; addedBlockIds: string[]}
}

async function writeDraftContent(draft: any, content: any[]) {
  await client.drafts.write.mutate({
    ...draft,
    id: draft.id,
    locationUid: draft.locationUid,
    locationPath: draft.locationPath,
    editUid: draft.editUid,
    editPath: draft.editPath,
    metadata: draft.metadata,
    content,
    deps: draft.deps,
    navigation: draft.navigation,
    visibility: draft.visibility,
  })
  invalidateQueries([queryKeys.DRAFT, draft.id])
}

/** Moves an unpublished draft-card embed from the old parent draft to the new parent draft when those drafts exist. */
export async function moveDraftCardBetweenParentDrafts({
  draftId,
  fromParentId,
  toParentId,
  sourceBlockId,
}: {
  draftId: string
  fromParentId: UnpackedHypermediaId | null | undefined
  toParentId: UnpackedHypermediaId
  sourceBlockId?: string
}): Promise<MoveDraftCardBetweenParentDraftsResult> {
  const result: MoveDraftCardBetweenParentDraftsResult = {}
  if (fromParentId) {
    const oldParentDraft = await client.drafts.findByEdit.query({
      editUid: fromParentId.uid,
      editPath: fromParentId.path || [],
    })
    if (oldParentDraft?.id) {
      const draft = await client.drafts.get.query(oldParentDraft.id)
      if (draft) {
        const removed = removeDraftCardFromEditorBlocks((draft.content || []) as any[], draftId, sourceBlockId)
        if (removed.removedBlockIds.length) {
          await writeDraftContent(draft, removed.content)
          result.removed = {parentId: fromParentId, parentDraftId: draft.id, removedBlockIds: removed.removedBlockIds}
        }
      }
    }
  }

  const newParentDraft = await client.drafts.findByEdit.query({
    editUid: toParentId.uid,
    editPath: toParentId.path || [],
  })
  if (newParentDraft?.id) {
    const draft = await client.drafts.get.query(newParentDraft.id)
    if (draft) {
      const added = appendDraftCardToEditorBlocks((draft.content || []) as any[], draftId, nanoid(10))
      if (added.addedBlockIds.length) {
        await writeDraftContent(draft, added.content)
        result.added = {parentId: toParentId, parentDraftId: draft.id, addedBlockIds: added.addedBlockIds}
      }
    }
  }

  if (fromParentId) {
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, fromParentId.id])
    invalidateQueries([queryKeys.ENTITY, fromParentId.id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, fromParentId.id])
  }
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, toParentId.id])
  invalidateQueries([queryKeys.ENTITY, toParentId.id])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, toParentId.id])
  return result
}
