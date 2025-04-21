import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmId, HMIDTypeSchema, packHmId} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _citations, type, uid, ...restPath] = pathParts
  const t = HMIDTypeSchema.parse(type)
  const result = await queryClient.entities.listEntityMentions({
    id: packHmId(
      hmId(t, uid, {
        path: restPath,
      }),
    ),
    pageSize: BIG_INT,
  })
  return {citations: result.mentions.map((m) => m.toJson())}
})
