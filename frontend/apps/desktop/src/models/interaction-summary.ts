import {fetchResource} from '@/models/entities'
import {grpcClient} from '@/grpc-client'
import {
  calculateInteractionSummary,
  HMResolvedResource,
  InteractionSummaryPayload,
  queryKeys,
  UnpackedHypermediaId,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {queryClient} from '@shm/shared/models/query-client'
import {useQuery} from '@tanstack/react-query'

// Resolve resource using React Query cache for deduplication
async function resolveResourceCached(
  id: UnpackedHypermediaId,
): Promise<HMResolvedResource | null> {
  const version = id.version || undefined
  const resource = await queryClient.fetchQuery({
    queryKey: [queryKeys.ENTITY, id.id, version],
    queryFn: () => fetchResource(id),
  })
  if (!resource) return null
  if (resource.type === 'redirect') {
    return resolveResourceCached(resource.redirectTarget)
  }
  if (resource.type === 'not-found') {
    return null
  }
  return resource
}

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

      // Fetch mentions and resolve resource (uses React Query cache)
      const [mentions, resource] = await Promise.all([
        grpcClient.entities.listEntityMentions({
          id: docId.id,
          pageSize: BIG_INT,
        }),
        resolveResourceCached(docId),
      ])

      if (!resource || resource.type !== 'document') {
        return {
          citations: 0,
          comments: 0,
          changes: 0,
          blocks: {},
        }
      }

      // Use resolved document's id and version for changes
      const resolvedId = resource.id
      const changes = await grpcClient.documents.listDocumentChanges({
        account: resolvedId.uid,
        path:
          resolvedId.path && resolvedId.path.length > 0
            ? '/' + resolvedId.path.join('/')
            : '',
        version: resource.document.version,
      })

      // Use the shared calculation function
      return calculateInteractionSummary(
        mentions.mentions,
        changes.changes,
        resolvedId,
      )
    },
  })
}
