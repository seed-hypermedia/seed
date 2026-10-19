import {unpackHmId, type HMMentionCandidate, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useQuery} from '@tanstack/react-query'
import {useCallback, useMemo} from 'react'
import {getContactMetadata, getDocumentTitle} from '../content'
import {useUniversalAppContext, useUniversalClient} from '../routing'
import type {UniversalClient} from '../universal-client'
import {hmId} from '../utils/entity-id-url'
import {useAccounts, useResources} from './entity'
import {rankMentionCandidates, type MentionThreadContext} from './mention-ranking'
import {getQueryClient} from './query-client'
import {queryKeys} from './query-keys'

/** Flat mention suggestions shared by desktop and mobile pickers. */
export type InlineMentionsResult = HMMentionCandidate[]
/** Context for mode-specific personalized mention suggestions. */
export type InlineMentionOptions = {
  mode?: 'account' | 'document'
  siteUid?: string
  documentId?: UnpackedHypermediaId
  thread?: MentionThreadContext
}
/** Fresh empty result for reset state. */
export function emptyInlineMentions(): InlineMentionsResult {
  return []
}

/** Cached mention query with local-only visit ranking and bounded seed IDs. */
export function queryInlineMentions(
  client: UniversalClient,
  query: string,
  perspectiveAccountUid?: string,
  options: InlineMentionOptions = {},
) {
  const mode = options.mode || 'account'
  const thread =
    mode === 'account' && options.thread ? {...options.thread, selectedAccountUid: perspectiveAccountUid} : undefined
  return {
    queryKey: [
      queryKeys.SEARCH,
      'inlineMentions',
      perspectiveAccountUid ?? null,
      mode,
      options.siteUid ?? null,
      options.documentId?.id ?? null,
      query,
      thread ?? null,
    ] as const,
    staleTime: query ? 15_000 : 5 * 60_000,
    cacheTime: 30 * 60_000,
    // The picker owns its error and explicit Retry action, not the global toast/boundary.
    retry: false,
    useErrorBoundary: false,
    meta: {handlesErrorLocally: true},
    queryFn: async ({signal}: {signal?: AbortSignal} = {}): Promise<InlineMentionsResult> => {
      const recents = await getQueryClient().fetchQuery({
        queryKey: [queryKeys.RECENTS],
        queryFn: async () => {
          try {
            const result = await client.fetchRecents?.()
            return Array.isArray(result) ? result : []
          } catch {
            return []
          }
        },
      })
      const threadUids = [
        ...(thread?.replyAuthorUid ? [thread.replyAuthorUid] : []),
        ...(thread?.participants || [])
          .slice()
          .sort(
            (a, b) =>
              Number(!!b.isThreadAuthor) - Number(!!a.isThreadAuthor) ||
              (b.latestCommentTime ?? 0) - (a.latestCommentTime ?? 0),
          )
          .map((p) => p.uid),
      ]
      const seedIds = [
        ...Array.from(new Set(threadUids)).map((uid) => hmId(uid, {path: [':profile']})),
        ...recents.filter((r) => (mode === 'account') === (r.id.path?.[0] === ':profile')).map((r) => r.id),
      ]
      const seenSeeds = new Set<string>()
      const candidates = await client.request(
        'MentionCandidates',
        {
          query,
          mode,
          perspectiveAccountUid,
          siteUid: options.siteUid,
          documentId: options.documentId,
          seedIds: seedIds
            .filter((id) => {
              const key = mode === 'account' ? id.uid : id.id
              if (seenSeeds.has(key)) return false
              seenSeeds.add(key)
              return true
            })
            .slice(0, 20),
        },
        {signal},
      )
      return rankMentionCandidates(candidates, query, recents, Date.now(), thread)
    },
  }
}

/** Declarative mention search, with identical candidate ordering on all platforms. */
export function useInlineMentions(
  query: string,
  {
    enabled = true,
    perspectiveAccountUid,
    ...options
  }: InlineMentionOptions & {enabled?: boolean; perspectiveAccountUid?: string | null} = {},
) {
  const client = useUniversalClient()
  const result = useQuery({...queryInlineMentions(client, query, perspectiveAccountUid || undefined, options), enabled})
  return {
    suggestions: result.data ?? emptyInlineMentions(),
    isFetched: result.isFetched,
    isFetching: result.isFetching,
    isError: result.isError,
    refetch: result.refetch,
  }
}

/** Stable async fetcher backed by the shared query cache for the mention controller. */
export function useInlineMentionsSearch(thread?: MentionThreadContext) {
  const client = useUniversalClient()
  return useCallback(
    async (
      query: string,
      perspectiveAccountUid?: string | null,
      options: InlineMentionOptions = {},
      signal?: AbortSignal,
    ) => {
      const queryOptions = queryInlineMentions(client, query, perspectiveAccountUid || undefined, {...options, thread})
      const cancel = () => void getQueryClient().cancelQueries({queryKey: queryOptions.queryKey, exact: true})
      signal?.addEventListener('abort', cancel, {once: true})
      try {
        return await getQueryClient().fetchQuery(queryOptions)
      } finally {
        signal?.removeEventListener('abort', cancel)
      }
    },
    [client, thread],
  )
}

/** An inline embed link whose display name should be loaded. */
export type MentionRef = {link: string; mentionKind?: 'account' | 'document'}

/** Loads display names for inline embed links. */
export function useMentionNames(mentionRefs: MentionRef[]): Record<string, string> {
  const {contacts} = useUniversalAppContext()
  const refs = useMemo(
    () =>
      Array.from(
        new Map(
          mentionRefs.map((ref) => [
            ref.mentionKind ? `${ref.mentionKind}:${ref.link}` : ref.link,
            {...ref, refId: unpackHmId(ref.link)},
          ]),
        ).values(),
      ),
    [mentionRefs],
  )
  const accountIds = useMemo(
    () =>
      refs.map(({refId, mentionKind}) =>
        mentionKind !== 'document' &&
        (mentionKind === 'account' || refId?.path?.[0] === ':profile' || !refId?.path?.length)
          ? refId?.path?.[0] === ':profile'
            ? refId.path[1] || refId.uid
            : refId?.uid
          : null,
      ),
    [refs],
  )
  const resourceIds = useMemo(
    () => refs.map(({refId}, index) => (accountIds[index] ? null : refId)),
    [refs, accountIds],
  )
  const accounts = useAccounts(accountIds)
  const resources = useResources(resourceIds, {subscribed: true})
  return useMemo(() => {
    const names: Record<string, string> = {}
    refs.forEach((ref, index) => {
      const key = ref.mentionKind ? `${ref.mentionKind}:${ref.link}` : ref.link
      const accountUid = accountIds[index]
      if (accountUid) {
        names[key] = getContactMetadata(accountUid, accounts[index]?.data?.metadata, contacts).name
      } else {
        const resource = resources[index]?.data
        if (resource?.type === 'document') names[key] = getDocumentTitle(resource.document)
      }
    })
    return names
  }, [refs, accountIds, accounts, resources, contacts])
}
