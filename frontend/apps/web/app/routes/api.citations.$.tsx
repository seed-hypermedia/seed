import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmId, packHmId} from '@shm/shared'

export const loader = apiGetter(async (req) => {
  const [_api, _document, uid, ...restPath] = req.pathParts
  const result = await queryClient.entities.listEntityMentions({
    id: packHmId(
      hmId('d', uid, {
        path: restPath,
      }),
    ),
    pageSize: BIG_INT,
  })
  return result.toJson()
})
