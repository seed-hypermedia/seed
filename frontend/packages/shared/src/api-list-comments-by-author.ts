import {loadAccounts} from './api-account'
import {HMRequestImplementation} from './api-types'
import {BIG_INT} from './constants'
import {GRPCClient} from './grpc-client'
import {
  HMComment,
  HMCommentSchema,
  HMListCommentsByAuthorRequest,
  HMMetadataPayload,
} from './hm-types'

function parseComment(rawComment: any): HMComment | null {
  const commentJson =
    typeof rawComment.toJson === 'function'
      ? rawComment.toJson({emitDefaultValues: true, enumAsInteger: false})
      : rawComment

  const parsed = HMCommentSchema.safeParse(commentJson)
  if (!parsed.success) {
    console.error('Failed to parse comment:', parsed.error)
    return null
  }
  return parsed.data
}

export const ListCommentsByAuthor: HMRequestImplementation<HMListCommentsByAuthorRequest> =
  {
    async getData(
      grpcClient: GRPCClient,
      input,
    ): Promise<HMListCommentsByAuthorRequest['output']> {
      const res = await grpcClient.comments.listCommentsByAuthor({
        author: input.authorId.uid,
        pageSize: BIG_INT,
      })

      const comments: HMComment[] = []
      res.comments.forEach((c) => {
        const parsed = parseComment(c)
        if (parsed) {
          comments.push(parsed)
        }
      })

      // Extract unique author UIDs
      const authorUids = new Set<string>()
      comments.forEach((comment) => {
        if (comment.author && comment.author.trim() !== '') {
          authorUids.add(comment.author)
        }
      })

      const authorAccountUids = Array.from(authorUids)
      const authors: Record<string, HMMetadataPayload> =
        authorAccountUids.length > 0
          ? await loadAccounts(grpcClient, authorAccountUids)
          : {}

      return {
        comments,
        authors,
      }
    },
  }
