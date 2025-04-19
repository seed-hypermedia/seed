import {json, LoaderFunction} from '@remix-run/node'
import {DAEMON_HTTP_URL} from '@shm/shared'
import {withCors} from '../utils/cors'

export const loader: LoaderFunction = async ({request}) => {
  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').slice(1)
  const [_api, _cid, cid] = pathParts
  const result = await fetch(`${DAEMON_HTTP_URL}/debug/cid/${cid}`)
  const value = await result.json()
  return withCors(json({value, cid}))
}
