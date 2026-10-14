import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  handleApiRequest: vi.fn(),
  handleApiAction: vi.fn(),
}))

vi.mock('@/client.server', () => ({grpcClient: {}}))
vi.mock('@shm/shared/api-server', () => ({
  handleApiRequest: mocks.handleApiRequest,
  handleApiAction: mocks.handleApiAction,
}))

import {signWebSession, WEB_SESSION_COOKIE} from '@/web-session.server'
import {action, loader} from '../routes/api.$'

const SECRET = 'test-session-secret'
const ok = {status: 200, body: '{}', headers: {'Content-Type': 'application/json'}}

function get(key: string, headers: HeadersInit = {}) {
  return loader({
    request: new Request(`http://site.localhost:3000/api/${key}?id=hm://z6Mk`, {headers}),
    params: {'*': key},
    context: {},
  } as any) as Promise<Response>
}

function post(key: string, headers: HeadersInit = {}) {
  return action({
    request: new Request(`http://site.localhost:3000/api/${key}`, {method: 'POST', headers, body: new Uint8Array()}),
    params: {'*': key},
    context: {},
  } as any) as Promise<Response>
}

function sessionCookie() {
  return `${WEB_SESSION_COOKIE}=${signWebSession({account: 'z6MkMember', exp: Date.now() / 1000 + 3600}, SECRET)}`
}

describe('/api gate under SEED_REQUIRE_SIGN_IN', () => {
  const env = {...process.env}
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.handleApiRequest.mockResolvedValue(ok)
    mocks.handleApiAction.mockResolvedValue(ok)
    process.env.SEED_REQUIRE_SIGN_IN = '1'
    process.env.SEED_SESSION_SECRET = SECRET
  })
  afterEach(() => {
    for (const name of ['SEED_REQUIRE_SIGN_IN', 'SEED_SESSION_SECRET', 'SEED_SERVICE_SECRET'] as const) {
      if (env[name] === undefined) delete process.env[name]
      else process.env[name] = env[name]
    }
  })

  it('answers 401 to an anonymous read', async () => {
    const response = await get('Resource')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({error: 'Sign in required'})
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it('answers 401 to an anonymous action', async () => {
    const response = await post('CreateComment')
    expect(response.status).toBe(401)
    expect(mocks.handleApiAction).not.toHaveBeenCalled()
  })

  it('serves a request that carries the web session cookie', async () => {
    const response = await get('Resource', {Cookie: sessionCookie()})
    expect(response.status).toBe(200)
    expect(mocks.handleApiRequest).toHaveBeenCalledTimes(1)
  })

  it('does not accept a bearer token as membership', async () => {
    const response = await get('Resource', {Authorization: 'Bearer api-token'})
    expect(response.status).toBe(401)
    expect(mocks.handleApiRequest).not.toHaveBeenCalled()
  })

  it("serves the box's own services that present the service secret", async () => {
    process.env.SEED_SERVICE_SECRET = 'service-secret'
    expect((await get('ListEvents', {'X-Seed-Service-Secret': 'service-secret'})).status).toBe(200)
    expect((await get('ListEvents', {'X-Seed-Service-Secret': 'wrong-secret!!'})).status).toBe(401)
    delete process.env.SEED_SERVICE_SECRET
    expect((await get('ListEvents', {'X-Seed-Service-Secret': ''})).status).toBe(401)
    expect((await get('ListEvents', {'X-Seed-Service-Secret': 'service-secret'})).status).toBe(401)
  })

  it('keeps the sign-in bootstrap calls open', async () => {
    expect((await post('PublishBlobs')).status).toBe(200)
    expect(mocks.handleApiAction).toHaveBeenCalledWith(
      'PublishBlobs',
      expect.anything(),
      expect.anything(),
      expect.any(Function),
    )
    expect((await get('Account')).status).toBe(200)
    expect((await get('PublishBlobs')).status).toBe(401)
  })

  it('stays open when the gate is off', async () => {
    delete process.env.SEED_REQUIRE_SIGN_IN
    expect((await get('Resource')).status).toBe(200)
    expect((await post('CreateComment')).status).toBe(200)
  })
})
