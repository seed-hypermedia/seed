import {desktopUniversalClient} from '@/desktop-universal-client'
import {grpcClient} from '@/grpc-client'
import {client} from '@/trpc'
import {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {Block, DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {nanoid} from 'nanoid'
import {shouldAutoLinkParent} from '../utils/publish-utils'

// Re-export utility functions from client SDK for easier testing
export {documentContainsLinkToChild, documentHasSelfQuery} from '@seed-hypermedia/client'

/**
 * Walk editor blocks looking for an inline draft embed,
 * and rewrite each match in place by setting the
 * URL and clearing draftId. Returns the block
 * tree and whether any rewrite happened.
 */
function rewriteInlineDraftEmbeds(
  blocks: any[],
  childDraftId: string,
  childUrl: string,
): {blocks: any[]; didRewrite: boolean} {
  let didRewrite = false
  const walk = (nodes: any[]): any[] =>
    nodes.map((b) => {
      if (b?.type === 'embed' && b?.props?.draftId && b.props.draftId === childDraftId) {
        didRewrite = true
        return {
          ...b,
          props: {
            ...b.props,
            url: childUrl,
            draftId: '',
            view: 'Card',
          },
        }
      }
      if (b?.children?.length) {
        return {...b, children: walk(b.children)}
      }
      return b
    })
  const rewritten = walk(blocks)
  return {blocks: rewritten, didRewrite}
}

/**
 * Add or update an embed link to a parent draft.
 *
 * Known limitation: if the user discards this draft later, the link is lost.
 */
export async function addLinkToParentDraft(
  parentDraftId: string,
  childId: UnpackedHypermediaId,
  childDraftId?: string,
): Promise<void> {
  const draft = await client.drafts.get.query(parentDraftId)
  if (!draft) {
    throw new Error(`Draft ${parentDraftId} not found`)
  }

  const childUrl = packHmId(childId)
  const originalContent = draft.content || []

  let updatedContent: any[]
  if (childDraftId) {
    const {blocks, didRewrite} = rewriteInlineDraftEmbeds(originalContent, childDraftId, childUrl)
    if (didRewrite) {
      updatedContent = blocks
    } else {
      updatedContent = [...originalContent, buildAppendedEmbedBlock(childUrl)]
    }
  } else {
    updatedContent = [...originalContent, buildAppendedEmbedBlock(childUrl)]
  }

  // Write back to draft
  await client.drafts.write.mutate({
    id: draft.id,
    locationUid: draft.locationUid,
    locationPath: draft.locationPath,
    editUid: draft.editUid,
    editPath: draft.editPath,
    metadata: draft.metadata,
    content: updatedContent,
    deps: draft.deps,
    navigation: draft.navigation,
    visibility: draft.visibility,
  })

  // Refetch draft queries.
  await queryClient.refetchQueries({queryKey: [queryKeys.DRAFT, parentDraftId]})
}

/**
 * Try to update an existing inline draft embed in the parent draft.
 * Returns whether any rewrite happened.
 */
async function tryRewriteInlineDraftEmbed(
  parentDraftId: string,
  childId: UnpackedHypermediaId,
  childDraftId: string,
): Promise<boolean> {
  const draft = await client.drafts.get.query(parentDraftId)
  if (!draft) throw new Error(`Draft ${parentDraftId} not found`)

  const childUrl = packHmId(childId)
  const originalContent = draft.content || []
  const {blocks, didRewrite} = rewriteInlineDraftEmbeds(originalContent, childDraftId, childUrl)
  if (!didRewrite) return false

  await client.drafts.write.mutate({
    id: draft.id,
    locationUid: draft.locationUid,
    locationPath: draft.locationPath,
    editUid: draft.editUid,
    editPath: draft.editPath,
    metadata: draft.metadata,
    content: blocks,
    deps: draft.deps,
    navigation: draft.navigation,
    visibility: draft.visibility,
  })

  // Refetch (not just invalidate) so the cache has the rewritten
  // content before this function returns. Awaiting matters: when the user
  // navigates back to the parent draft in the same window, React Query would
  // otherwise hand the editor the stale cached version while a background
  // refetch is still in flight, and the editor's 'frozenBlocksRef' captures
  // the first blocks it sees, freezing the stale state until a hard reload.
  await queryClient.refetchQueries({queryKey: [queryKeys.DRAFT, parentDraftId]})
  return true
}

function buildAppendedEmbedBlock(childUrl: string) {
  return {
    id: nanoid(10),
    type: 'embed',
    props: {
      url: childUrl,
      view: 'Card',
      defaultOpen: 'false',
    },
    content: [],
    children: [],
  }
}

/**
 * Publish an embed link to a parent document (when parent has no draft).
 */
export async function publishLinkToParentDocument(
  parentId: UnpackedHypermediaId,
  parentDocument: HMDocument,
  childId: UnpackedHypermediaId,
  signingKeyName: string,
): Promise<HMDocument> {
  const rootBlocks = parentDocument.content || []
  const lastBlock = rootBlocks[rootBlocks.length - 1]
  const lastBlockId = lastBlock?.block?.id || ''

  const newBlockId = nanoid(10)

  const embedBlock = {
    id: newBlockId,
    type: 'Embed',
    link: packHmId(childId),
    attributes: {view: 'Card'},
  }

  // Block.fromJson() is required to properly convert the attributes plain object
  // into a google.protobuf.Struct. Without it, attributes like {view: 'Card'} are silently dropped.
  const changes = [
    new DocumentChange({
      op: {case: 'moveBlock', value: {blockId: newBlockId, parent: '', leftSibling: lastBlockId}},
    }),
    new DocumentChange({
      op: {case: 'replaceBlock', value: Block.fromJson(embedBlock)},
    }),
  ]

  let capabilityId = ''
  if (signingKeyName !== parentId.uid) {
    const capabilities = await grpcClient.accessControl.listCapabilities({
      account: parentId.uid,
      path: hmIdPathToEntityQueryPath(parentId.path || []),
    })
    const capability = capabilities.capabilities.find((cap) => cap.delegate === signingKeyName)
    if (!capability) {
      throw new Error('Could not find capability for signing account to update parent document')
    }
    capabilityId = capability.id
  }

  const parentPath = hmIdPathToEntityQueryPath(parentId.path || [])

  await desktopUniversalClient.publishDocument!({
    signerAccountUid: signingKeyName,
    account: parentId.uid,
    baseVersion: parentDocument.version,
    path: parentPath,
    changes,
    capability: capabilityId,
    genesis: parentDocument.genesis,
    generation: parentDocument.generationInfo?.generation,
  })

  const updatedDoc = await grpcClient.documents.getDocument({
    account: parentId.uid,
    path: parentPath,
  })
  const resultDoc: HMDocument = prepareHMDocument(updatedDoc)

  invalidateQueries([queryKeys.ENTITY, parentId.id])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, parentId.id])

  return resultDoc
}

