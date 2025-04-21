import {apiGetter, BadRequestError, NotFoundError} from '@/server-api'
import {DAEMON_HTTP_URL} from '@shm/shared'
import {CID} from 'multiformats/cid'

export const loader = apiGetter(async (req) => {
  const [_api, _cid, cid] = req.pathParts
  const parsedCid = parseCid(cid)
  const result = await fetch(`${DAEMON_HTTP_URL}/debug/cid/${cid}`)
  if (result.status === 404) {
    throw new NotFoundError('CID not found')
  }
  const value = await result.json()
  return {value, cid, encoding: parsedCid.version}
})

function parseCid(cid: string) {
  try {
    return CID.parse(cid)
  } catch (error) {
    throw new BadRequestError('Invalid CID format')
  }
}
