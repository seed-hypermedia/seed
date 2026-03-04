import type {
  DiscoveryState,
  HMListedDraft,
  HMPrepareDocumentChangeInput,
  HMRequest,
  HMSigner,
  UnpackedHypermediaId,
} from './hm-types'
import type {RecentsResult} from './models/recents'
import type {StateStream} from './utils/stream'

export type PublishDocumentInput = {
  account: string
  signerAccountUid: string
  changes: HMPrepareDocumentChangeInput['changes']
  path?: string
  baseVersion?: string
  genesis?: string
  generation?: number | bigint
  capability?: string
  visibility?: number
}

export type {RecentsResult}

// Drafts service for querying drafts (desktop only)
export type DraftsService = {
  listAccountDrafts: (accountUid: string | undefined) => Promise<HMListedDraft[]>
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

  request<K extends HMRequest['key']>(
    key: K,
    input: Extract<HMRequest, {key: K}>['input'],
  ): Promise<Extract<HMRequest, {key: K}>['output']>
  publish: (
    input: Extract<HMRequest, {key: 'PublishBlobs'}>['input'],
  ) => Promise<Extract<HMRequest, {key: 'PublishBlobs'}>['output']>

  // Discovery subscription (desktop only - no-op on web)
  subscribeEntity?: (opts: {id: UnpackedHypermediaId; recursive?: boolean}) => () => void

  // Discovery state tracking (desktop only - undefined on web)
  discovery?: DiscoveryService

  // Drafts service (desktop only - undefined on web)
  drafts?: DraftsService

  // Platform-specific signing
  getSigner?: (accountUid: string) => HMSigner

  // Combined prepare + sign + publish in one call
  publishDocument?: (input: PublishDocumentInput) => Promise<void>
}
