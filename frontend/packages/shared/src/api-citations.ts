import {HMRequestImplementation, HMRequestParams} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMListCitationsRequest} from '@seed-hypermedia/client/hm-types'
import {LIST_PAGE_SIZE, listAllPages} from './list-all-pages'
import {packHmId, unpackHmId} from './utils'

export const ListCitations: HMRequestImplementation<HMListCitationsRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMListCitationsRequest['output']> {
    const citations = await listAllPages(
      (pageToken) =>
        grpcClient.resources.listCitations({
          iri: packHmId({...input.targetId, version: null, latest: null}),
          pageSize: LIST_PAGE_SIZE,
          pageToken,
        }),
      (r) => ({items: r.citations, nextPageToken: r.nextPageToken}),
    )
    return {
      citations: citations.map((c) => c.toJson({emitDefaultValues: true, enumAsInteger: false}) as any),
    }
  },
}

export const ListCitationsParams: HMRequestParams<HMListCitationsRequest> = {
  inputToParams: (input) => ({targetId: packHmId(input.targetId)}),
  paramsToInput: (params) => {
    const targetId = unpackHmId(params.targetId)
    if (!targetId) {
      throw new Error(`Invalid targetId query param: ${params.targetId}`)
    }
    return {targetId}
  },
}
