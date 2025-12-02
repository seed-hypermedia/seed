import type {HMRequest, UnpackedHypermediaId} from './hm-types'
import type {RecentsResult} from './models/recents'

export type {RecentsResult}

export type DeleteCommentInput = {
  commentId: string
  targetDocId: UnpackedHypermediaId
  signingAccountId: string
}

// Platform-agnostic client interface for universal data operations
export type UniversalClient = {
  // Comment editor component (platform-specific)
  CommentEditor: React.ComponentType<{docId: UnpackedHypermediaId}>

  fetchRecents(): Promise<RecentsResult[]>

  deleteRecent(id: string): Promise<void>

  // Delete a comment (desktop-only, requires signing key)
  deleteComment(input: DeleteCommentInput): Promise<void>

  request<Request extends HMRequest>(
    key: Request['key'],
    input: Request['input'],
  ): Promise<Request['output']>

  // Discovery subscription (desktop only - no-op on web)
  subscribeEntity?: (opts: {
    id: UnpackedHypermediaId
    recursive?: boolean
  }) => () => void
}
