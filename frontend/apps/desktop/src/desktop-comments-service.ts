import {
  createCommentsByIdResolver,
  createCommentsByReferenceResolver,
  createCommentsResolver,
  createDiscussionsResolver,
  hmId,
} from '@shm/shared'
import {
  CommentsService,
  DeleteCommentRequest,
  getCommentReplyCountImpl,
  GetReplyCountRequest,
  GetReplyCountResponse,
  ListCommentsByIdRequest,
  ListCommentsByReferenceRequest,
  ListCommentsByReferenceResponse,
  ListCommentsRequest,
  ListCommentsResponse,
  ListDiscussionsRequest,
  ListDiscussionsResponse,
} from '@shm/shared/models/comments-service'
import {useMemo} from 'react'
import {grpcClient} from './grpc-client'
import {useSubscribedResources} from './models/entities'

const loadComments = createCommentsResolver(grpcClient)
const loadDiscussions = createDiscussionsResolver(grpcClient)
const loadCommentsByReference = createCommentsByReferenceResolver(grpcClient)
const loadCommentsById = createCommentsByIdResolver(grpcClient)

export class DesktopCommentsService implements CommentsService {
  async listComments(
    params: ListCommentsRequest,
  ): Promise<ListCommentsResponse> {
    return await loadComments(params.targetId)
  }

  async listDiscussions(
    params: ListDiscussionsRequest,
  ): Promise<ListDiscussionsResponse> {
    return await loadDiscussions(params.targetId, params.commentId)
  }

  useHackyAuthorsSubscriptions(authorIds: string[]) {
    useSubscribedResources(
      useMemo(
        () => authorIds.map((id) => ({id: hmId(id), recusive: false})),
        [authorIds],
      ),
    )
  }

  async listCommentsById(
    params: ListCommentsByIdRequest,
  ): Promise<ListCommentsResponse> {
    return await loadCommentsById(params.commentsIds)
  }

  async listCommentsByReference(
    params: ListCommentsByReferenceRequest,
  ): Promise<ListCommentsByReferenceResponse> {
    if (!params.targetId.blockRef) {
      throw new Error('blockRef is required for listCommentsByReference')
    }
    return await loadCommentsByReference(
      params.targetId,
      params.targetId.blockRef,
    )
  }

  async deleteComment(params: DeleteCommentRequest): Promise<void> {
    await grpcClient.comments.deleteComment({
      id: params.commentId,
      signingKeyName: params.signingAccountId,
    })
  }

  getReplyCount(params: GetReplyCountRequest): Promise<GetReplyCountResponse> {
    return getCommentReplyCountImpl({client: grpcClient, params})
  }
}
