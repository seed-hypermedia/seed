import {grpcClient} from '@/client.server'
import {apiGetter} from '@/server-api'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, uid, ...restPath] = pathParts
  const result = await grpcClient.comments.listComments({
    targetAccount: uid,
    targetPath: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return {comments: result.comments.map((m) => m.toJson())}
})
