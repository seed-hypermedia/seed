import {
  PlainMessage,
  Struct,
  Timestamp,
  toPlainMessage,
} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {
  useInfiniteQuery,
  useQueries,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query'
import {useEffect, useMemo, useRef, useState} from 'react'
import {DocumentInfo, RedirectErrorDetails} from '../client'
import {DISCOVERY_TIMEOUT_MS} from '../constants'
import {getContactMetadata} from '../content'
import {
  HMAccountContactsRequest,
  HMAccountsMetadata,
  HMContactRecord,
  HMDocumentInfo,
  HMDocumentInfoSchema,
  HMDocumentMetadataSchema,
  HMGetCIDOutput,
  HMGetCIDRequest,
  HMListAccountsOutput,
  HMListAccountsRequest,
  HMListCommentsByAuthorOutput,
  HMListCommentsByAuthorRequest,
  HMListedDraft,
  HMListEventsOutput,
  HMListEventsRequest,
  HMMetadata,
  HMMetadataPayload,
  HMResolvedResource,
  HMResource,
  HMResourceRequest,
  HMTimestamp,
  HMTimestampSchema,
  UnpackedHypermediaId,
} from '../hm-types'
import {useUniversalAppContext, useUniversalClient} from '../routing'
import {useStream} from '../use-stream'
import {entityQueryPathToHmIdPath, hmId, unpackHmId} from '../utils'
import {queryKeys} from './query-keys'
import {
  queryAccount,
  queryCapabilities,
  queryChanges,
  queryCitations,
  queryComments,
  queryDirectory,
  queryResource,
} from './queries'

export function documentMetadataParseAdjustments(metadata: any) {
  if (metadata?.theme === '[object Object]') {
    metadata.theme = undefined
  }
}

export function prepareHMDocumentMetadata(
  metadata: Struct | undefined,
): HMMetadata {
  const docMeta =
    metadata?.toJson({emitDefaultValues: true, enumAsInteger: false}) || {}
  documentMetadataParseAdjustments(docMeta)
  return HMDocumentMetadataSchema.parse(docMeta)
}

export function prepareHMDate(
  date: PlainMessage<Timestamp> | undefined,
): HMTimestamp | undefined {
  if (!date) return undefined
  const d = toPlainMessage(date)
  return HMTimestampSchema.parse(d)
}

export function prepareHMDocumentInfo(doc: DocumentInfo): HMDocumentInfo {
  const docInfo = toPlainMessage(doc)
  const path = entityQueryPathToHmIdPath(docInfo.path)
  const createTime = prepareHMDate(docInfo.createTime)
  let sortTime: Date
  if (!createTime) {
    sortTime = new Date(0)
  } else if (typeof createTime === 'string') {
    sortTime = new Date(createTime)
  } else {
    sortTime = new Date(
      Number(createTime.seconds) * 1000 + createTime.nanos / 1000000,
    )
  }

  // Transform redirectInfo from proto format to frontend format
  let redirectInfo
  if (docInfo.redirectInfo) {
    const target = `${docInfo.redirectInfo.account}${
      docInfo.redirectInfo.path ? `/${docInfo.redirectInfo.path}` : ''
    }`
    redirectInfo = {
      type: 'redirect' as const,
      target,
    }
  }

  return HMDocumentInfoSchema.parse({
    ...docInfo,
    metadata: prepareHMDocumentMetadata(doc.metadata),
    type: 'document',
    createTime,
    updateTime: prepareHMDate(docInfo.updateTime),
    sortTime,
    id: hmId(docInfo.account, {path, version: docInfo.version, latest: true}),
    path,
    redirectInfo,
  } as const)
}

export function documentParseAdjustments(document: any) {
  documentMetadataParseAdjustments(document?.metadata)
}

export function useDiscoveryState(entityId: string | undefined) {
  const client = useUniversalClient()
  const stream = entityId
    ? client.discovery?.getDiscoveryStream(entityId)
    : undefined
  const discoveryState = useStream(stream)

  // Check if discovery has timed out
  const isTimedOut = discoveryState
    ? Date.now() - discoveryState.startedAt > DISCOVERY_TIMEOUT_MS
    : false

  return {
    isDiscovering: discoveryState?.isDiscovering && !isTimedOut,
    isTimedOut,
    isTombstone: discoveryState?.isTombstone ?? false,
    isNotFound: discoveryState?.isNotFound ?? false,
  }
}

export function useResource(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResource | null> & {
    subscribed?: boolean
    recursive?: boolean
    onRedirectOrDeleted?: (opts: {
      isDeleted: boolean
      redirectTarget: UnpackedHypermediaId | null
    }) => void
  },
) {
  const client = useUniversalClient()
  const {subscribed, recursive, onRedirectOrDeleted, ...queryOptions} =
    options ?? {}

  // Discovery subscription (desktop only)
  useEffect(() => {
    if (!subscribed || !id || !client.subscribeEntity) return
    return client.subscribeEntity({id, recursive})
  }, [subscribed, recursive, id?.id, client.subscribeEntity])

  const result = useQuery({
    ...queryResource(client, id),
    ...queryOptions,
  })

  // Get discovery state
  const {
    isDiscovering: discoveryInProgress,
    isTombstone,
    isNotFound,
  } = useDiscoveryState(id?.id)

  // Determine if we should show discovering UI
  // Show discovering when: subscribed, not-found, AND either discovery in progress OR query is fetching
  // BUT: never show discovering UI for tombstoned or settled not-found resources
  // The isFetching check covers the gap between discovery completion and data arrival
  const isDiscovering =
    !!subscribed &&
    !isTombstone &&
    !isNotFound && // Don't show loading when discovery determined not-found
    result.data?.type === 'not-found' &&
    (!!discoveryInProgress || result.isFetching)

  // Redirect handling
  const redirectTarget =
    result.data?.type === 'redirect' ? result.data.redirectTarget : null
  const onRedirectOrDeletedRef = useRef(onRedirectOrDeleted)
  onRedirectOrDeletedRef.current = onRedirectOrDeleted
  const handledRedirectRef = useRef<string | null>(null)
  useEffect(() => {
    if (redirectTarget && handledRedirectRef.current !== redirectTarget.id) {
      handledRedirectRef.current = redirectTarget.id
      onRedirectOrDeletedRef.current?.({isDeleted: false, redirectTarget})
    }
  }, [redirectTarget])

  return {
    ...result,
    isDiscovering,
    isTombstone,
  }
}

export function useAccount(
  id: string | null | undefined,
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  const client = useUniversalClient()
  return useQuery({
    ...queryAccount(client, id),
    ...options,
  })
}

export function useResolvedResource(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResolvedResource | null>,
) {
  const client = useUniversalClient()
  const version = id?.version || undefined
  return useQuery({
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.RESOLVED_ENTITY, id?.id, version],
    queryFn: async (): Promise<HMResolvedResource | null> => {
      if (!id) return null

      async function loadResolvedResource(
        id: UnpackedHypermediaId,
      ): Promise<HMResolvedResource | null> {
        let resource = await client.request<HMResourceRequest>('Resource', id)
        if (resource?.type === 'redirect') {
          return await loadResolvedResource(resource.redirectTarget)
        }
        // @ts-expect-error
        return resource
      }

      return await loadResolvedResource(id)
    },
    ...options,
  })
}

