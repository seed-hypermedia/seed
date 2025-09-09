import {grpcClient} from '@/grpc-client'
import {
  BIG_INT,
  calculateInteractionSummary,
  hmIdPathToEntityQueryPath,
  InteractionSummaryPayload,
  queryKeys,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useQuery} from '@tanstack/react-query'

export function useInteractionSummary(
  docId?: UnpackedHypermediaId | null,
  {enabled}: {enabled?: boolean} = {},
) {
  return useQuery({
    enabled: enabled !== false && !!docId,
    queryKey: [queryKeys.DOCUMENT_INTERACTION_SUMMARY, docId?.id],
    queryFn: async (): Promise<InteractionSummaryPayload> => {
      if (!docId) {
        return {
          citations: 0,
          comments: 0,
          changes: 0,
          blocks: {},
        }
      }

      // Fetch all required data in parallel
      const [mentions, comments, latestDoc] = await Promise.all([
        grpcClient.entities.listEntityMentions({
          id: docId.id,
          pageSize: BIG_INT,
        }),
        grpcClient.comments.listComments({
          targetAccount: docId.uid,
          targetPath: hmIdPathToEntityQueryPath(docId.path),
          pageSize: BIG_INT,
        }),
        grpcClient.documents.getDocument({
          account: docId.uid,
          path: hmIdPathToEntityQueryPath(docId.path),
          version: undefined,
        }),
      ])

      // Fetch changes using the latest document version
      const changes = await grpcClient.documents.listDocumentChanges({
        account: docId.uid,
        path:
          docId.path && docId.path.length > 0 ? '/' + docId.path.join('/') : '',
        version: latestDoc.version,
      })

      // Use the shared calculation function
      return calculateInteractionSummary(
        mentions.mentions,
        comments.comments,
        changes.changes,
        docId,
      )
    },
  })
}
