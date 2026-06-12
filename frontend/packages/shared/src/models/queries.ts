/**
 * Shared query objects for React Query.
 *
 * These functions return query options compatible with both useQuery() and prefetchQuery().
 * They accept a UniversalClient instance, enabling use in both SSR and client contexts.
 */

import type {
  HMDomainInfo,
  HMCapability,
  HMContactRecord,
  HMDocumentInfo,
  HMInteractionSummaryOutput,
  HMQueryBlockInput,
  HMQueryBlockPayload,
  HMListChangesOutput,
  HMListCitationsOutput,
  HMListCommentVersionsOutput,
  HMListCommentsOutput,
  HMListDiscussionsOutput,
  HMListDocumentCollaboratorsOutput,
  HMMetadataPayload,
  HMRawCapability,
  HMResource,
  HMRole,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {HMQueryBlockPayloadSchema, HMQueryResultSchema, HMResourceSchema} from '@seed-hypermedia/client/hm-types'
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

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError'
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
export function queryResource(client: UniversalClient, id: UnpackedHypermediaId | null | undefined) {
  const version = id?.version || undefined
  const latest = id?.latest || false
  return {
    queryKey: [queryKeys.ENTITY, id?.id, version, latest] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMResource | null> => {
      if (!id) return null
      try {
        let res = await client.request('Resource', id, {signal})
        let republishSourceId: UnpackedHypermediaId | null = null
        // Follow redirects automatically so consumers never see {type: 'redirect'}.
        // Republish refs are special: they should render the target content while
        // preserving the source route/ID, so the omnibar and navigation stay on
        // the republished path instead of being treated like a move redirect.
        let maxRedirects = 5
        while (res?.type === 'redirect' && maxRedirects-- > 0) {
          const nextTarget = {
            ...res.redirectTarget,
            hostname: res.redirectTarget.hostname || res.id.hostname || id.hostname,
          }
          if (res.republish && !republishSourceId) {
            republishSourceId = res.id
          }
          res = await client.request('Resource', nextTarget, {signal})
        }
        if (res?.type === 'redirect') {
          return {type: 'error', id, message: 'Too many redirects while resolving resource'}
        }
        const parsed = HMResourceSchema.parse(res)
        if (republishSourceId && (parsed.type === 'document' || parsed.type === 'comment') && !id.hostname) {
          return {
            ...parsed,
            id: republishSourceId,
          }
        }
        return parsed
      } catch (e) {
        if (isAbortError(e)) throw e
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
export function queryAccount(client: UniversalClient, uid: string | null | undefined) {
  return {
    queryKey: [queryKeys.ACCOUNT, uid] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMMetadataPayload | null> => {
      if (!uid) return null
      const result = await client.request('Account', uid, {signal})
      if (result.type === 'account-not-found') return null
      return result
    },
    enabled: !!uid,
  }
}

/**
 * Query options for fetching tracked domain information.
 * Returns null when the domain is unknown or the lookup fails.
 */
export function queryDomain(client: UniversalClient, domain: string | null | undefined, forceCheck = false) {
  return {
    queryKey: [queryKeys.DOMAIN, domain, forceCheck] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMDomainInfo | null> => {
      if (!domain) return null
      try {
        return await client.request('GetDomain', forceCheck ? {domain, forceCheck: true} : {domain}, {signal})
      } catch (error) {
        if (isAbortError(error)) throw error
        return null
      }
    },
    enabled: !!domain,
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
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMDocumentInfo[]> => {
      if (!id) return []
      const result = await client.request(
        'Query',
        {
          includes: [
            {
              space: id.uid,
              mode,
              path: hmIdPathToEntityQueryPath(id.path),
            },
          ],
        },
        {signal},
      )
      if (!result) return []
      return HMQueryResultSchema.parse(result).results
    },
    enabled: !!id,
  }
}

/**
 * Query options for fetching all metadata needed to render a query block.
 */
export function queryQueryBlock(client: UniversalClient, input: HMQueryBlockInput | null | undefined) {
  return {
    queryKey: [queryKeys.QUERY_BLOCK, input?.query ?? null] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMQueryBlockPayload | null> => {
      if (!input) return null
      const result = await client.request('QueryBlock', input, {signal})
      if (!result) return null
      return HMQueryBlockPayloadSchema.parse(result)
    },
    enabled: !!input,
  }
}

/**
 * Query options for fetching comments on a target.
 */
export function queryComments(client: UniversalClient, targetId: UnpackedHypermediaId | null | undefined) {
  return {
    queryKey: [queryKeys.COMMENTS, targetId?.id] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListCommentsOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request(
        'ListComments',
        {
          targetId,
        },
        {signal},
      )
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching the main comments list used by document comment views.
 */
export function queryDocumentComments(client: UniversalClient, targetId: UnpackedHypermediaId) {
  return {
    queryKey: [queryKeys.DOCUMENT_COMMENTS, targetId] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListCommentsOutput> => {
      try {
        return await client.request('ListComments', {targetId}, {signal})
      } catch (error) {
        console.error('Error fetching comments:', error)
        throw error
      }
    },
    retry: 1,
    staleTime: 30_000,
  }
}

/**
 * Query options for fetching grouped discussions on a document or focused comment.
 */
export function queryDocumentDiscussions(client: UniversalClient, targetId: UnpackedHypermediaId, commentId?: string) {
  return {
    queryKey: [queryKeys.DOCUMENT_DISCUSSION, targetId, commentId] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListDiscussionsOutput> => {
      try {
        return await client.request('ListDiscussions', {targetId, commentId}, {signal})
      } catch (error) {
        console.error('Error fetching discussions:', error)
        throw error
      }
    },
    retry: 1,
    staleTime: 30_000,
  }
}

/**
 * Query options for fetching comments that reference a specific document block.
 */
export function queryBlockDiscussions(client: UniversalClient, targetId: UnpackedHypermediaId) {
  return {
    queryKey: [queryKeys.BLOCK_DISCUSSIONS, targetId] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListCommentsOutput> => {
      try {
        return await client.request('ListCommentsByReference', {targetId}, {signal})
      } catch (error) {
        console.error('Error fetching block discussions:', error)
        throw error
      }
    },
    retry: 1,
    staleTime: 30_000,
  }
}

/**
 * Query options for fetching all versions of a comment.
 */
export function queryCommentVersions(client: UniversalClient, commentId: string | null | undefined) {
  return {
    queryKey: [queryKeys.COMMENT_VERSIONS, commentId] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListCommentVersionsOutput> => {
      return await client.request('ListCommentVersions', {id: commentId!}, {signal})
    },
    enabled: !!commentId,
    useErrorBoundary: false,
    staleTime: 60_000,
  }
}

/**
 * Query options for fetching a comment's reply count.
 */
export function queryCommentReplyCount(client: UniversalClient, id: string) {
  return {
    queryKey: [queryKeys.COMMENT_REPLY_COUNT, id] as const,
    queryFn: ({signal}: {signal?: AbortSignal} = {}) =>
      client.request(
        'GetCommentReplyCount',
        {
          id,
        },
        {signal},
      ),
    retry: 1,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  }
}

/**
 * Query options for fetching citations to a target.
 */
export function queryCitations(client: UniversalClient, targetId: UnpackedHypermediaId | null | undefined) {
  return {
    queryKey: [queryKeys.CITATIONS, targetId?.id] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListCitationsOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request(
        'ListCitations',
        {
          targetId,
        },
        {signal},
      )
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching changes to a target.
 */
export function queryChanges(client: UniversalClient, targetId: UnpackedHypermediaId | null | undefined) {
  return {
    queryKey: [queryKeys.CHANGES, targetId?.id] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListChangesOutput> => {
      if (!targetId) throw new Error('ID required')
      return await client.request(
        'ListChanges',
        {
          targetId,
        },
        {signal},
      )
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching capabilities on a target.
 * Returns deduplicated HMCapability[] including a synthetic owner entry.
 */
export function queryCapabilities(client: UniversalClient, targetId: UnpackedHypermediaId | null | undefined) {
  return {
    queryKey: [queryKeys.CAPABILITIES, targetId?.uid, ...(targetId?.path || [])] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMCapability[]> => {
      if (!targetId) throw new Error('ID required')
      const result = await client.request('ListCapabilities', {targetId}, {signal})
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
 * Query options for fetching collaborators with account metadata for a target.
 */
export function queryDocumentCollaborators(client: UniversalClient, targetId: UnpackedHypermediaId | null | undefined) {
  return {
    queryKey: [queryKeys.DOCUMENT_COLLABORATORS, targetId?.uid, ...(targetId?.path || [])] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMListDocumentCollaboratorsOutput | null> => {
      if (!targetId) return null
      return await client.request('ListDocumentCollaborators', {targetId}, {signal})
    },
    enabled: !!targetId,
  }
}

/**
 * Query options for fetching interaction summary for a document.
 */
export function queryInteractionSummary(client: UniversalClient, id: UnpackedHypermediaId | null | undefined) {
  return {
    queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY, id?.id] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMInteractionSummaryOutput> => {
      if (!id) {
        return {
          citations: 0,
          comments: 0,
          changes: 0,
          children: 0,
          authorUids: [],
          blocks: {},
        }
      }
      return await client.request('InteractionSummary', {id}, {signal})
    },
    enabled: !!id,
  }
}

/**
 * Query options for fetching contacts where the given account is the subject.
 */
export function queryContactsOfSubject(client: UniversalClient, uid: string | undefined) {
  return {
    queryKey: [queryKeys.CONTACTS_SUBJECT, uid] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMContactRecord[]> => {
      if (!uid) return []
      return client.request('SubjectContacts', uid, {signal})
    },
    enabled: !!uid,
  }
}

/**
 * Query options for fetching contacts owned by the given account.
 */
export function queryContactsOfAccount(client: UniversalClient, uid: string | null | undefined) {
  return {
    queryKey: [queryKeys.CONTACTS_ACCOUNT, uid] as const,
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<HMContactRecord[]> => {
      if (!uid) return []
      return client.request('AccountContacts', uid, {signal})
    },
    enabled: !!uid,
  }
}
