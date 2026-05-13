import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useQuery} from '@tanstack/react-query'
import {useUniversalClient} from '../routing'
import {
  queryBlockDiscussions,
  queryCommentReplyCount,
  queryCommentVersions,
  queryDocumentComments,
  queryDocumentDiscussions,
} from './queries'

/** Fetches comments for the main document comments view. */
export function useDocumentComments(targetId: UnpackedHypermediaId) {
  const client = useUniversalClient()
  return useQuery(queryDocumentComments(client, targetId))
}

/** Fetches grouped discussions for a document or focused comment. */
export function useDocumentDiscussions(targetId: UnpackedHypermediaId, commentId?: string) {
  const client = useUniversalClient()
  return useQuery(queryDocumentDiscussions(client, targetId, commentId))
}

/** Fetches comments that reference a specific document block. */
export function useBlockDiscussions(targetId: UnpackedHypermediaId) {
  const client = useUniversalClient()
  return useQuery(queryBlockDiscussions(client, targetId))
}

/** Fetches all versions of a comment. */
export function useCommentVersions(commentId: string | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryCommentVersions(client, commentId))
}

/** Fetches the number of replies to a comment. */
export function useCommentReplyCount({id}: {id: string}) {
  const client = useUniversalClient()
  return useQuery(queryCommentReplyCount(client, id))
}
