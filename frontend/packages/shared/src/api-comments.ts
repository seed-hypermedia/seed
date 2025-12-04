import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {
  HMGetCommentReplyCountRequest,
  HMListCommentsByReferenceRequest,
  HMListCommentsRequest,
  HMListDiscussionsRequest,
} from './hm-types'
import {
  createCommentsByReferenceResolver,
  createCommentsResolver,
  createDiscussionsResolver,
} from './models/comments-resolvers'

export const ListComments: HMRequestImplementation<HMListCommentsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const loadComments = createCommentsResolver(grpcClient)
    return loadComments(input.targetId)
  },
}

export const ListDiscussions: HMRequestImplementation<HMListDiscussionsRequest> =
  {
    async getData(grpcClient: GRPCClient, input) {
      const loadDiscussions = createDiscussionsResolver(grpcClient)
      return loadDiscussions(input.targetId, input.commentId)
    },
  }

export const ListCommentsByReference: HMRequestImplementation<HMListCommentsByReferenceRequest> =
  {
    async getData(grpcClient: GRPCClient, input) {
      if (!input.targetId.blockRef) {
        throw new Error('blockRef is required for ListCommentsByReference')
      }
      const loadCommentsByReference =
        createCommentsByReferenceResolver(grpcClient)
      return loadCommentsByReference(input.targetId, input.targetId.blockRef)
    },
  }

export const GetCommentReplyCount: HMRequestImplementation<HMGetCommentReplyCountRequest> =
  {
    async getData(grpcClient: GRPCClient, input) {
      const response = await grpcClient.comments.getCommentReplyCount({
        id: input.id,
      })
      return Number(response.replyCount)
    },
  }
