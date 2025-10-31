import {UseQueryResult} from '@tanstack/react-query'
import type {
  HMAccountsMetadata,
  HMDocumentInfo,
  HMResource,
  UnpackedHypermediaId,
} from './hm-types'
import type {Contact} from './client/grpc-types'

export type {Contact}

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
    id: UnpackedHypermediaId,
    options?: {mode?: string},
  ): UseQueryResult<HMDocumentInfo[]>

  // Contacts (desktop: useSelectedAccountContacts, web: null)
  useContacts(): UseQueryResult<Contact[] | null>

  // Accounts metadata batch loader
  useAccountsMetadata(uids: string[]): HMAccountsMetadata

  // Comment editor component (platform-specific)
  CommentEditor: React.ComponentType<{docId: UnpackedHypermediaId}>
}
