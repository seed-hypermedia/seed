import {grpcClient} from '@/grpc-client'
import {toPlainMessage} from '@bufbuild/protobuf'
import {normalizeDate} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMChangeSummary,
  HMDocumentChangeInfo,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {useQuery} from '@tanstack/react-query'
import {useContacts} from './contacts'

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

export function useDocumentChanges(id: UnpackedHypermediaId) {
  const publishedChanges = useDocumentPublishedChanges(id)
  const changeAuthorIds: Set<string> = new Set()
  publishedChanges.data?.forEach((change) => {
    changeAuthorIds.add(change.author)
  })
  const changeAuthorIdList = Array.from(changeAuthorIds)
  const changeAuthors = useContacts(changeAuthorIdList)
  const changes: HMDocumentChangeInfo[] = []
  const authors = Object.fromEntries(
    changeAuthorIdList
      .map((id, index) => [id, changeAuthors[index]?.data])
      .filter(([id, a]) => !!a),
  )
  publishedChanges.data?.forEach((change) => {
    const author = authors[change.author]
    const createTime = normalizeDate(change.createTime)?.toISOString()
    if (author && createTime) {
      changes.push({
        ...change,
        createTime,
        author,
      })
    }
  })
  if (!publishedChanges.data) return publishedChanges
  return {
    ...publishedChanges,
    data: changes,
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