type DiscoveryStateInfo = {
  isDiscovering: boolean
  isTombstone: boolean
  isNotFound: boolean
}

// Hook to get discovery states for multiple entity IDs
function useDiscoveryStates(
  entityIds: (string | undefined)[],
): DiscoveryStateInfo[] {
  const client = useUniversalClient()

  // Create a stable key for the ids array
  const idsKey = entityIds.join(',')

  // Subscribe to all discovery streams
  const streams = useMemo(() => {
    if (!client.discovery) return []
    return entityIds.map((id) =>
      id ? client.discovery!.getDiscoveryStream(id) : undefined,
    )
  }, [client.discovery, idsKey])

  // Get current values from all streams
  const [states, setStates] = useState<DiscoveryStateInfo[]>(() =>
    streams.map((stream) => {
      const state = stream?.get()
      const isTimedOut = state
        ? Date.now() - state.startedAt > DISCOVERY_TIMEOUT_MS
        : false
      return {
        isDiscovering: (state?.isDiscovering && !isTimedOut) ?? false,
        isTombstone: state?.isTombstone ?? false,
        isNotFound: state?.isNotFound ?? false,
      }
    }),
  )

  useEffect(() => {
    if (!client.discovery) return

    const cleanups = streams.map((stream, index) => {
      if (!stream) return undefined
      return stream.subscribe((state) => {
        setStates((prev) => {
          const next = [...prev]
          const isTimedOut = state
            ? Date.now() - state.startedAt > DISCOVERY_TIMEOUT_MS
            : false
          next[index] = {
            isDiscovering: (state?.isDiscovering && !isTimedOut) ?? false,
            isTombstone: state?.isTombstone ?? false,
            isNotFound: state?.isNotFound ?? false,
          }
          return next
        })
      })
    })

    return () => cleanups.forEach((cleanup) => cleanup?.())
  }, [streams, client.discovery])

  return states
}

