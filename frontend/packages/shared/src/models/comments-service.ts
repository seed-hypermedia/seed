import {
  HMCommentGroup,
  HMCommentsPayload,
  HMExternalCommentGroup,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '../hm-types'

export type ListCommentsRequest = {
  targetId: UnpackedHypermediaId
  commentIds?: string[]
}

export type ListCommentsByIdRequest = {
  commentsIds: Array<string>
}

export type ListCommentsResponse = {
  comments: HMCommentsPayload['comments']
  authors: Record<string, HMMetadataPayload>
}

export type ListDiscussionsRequest = {
  targetId: UnpackedHypermediaId
  commentId?: string
}

export type ListDiscussionsResponse = {
  discussions: Array<HMCommentGroup>
  authors: Record<string, HMMetadataPayload>
  citingDiscussions: Array<HMExternalCommentGroup>
}

export type ListCommentsByReferenceRequest = {
  targetId: UnpackedHypermediaId
}

export type ListCommentsByReferenceResponse = ListCommentsResponse

export interface CommentsService {
  /**
   * Raw comment operations - returns flat list of comments
   * Used for low-level operations and as building blocks for discussions
   */
  listComments(params: ListCommentsRequest): Promise<ListCommentsResponse>

  /**
   * All Discussions - returns comment groups with authors metadata
   * This is the main view showing all discussions for a document or a particular target comment
   * Web: matches /hm/api/discussions response
   * Desktop: processes raw comments into groups + fetches authors
   */
  listDiscussions(
    params: ListDiscussionsRequest,
  ): Promise<ListDiscussionsResponse>

  /**
   * List comments by IDs - returns comments with authors metadata
   * Used for low-level operations and as building blocks for discussions
   * Uses the BatchGetComments RPC
   */
  listCommentsById(
    params: ListCommentsByIdRequest,
  ): Promise<ListCommentsResponse>

  //   getCommentsById(commentIds: string[]): Promise<Array<HMCommentGroup>>
  //   getCommentsByAuthor(authorId: string): Promise<Array<HMCommentGroup>>

  //   publishComment(comment: HMComment): Promise<HMComment>
  //   deleteComment(commentId: string): Promise<void>

  //    onCopy(commentId: string): Promise<void>
  //    onReply(commentId: string): Promise<void>
  //    onReplyCount(commentId: string): Promise<number>

  /**
   * List comments by reference - returns comments with authors metadata
   * This is used for the view when a block is focused in the discussions panel.
   * Uses the BatchGetComments RPC
   */
  listCommentsByReference(
    params: ListCommentsByReferenceRequest,
  ): Promise<ListCommentsByReferenceResponse>
}
