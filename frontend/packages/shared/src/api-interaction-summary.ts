import {HMRequestImplementation} from './api-types'
import {GRPCClient} from './grpc-client'
import {HMInteractionSummaryRequest} from '@seed-hypermedia/client/hm-types'
import {ListCitationsResponse} from './client/.generated/documents/v3alpha/resources_pb'
import {calculateInteractionSummary} from './interaction-summary'
import {LIST_PAGE_SIZE} from './list-all-pages'
import {getErrorMessage, HMNotFoundError, HMRedirectError, HMResourceTombstoneError} from './models/entity'
import {MAX_REDIRECT_HOPS} from './redirects'
import {hmIdPathToEntityQueryPath} from './utils'

function emptySummary(): HMInteractionSummaryRequest['output'] {
  return {citations: 0, comments: 0, changes: 0, children: 0, authorUids: [], blocks: {}}
}

// A moved, deleted or unknown document has no summary of its own. queryResource follows
// moves, so a moved address is re-queried with the target id and this answer is discarded.
function isMissingResourceError(err: unknown): boolean {
  return err instanceof HMRedirectError || err instanceof HMResourceTombstoneError || err instanceof HMNotFoundError
}

export const InteractionSummary: HMRequestImplementation<HMInteractionSummaryRequest> = {
  async getData(grpcClient: GRPCClient, input): Promise<HMInteractionSummaryRequest['output']> {
    // A republish is a redirect Ref at the site's own address: its content, history and
    // children are the target's, while links may point at either address. Follow the hop
    // for the document side and keep the citations of every address on the way, so a
    // republished page counts the links to itself as well as the links to the original.
    // Before this, getDocument failed with a redirect at the republish address and every
    // badge on the page showed zero.
    let id = input.id
    const citations: ListCitationsResponse['citations'] = []
    for (let hop = 0; ; hop++) {
      const apiPath = hmIdPathToEntityQueryPath(id.path)

      const [citationsRes, latestDocRes, docInfoRes] = await Promise.allSettled([
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

      if (citationsRes.status === 'fulfilled') {
        citations.push(...citationsRes.value.citations)
      } else if (!isMissingResourceError(getErrorMessage(citationsRes.reason))) {
        throw citationsRes.reason
      }

      if (latestDocRes.status === 'rejected') {
        const err = getErrorMessage(latestDocRes.reason)
        if (err instanceof HMRedirectError && err.republish && hop < MAX_REDIRECT_HOPS) {
          id = err.target
          continue
        }
        if (isMissingResourceError(err)) return emptySummary()
        throw latestDocRes.reason
      }

      if (citationsRes.status === 'rejected') return emptySummary()
      if (docInfoRes.status === 'rejected') {
        if (isMissingResourceError(getErrorMessage(docInfoRes.reason))) return emptySummary()
        throw docInfoRes.reason
      }

      try {
        const changes = await grpcClient.documents.listDocumentChanges({
          account: id.uid,
          path: apiPath,
          version: latestDocRes.value.version,
        })
        const childrenCount = docInfoRes.value.activitySummary?.childrenCount ?? 0

        return calculateInteractionSummary(citations, changes.changes, input.id, childrenCount)
      } catch (e) {
        if (isMissingResourceError(getErrorMessage(e))) return emptySummary()
        throw e
      }
    }
  },
}
