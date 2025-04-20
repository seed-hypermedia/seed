import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'

export const loader = apiGetter(async (req) => {
  const pathParts = req.pathParts
  const [_api, _document, uid, ...restPath] = pathParts
  const result = await queryClient.comments.listComments({
    targetAccount: uid,
    targetPath: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return result.toJson()
})
