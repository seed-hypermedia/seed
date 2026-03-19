import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {
  HMComment,
  HMCommentSchema,
  HMGetCommentReplyCountRequest,
  HMListCommentsByReferenceRequest,
  HMListCommentsRequest,
  HMListCommentVersionsRequest,
  HMListDiscussionsRequest,
} from '@seed-hypermedia/client/hm-types'
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

export const ListDiscussions: HMRequestImplementation<HMListDiscussionsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const loadDiscussions = createDiscussionsResolver(grpcClient)
    return loadDiscussions(input.targetId, input.commentId)
  },
}

export const ListCommentsByReference: HMRequestImplementation<HMListCommentsByReferenceRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    if (!input.targetId.blockRef) {
      throw new Error('blockRef is required for ListCommentsByReference')
    }
    const loadCommentsByReference = createCommentsByReferenceResolver(grpcClient)
    return loadCommentsByReference(input.targetId, input.targetId.blockRef)
  },
}

export const GetCommentReplyCount: HMRequestImplementation<HMGetCommentReplyCountRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const response = await grpcClient.comments.getCommentReplyCount({
      id: input.id,
    })
    return Number(response.replyCount)
  },
}

/** Lists all versions (edit history) of a comment. */
export const ListCommentVersions: HMRequestImplementation<HMListCommentVersionsRequest> = {
  async getData(grpcClient: GRPCClient, input) {
    const response = await grpcClient.comments.listCommentVersions({
      id: input.id,
    })
    const versions: HMComment[] = []
    for (const raw of response.versions) {
      const json = typeof raw.toJson === 'function' ? raw.toJson({emitDefaultValues: true, enumAsInteger: false}) : raw
      const parsed = HMCommentSchema.safeParse(json)
      if (parsed.success) {
        versions.push(parsed.data)
      }
    }
    return {versions}
  },
}
