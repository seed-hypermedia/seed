import {
  PlainMessage,
  Struct,
  Timestamp,
  toPlainMessage,
} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {useMemo} from 'react'
import {DocumentInfo, RedirectErrorDetails} from '../client'
import {Status} from '../client/.generated/google/rpc/status_pb'
import {getContactMetadata} from '../content'
import {GRPCClient} from '../grpc-client'
import {
  HMAccountContactsRequest,
  HMAccountRequest,
  HMAccountsMetadata,
  HMBatchAccountsRequest,
  HMContactRecord,
  HMDocumentInfo,
  HMDocumentInfoSchema,
  HMDocumentMetadataSchema,
  HMMetadata,
  HMMetadataPayload,
  HMQueryRequest,
  HMResolvedResource,
  HMResource,
  HMResourceRequest,
  HMTimestamp,
  HMTimestampSchema,
  UnpackedHypermediaId,
} from '../hm-types'
import {useUniversalAppContext, useUniversalClient} from '../routing'
import {useStream} from '../use-stream'
import {entityQueryPathToHmIdPath, hmId, hmIdPathToEntityQueryPath} from '../utils'
import {queryKeys} from './query-keys'

export function documentMetadataParseAdjustments(metadata: any) {
  if (metadata?.theme === '[object Object]') {
    metadata.theme = undefined
  }
}

export function prepareHMDocumentMetadata(
  metadata: Struct | undefined,
): HMMetadata {
  const docMeta = metadata?.toJson() || {}
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
  return HMDocumentInfoSchema.parse({
    ...docInfo,
    metadata: prepareHMDocumentMetadata(doc.metadata),
    type: 'document',
    createTime,
    updateTime: prepareHMDate(docInfo.updateTime),
    sortTime,
    id: hmId(docInfo.account, {path, version: docInfo.version, latest: true}),
    path,
  } as const)
}

export function documentParseAdjustments(document: any) {
  documentMetadataParseAdjustments(document?.metadata)
}

export function createBatchAccountsResolver(client: GRPCClient) {
  async function getBatchAccountsResolved(
    accountUids: string[],
  ): Promise<Record<string, HMMetadataPayload>> {
    if (accountUids.length === 0) return {}

    const _accounts = await client.documents.batchGetAccounts({
      ids: accountUids,
    })

    Object.entries(_accounts.errors).forEach(([id, error]) => {
      try {
        const status = Status.fromBinary(error)
        console.error(`Error loading account ${id}: `, toPlainMessage(status))
      } catch (e) {
        console.error(
          `Error loading account ${id}: (error parse failure) `,
          Buffer.from(error).toString('hex'),
        )
      }
    })

    if (!_accounts?.accounts) {
      return {}
    }

    const resolvedAccounts: Record<string, HMMetadataPayload> = {}
    const aliasesToResolve: string[] = []
    const aliasMapping: Record<string, string[]> = {}

    Object.entries(_accounts.accounts).forEach(([id, account]) => {
      const serverAccount = toPlainMessage(account)

      if (serverAccount.aliasAccount) {
        const aliasAccount = serverAccount.aliasAccount
        if (!aliasMapping[aliasAccount]) {
          aliasMapping[aliasAccount] = []
        }
        aliasMapping[aliasAccount].push(id)

        if (!aliasesToResolve.includes(aliasAccount)) {
          aliasesToResolve.push(aliasAccount)
        }
      } else {
        const serverMetadata = account.metadata?.toJson() || {}
        documentMetadataParseAdjustments(serverMetadata)
        const metadata = HMDocumentMetadataSchema.safeParse(serverMetadata)
        if (!metadata.success) {
          console.error(
            `Error parsing metadata for account ${id}: `,
            metadata.error,
          )
          return
        }
        resolvedAccounts[id] = {
          id: hmId(id),
          metadata: metadata.data,
        } as HMMetadataPayload
      }
    })

    if (aliasesToResolve.length > 0) {
      const resolvedAliases = await getBatchAccountsResolved(aliasesToResolve)

      Object.entries(resolvedAliases).forEach(
        ([resolvedId, resolvedAccount]) => {
          resolvedAccounts[resolvedId] = resolvedAccount

          if (aliasMapping[resolvedId]) {
            aliasMapping[resolvedId].forEach((originalId) => {
              resolvedAccounts[originalId] = resolvedAccount
            })
          }
        },
      )
    }

    return resolvedAccounts
  }

  return getBatchAccountsResolved
}

export function useResource(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResource | null>,
) {
  const client = useUniversalClient()
  const version = id?.version || undefined
  return useQuery({
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ENTITY, id?.id, version],
    queryFn: async (): Promise<HMResource | null> => {
      if (!id) return null
      return await client.request<HMResourceRequest>('Resource', id)
    },
    ...options,
  })
}

export function useAccount(
  id: string | null | undefined,
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  const client = useUniversalClient()
  return useQuery({
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ACCOUNT, id],
    queryFn: async (): Promise<HMMetadataPayload | null> => {
      if (!id) return null
      return await client.request<HMAccountRequest>('Account', id)
    },
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

export function useResources(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMResource | null>,
) {
  const client = useUniversalClient()
  return useQueries({
    queries: ids.map((id) => {
      const version = id?.version || undefined
      return {
        enabled: options?.enabled ?? !!id,
        queryKey: [queryKeys.ENTITY, id?.id, version],
        queryFn: async (): Promise<HMResource | null> => {
          if (!id) return null
          const r = await client.request<HMResourceRequest>('Resource', id)
          return r
        },
      }
    }),
  })
}

export function useAccounts(
  ids: (string | null | undefined)[],
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  const client = useUniversalClient()
  return useQueries({
    queries: ids.map((id) => ({
      enabled: options?.enabled ?? !!id,
      queryKey: [queryKeys.ACCOUNT, id],
      queryFn: async (): Promise<HMMetadataPayload | null> => {
        if (!id) return null
        return await client.request<HMAccountRequest>('Account', id)
      },
    })),
  })
}

export type HMAccountsMetadataResult = {
  data: HMAccountsMetadata
  isLoading: boolean
}

export function useAccountsMetadata(uids: string[]): HMAccountsMetadataResult {
  const client = useUniversalClient()
  const result = useQuery({
    enabled: uids.length > 0,
    queryKey: [queryKeys.BATCH_ACCOUNTS, ...uids.slice().sort()],
    queryFn: async (): Promise<HMAccountsMetadata> => {
      if (uids.length === 0) return {}
      return await client.request<HMBatchAccountsRequest>('BatchAccounts', uids)
    },
  })
  return {data: result.data || {}, isLoading: result.isLoading}
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
  return useQuery({
    queryKey: [queryKeys.DOC_LIST_DIRECTORY, id?.id, mode],
    queryFn: async (): Promise<HMDocumentInfo[]> => {
      if (!id) return []
      const results = await client.request<HMQueryRequest>('Query', {
        includes: [
          {
            space: id.uid,
            mode,
            path: hmIdPathToEntityQueryPath(id.path),
          },
        ],
      })
      return results?.results || []
    },
    enabled: !!id,
  })
}
