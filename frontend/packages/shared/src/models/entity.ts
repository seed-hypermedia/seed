import {ConnectError} from '@connectrpc/connect'
import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {RedirectErrorDetails} from '../client'
import {
  HMMetadataPayload,
  HMResolvedResource,
  HMResource,
  UnpackedHypermediaId,
} from '../hm-types'
import {entityQueryPathToHmIdPath, hmId} from '../utils'
import {queryKeys} from './query-keys'

let queryResource:
  | ((hmId: UnpackedHypermediaId) => Promise<HMResource>)
  | null = null

export function setResourceQuery(
  handler: (hmId: UnpackedHypermediaId) => Promise<HMResource>,
) {
  queryResource = handler
}

let queryAccount: ((accountUid: string) => Promise<HMMetadataPayload>) | null =
  null

export function setAccountQuery(
  handler: (accountUid: string) => Promise<HMMetadataPayload>,
) {
  queryAccount = handler
}

export function documentMetadataParseAdjustments(metadata: any) {
  if (metadata?.theme === '[object Object]') {
    metadata.theme = undefined
  }
}

export function documentParseAdjustments(document: any) {
  documentMetadataParseAdjustments(document?.metadata)
}

export async function loadResource(
  id: UnpackedHypermediaId,
): Promise<HMResource | null> {
  if (!queryResource) throw new Error('queryResource not injected')
  return await queryResource(id)

  // try {
  //   if (!queryResource) throw new Error('queryResource not injected')

  //   return await queryResource(id)

  //   documentParseAdjustments(serverDocument)
  //   // console.log('serverDocument', serverDocument.toJson())
  //   const result = HMDocumentSchema.safeParse(serverDocument)
  //   if (result.success) {
  //     const document = result.data
  //     return {
  //       id: {...id, version: document.version},
  //       document,
  //     }
  //   } else {
  //     console.error('Invalid Document Data', serverDocument, result.error)
  //     return {id, document: undefined}
  //   }
  // } catch (e) {
  //   const error = getErrorMessage(e)
  //   if (error instanceof HMRedirectError) {
  //     return {
  //       id,
  //       redirectTarget: error.target,
  //       document: undefined,
  //     }
  //   }
  //   return {id, document: undefined}
  // }
}

export async function loadAccount(
  accountUid: string,
): Promise<HMMetadataPayload> {
  if (!queryAccount) throw new Error('queryAccount not injected')
  return await queryAccount(accountUid)
}

export async function loadResolvedResource(
  id: UnpackedHypermediaId,
): Promise<HMResolvedResource | null> {
  let resource = await loadResource(id)
  if (resource?.type === 'redirect') {
    return await loadResolvedResource(resource.redirectTarget)
  }
  // @ts-expect-error
  return resource
}

export function getResourceQuery(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResource | null>,
): UseQueryOptions<HMResource | null> {
  const version = id?.latest ? undefined : id?.version || undefined
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ENTITY, id?.id, version],
    queryFn: async (): Promise<HMResource | null> => {
      if (!id) return null
      return await loadResource(id)
    },
  }
}

export function getAccountQuery(
  id: string | null | undefined,
  options?: UseQueryOptions<HMMetadataPayload | null>,
): UseQueryOptions<HMMetadataPayload | null> {
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ACCOUNT, id],
    queryFn: async (): Promise<HMMetadataPayload | null> => {
      if (!id) return null
      return await loadAccount(id)
    },
  }
}

export function getResolvedResourceQuery(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResolvedResource | null>,
): UseQueryOptions<HMResolvedResource | null> {
  const version = id?.latest ? undefined : id?.version || undefined
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.RESOLVED_ENTITY, id?.id, version],
    queryFn: async (): Promise<HMResolvedResource | null> => {
      if (!id) return null
      return await loadResolvedResource(id)
    },
  }
}

export function useResource(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResource | null>,
) {
  return useQuery(getResourceQuery(id, options))
}

export function useAccount(
  id: string | null | undefined,
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  return useQuery(getAccountQuery(id, options))
}

export function useResolvedResource(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMResolvedResource | null>,
) {
  return useQuery(getResolvedResourceQuery(id, options))
}

export function useResources(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMResource | null>,
) {
  return useQueries({
    queries: ids.map((id) => getResourceQuery(id)),
    ...(options || {}),
  })
}

export function useAccounts(
  ids: (string | null | undefined)[],
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  return useQueries({
    queries: ids.map((id) => getAccountQuery(id)),
    ...(options || {}),
  })
}

export function useResolvedResources(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMResolvedResource | null>,
) {
  return useQueries({
    queries: ids.map((id) => getResolvedResourceQuery(id)),
    ...(options || {}),
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

// @ts-expect-error
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
