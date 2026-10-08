import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  getInfo: vi.fn(),
  connect: vi.fn(),
  getConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {getInfo: mocks.getInfo},
    networking: {connect: mocks.connect},
  },
}))
vi.mock('@/site-config.server', () => ({getConfig: mocks.getConfig, writeConfig: mocks.writeConfig}))

import {action, loader} from '../routes/hm.api.register'

function register(input: {peerId?: string; registrationSecret?: string} = {}) {
  return action({
    request: new Request('http://myspace.localhost:3000/hm/api/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        registrationSecret: 'setup-secret',
        accountUid: 'space-account',
        peerId: 'publishing-peer',
        addrs: ['/ip4/127.0.0.1/tcp/5800'],
        ...input,
      }),
    }),
    params: {},
    context: {},
  } as any) as Promise<Response>
}

describe('/hm/api/register action', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.getConfig.mockResolvedValue({availableRegistrationSecret: 'setup-secret'})
    mocks.getInfo.mockResolvedValue({peerId: 'hosting-peer'})
    mocks.connect.mockResolvedValue({})
    mocks.writeConfig.mockResolvedValue(undefined)
  })

  it('registers a space hosted by the same daemon without dialing itself', async () => {
    mocks.getInfo.mockResolvedValue({peerId: 'publishing-peer'})
    const response = await register()

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({message: 'Success'})
    expect(mocks.getInfo).toHaveBeenCalledWith({})
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.writeConfig).toHaveBeenCalledWith('myspace.localhost', {
      registeredAccountUid: 'space-account',
      sourcePeerId: 'publishing-peer',
    })
  })

  it('connects to a different publishing daemon before saving registration', async () => {
    const response = await register()

    expect(response.status).toBe(200)
    expect(mocks.connect).toHaveBeenCalledWith({addrs: ['/ip4/127.0.0.1/tcp/5800/p2p/publishing-peer']})
    expect(mocks.writeConfig).toHaveBeenCalledWith('myspace.localhost', {
      registeredAccountUid: 'space-account',
      sourcePeerId: 'publishing-peer',
    })
    expect(mocks.connect.mock.invocationCallOrder[0]).toBeLessThan(mocks.writeConfig.mock.invocationCallOrder[0]!)
  })

  it('returns real connection failures without recording the space as registered', async () => {
    mocks.connect.mockRejectedValue(new Error('peer unavailable'))
    const response = await register()

    expect(response.status).toBe(500)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.json()).toEqual({message: 'peer unavailable'})
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it('rejects an invalid secret before querying, dialing, or saving daemon configuration', async () => {
    const response = await register({registrationSecret: 'wrong-secret'})

    expect(response.status).toBe(500)
    expect(mocks.getInfo).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it('does not treat empty peer identities as a same-daemon match', async () => {
    mocks.getInfo.mockResolvedValue({peerId: ''})
    mocks.connect.mockRejectedValue(new Error('invalid peer identity'))
    const response = await register({peerId: ''})

    expect(response.status).toBe(500)
    expect(mocks.connect).toHaveBeenCalledOnce()
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it('does not save registration when the hosting daemon identity cannot be loaded', async () => {
    mocks.getInfo.mockRejectedValue(new Error('daemon unavailable'))
    const response = await register()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({message: 'daemon unavailable'})
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })

  it.each([action, loader])(
    'allows a cross-origin browser preflight without reading or mutating config',
    async (handler) => {
      const response = (await handler({
        request: new Request('https://myspace.hyper.media/hm/api/register', {
          method: 'OPTIONS',
          headers: {Origin: 'https://hyper.media', 'Access-Control-Request-Method': 'POST'},
        }),
        params: {},
        context: {},
      } as any)) as Response
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type')
      expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false)
      expect(mocks.getConfig).not.toHaveBeenCalled()
      expect(mocks.getInfo).not.toHaveBeenCalled()
      expect(mocks.connect).not.toHaveBeenCalled()
      expect(mocks.writeConfig).not.toHaveBeenCalled()
    },
  )

  it.each(['GET', 'DELETE', 'PATCH'])('rejects %s before accessing registration state', async (method) => {
    const handler = method === 'GET' ? loader : action
    const response = (await handler({
      request: new Request('https://myspace.hyper.media/hm/api/register', {method}),
      params: {},
      context: {},
    } as any)) as Response
    expect(response.status).toBe(405)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(mocks.getConfig).not.toHaveBeenCalled()
    expect(mocks.writeConfig).not.toHaveBeenCalled()
  })
})
