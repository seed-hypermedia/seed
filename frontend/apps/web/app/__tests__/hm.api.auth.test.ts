import {Code, ConnectError} from '@connectrpc/connect'
import {Timestamp} from '@bufbuild/protobuf'
import {AuthenticateRequest} from '@shm/shared/client/grpc-types'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolveMemberAccount: vi.fn(),
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {
      authenticate: mocks.authenticate,
    },
  },
}))
vi.mock('@/site-membership.server', () => ({resolveMemberAccount: mocks.resolveMemberAccount}))

import {verifyWebSession, WEB_SESSION_COOKIE} from '@/web-session.server'
import {action} from '../routes/hm.api.auth'

function makeAuthRequest() {
  return new Request('http://localhost/hm/api/auth', {
    method: 'POST',
    headers: {'Content-Type': 'application/protobuf'},
    body: new AuthenticateRequest({
      account: new Uint8Array([1, 2, 3]),
      timestamp: BigInt(Date.now()),
      signature: new Uint8Array([4, 5, 6]),
    }).toBinary(),
  })
}

describe('/hm/api/auth action', () => {
  it('maps daemon permission denials instead of surfacing them as 500s', async () => {
    mocks.authenticate.mockRejectedValueOnce(
      new ConnectError('authentication principal is not known', Code.PermissionDenied),
    )

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('authentication principal is not known')
  })

  it('maps unavailable daemon auth errors to service unavailable', async () => {
    mocks.authenticate.mockRejectedValueOnce(new ConnectError('daemon unavailable', Code.Unavailable))

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(503)
    expect(await response.text()).toContain('daemon unavailable')
  })
})

describe('/hm/api/auth action under SEED_REQUIRE_SIGN_IN', () => {
  const SECRET = 'test-session-secret'
  const env = {...process.env}
  const expiresAt = Math.floor(Date.now() / 1000) + 3600

  beforeEach(() => {
    vi.resetAllMocks()
    process.env.SEED_REQUIRE_SIGN_IN = '1'
    process.env.SEED_SESSION_SECRET = SECRET
    mocks.authenticate.mockResolvedValue({
      bearerToken: 'daemon-token',
      expireTime: Timestamp.fromDate(new Date(expiresAt * 1000)),
    })
  })
  afterEach(() => {
    for (const name of ['SEED_REQUIRE_SIGN_IN', 'SEED_SESSION_SECRET'] as const) {
      if (env[name] === undefined) delete process.env[name]
      else process.env[name] = env[name]
    }
  })

  // withCors re-appends Set-Cookie on top of the copied headers, so dedupe.
  function setCookies(response: Response) {
    return [...new Set(response.headers.getSetCookie())]
  }

  it('refuses a non-member with 403 and sets no cookies', async () => {
    mocks.resolveMemberAccount.mockResolvedValue(null)

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('not a member')
    expect(setCookies(response)).toEqual([])
  })

  it('gives a member both the daemon cookie and a signed web session', async () => {
    mocks.resolveMemberAccount.mockResolvedValue('z6MkMember')

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(204)
    const cookies = setCookies(response)
    expect(cookies).toHaveLength(2)
    const session = cookies.find((c) => c.startsWith(`${WEB_SESSION_COOKIE}=`))!
    expect(session).toContain('HttpOnly')
    const value = session.slice(WEB_SESSION_COOKIE.length + 1).split(';')[0]!
    expect(verifyWebSession(value, SECRET)).toEqual({account: 'z6MkMember', exp: expiresAt})
    expect(cookies.some((c) => c.startsWith('HM-Auth-Token='))).toBe(true)
  })

  it('refuses to mint sessions without SEED_SESSION_SECRET', async () => {
    delete process.env.SEED_SESSION_SECRET
    mocks.resolveMemberAccount.mockResolvedValue('z6MkMember')

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(503)
    expect(setCookies(response)).toEqual([])
    expect(mocks.resolveMemberAccount).not.toHaveBeenCalled()
  })

  it('clears both cookies on sign-out', async () => {
    const response = await action({
      request: new Request('http://localhost/hm/api/auth', {method: 'DELETE'}),
      params: {},
      context: {},
    } as any)

    expect(response.status).toBe(204)
    const cookies = setCookies(response)
    expect(cookies.some((c) => c.startsWith(`${WEB_SESSION_COOKIE}=;`))).toBe(true)
    expect(cookies.some((c) => c.startsWith('HM-Auth-Token=;'))).toBe(true)
  })

  it('skips the membership check when the gate is off', async () => {
    delete process.env.SEED_REQUIRE_SIGN_IN

    const response = await action({request: makeAuthRequest(), params: {}, context: {}} as any)

    expect(response.status).toBe(204)
    expect(mocks.resolveMemberAccount).not.toHaveBeenCalled()
    expect(setCookies(response)).toHaveLength(1)
  })
})
