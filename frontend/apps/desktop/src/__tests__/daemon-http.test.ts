import {afterEach, describe, expect, it, vi} from 'vitest'
import {createPromiseClient} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {Daemon} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_connect'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'
import {daemonAuthInterceptor, daemonFetch} from '@shm/shared/daemon-http'

afterEach(() => {
  delete window.daemonAppSecret
  vi.unstubAllGlobals()
})

describe('daemon authentication', () => {
  it('attaches the launch credential to a real grpc-web transport request', async () => {
    window.daemonAppSecret = 'launch-secret'
    const transportFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('X-Seed-App-Secret')).toBe('launch-secret')
      throw new Error('request captured')
    })
    vi.stubGlobal('fetch', transportFetch)
    const client = createPromiseClient(
      Daemon,
      createGrpcWebTransport({baseUrl: DAEMON_HTTP_URL, interceptors: [daemonAuthInterceptor]}),
    )
    await expect(client.getInfo({})).rejects.toThrow('request captured')
    expect(transportFetch).toHaveBeenCalledOnce()
  })

  it('authenticates uploads and private reads while preserving headers and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    window.daemonAppSecret = 'launch-secret'
    const body = new FormData()
    body.append('file', new Blob(['hello']), 'hello.txt')
    await daemonFetch(`${DAEMON_HTTP_URL}/ipfs/file-upload`, {
      method: 'POST',
      body,
      headers: {Authorization: 'Bearer token'},
    })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.body).toBe(body)
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer token')
    expect(new Headers(init.headers).get('X-Seed-App-Secret')).toBe('launch-secret')
    expect(init.redirect).toBe('error')
    await daemonFetch(new Request(`${DAEMON_HTTP_URL}/ipfs/cid`, {headers: {Range: 'bytes=0-9'}}))
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Range')).toBe('bytes=0-9')
  })

  it('does not send the secret to other origins or put it in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    window.daemonAppSecret = 'launch-secret'
    expect(() => daemonFetch('https://example.com/ipfs/file-upload')).toThrow('daemon origin')
    expect(fetchMock).not.toHaveBeenCalled()
    await daemonFetch(`${DAEMON_HTTP_URL}/hm/api/config`)
    expect(fetchMock.mock.calls[0][0]).toBe(`${DAEMON_HTTP_URL}/hm/api/config`)
  })

  it('keeps non-desktop callers credential-less', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    await daemonFetch(`${DAEMON_HTTP_URL}/ipfs/file-upload`, {method: 'POST'})
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('X-Seed-App-Secret')).toBe(false)
  })
})
