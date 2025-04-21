import {getHMDocument} from '@/loaders'
import {apiGetterWithParams, BadRequestError} from '@/server-api'
import {hmId} from '@shm/shared'

export const loader = apiGetterWithParams(async (req, params) => {
  const version = req.url.searchParams.get('v')
  const latest = req.url.searchParams.get('l') === 'true'
  const entityPath = params['*']?.split('/')
  const uid = entityPath?.[0]
  const path = entityPath?.slice(1)
  if (!uid) {
    throw new BadRequestError('No uid provided')
  }
  const id = hmId('d', uid, {path: path || [], version, latest})
  const loaded = await getHMDocument(id)
  return loaded
})
