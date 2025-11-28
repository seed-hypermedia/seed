import {UseQueryResult} from '@tanstack/react-query'
import type {Contact} from './client/grpc-types'
import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMMetadataPayload,
  HMQuery,
  HMQueryResult,
  HMResource,
  UnpackedHypermediaId,
} from './hm-types'
import type {RecentsResult} from './models/recents'
import type {SearchPayload} from './models/search'

export type {Contact, RecentsResult, SearchPayload}

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

  // Directory listing (desktop: useListDirectory, web: context-based)
  useDirectory(
    id: UnpackedHypermediaId | null | undefined,
    options?: {mode?: string},
  ): UseQueryResult<HMDocumentInfo[]>

  // Contacts (desktop: useSelectedAccountContacts, web: null)
  useContacts(): UseQueryResult<Contact[] | null>

  // Accounts metadata batch loader
  useAccountsMetadata(uids: string[]): HMAccountsMetadata

  // Comment editor component (platform-specific)
  CommentEditor: React.ComponentType<{docId: UnpackedHypermediaId}>

  fetchSearch(
    query: string,
    opts?: {
      accountUid?: string
      perspectiveAccountUid?: string
      includeBody?: boolean
      contextSize?: number
    },
  ): Promise<SearchPayload>

  fetchResource(id: UnpackedHypermediaId): Promise<HMResource>

  fetchAccount(accountUid: string): Promise<HMMetadataPayload>

  fetchBatchAccounts(
    accountUids: string[],
  ): Promise<Record<string, HMMetadataPayload>>

  fetchRecents(): Promise<RecentsResult[]>

  fetchQuery(query: HMQuery): Promise<HMQueryResult | null>

  deleteRecent(id: string): Promise<void>
}
