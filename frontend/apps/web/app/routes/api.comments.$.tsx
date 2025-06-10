import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath, HMIDTypeSchema} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, type, uid, ...restPath] = pathParts
  const t = HMIDTypeSchema.parse(type)
  const result = await queryClient.comments.listComments({
    targetAccount: uid,
    targetPath: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return {comments: result.comments.map((m) => m.toJson())}
})
