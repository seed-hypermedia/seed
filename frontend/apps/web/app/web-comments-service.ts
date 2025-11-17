import {
  CommentsService,
  DeleteCommentRequest,
  GetReplyCountRequest,
  GetReplyCountResponse,
  ListCommentsByIdRequest,
  ListCommentsByReferenceRequest,
  ListCommentsRequest,
  ListCommentsResponse,
  ListDiscussionsRequest,
  ListDiscussionsResponse,
} from '@shm/shared/models/comments-service'
import {queryAPI} from './models'

export class WebCommentsService implements CommentsService {
  async listComments(
    params: ListCommentsRequest,
  ): Promise<ListCommentsResponse> {
    try {
      let queryUrl = `/hm/api/comments?targetId=${params.targetId.id}`
      let res = await queryAPI<ListCommentsResponse | {error: string}>(queryUrl)

      if ('error' in res) {
        console.error('API returned error for comments:', res.error)
        return {comments: [], authors: {}}
      }

      return res
    } catch (error) {
      console.error('Failed to load comments:', error)
      return {comments: [], authors: {}}
    }
  }
  async listDiscussions(
    params: ListDiscussionsRequest,
  ): Promise<ListDiscussionsResponse> {
    try {
      let queryUrl = `/hm/api/discussions?targetId=${params.targetId.id}`
      let res = await queryAPI<ListDiscussionsResponse | {error: string}>(
        queryUrl,
      )

      if ('error' in res) {
        console.error('API returned error for discussions:', res.error)
        return {discussions: [], authors: {}, citingDiscussions: []}
      }

      return res
    } catch (error) {
      console.error('Failed to load discussions:', error)
      return {discussions: [], authors: {}, citingDiscussions: []}
    }
  }

  async listCommentsById(
    params: ListCommentsByIdRequest,
  ): Promise<ListCommentsResponse> {
    throw new Error('Method not implemented.')
  }

  async listCommentsByReference(
    params: ListCommentsByReferenceRequest,
  ): Promise<ListCommentsResponse> {
    try {
      let queryUrl = `/hm/api/block-discussions?targetId=${params.targetId.id}&blockId=${params.targetId.blockRef}`
      let res = await queryAPI<ListCommentsResponse | {error: string}>(queryUrl)

      if ('error' in res) {
        console.error('API returned error for block discussions:', res.error)
        return {comments: [], authors: {}}
      }

      return res
    } catch (error) {
      console.error('Failed to load block discussions:', error)
      return {comments: [], authors: {}}
    }
  }

  async deleteComment(params: DeleteCommentRequest): Promise<void> {
    // TODO: Implement when web API endpoint is available
    // Would be something like:
    // await fetch(`/hm/api/comments/${params.commentId}`, { method: 'DELETE' })
    throw new Error('Delete comment not yet implemented for web')
  }

  useHackyAuthorsSubscriptions(authorIds: string[]) {
    // no-op on web, we expect that author info will be pushed to the server already.
  }

  async getReplyCount(
    params: GetReplyCountRequest,
  ): Promise<GetReplyCountResponse> {
    try {
      let queryUrl = `/hm/api/comment-reply-count?targetId=${params.id}`
      let res = await queryAPI<number | {error: string}>(queryUrl)

      if (typeof res != 'number') {
        console.error('API returned error for discussions:', res.error)
        return 0
      }

      return res
    } catch (error) {
      console.error('Failed to load discussions:', error)
      return 0
    }
  }
}
