import {grpcClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT} from '@shm/shared/constants'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, uid] = pathParts
  const result = await grpcClient.comments.listCommentsByAuthor({
    author: uid,
    pageSize: BIG_INT,
  })
  return {comments: result.comments.map((m) => m.toJson())}
})
