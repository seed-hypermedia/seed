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
      // Bounded on purpose: each ListCitations round-trip costs the daemon
      // 0.3-2.5s regardless of page size, so a heavily-cited document must not
      // fan out into an unbounded chain of them (2026-08-11 outage; see
      // docs/daemon-saturation-incident.md). Documents with more than
      // LIST_PAGE_SIZE citations show a truncated list until the daemon can
      // page cheaply.
      {maxPages: 1},
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
