import {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {invalidateQueries, setQueriesDataByKey} from './query-client'
import {queryKeys} from './query-keys'

/**
 * Core cache invalidation after a successful document publish.
 * Shared between web and desktop — both platforms call this to update
 * TanStack Query cache so the UI reflects the new document immediately.
 *
 * Desktop extends this with additional invalidations (parent directories,
 * citations, interaction summaries) via its own onSuccess handler.
 */
export function invalidateAfterPublish(docId: UnpackedHypermediaId, newDocument: HMDocument) {
  const resultId = {...docId, version: newDocument.version}
  // Write the freshly published document straight into the ENTITY cache (this
  // matches all ENTITY queries for the doc, including the "latest" one).
  setQueriesDataByKey([queryKeys.ENTITY, docId.id], {
    type: 'document' as const,
    document: newDocument,
    id: resultId,
  })
  // Deliberately DO NOT invalidate the ENTITY query for this doc: it would
  // refetch "latest" from the daemon whose latest pointer can still lag right
  // after publish (especially on web against a remote daemon), returning the
  // pre-publish version and clobbering the fresh document we just wrote — which
  // made views that don't navigate on publish (e.g. :metadata) show stale values
  // and an "older version" warning until a manual refresh. The setQueriesDataByKey
  // above already provides the up-to-date document.
  invalidateQueries([queryKeys.ACCOUNT, docId.uid])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, docId.id])
  invalidateQueries([queryKeys.ACTIVITY_FEED])
}
