import {prepareHMComment, prepareHMDocument} from './document-utils'
import {GRPCClient} from './grpc-client'
import {
  HMResolvedResource,
  HMResource,
  HMResourceNotFound,
  HMResourceRedirect,
  UnpackedHypermediaId,
} from './hm-types'
import {
  getErrorMessage,
  HMNotFoundError,
  HMRedirectError,
} from './models/entity'
import {packHmId} from './utils'

/**
 * Creates a low-level resource fetcher.
 * Returns all response types including redirect and not-found.
 * Caller is responsible for handling redirects and not-found cases.
 */
export function createResourceFetcher(grpcClient: GRPCClient) {
  async function fetchResource(id: UnpackedHypermediaId): Promise<HMResource> {
    try {
      const resource = await grpcClient.resources.getResource({
        iri: packHmId(id),
      })
      if (resource.kind.case === 'comment') {
        const comment = prepareHMComment(resource.kind.value)
        return {
          type: 'comment',
          id,
          comment,
        }
      } else if (resource.kind.case === 'document') {
        const document = prepareHMDocument(resource.kind.value)
        return {
          type: 'document',
          id,
          document,
        }
      }
      throw new Error(`Unable to get resource with kind: ${resource.kind.case}`)
    } catch (e) {
      const err = getErrorMessage(e)
      if (err instanceof HMRedirectError) {
        return {
          type: 'redirect',
          id,
          redirectTarget: err.target,
        } satisfies HMResourceRedirect
      }
      if (err instanceof HMNotFoundError) {
        return {
          type: 'not-found',
          id,
        } satisfies HMResourceNotFound
      }
      throw e
    }
  }
  return fetchResource
}

/**
 * Creates a resource resolver that follows redirects.
 * Returns document or comment (never redirect).
 * Throws HMNotFoundError if resource not found.
 */
export function createResourceResolver(grpcClient: GRPCClient) {
  const fetchResource = createResourceFetcher(grpcClient)

  async function resolveResource(
    id: UnpackedHypermediaId,
  ): Promise<HMResolvedResource> {
    const resource = await fetchResource(id)
    if (resource.type === 'redirect') {
      return resolveResource(resource.redirectTarget)
    }
    if (resource.type === 'not-found') {
      throw new HMNotFoundError()
    }
    return resource
  }
  return resolveResource
}

/** @deprecated Use createResourceFetcher instead */
export const createResourceLoader = createResourceFetcher
