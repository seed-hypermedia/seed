/**
 * The file proxy (`/hm/api/file/<cid>`) is the extension asset endpoint. The
 * CID segment must be validated before it is interpolated into the daemon URL:
 * Remix decodes `%5C`, and Node's fetch normalizes `\` to `/` in http URLs, so
 * an unvalidated `..\debug\pprof\heap` would reach `${DAEMON_HTTP_URL}/debug/...`.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {daemonIpfsUrl, parseCidParam} from '../utils/cid-param'

vi.mock('@/daemon-auth.server', () => ({
  getDaemonAuthToken: async () => 'daemon-token',
  withDaemonAuthToken: (_token: unknown, fn: () => unknown) => fn(),
}))

import {loader} from '../routes/hm.api.file.$'

const VALID_CID_V1 = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
const VALID_CID_V0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'

describe('parseCidParam', () => {
  it('accepts CIDv1 and CIDv0 and ignores anything after the first slash', () => {
    expect(parseCidParam(VALID_CID_V1)).toBe(VALID_CID_V1)
    expect(parseCidParam(VALID_CID_V0)).toBe(VALID_CID_V0)
    expect(parseCidParam(`${VALID_CID_V1}/ignored/tail`)).toBe(VALID_CID_V1)
  })

  it('rejects missing, malformed and traversal-shaped values', () => {
    expect(parseCidParam(undefined)).toBeNull()
    expect(parseCidParam('')).toBeNull()
    expect(parseCidParam('/')).toBeNull()
    expect(parseCidParam('not-a-cid')).toBeNull()
    expect(parseCidParam('..\\debug\\pprof\\heap')).toBeNull()
    expect(parseCidParam('..')).toBeNull()
    expect(parseCidParam(`${VALID_CID_V1}?x=1`)).toBeNull()
    expect(parseCidParam(`${VALID_CID_V1}#frag`)).toBeNull()
  })

  it('builds the daemon /ipfs URL from the validated CID only', () => {
    const url = new URL(daemonIpfsUrl(VALID_CID_V1))
    expect(url.pathname).toBe(`/ipfs/${VALID_CID_V1}`)
    expect(url.search).toBe('')
  })
})

describe('/hm/api/file loader', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function run(splat: string, headers?: Record<string, string>) {
    return loader({
      params: {'*': splat},
      request: new Request(`https://seed.example/hm/api/file/${splat}`, {headers}),
      context: {},
    } as any) as Promise<Response>
  }

  it('returns 400 without touching the daemon when the CID segment is not a CID', async () => {
    const res = await run('..\\debug\\pprof\\heap')
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')

    expect((await run('')).status).toBe(400)
    expect((await run('nope')).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proxies a valid CID to the daemon /ipfs endpoint, forwarding Range and the auth token', async () => {
    fetchMock.mockResolvedValue(
      new Response('bytes', {
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-range': 'bytes 0-4/100',
          'accept-ranges': 'bytes',
          'cache-control': 'public, max-age=1',
        },
      }),
    )
    const res = await run(`${VALID_CID_V1}/video.mp4`, {range: 'bytes=0-4'})

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(new URL(calledUrl).pathname).toBe(`/ipfs/${VALID_CID_V1}`)
    expect(init.headers).toMatchObject({Range: 'bytes=0-4', Authorization: 'Bearer daemon-token'})

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Type')).toBe('video/mp4')
    expect(res.headers.get('Content-Range')).toBe('bytes 0-4/100')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('Range')
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('Content-Range')
    expect(await res.text()).toBe('bytes')
  })

  it('answers OPTIONS preflight with CORS headers and no daemon call', async () => {
    const res = (await loader({
      params: {'*': VALID_CID_V1},
      request: new Request(`https://seed.example/hm/api/file/${VALID_CID_V1}`, {method: 'OPTIONS'}),
      context: {},
    } as any)) as Response
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
