import {useGRPCClient} from '@/app-context'
import {PlainMessage, toPlainMessage} from '@bufbuild/protobuf'
import {
  DocumentChangeInfo,
  hmIdPathToEntityQueryPath,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useQuery} from '@tanstack/react-query'
import {useEntity} from './entities'
import {queryKeys} from './query-keys'

export type HMChangeInfo = PlainMessage<DocumentChangeInfo>

export function useDocumentChanges(id: UnpackedHypermediaId) {
  const grpcClient = useGRPCClient()
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
      })
      return result.changes.map(toPlainMessage)
    },
  })
}

export function useVersionChanges(id: UnpackedHypermediaId) {
  const entity = useEntity(id)
  const version = id.version || entity.data?.document?.version
  const versionChanges = version?.split('.')
  if (!versionChanges) return null
  return new Set(versionChanges)
}
