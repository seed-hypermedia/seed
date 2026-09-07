import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMInteractionSummaryRequest} from '@seed-hypermedia/client/hm-types'
import {calculateInteractionSummaryFromAggregate} from './interaction-summary'
import {getErrorMessage, HMNotFoundError, HMRedirectError, HMResourceTombstoneError} from './models/entity'
import {hmIdPathToEntityQueryPath} from './utils'

export const InteractionSummary: HMRequestImplementation<HMInteractionSummaryRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMInteractionSummaryRequest['output']> {
    const {id} = input

    const apiPath = hmIdPathToEntityQueryPath(id.path)

    try {
      const [aggregate, latestDoc, docInfo] = await Promise.all([
        // The daemon groups by target fragment and author while seeking the
        // target-link index. Unlike ListCitations, this does not materialise or
        // return one row per citation and does not expand every genesis chain.
        grpcClient.resources.getInteractionSummary({iri: id.id}),
        grpcClient.documents.getDocument({
          account: id.uid,
          path: apiPath,
          version: undefined,
        }),
        grpcClient.documents.getDocumentInfo({
          account: id.uid,
          path: apiPath,
        }),
      ])

      const changes = await grpcClient.documents.listDocumentChanges({
        account: id.uid,
        path: apiPath,
        version: latestDoc.version,
      })
      const childrenCount = docInfo.activitySummary?.childrenCount ?? 0

      return calculateInteractionSummaryFromAggregate(aggregate, changes.changes, childrenCount)
    } catch (e) {
      // If the document has been redirected, return empty summary.
      // queryResource handles following redirects, so this query will be
      // re-fetched with the correct (target) ID after redirect resolution.
      const err = getErrorMessage(e)
      if (err instanceof HMRedirectError || err instanceof HMResourceTombstoneError || err instanceof HMNotFoundError) {
        return {citations: 0, comments: 0, changes: 0, children: 0, authorUids: [], blocks: {}}
      }
      throw e
    }
  },
}