export function useResources(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMResource | null> & {
    subscribed?: boolean
    recursive?: boolean
  },
) {
  const client = useUniversalClient()
  const {subscribed, recursive, ...queryOptions} = options ?? {}

  // Discovery subscription (desktop only)
  useEffect(() => {
    if (!subscribed || !client.subscribeEntity) return
    const cleanups = ids
      .filter((id): id is UnpackedHypermediaId => !!id)
      .map((id) => client.subscribeEntity!({id, recursive}))
    return () => cleanups.forEach((cleanup) => cleanup())
  }, [
    subscribed,
    recursive,
    ids.map((id) => id?.id).join(','),
    client.subscribeEntity,
  ])

  // Get discovery states for all entities
  const entityIdStrings = ids.map((id) => id?.id)
  const discoveryStates = useDiscoveryStates(entityIdStrings)

  const queryResults = useQueries({
    queries: ids.map((id) => ({
      ...queryResource(client, id),
      ...queryOptions,
    })),
  })

  // Combine query results with discovery state
  return queryResults.map((result, index) => {
    const {
      isDiscovering: discoveryInProgress,
      isTombstone,
      isNotFound,
    } = discoveryStates[index] ?? {
      isDiscovering: false,
      isTombstone: false,
      isNotFound: false,
    }
    // Show discovering when: subscribed, not-found, AND either discovery in progress OR query is fetching
    // BUT: never show discovering UI for tombstoned or settled not-found resources
    const isDiscovering =
      !!subscribed &&
      !isTombstone &&
      !isNotFound &&
      result.data?.type === 'not-found' &&
      (!!discoveryInProgress || result.isFetching)
    return {
      ...result,
      isDiscovering,
      isTombstone,
    }
  })
}

export function useAccounts(
  ids: (string | null | undefined)[],
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  const client = useUniversalClient()
  return useQueries({
    queries: ids.map((id) => ({
      ...queryAccount(client, id),
      ...options,
    })),
  })
}

export type HMAccountsMetadataResult = {
  data: HMAccountsMetadata
  isLoading: boolean
}

export function useAccountsMetadata(uids: string[]): HMAccountsMetadataResult {
  const client = useUniversalClient()
  const results = useQueries({
    queries: uids.map((uid) => queryAccount(client, uid)),
  })
  const isLoading = results.some((r) => r.isLoading)
  const data: HMAccountsMetadata = {}
  results.forEach((result, index) => {
    const uid = uids[index]
    if (result.data && uid) {
      data[uid] = result.data
    }
  })
  return {data, isLoading}
}

export function useResolvedResources(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMResolvedResource | null>,
) {
  const client = useUniversalClient()
  return useQueries({
    queries: ids.map((id) => {
      const version = id?.version || undefined
      return {
        enabled: options?.enabled ?? !!id,
        queryKey: [queryKeys.RESOLVED_ENTITY, id?.id, version],
        queryFn: async (): Promise<HMResolvedResource | null> => {
          if (!id) return null

          async function loadResolvedResource(
            id: UnpackedHypermediaId,
          ): Promise<HMResolvedResource | null> {
            let resource = await client.request<HMResourceRequest>(
              'Resource',
              id,
            )
            if (resource?.type === 'redirect') {
              return await loadResolvedResource(resource.redirectTarget)
            }
            // @ts-expect-error
            return resource
          }

          return await loadResolvedResource(id)
        },
      }
    }),
  })
}

