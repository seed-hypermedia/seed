import {UseQueryResult} from '@tanstack/react-query'
import type {HMRequest, HMResource, UnpackedHypermediaId} from './hm-types'
import type {RecentsResult} from './models/recents'

export type {RecentsResult}

// Platform-agnostic client interface for universal data operations
export type UniversalClient = {
  // Resource loading (desktop: useSubscribedResource, web: useResource)
  useResource(
    id: UnpackedHypermediaId | null | undefined,
    options?: {recursive?: boolean},
  ): UseQueryResult<HMResource | null>

  // Batch resource loading
  useResources(
    ids: (UnpackedHypermediaId | null | undefined)[],
  ): UseQueryResult<HMResource | null>[]

  // Comment editor component (platform-specific)
  CommentEditor: React.ComponentType<{docId: UnpackedHypermediaId}>

  fetchRecents(): Promise<RecentsResult[]>

  deleteRecent(id: string): Promise<void>

  request<Request extends HMRequest>(
    key: Request['key'],
    input: Request['input'],
  ): Promise<Request['output']>
}
