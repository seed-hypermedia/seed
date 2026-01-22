import {grpcClient} from '@/grpc-client'
import {client} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {
  HMBlockNodeSchema,
  HMComment,
  HMCommentDraftSchema,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'

export function useCommentDraft(
  targetDocId: UnpackedHypermediaId,
  commentId: string | undefined,
  quotingBlockId: string | undefined,
  context: 'accessory' | 'feed' | 'document-content' | undefined,
  opts?: {enabled?: boolean},
) {
  const comment = useQuery({
    queryKey: [
      queryKeys.COMMENT_DRAFT,
      targetDocId.id,
      commentId,
      quotingBlockId,
      context,
    ],
    queryFn: () =>
      client.comments.getCommentDraft.query({
        targetDocId: targetDocId.id,
        replyCommentId: commentId,
        quotingBlockId: quotingBlockId,
        context: context,
      }),
    enabled: opts?.enabled,
  })
  return {
    ...comment,
    data: comment.data ? HMCommentDraftSchema.parse(comment.data) : undefined,
  }
}

export function useComments(commentIds: UnpackedHypermediaId[] = []) {
  return useQuery({
    queryKey: [queryKeys.COMMENTS_BATCH],
    queryFn: async function () {
      const res = await grpcClient.comments.batchGetComments({
        ids: commentIds.map((c) => c.id),
      })
      return res.comments.map((comment) => {
        const plain = toPlainMessage(comment)
        return {
          ...plain,
          content: plain.content.map((blockNode) => {
            const parsed = HMBlockNodeSchema.safeParse(blockNode)
            return parsed.success ? parsed.data : blockNode
          }),
        } as HMComment
      })
    },
  })
}

export function useDeleteComment() {
  return useMutation({
    mutationFn: async ({
      commentId,
      targetDocId,
      signingAccountId,
    }: {
      commentId: string
      targetDocId: UnpackedHypermediaId
      signingAccountId: string
    }) => {
      await grpcClient.comments.deleteComment({
        id: commentId,
        signingKeyName: signingAccountId,
      })
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.DOCUMENT_DISCUSSION])
      invalidateQueries([])
    },
  })
}