export class HMError extends Error {}

export class HMRedirectError extends HMError {
  constructor(public redirect: RedirectErrorDetails) {
    super('Document Redirected')
  }
  public get target(): UnpackedHypermediaId {
    return hmId(this.redirect.targetAccount, {
      path: entityQueryPathToHmIdPath(this.redirect.targetPath),
    })
  }
}

export class HMNotFoundError extends HMError {
  constructor() {
    super('Resource Not Found')
  }
}

export class HMResourceTombstoneError extends HMError {
  constructor() {
    super('Resource has been Deleted')
  }
}

// @ts-ignore
export function getErrorMessage(err: any) {
  try {
    const e = ConnectError.from(err)
    if (e.code === Code.NotFound) {
      return new HMNotFoundError()
    }
    const firstDetail = e.details[0] // what if there are more than one detail?
    if (
      e.code === Code.FailedPrecondition &&
      e.message.match('marked as deleted')
    ) {
      return new HMResourceTombstoneError()
    }
    if (e.code === Code.Unknown && e.message.match('ipld: could not find')) {
      // the API has a lot of different types for "not found"!
      return new HMNotFoundError()
    }
    if (e.code === Code.Unknown && e.message.match('not found')) {
      // the message is like: "cid 1234 not found", I think we hit this for specific versions.
      // the API has a lot of different types for "not found"!
      return new HMNotFoundError()
    }

    if (
      // @ts-expect-error
      firstDetail.type === 'com.seed.documents.v3alpha.RedirectErrorDetails'
    ) {
      const redirect = RedirectErrorDetails.fromBinary(
        // @ts-expect-error
        firstDetail.value as Uint8Array,
      )
      return new HMRedirectError(redirect)
    }
  } catch (e) {
    return e
  }
}

export function useSelectedAccountId() {
  const {selectedIdentity} = useUniversalAppContext()
  return useStream(selectedIdentity) ?? null
}

export function useAccountContacts(accountUid: string | null | undefined) {
  const client = useUniversalClient()
  return useQuery({
    enabled: !!accountUid,
    queryKey: [queryKeys.CONTACTS_ACCOUNT, accountUid],
    queryFn: async (): Promise<HMContactRecord[]> => {
      if (!accountUid) return []
      return await client.request<HMAccountContactsRequest>(
        'AccountContacts',
        accountUid,
      )
    },
  })
}

export function useContacts(accountUids: string[]) {
  const accounts = useAccounts(accountUids)
  const selectedAccountId = useSelectedAccountId()
  const contacts = useAccountContacts(selectedAccountId)

  return useMemo(() => {
    return accounts.map((account) => {
      return {
        ...account,
        data: account.data
          ? {
              id: account.data.id,
              metadata: getContactMetadata(
                account.data.id.uid,
                account.data.metadata,
                contacts.data,
              ),
            }
          : undefined,
      }
    })
  }, [accounts, contacts.data])
}

export function useDirectory(
  id: UnpackedHypermediaId | null | undefined,
  options?: {mode?: 'Children' | 'AllDescendants'},
) {
  const client = useUniversalClient()
  const mode = options?.mode || 'Children'
  return useQuery(queryDirectory(client, id, mode))
}

export function useAccountDrafts(accountUid: string | undefined) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.ACCOUNT_DRAFTS, accountUid],
    queryFn: async (): Promise<HMListedDraft[]> => {
      if (!accountUid || !client.drafts) return []
      return client.drafts.listAccountDrafts(accountUid)
    },
    enabled: !!accountUid && !!client.drafts,
  })
}