/**
 * Result of the auto-link-parent-after-publish helper.
 *
 * `kind` tells the caller which code path ran so it can show the right toast
 * or skip UI altogether. `parentId` is returned so callers can navigate to the parent.
 */
export type AutoLinkParentResult =
  | {kind: 'skipped'; reason: 'at-root' | 'no-parent-doc' | 'should-not-link' | 'no-account'}
  | {kind: 'added-to-draft'; parentId: UnpackedHypermediaId; parentDraftId: string}
  | {kind: 'published-parent'; parentId: UnpackedHypermediaId}

/**
 * Auto-link a newly-published child document to its parent on first publish.
 *
 * Decides whether to append a Card embed to the parent and, if so, writes to
 * the parent's draft when one exists or publishes a new parent version
 * otherwise. Invalidates the parent's query cache so every window re-renders.
 *
 * Callers must gate on `isFirstPublish` themselves; this helper assumes the
 * child publish was a first publish. Errors propagate — the caller decides
 * whether to surface them to the user.
 */
export async function autoLinkParentAfterPublish({
  childId,
  childDraftId,
  signingAccountUid,
  isPrivate,
}: {
  childId: UnpackedHypermediaId
  /** Local id of the draft that was just published. When provided and the
   * parent draft contains an inline draft embed referencing this id, the
   * embed is rewritten in place instead of an append being added. */
  childDraftId?: string
  signingAccountUid: string | undefined
  isPrivate: boolean
}): Promise<AutoLinkParentResult> {
  if (!signingAccountUid) {
    return {kind: 'skipped', reason: 'no-account'}
  }

  const childPath = childId.path || []
  if (childPath.length < 1) {
    return {kind: 'skipped', reason: 'at-root'}
  }

  const parentPath = childPath.slice(0, -1)
  const parentId = hmId(childId.uid, {path: parentPath})

  // Look up the parent's draft before fetching the published doc.
  // For nested draft chains the parent has no published version yet, so the
  // published doc fetch below will fail, but we can still rewrite the
  // matching inline draft embed inside the parent's draft content.
  const parentDraft = await client.drafts.findByEdit.query({
    editUid: parentId.uid,
    editPath: parentPath,
  })

  // When childDraftId is provided AND the parent has a draft
  // with a matching embed, rewrite it in place. This works regardless
  // of whether the parent itself has been published, which is
  // what makes deeply nested draft chains transition correctly.
  if (parentDraft?.id && childDraftId) {
    const didRewrite = await tryRewriteInlineDraftEmbed(parentDraft.id, childId, childDraftId)
    if (didRewrite) {
      invalidateQueries([queryKeys.DRAFT, parentDraft.id])
      invalidateQueries([queryKeys.ENTITY, parentId.id])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, parentId.id])
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
      return {kind: 'added-to-draft', parentId, parentDraftId: parentDraft.id}
    }
  }

  // Append a Card embed at the parent's end when no
  // matching inline embed exists.
  let parentDocument: HMDocument | null = null
  try {
    const rawParent = await grpcClient.documents.getDocument({
      account: parentId.uid,
      path: hmIdPathToEntityQueryPath(parentPath),
    })
    parentDocument = prepareHMDocument(rawParent)
  } catch {
    return {kind: 'skipped', reason: 'no-parent-doc'}
  }

  if (!parentDocument) {
    return {kind: 'skipped', reason: 'no-parent-doc'}
  }

  const willAddLink = shouldAutoLinkParent(isPrivate, parentDocument, childId, parentId)
  if (!willAddLink) {
    return {kind: 'skipped', reason: 'should-not-link'}
  }

  if (parentDraft?.id) {
    await addLinkToParentDraft(parentDraft.id, childId, childDraftId)
    invalidateQueries([queryKeys.DRAFT, parentDraft.id])
    invalidateQueries([queryKeys.ENTITY, parentId.id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, parentId.id])
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
    return {kind: 'added-to-draft', parentId, parentDraftId: parentDraft.id}
  }

  await publishLinkToParentDocument(parentId, parentDocument, childId, signingAccountUid)
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
  return {kind: 'published-parent', parentId}
}
