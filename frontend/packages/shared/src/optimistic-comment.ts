import {commentRecordIdFromBlob, trimTrailingEmptyBlocks} from '@seed-hypermedia/client'
import type {QuotingTarget} from '@seed-hypermedia/client'
import {
  hmIdPathToEntityQueryPath,
  HMBlockNode,
  HMComment,
  HMListCommentsOutput,
  HMMetadataPayload,
  HMPublishBlobsInput,
  packHmId,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import type {QueryClient} from '@tanstack/react-query'
import {queryKeys} from './models/query-keys'
import type {NavRoute} from './routes'

// ─── Build optimistic comment ───────────────────────────────────────────────

/** Parameters for building an optimistic HMComment from local data. */
export type BuildOptimisticCommentParams = {
  commentPayload: HMPublishBlobsInput
  authorUid: string
  docId: UnpackedHypermediaId
  docVersion: string
  /** Raw block nodes from the editor (before trimming/wrapping). */
  contentBlocks: HMBlockNode[]
  replyParentId?: string
  threadRootVersion?: string
  /** Structured quote target (preferred). */
  quoting?: QuotingTarget
  /** Deprecated alias retained for callers still passing only a block id. */
  quotingBlockId?: string
  visibility?: 'PUBLIC' | 'PRIVATE'
}

/**
 * Build a fully-shaped HMComment from local data.
 * Uses `commentRecordIdFromBlob` to compute the real authority/tsid record ID
 * from the CBOR blob, so the optimistic comment has a valid `id` field.
 */
export async function buildOptimisticComment(params: BuildOptimisticCommentParams): Promise<HMComment> {
  const blobData = params.commentPayload.blobs[0]?.data
  if (!blobData) throw new Error('No blob data in comment payload')

  const recordId = await commentRecordIdFromBlob(blobData)
  const now = new Date().toISOString()

  // Apply same transformations as createComment: trim trailing empty blocks + wrap with embed if quoting
  let content = trimTrailingEmptyBlocks(params.contentBlocks)
  const quoting = resolveQuoting(params)
  if (quoting) {
    content = wrapQuotedContent(content, params.docId, params.docVersion, quoting)
  }

  return {
    id: recordId,
    version: `optimistic-${Date.now()}`,
    author: params.authorUid,
    targetAccount: params.docId.uid,
    targetPath: hmIdPathToEntityQueryPath(params.docId.path || null),
    targetVersion: params.docVersion,
    replyParent: params.replyParentId || '',
    threadRootVersion: params.threadRootVersion,
    content,
    createTime: now,
    updateTime: now,
    visibility: params.visibility || 'PUBLIC',
  }
}

/** Replicates `wrapQuotedContent` from comment.ts for the optimistic path. */
function wrapQuotedContent(
  content: HMBlockNode[],
  docId: UnpackedHypermediaId,
  docVersion: string,
  quoting: QuotingTarget,
): HMBlockNode[] {
  return [
    {
      block: {
        id: generateBlockId(8),
        type: 'Embed',
        text: '',
        attributes: {childrenType: 'Group', view: 'Content'},
        annotations: [],
        link: packHmId({
          ...docId,
          blockRef: quoting.blockId,
          blockRange: quoting.range ?? null,
          version: docVersion,
          latest: false,
        }),
      },
      children: content,
    } as HMBlockNode,
  ]
}

/** Reconciles legacy `quotingBlockId` and the new `quoting` param. */
function resolveQuoting(params: {quoting?: QuotingTarget; quotingBlockId?: string}): QuotingTarget | undefined {
  if (params.quoting) {
    if (params.quoting.range && params.quoting.range.start === params.quoting.range.end) {
      return {blockId: params.quoting.blockId}
    }
    return params.quoting
  }
  if (params.quotingBlockId) return {blockId: params.quotingBlockId}
  return undefined
}

function generateBlockId(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

// ─── Apply optimistic comment to cache ──────────────────────────────────────

/**
 * Injects an optimistic comment into the React Query cache and returns
 * a rollback function that restores the previous state.
 */
export function applyOptimisticComment(
  qc: QueryClient,
  targetId: UnpackedHypermediaId,
  comment: HMComment,
  authorMetadata?: HMMetadataPayload | null,
  quoting?: QuotingTarget | string,
): () => void {
  const rollbacks: (() => void)[] = []
  // Back-compat: callers used to pass `quotingBlockId: string` as the 5th arg.
  const quotingTarget: QuotingTarget | undefined = typeof quoting === 'string' ? {blockId: quoting} : quoting

  // Update DOCUMENT_COMMENTS cache
  const commentsKey = [queryKeys.DOCUMENT_COMMENTS, targetId]
  const prevComments = qc.getQueryData<HMListCommentsOutput>(commentsKey)
  qc.setQueryData<HMListCommentsOutput>(commentsKey, (old) => {
    const comments = old?.comments ? [...old.comments, comment] : [comment]
    const authors = {...(old?.authors || {})}
    if (authorMetadata && comment.author) {
      authors[comment.author] = authorMetadata
    }
    return {comments, authors}
  })
  rollbacks.push(() => qc.setQueryData(commentsKey, prevComments))

  // Also update BLOCK_DISCUSSIONS cache when quoting a specific block
  if (quotingTarget) {
    const blockTargetId = {...targetId, blockRef: quotingTarget.blockId}
    const blockKey = [queryKeys.BLOCK_DISCUSSIONS, blockTargetId]
    const prevBlock = qc.getQueryData<HMListCommentsOutput>(blockKey)
    if (prevBlock) {
      qc.setQueryData<HMListCommentsOutput>(blockKey, (old) => {
        const comments = old?.comments ? [...old.comments, comment] : [comment]
        const authors = {...(old?.authors || {})}
        if (authorMetadata && comment.author) {
          authors[comment.author] = authorMetadata
        }
        return {comments, authors}
      })
      rollbacks.push(() => qc.setQueryData(blockKey, prevBlock))
    }
  }

  return () => rollbacks.forEach((fn) => fn())
}

// ─── Navigate to comment after publish ──────────────────────────────────────

/**
 * Navigate to the newly published comment, updating the URL to focus it.
 * Returns the previous route for rollback, or null if no navigation was needed.
 *
 * Only 2 route patterns:
 * - `route.key === 'comments'` → main section → set openComment
 * - `route.key === 'document'` + `panel.key === 'comments'` → right panel → set panel.openComment
 */
export function navigateToComment(
  navigate: (route: NavRoute) => void,
  route: NavRoute,
  recordId: string,
): NavRoute | null {
  if (route.key === 'comments') {
    const previousRoute = {...route}
    navigate({
      ...route,
      openComment: recordId,
      targetBlockId: undefined,
      isReplying: undefined,
      replyCommentVersion: undefined,
      rootReplyCommentVersion: undefined,
    })
    return previousRoute
  }

  if (route.key === 'document' && route.panel?.key === 'comments') {
    const previousRoute = {...route, panel: {...route.panel}}
    navigate({
      ...route,
      panel: {
        ...route.panel,
        openComment: recordId,
        targetBlockId: undefined,
        isReplying: undefined,
        replyCommentVersion: undefined,
        rootReplyCommentVersion: undefined,
      },
    })
    return previousRoute
  }

  return null
}
