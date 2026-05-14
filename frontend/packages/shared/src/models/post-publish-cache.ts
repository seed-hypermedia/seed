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
  setQueriesDataByKey([queryKeys.ENTITY, docId.id], {
    type: 'document' as const,
    document: newDocument,
    id: resultId,
  })
  invalidateQueries([queryKeys.ENTITY, docId.id])
  invalidateQueries([queryKeys.ACCOUNT, docId.uid])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, docId.id])
}
