import {grpcClient} from '@/client.server'
import {apiGetter} from '@/server-api'
import {hmIdPathToEntityQueryPath} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'

export const loader = apiGetter(async ({pathParts}) => {
  const [_api, _capabilities, uid, ...restPath] = pathParts
  const result = await grpcClient.accessControl.listCapabilities({
    account: uid,
    path: hmIdPathToEntityQueryPath(restPath),
    pageSize: BIG_INT,
  })
  return result.toJson()
})
