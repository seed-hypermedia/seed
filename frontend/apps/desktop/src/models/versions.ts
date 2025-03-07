import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMChangeSummary,
  HMDraftChange,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {useQuery} from '@tanstack/react-query'
import {useDraft} from './accounts'

export function useDocumentPublishedChanges(id: UnpackedHypermediaId) {
  const entity = useEntity({...id, version: null})
  const version = entity.data?.document?.version
  const path = hmIdPathToEntityQueryPath(id.path)
  return useQuery({
    queryKey: [queryKeys.ENTITY_CHANGES, id.uid, path, version],
    queryFn: async () => {
      if (!version) return []
      const result = await grpcClient.documents.listDocumentChanges({
        account: id.uid,
        path,
        version,
        pageSize: BIG_INT,
      })
      let changes = result.changes
        .map(toPlainMessage)
        .map((change) => ({...change, type: 'change'}) as HMChangeSummary)

      return changes
    },
  })
}

export function useDocumentChanges(
  id: UnpackedHypermediaId,
  isDraft: boolean = false,
) {
  const publishedChanges = useDocumentPublishedChanges(id)
  const draft = useDraft(id)
  if (!publishedChanges.data) return publishedChanges
  return {
    ...publishedChanges,
    data: isDraft
      ? [
          {
            author: id.uid,
            id: `draft-${id.id}`,
            deps: draft.data?.deps,
            isDraft: true,
            lastUpdateTime: draft.data?.lastUpdateTime,
            type: 'draftChange',
          } as HMDraftChange,
          ...publishedChanges.data,
        ]
      : publishedChanges.data,
  }
}

export function useVersionChanges(
  id: UnpackedHypermediaId,
): null | Set<string> {
  const entity = useEntity(id)
  const version = id.version || entity.data?.document?.version
  const versionChanges = version?.split('.')
  if (!versionChanges) return null
  return new Set(versionChanges)
}
