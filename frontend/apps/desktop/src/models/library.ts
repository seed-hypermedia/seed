import {grpcClient} from '@/grpc-client'
import {HMLibraryDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {BIG_INT} from '@shm/shared/constants'
import {documentMetadataParseAdjustments, prepareHMDocumentInfo} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useQuery} from '@tanstack/react-query'
import {useComments} from './comments'

export function useSiteLibrary(siteUid: string | null | undefined, enabled: boolean) {
  const siteDocuments = useQuery({
    queryKey: [queryKeys.SITE_LIBRARY, siteUid],
    enabled,
    queryFn: async () => {
      if (!siteUid) return {documents: []}
      const res = await grpcClient.documents.listDocuments({
        account: siteUid,
        pageSize: BIG_INT,
      })
      res.documents?.forEach((d) => {
        documentMetadataParseAdjustments(d.metadata)
      })
      return {
        documents: res.documents.map((d) => prepareHMDocumentInfo(d)),
      }
    },
  })
  const commentIds = siteDocuments.data?.documents
    .map((doc) => doc.activitySummary?.latestCommentId)
    .filter((commentId) => commentId != null)
    .filter((commentId) => commentId.length)
    .map((commentId) => hmId(commentId))
  const comments = useComments(commentIds || [])

  const data =
    siteDocuments.data?.documents.map(
      (doc) =>
        ({
          ...doc,
          latestComment: comments.data?.find((c) => c?.id === doc.activitySummary?.latestCommentId),
        }) satisfies HMLibraryDocument,
    ) || []

  return {
    ...siteDocuments,
    data,
  }
}

export function useChildrenActivity(docId: UnpackedHypermediaId | null | undefined, opts?: {enabled?: boolean}) {
  const siteLibrary = useSiteLibrary(docId?.uid, !!docId && opts?.enabled !== false)
  const path = docId?.path
  const pathPrefix = docId?.path?.join('/') || ''
  return {
    ...siteLibrary,
    data: siteLibrary.data?.filter((item) => {
      if (!item.path?.length) return false
      if (item.path.length !== (path?.length || 0) + 1) return false
      const pathStr = item.path.join('/')
      if (!pathStr.startsWith(pathPrefix)) return false
      return true
    }),
  }
}

/**
 * Fetches all documents with activity summaries.
 * Returns a map of document id (id.id) -> HMLibraryDocument for quick lookup.
 */
export function useSubscribedDocuments() {
  const allDocuments = useQuery({
    queryKey: [queryKeys.LIBRARY],
    queryFn: async () => {
      const res = await grpcClient.documents.listDocuments({
        pageSize: BIG_INT,
      })
      return res.documents.map((docInfo) => prepareHMDocumentInfo(docInfo))
    },
  })

  // Fetch comments for document-level activity
  const commentIds = (allDocuments.data || [])
    .map((doc) => doc.activitySummary?.latestCommentId)
    .filter((id): id is string => !!id && id.length > 0)
    .map((id) => hmId(id))
  const comments = useComments(commentIds)

  // Build map of document id -> document with latestComment
  const documentsMap = new Map<string, HMLibraryDocument>()
  if (allDocuments.data) {
    for (const doc of allDocuments.data) {
      documentsMap.set(doc.id.id, {
        ...doc,
        latestComment: doc.activitySummary?.latestCommentId
          ? comments.data?.find((c) => c?.id === doc.activitySummary?.latestCommentId)
          : undefined,
      })
    }
  }

  return {
    ...allDocuments,
    data: documentsMap,
  }
}
