import {grpcClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmId, packHmId} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, uid, ...restPath] = pathParts
  const result = await grpcClient.entities.listEntityMentions({
    id: packHmId(
      hmId(uid, {
        path: restPath,
      }),
    ),
    pageSize: BIG_INT,
  })
  return {citations: result.mentions.map((m) => m.toJson())}
})
