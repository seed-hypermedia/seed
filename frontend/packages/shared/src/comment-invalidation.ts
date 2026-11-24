import type {HMBlockNode, HMComment, HMListCommentsOutput, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {Query, QueryClient} from '@tanstack/react-query'
import {extractAllContentRefs} from './content'
import {queryKeys} from './models/query-keys'

/**
 * The documents whose comment data changes when a comment is published: the document it was
 * written on, and every document it cites through an embed, a link or a mention. A cited
 * document's comment count and block discussions include the citing comment, so it has to be
 * refreshed just like the target.
 *
 * Ids are version-less (`hm://uid/path`), the form the cached queries are keyed by.
 */
export function getCommentAffectedDocumentIds(targetId: UnpackedHypermediaId, content: HMBlockNode[]): Set<string> {
  const ids = new Set<string>([targetId.id])
  for (const ref of extractAllContentRefs(content)) {
    if (ref.refId?.id) ids.add(ref.refId.id)
  }
  return ids
}

/** The comments above a reply in its thread, found in the cached comment lists of its document. */
function getCachedReplyAncestorIds(qc: QueryClient, replyParentId: string): Set<string> {
  const parents = new Map<string, string>()
  for (const [, data] of qc.getQueriesData<HMListCommentsOutput>({queryKey: [queryKeys.DOCUMENT_COMMENTS]})) {
    for (const item of data?.comments || []) {
      if (item.replyParent) parents.set(item.id, item.replyParent)
    }
  }
  const ancestors = new Set<string>()
  let current: string | undefined = replyParentId
  while (current && !ancestors.has(current)) {
    ancestors.add(current)
    current = parents.get(current)
  }
  return ancestors
}

/**
 * Refreshes cached data after a comment is published, and only the data that comment can change.
 *
 * Invalidating whole query families refetches them for every document in the cache. On a page
 * listing many documents that was 80+ requests for a single comment, enough to exceed the proxy's
 * in-flight limit. Here each family is narrowed to the affected documents (see
 * `getCommentAffectedDocumentIds`), and queries nobody is looking at are only marked stale, so they
 * refetch when next shown.
 */
export function invalidateAfterCommentPublish(
  qc: QueryClient,
  {targetId, comment}: {targetId: UnpackedHypermediaId; comment: Pick<HMComment, 'content' | 'replyParent'>},
) {
  const affected = getCommentAffectedDocumentIds(targetId, comment.content)
  const keyedByDocumentId = (query: Query) => typeof query.queryKey[1] === 'string' && affected.has(query.queryKey[1])
  const keyedByDocument = (query: Query) => {
    const id = (query.queryKey[1] as UnpackedHypermediaId | null | undefined)?.id
    return typeof id === 'string' && affected.has(id)
  }

  // Comment counts, on the document and on each card that shows one.
  qc.invalidateQueries({queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY], predicate: keyedByDocumentId})
  qc.invalidateQueries({queryKey: [queryKeys.DOC_CITATIONS], predicate: keyedByDocumentId})
  qc.invalidateQueries({queryKey: [queryKeys.DOCUMENT_ACTIVITY], predicate: keyedByDocumentId})

  // Comment lists.
  qc.invalidateQueries({queryKey: [queryKeys.DOCUMENT_COMMENTS], predicate: keyedByDocument})
  qc.invalidateQueries({queryKey: [queryKeys.DOCUMENT_DISCUSSION], predicate: keyedByDocument})
  qc.invalidateQueries({queryKey: [queryKeys.BLOCK_DISCUSSIONS], predicate: keyedByDocument})

  // Reply counts of the comments above this one in its thread.
  if (comment.replyParent) {
    const ancestors = getCachedReplyAncestorIds(qc, comment.replyParent)
    qc.invalidateQueries({
      queryKey: [queryKeys.COMMENT_REPLY_COUNT],
      predicate: (query) => typeof query.queryKey[1] === 'string' && ancestors.has(query.queryKey[1]),
    })
  }

  // Query blocks carry a comment count per listed document, so only the ones listing an affected
  // document change. A comment cannot add a document to a query's results.
  qc.invalidateQueries({
    queryKey: [queryKeys.QUERY_BLOCK],
    predicate: (query) => {
      const data = query.state.data as
        | {results?: {id?: {id?: string}}[]; interactionSummaries?: Record<string, unknown>}
        | null
        | undefined
      if (!data) return false
      if (data.results?.some((result) => !!result.id?.id && affected.has(result.id.id))) return true
      return Object.keys(data.interactionSummaries || {}).some((id) => affected.has(id))
    },
  })

  // A feed can show the new comment whatever it is filtered by, and few are ever open.
  qc.invalidateQueries({queryKey: [queryKeys.ACTIVITY_FEED]})
}
