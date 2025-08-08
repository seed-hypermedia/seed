import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmId, packHmId} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, uid, ...restPath] = pathParts
  const result = await queryClient.entities.listEntityMentions({
    id: packHmId(
      // @ts-expect-error
      hmId(uid, {
        path: restPath,
      }),
    ),
    pageSize: BIG_INT,
  })
  return {citations: result.mentions.map((m) => m.toJson())}
})
