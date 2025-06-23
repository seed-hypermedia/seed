import {ConnectError} from '@connectrpc/connect'
import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {RedirectErrorDetails} from '../client'
import {
  HMDocument,
  HMDocumentSchema,
  HMEntityContent,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '../hm-types'
import {entityQueryPathToHmIdPath, hmId} from '../utils'
import {queryKeys} from './query-keys'

let queryEntity: ((hmId: UnpackedHypermediaId) => Promise<HMDocument>) | null =
  null

export function setEntityQuery(
  handler: (hmId: UnpackedHypermediaId) => Promise<HMDocument>,
) {
  queryEntity = handler
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

export async function loadEntity(
  id: UnpackedHypermediaId,
): Promise<HMEntityContent | null> {
  try {
    if (!queryEntity) throw new Error('queryEntity not injected')

    const serverDocument = await queryEntity(id)

    documentParseAdjustments(serverDocument)
    // console.log('serverDocument', serverDocument.toJson())
    const result = HMDocumentSchema.safeParse(serverDocument)
    if (result.success) {
      const document = result.data
      return {
        id: {...id, version: document.version},
        document,
      }
    } else {
      console.error('Invalid Document Data', serverDocument, result.error)
      return {id, document: undefined}
    }
  } catch (e) {
    const error = getErrorMessage(e)
    if (error instanceof HMRedirectError) {
      return {
        id,
        redirectTarget: error.target,
        document: undefined,
      }
    }
    return {id, document: undefined}
  }
}

export async function loadAccount(
  accountUid: string,
): Promise<HMMetadataPayload> {
  if (!queryAccount) throw new Error('queryAccount not injected')
  return await queryAccount(accountUid)
}

export async function loadResolvedEntity(
  id: UnpackedHypermediaId,
): Promise<HMEntityContent | null> {
  let entity = await loadEntity(id)
  while (entity?.redirectTarget) {
    entity = await loadEntity(entity.redirectTarget)
  }
  return entity
}

export function getEntityQuery(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
): UseQueryOptions<HMEntityContent | null> {
  const version = id?.latest ? undefined : id?.version || undefined
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.ENTITY, id?.id, version],
    queryFn: async (): Promise<HMEntityContent | null> => {
      if (!id) return null
      return await loadEntity(id)
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

export function getResolvedEntityQuery(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
): UseQueryOptions<HMEntityContent | null> {
  const version = id?.latest ? undefined : id?.version || undefined
  return {
    ...options,
    enabled: options?.enabled ?? !!id,
    queryKey: [queryKeys.RESOLVED_ENTITY, id?.id, version],
    queryFn: async (): Promise<HMEntityContent | null> => {
      if (!id) return null
      return await loadResolvedEntity(id)
    },
  }
}

export function useEntity(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQuery(getEntityQuery(id, options))
}

export function useAccount(
  id: string | null | undefined,
  options?: UseQueryOptions<HMMetadataPayload | null>,
) {
  return useQuery(getAccountQuery(id, options))
}

export function useResolvedEntity(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQuery(getResolvedEntityQuery(id, options))
}

export function useEntities(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQueries({
    queries: ids.map((id) => getEntityQuery(id)),
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

export function useResolvedEntities(
  ids: (UnpackedHypermediaId | null | undefined)[],
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQueries({
    queries: ids.map((id) => getResolvedEntityQuery(id)),
    ...(options || {}),
  })
}

export class HMRedirectError extends Error {
  constructor(public redirect: RedirectErrorDetails) {
    super('Document Redirected')
  }
  public get target(): UnpackedHypermediaId {
    return hmId('d', this.redirect.targetAccount, {
      path: entityQueryPathToHmIdPath(this.redirect.targetPath),
    })
  }
}

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
