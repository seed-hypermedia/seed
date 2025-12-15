import type {
  DiscoveryState,
  HMListedDraft,
  HMRequest,
  UnpackedHypermediaId,
} from './hm-types'
import type {RecentsResult} from './models/recents'
import type {StateStream} from './utils/stream'

export type {RecentsResult}

// Drafts service for querying drafts (desktop only)
export type DraftsService = {
  listAccountDrafts: (
    accountUid: string | undefined,
  ) => Promise<HMListedDraft[]>
}

export type DeleteCommentInput = {
  commentId: string
  targetDocId: UnpackedHypermediaId
  signingAccountId: string
}

// Discovery service for tracking entity discovery state
export type DiscoveryService = {
  getDiscoveryStream: (entityId: string) => StateStream<DiscoveryState | null>
}

// Platform-agnostic client interface for universal data operations
export type UniversalClient = {
  // Comment editor component (platform-specific)
  CommentEditor?: React.ComponentType<{docId: UnpackedHypermediaId}>

  fetchRecents?: () => Promise<RecentsResult[]>

  deleteRecent?: (id: string) => Promise<void>

  // Delete a comment (desktop-only, requires signing key)
  deleteComment?: (input: DeleteCommentInput) => Promise<void>

  request<Request extends HMRequest>(
    key: Request['key'],
    input: Request['input'],
  ): Promise<Request['output']>

  // Discovery subscription (desktop only - no-op on web)
  subscribeEntity?: (opts: {
    id: UnpackedHypermediaId
    recursive?: boolean
  }) => () => void

  // Discovery state tracking (desktop only - undefined on web)
  discovery?: DiscoveryService

  // Drafts service (desktop only - undefined on web)
  drafts?: DraftsService
}
