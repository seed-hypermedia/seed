import {getResource} from '@/loaders'
import {parseRequest} from '@/request'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {hmId, HMResource} from '@shm/shared'

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMResource>> => {
  const parsedRequest = parseRequest(request)
  const {url} = parsedRequest
  const version = url.searchParams.get('v')
  const latest = url.searchParams.get('l') === 'true'
  const entityPath = params['*']?.split('/')
  const uid = entityPath?.[0]
  const path = entityPath?.slice(1)
  if (!uid) {
    throw new Error('No uid provided')
  }
  const id = hmId(uid, {path: path || [], version, latest})
  const resource = await getResource(id)
  return wrapJSON(resource)
}
