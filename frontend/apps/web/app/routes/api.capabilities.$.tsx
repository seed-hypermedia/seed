import {queryClient} from '@/client'
import {apiGetter} from '@/server-api'
import {BIG_INT, hmIdPathToEntityQueryPath} from '@shm/shared'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _capabilities, uid, ...restPath] = pathParts
  const result = await queryClient.accessControl.listCapabilities({
    account: uid,
    path: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return result.toJson({emitDefaultValues: true})
})
