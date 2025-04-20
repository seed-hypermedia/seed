import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'

export const loader = apiGetter(async (req) => {
  const [_api, _document, uid, ...restPath] = req.pathParts
  const result = await queryClient.documents.listDocumentChanges({
    account: uid,
    path: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return result.toJson()
})
