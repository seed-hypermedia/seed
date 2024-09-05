import {useGRPCClient} from '@/app-context'
import {toPlainMessage} from '@bufbuild/protobuf'
import {hmIdPathToEntityQueryPath, UnpackedHypermediaId} from '@shm/shared'
import {useQuery} from '@tanstack/react-query'
import {useEntity} from './entities'
import {queryKeys} from './query-keys'

export function useDocumentChanges(id: UnpackedHypermediaId) {
  const grpcClient = useGRPCClient()
  const entity = useEntity(id)
  const version = id.version || entity.data?.document?.version
  const path = hmIdPathToEntityQueryPath(id.path)
  return useQuery({
    queryKey: [queryKeys.ENTITY_CHANGES, id.uid, path, version],
    queryFn: async () => {
      if (!version) return []
      const result = await grpcClient.documents.listDocumentChanges({
        account: id.uid,
        path,
        version,
      })
      return result.changes.map(toPlainMessage)
    },
  })
}
