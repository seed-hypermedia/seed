import {ConnectError} from '@connectrpc/connect'
import {useQueries, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {RedirectErrorDetails} from '../client'
import {
  HMDocument,
  HMDocumentSchema,
  HMEntityContent,
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

    console.log(`=== DRAFT loadEntity:`, serverDocument)
    documentParseAdjustments(serverDocument)

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
    console.error('~~ Document Load Error', error)
    if (error instanceof HMRedirectError) {
      console.error('~~ HMRedirectError to', error.target)
      return {
        id,
        redirectTarget: error.target,
        document: undefined,
      }
    }
    return {id, document: undefined}
  }
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

export function useEntity(
  id: UnpackedHypermediaId | null | undefined,
  options?: UseQueryOptions<HMEntityContent | null>,
) {
  return useQuery(getEntityQuery(id, options))
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
    console.error('~~ ConnectError', e, e.details)
    if (
      // @ts-expect-error
      firstDetail.type === 'com.seed.documents.v3alpha.RedirectErrorDetails'
    ) {
      console.error('~~ RedirectErrorDetails', firstDetail)
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
