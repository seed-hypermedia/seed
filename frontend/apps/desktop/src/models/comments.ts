import {client} from '@/trpc'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {queryKeys} from '@shm/shared/models/query-keys'

/** Query key + fetcher shared by the draft hook and the composer machine's load effect. */
export function commentDraftQueryOptions(
  targetDocId: UnpackedHypermediaId,
  commentId: string | undefined,
  quotingBlockId: string | undefined,
  quotingRange: {start: number; end: number} | undefined,
  context: 'accessory' | 'feed' | 'document-content' | undefined,
) {
  return {
    queryKey: [
      queryKeys.COMMENT_DRAFT,
      targetDocId.id,
      commentId,
      quotingBlockId,
      quotingRange?.start,
      quotingRange?.end,
      context,
    ],
    queryFn: () =>
      client.comments.getCommentDraft.query({
        targetDocId: targetDocId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        quotingRange: quotingRange,
        context: context,
      }),
  }
}
