import {prepareHMComment, prepareHMDocument} from './document-utils'
import {GRPCClient} from './grpc-client'
import {HMResource, HMResourceRedirect, UnpackedHypermediaId} from './hm-types'
import {getErrorMessage, HMRedirectError} from './models/entity'
import {packHmId} from './utils'

export function createResourceLoader(grpcClient: GRPCClient) {
  async function loadResource(id: UnpackedHypermediaId): Promise<HMResource> {
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
      throw e
    }
  }
  return loadResource
}
