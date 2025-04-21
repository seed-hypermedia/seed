import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'

export const loader = apiGetter(async (req) => {
  const [_api, _changes, uid, ...restPath] = req.pathParts
  const path = hmIdPathToEntityQueryPath(restPath)
  const latestDoc = await queryClient.documents.getDocument({
    account: uid,
    path,
    version: undefined,
  })
  const result = await queryClient.documents.listDocumentChanges({
    account: uid,
    path,
    version: latestDoc.version,
    pageSize: BIG_INT,
  })
  return result.toJson()
})