export function useDirectoryWithDrafts(
  id: UnpackedHypermediaId | null | undefined,
  options?: {mode?: 'Children' | 'AllDescendants'},
) {
  const directory = useDirectory(id, options)
  const drafts = useAccountDrafts(id?.uid)

  return useMemo(() => {
    return {
      directory: directory.data,
      drafts: drafts.data ?? [],
      isLoading: directory.isLoading || drafts.isLoading,
      isInitialLoading: directory.isInitialLoading || drafts.isInitialLoading,
    }
  }, [
    directory.data,
    drafts.data,
    directory.isLoading,
    drafts.isLoading,
    directory.isInitialLoading,
    drafts.isInitialLoading,
  ])
}

export function useRootDocuments() {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.ROOT_DOCUMENTS],
    queryFn: async (): Promise<HMListAccountsOutput> => {
      return await client.request<HMListAccountsRequest>(
        'ListAccounts',
        undefined,
      )
    },
  })
}

export function useCID(cid: string | undefined) {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.CID, cid],
    queryFn: async (): Promise<HMGetCIDOutput> => {
      return await client.request<HMGetCIDRequest>('GetCID', {cid: cid!})
    },
    enabled: !!cid,
  })
}

export function useComments(id: UnpackedHypermediaId | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryComments(client, id))
}

export function useAuthoredComments(
  id: UnpackedHypermediaId | null | undefined,
) {
  const client = useUniversalClient()
  const isRootAccount = !id?.path?.filter((p) => !!p).length
  return useQuery({
    queryKey: [queryKeys.AUTHORED_COMMENTS, id?.id],
    queryFn: async (): Promise<HMListCommentsByAuthorOutput> => {
      if (!id) throw new Error('ID required')
      return await client.request<HMListCommentsByAuthorRequest>(
        'ListCommentsByAuthor',
        {authorId: id},
      )
    },
    enabled: !!id && isRootAccount,
  })
}

export function useCitations(id: UnpackedHypermediaId | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryCitations(client, id))
}

export function useChanges(id: UnpackedHypermediaId | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryChanges(client, id))
}

export function useCapabilities(id: UnpackedHypermediaId | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryCapabilities(client, id))
}

export function useInfiniteFeed(pageSize: number = 10) {
  const client = useUniversalClient()
  return useInfiniteQuery({
    queryKey: [queryKeys.FEED, 'infinite', pageSize],
    queryFn: async ({pageParam}): Promise<HMListEventsOutput> => {
      return await client.request<HMListEventsRequest>('ListEvents', {
        pageSize,
        pageToken: pageParam as string | undefined,
      })
    },
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    refetchInterval: 30000,
  })
}

export function useLatestEvent() {
  const client = useUniversalClient()
  return useQuery({
    queryKey: [queryKeys.FEED, 'latest'],
    queryFn: async () => {
      const result = await client.request<HMListEventsRequest>('ListEvents', {
        pageSize: 1,
      })
      return result.events[0] || null
    },
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
  })
}

export function useChildrenList(id: UnpackedHypermediaId | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryDirectory(client, id, 'Children'))
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string | null {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  return match?.[1] ?? null
}

export type HypermediaSearchResult = {
  destination?: string
  errorMessage?: string
}

export async function search(input: string): Promise<HypermediaSearchResult> {
  const cid = extractIpfsUrlCid(input)
  if (cid) {
    return {destination: `/ipfs/${cid}`}
  }
  if (input.startsWith('hm://')) {
    const unpackedId = unpackHmId(input)
    if (unpackedId) {
      return {
        destination: `/hm/${unpackedId.uid}/${unpackedId.path?.join('/')}`,
      }
    }
  }
  if (input.match(/\./)) {
    // it might be a url
    const hasProtocol = input.match(/^https?:\/\//)
    const searchUrl = hasProtocol ? input : `https://${input}`
    const result = await fetch(searchUrl, {
      method: 'OPTIONS',
    })
    const id = result.headers.get('x-hypermedia-id')
    const unpackedId = id && unpackHmId(id)
    const version = result.headers.get('x-hypermedia-version')
    if (unpackedId) {
      return {
        destination: `/hm/${unpackedId.uid}/${unpackedId.path?.join(
          '/',
        )}?v=${version}`,
      }
    }
  }
  return {
    errorMessage:
      'Invalid input. Please enter a valid hypermedia URL or IPFS url.',
  }
}
