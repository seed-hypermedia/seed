import {prepareHMComment, prepareHMDocument} from './document-utils'
import {GRPCClient} from './grpc-client'
import {
  HMResolvedResource,
  HMResource,
  HMResourceError,
  HMResourceNotFound,
  HMResourceRedirect,
  HMResourceTombstone,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {getErrorMessage, HMError, HMNotFoundError, HMRedirectError, HMResourceTombstoneError} from './models/entity'
import {MAX_REDIRECT_HOPS} from './redirects'
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
      if (err instanceof HMResourceTombstoneError) {
        return {
          type: 'tombstone',
          id,
        } satisfies HMResourceTombstone
      }
      if (err instanceof HMRedirectError) {
        return {
          type: 'redirect',
          id,
          redirectTarget: err.target,
          republish: err.republish,
        } satisfies HMResourceRedirect
      }
      if (err instanceof HMNotFoundError) {
        return {
          type: 'not-found',
          id,
        } satisfies HMResourceNotFound
      }
      // Return error resource for unknown errors
      const message = e instanceof Error ? e.message : 'Unknown error'
      return {
        type: 'error',
        id,
        message,
      } satisfies HMResourceError
    }
  }
  return fetchResource
}

/**
 * A redirect chain that cannot end at a resource: it revisits an address (a cycle in
 * the daemon's redirect data) or is longer than {@link MAX_REDIRECT_HOPS}. Never
 * follow further after this — the chain is unresolvable by construction.
 */
export class HMRedirectCycleError extends HMError {
  constructor(
    public readonly chain: string[],
    opts?: {limitExceeded?: boolean},
  ) {
    super(
      opts?.limitExceeded
        ? `Too many redirects while resolving resource (limit ${MAX_REDIRECT_HOPS}): ${chain.join(' -> ')}`
        : `Redirect cycle detected: ${chain.join(' -> ')}`,
    )
  }
}

/**
 * Creates a resource resolver that follows redirects.
 * Returns document or comment (never redirect).
 * Throws HMNotFoundError if resource not found.
 * Throws HMRedirectCycleError on a cyclic or over-long redirect chain — redirects are
 * daemon-served data, so the walk must be bounded or a cycle spins it forever.
 */
export function createResourceResolver(grpcClient: GRPCClient) {
  const fetchResource = createResourceFetcher(grpcClient)

  async function resolveResource(id: UnpackedHypermediaId): Promise<HMResolvedResource> {
    const visited = new Set<string>()
    let current = id
    while (true) {
      const key = packHmId(current)
      if (visited.has(key)) {
        throw new HMRedirectCycleError(Array.from(visited).concat(key))
      }
      if (visited.size > MAX_REDIRECT_HOPS) {
        throw new HMRedirectCycleError(Array.from(visited), {limitExceeded: true})
      }
      visited.add(key)
      const resource = await fetchResource(current)
      if (resource.type === 'redirect') {
        current = resource.redirectTarget
        continue
      }
      if (resource.type === 'not-found') {
        throw new HMNotFoundError()
      }
      if (resource.type === 'error') {
        throw new Error(resource.message)
      }
      return resource
    }
  }
  return resolveResource
}
