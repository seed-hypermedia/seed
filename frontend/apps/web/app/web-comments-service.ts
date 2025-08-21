import {
  CommentsService,
  ListCommentsByIdRequest,
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
    let queryUrl = `/hm/api/comments?targetId=${params.targetId.id}`
    let res = await queryAPI<ListCommentsResponse>(queryUrl)
    return res
  }
  async listDiscussions(
    params: ListDiscussionsRequest,
  ): Promise<ListDiscussionsResponse> {
    let queryUrl = `/hm/api/discussions?targetId=${params.targetId.id}`
    let res = await queryAPI<ListDiscussionsResponse>(queryUrl)
    return res
  }
  async listCommentsById(
    params: ListCommentsByIdRequest,
  ): Promise<ListCommentsResponse> {
    throw new Error('Method not implemented.')
  }
}
