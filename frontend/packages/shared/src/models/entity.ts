import {toPlainMessage} from '@bufbuild/protobuf'
import {ConnectError} from '@connectrpc/connect'
import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {RedirectErrorDetails} from '../client'
import {Status} from '../client/.generated/google/rpc/status_pb'
import {GRPCClient} from '../grpc-client'
import {
  HMDocumentMetadataSchema,
  HMMetadataPayload,
  HMResolvedResource,
  HMResource,
  UnpackedHypermediaId,
} from '../hm-types'
import {useUniversalClient} from '../routing'
import {entityQueryPathToHmIdPath, hmId} from '../utils'
import {queryKeys} from './query-keys'

export function documentMetadataParseAdjustments(metadata: any) {
  if (metadata?.theme === '[object Object]') {
    metadata.theme = undefined
  }
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
          error.toHex(),
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
        const metadata = HMDocumentMetadataSchema.parse(serverMetadata)
        resolvedAccounts[id] = {
          id: hmId(id),
          metadata,
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
      return await client.loadResource(id)
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
      return await client.loadAccount(id)
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
        let resource = await client.loadResource(id)
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
          return await client.loadResource(id)
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
        return await client.loadAccount(id)
      },
    })),
  })
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
            let resource = await client.loadResource(id)
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

export class HMRedirectError extends Error {
  constructor(public redirect: RedirectErrorDetails) {
    super('Document Redirected')
  }
  public get target(): UnpackedHypermediaId {
    return hmId(this.redirect.targetAccount, {
      path: entityQueryPathToHmIdPath(this.redirect.targetPath),
    })
  }
}

// @ts-ignore
export function getErrorMessage(err: any) {
  try {
    const e = ConnectError.from(err)
    const firstDetail = e.details[0] // what if there are more than one detail?
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
