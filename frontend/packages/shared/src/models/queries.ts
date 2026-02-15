/**
 * Shared query objects for React Query.
 *
 * These functions return query options compatible with both useQuery() and prefetchQuery().
 * They accept a UniversalClient instance, enabling use in both SSR and client contexts.
 */

import type {
  HMAccountRequest,
  HMCapability,
  HMDocumentInfo,
  HMInteractionSummaryOutput,
  HMInteractionSummaryRequest,
  HMListCapabilitiesRequest,
  HMListChangesOutput,
  HMListChangesRequest,
  HMListCitationsOutput,
  HMListCitationsRequest,
  HMListCommentsOutput,
  HMListCommentsRequest,
  HMMetadataPayload,
  HMQueryRequest,
  HMRawCapability,
  HMResource,
  HMResourceRequest,
  HMRole,
  UnpackedHypermediaId,
} from '../hm-types'
import {HMQueryResultSchema, HMResourceSchema} from '../hm-types'
import type {UniversalClient} from '../universal-client'
import {hmIdPathToEntityQueryPath} from '../utils'
import {hmId} from '../utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '../utils/path-api'
import {queryKeys} from './query-keys'

function rawRoleToHMRole(role?: string): HMRole {
  if (role === 'WRITER') return 'writer'
  if (role === 'AGENT') return 'agent'
  return 'none'
}

function parseTimestamp(ts?: string): {seconds: number; nanos: number} {
  if (!ts) return {seconds: 0, nanos: 0}
  const ms = new Date(ts).getTime()
  return {seconds: Math.floor(ms / 1000), nanos: (ms % 1000) * 1_000_000}
}

function rawCapToHMCapability(raw: HMRawCapability): HMCapability | null {
  if (!raw.delegate || !raw.account) return null
  return {
    id: raw.id || '',
    accountUid: raw.delegate,
    role: rawRoleToHMRole(raw.role),
    grantId: hmId(raw.account, {
      path: entityQueryPathToHmIdPath(raw.path),
    }),
    label: raw.label,
    createTime: parseTimestamp(raw.createTime),
  }
}

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
      try {
        const res = await client.request<HMResourceRequest>('Resource', id)
        return HMResourceSchema.parse(res)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return {type: 'error', id, message}
      }
    },
    enabled: !!id,
  }
}

/**
 * Query options for fetching account metadata.
 * Returns HMMetadataPayload or null (handles not-found internally).
 */
export function queryAccount(
  client: UniversalClient,
  uid: string | null | undefined,
) {
  return {
    queryKey: [queryKeys.ACCOUNT, uid] as const,
    queryFn: async (): Promise<HMMetadataPayload | null> => {
      if (!uid) return null
      const result = await client.request<HMAccountRequest>('Account', uid)
      if (result.type === 'account-not-found') return null
      return result
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
 * Returns deduplicated HMCapability[] including a synthetic owner entry.
 */
export function queryCapabilities(
  client: UniversalClient,
  targetId: UnpackedHypermediaId | null | undefined,
) {
  return {
    queryKey: [
      queryKeys.CAPABILITIES,
      targetId?.uid,
      ...(targetId?.path || []),
    ] as const,
    queryFn: async (): Promise<HMCapability[]> => {
      if (!targetId) throw new Error('ID required')
      const result = await client.request<HMListCapabilitiesRequest>(
        'ListCapabilities',
        {targetId},
      )
      const visitedCaps = new Set<string>()
      const caps: HMCapability[] = []
      for (const raw of result.capabilities) {
        const key = `${raw.delegate}-${raw.role}`
        if (visitedCaps.has(key)) continue
        visitedCaps.add(key)
        const cap = rawCapToHMCapability(raw)
        if (cap) caps.push(cap)
      }
      caps.push({
        id: '_owner',
        accountUid: targetId.uid,
        role: 'owner',
        grantId: hmId(targetId.uid),
        label: 'Owner',
        createTime: {seconds: 0, nanos: 0},
      })
      return caps
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
