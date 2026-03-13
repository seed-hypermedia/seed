import {fetchResource} from '@/loaders'
import {parseRequest} from '@/request'
import {withCors} from '@/utils/cors'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {HMResource} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'

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
  const latest = url.searchParams.get('l') === '' || !version
  const entityPath = params['*']?.split('/')
  const uid = entityPath?.[0]
  const path = entityPath?.slice(1).filter((term) => term !== '')
  if (!uid) {
    throw new Error('No uid provided')
  }
  const id = hmId(uid, {path: path || [], version, latest})
  const resource = await fetchResource(id)
  return withCors(wrapJSON(resource))
}
