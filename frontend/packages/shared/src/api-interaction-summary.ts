import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMInteractionSummaryRequest} from '@seed-hypermedia/client/hm-types'
import {calculateInteractionSummary} from './interaction-summary'
import {LIST_PAGE_SIZE, listAllPages} from './list-all-pages'
import {getErrorMessage, HMNotFoundError, HMRedirectError, HMResourceTombstoneError} from './models/entity'
import {hmIdPathToEntityQueryPath} from './utils'

export const InteractionSummary: HMRequestImplementation<HMInteractionSummaryRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMInteractionSummaryRequest['output']> {
    const {id} = input

    const apiPath = hmIdPathToEntityQueryPath(id.path)

    try {
      const [citations, latestDoc, docInfo] = await Promise.all([
        listAllPages(
          (pageToken) =>
            grpcClient.resources.listCitations({
              iri: id.id,
              pageSize: LIST_PAGE_SIZE,
              pageToken,
            }),
          (r) => ({items: r.citations, nextPageToken: r.nextPageToken}),
        ),
        grpcClient.documents.getDocument({
          account: id.uid,
          path: apiPath,
          version: undefined,
        }),
        // The backend computes the alive direct-children count for every
        // document info row; a whole ListDirectory call just to count
        // children was both wasteful and wrong (it silently truncated at
        // the default page size).
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

      return calculateInteractionSummary(citations, changes.changes, id, childrenCount)
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
