import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, HMIDTypeSchema} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, type, uid] = pathParts
  const t = HMIDTypeSchema.parse(type)
  const result = await queryClient.comments.listCommentsByAuthor({
    author: uid,
    pageSize: BIG_INT,
  })
  return {comments: result.comments.map((m) => m.toJson())}
})
