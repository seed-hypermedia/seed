import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMInteractionSummaryRequest} from '@seed-hypermedia/client/hm-types'
import {calculateInteractionSummary} from './interaction-summary'
import {LIST_PAGE_SIZE} from './list-all-pages'
import {getErrorMessage, HMNotFoundError, HMRedirectError, HMResourceTombstoneError} from './models/entity'
import {hmIdPathToEntityQueryPath} from './utils'

export const InteractionSummary: HMRequestImplementation<HMInteractionSummaryRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMInteractionSummaryRequest['output']> {
    const {id} = input

    const apiPath = hmIdPathToEntityQueryPath(id.path)

    try {
      const [citationsPage, latestDoc, docInfo] = await Promise.all([
        // ONE page, deliberately. This used to call listAllPages, walking every
        // citation of the target to produce a handful of integers. Each
        // ListCitations materialises the target's whole citation fan-out before
        // applying its LIMIT (0.3-2.5s of daemon CPU), and the daemon's read
        // pool has only 12 connections, so a document with thousands of
        // citations could hold a slot for 30s+ and convoy every other query
        // behind it. That took production down on 2026-08-11; see
        // docs/daemon-saturation-incident.md.
        //
        // Consequence: documents with more than LIST_PAGE_SIZE citations
        // under-report their counts. That is a deliberate trade against
        // unbounded work on a shared resource. It goes away once the daemon can
        // report a citation count without enumerating citations, the way
        // children_count already does for directories (see getDocumentInfo
        // below, which does exactly that for children).
        grpcClient.resources.listCitations({
          iri: id.id,
          pageSize: LIST_PAGE_SIZE,
        }),
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

      return calculateInteractionSummary(citationsPage.citations, changes.changes, id, childrenCount)
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
