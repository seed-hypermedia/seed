import type {HMRequest, UnpackedHypermediaId} from './hm-types'
import type {RecentsResult} from './models/recents'

export type {RecentsResult}

// Platform-agnostic client interface for universal data operations
export type UniversalClient = {
  // Comment editor component (platform-specific)
  CommentEditor: React.ComponentType<{docId: UnpackedHypermediaId}>

  fetchRecents(): Promise<RecentsResult[]>

  deleteRecent(id: string): Promise<void>

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
