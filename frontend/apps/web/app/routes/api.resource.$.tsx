import {resolveHMDocument} from '@/loaders'
import {apiGetter} from '@/server-api'
import {hmId} from '@shm/shared'

export const loader = apiGetter(async (req) => {
  const pathParts = req.pathParts
  const [_api, _document, uid, ...restPath] = pathParts

  // @ts-expect-error
  return resolveHMDocument(hmId(uid, {path: restPath}))
})
