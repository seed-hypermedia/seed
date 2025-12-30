/**
 * Shared query objects for React Query.
 *
 * These functions return query options compatible with both useQuery() and prefetchQuery().
 * They accept a UniversalClient instance, enabling use in both SSR and client contexts.
 */

import type {
  HMAccountRequest,
  HMDocumentInfo,
  HMInteractionSummaryOutput,
  HMInteractionSummaryRequest,
  HMListCapabilitiesOutput,
  HMListCapabilitiesRequest,
  HMListChangesOutput,
  HMListChangesRequest,
  HMListCitationsOutput,
  HMListCitationsRequest,
  HMListCommentsOutput,
  HMListCommentsRequest,
  HMMetadataPayload,
  HMQueryRequest,
  HMResource,
  HMResourceRequest,
  UnpackedHypermediaId,
} from '../hm-types'
import {HMQueryResultSchema, HMResourceSchema} from '../hm-types'
import type {UniversalClient} from '../universal-client'
import {hmIdPathToEntityQueryPath} from '../utils'
import {queryKeys} from './query-keys'

/**
 * Query options for fetching a resource (document, comment, etc.)
 */
export function queryResource(
  client: UniversalClient,
  id: UnpackedHypermediaId | null | undefined,
) {
  const version = id?.version || undefined
  return {
    queryKey: [queryKeys.ENTITY, id?.id, version] as const,
    queryFn: async (): Promise<HMResource | null> => {
      if (!id) return null
      const res = await client.request<HMResourceRequest>('Resource', id)
      return HMResourceSchema.parse(res)
    },
    enabled: !!id,
  }
}

/**
 * Query options for fetching account metadata.
 */
export function queryAccount(
  client: UniversalClient,
  uid: string | null | undefined,
) {
  return {
    queryKey: [queryKeys.ACCOUNT, uid] as const,
    queryFn: async (): Promise<HMMetadataPayload | null> => {
      if (!uid) return null
      return await client.request<HMAccountRequest>('Account', uid)
    },
    enabled: !!uid,
  }
}

/**
 * Query options for fetching directory listing.
 */
export function queryDirectory(
  client: UniversalClient,
  id: UnpackedHypermediaId | null | undefined,
  mode: 'Children' | 'AllDescendants' = 'Children',
) {
  return {
    queryKey: [queryKeys.DOC_LIST_DIRECTORY, id?.id, mode] as const,
    queryFn: async (): Promise<HMDocumentInfo[]> => {
      if (!id) return []
      const result = await client.request<HMQueryRequest>('Query', {
        includes: [
          {
            space: id.uid,
            mode,
            path: hmIdPathToEntityQueryPath(id.path),
          },
        ],
      })
      if (!result) return []
      return HMQueryResultSchema.parse(result).results
    },
    enabled: !!id,
  }
}

/**
 * Query options for fetching comments on a target.
 */
export function queryComments(
  client: UniversalClient,
  targetId: UnpackedHypermediaId | null | undefined,
) {
  return {
    queryKey: [queryKeys.COMMENTS, targetId?.id] as const,
    queryFn: async (): Promise<HMListCommentsOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request<HMListCommentsRequest>('ListComments', {
        targetId,
      })
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching citations to a target.
 */
export function queryCitations(
  client: UniversalClient,
  targetId: UnpackedHypermediaId | null | undefined,
) {
  return {
    queryKey: [queryKeys.CITATIONS, targetId?.id] as const,
    queryFn: async (): Promise<HMListCitationsOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request<HMListCitationsRequest>('ListCitations', {
        targetId,
      })
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching changes to a target.
 */
export function queryChanges(
  client: UniversalClient,
  targetId: UnpackedHypermediaId | null | undefined,
) {
  return {
    queryKey: [queryKeys.CHANGES, targetId?.id] as const,
    queryFn: async (): Promise<HMListChangesOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request<HMListChangesRequest>('ListChanges', {
        targetId,
      })
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching capabilities on a target.
 */
export function queryCapabilities(
  client: UniversalClient,
  targetId: UnpackedHypermediaId | null | undefined,
) {
  return {
    queryKey: [queryKeys.CAPABILITIES, targetId?.id] as const,
    queryFn: async (): Promise<HMListCapabilitiesOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request<HMListCapabilitiesRequest>(
        'ListCapabilities',
        {targetId},
      )
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching interaction summary for a document.
 */
export function queryInteractionSummary(
  client: UniversalClient,
  id: UnpackedHypermediaId | null | undefined,
) {
  return {
    queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY, id?.id] as const,
    queryFn: async (): Promise<HMInteractionSummaryOutput> => {
      if (!id) {
        return {
          citations: 0,
          comments: 0,
          changes: 0,
          children: 0,
          blocks: {},
        }
      }
      return await client.request<HMInteractionSummaryRequest>(
        'InteractionSummary',
        {id},
      )
    },
    enabled: !!id,
  }
}
