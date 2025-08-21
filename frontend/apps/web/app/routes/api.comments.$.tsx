import {grpcClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, uid, ...restPath] = pathParts
  const result = await grpcClient.comments.listComments({
    targetAccount: uid,
    targetPath: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return {comments: result.comments.map((m) => m.toJson())}
})
