import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {signWebSession, WEB_SESSION_COOKIE} from '@/web-session.server'
import {loader} from '../routes/hm.api.session'

const SECRET = 'test-session-secret'

function probe(headers: HeadersInit = {}) {
  return loader({
    request: new Request('http://site.localhost/hm/api/session', {headers}),
    params: {},
    context: {},
  } as any) as Promise<Response>
}

function sessionCookie(expOffsetSeconds = 3600) {
  return `${WEB_SESSION_COOKIE}=${signWebSession(
    {account: 'z6MkMember', exp: Date.now() / 1000 + expOffsetSeconds},
    SECRET,
  )}`
}

describe('/hm/api/session (forward_auth target)', () => {
  const env = {...process.env}
  beforeEach(() => {
    process.env.SEED_REQUIRE_SIGN_IN = '1'
    process.env.SEED_SESSION_SECRET = SECRET
  })
  afterEach(() => {
    process.env.SEED_REQUIRE_SIGN_IN = env.SEED_REQUIRE_SIGN_IN
    process.env.SEED_SESSION_SECRET = env.SEED_SESSION_SECRET
    if (env.SEED_REQUIRE_SIGN_IN === undefined) delete process.env.SEED_REQUIRE_SIGN_IN
    if (env.SEED_SESSION_SECRET === undefined) delete process.env.SEED_SESSION_SECRET
  })

  it('passes a valid session', async () => {
    const response = await probe({Cookie: sessionCookie(), 'X-Forwarded-Uri': '/private/doc', Accept: 'text/html'})
    expect(response.status).toBe(204)
  })

  it('redirects a browser navigation without a session to sign-in, keeping the destination', async () => {
    const response = await probe({
      'X-Forwarded-Uri': '/private/doc?panel=comments',
      'X-Forwarded-Method': 'GET',
      Accept: 'text/html,application/xhtml+xml',
    })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!, 'http://site.localhost')
    expect(location.pathname).toBe('/hm/sign-in')
    expect(location.searchParams.get('next')).toBe('/private/doc?panel=comments')
  })

  it('drops the Remix data-request marker from the destination it sends back to', async () => {
    const response = await probe({
      'X-Forwarded-Uri': '/private/doc?_data=routes%2F%24&panel=comments',
      'X-Forwarded-Method': 'GET',
      Accept: 'text/html,application/xhtml+xml',
    })
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('Location')!, 'http://site.localhost')
    expect(location.searchParams.get('next')).toBe('/private/doc?panel=comments')
  })

  it('answers 401 to a fetch without a session', async () => {
    const response = await probe({'X-Forwarded-Uri': '/api/Resource?id=x', Accept: 'application/json'})
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({error: 'Sign in required'})
  })

  it("passes the box's own services by the service secret, and nothing else without a session", async () => {
    process.env.SEED_SERVICE_SECRET = 'service-secret'
    try {
      expect((await probe({'X-Seed-Service-Secret': 'service-secret', 'X-Forwarded-Uri': '/ipfs/bafy'})).status).toBe(
        204,
      )
      expect((await probe({'X-Seed-Service-Secret': 'other', 'X-Forwarded-Uri': '/ipfs/bafy'})).status).toBe(401)
    } finally {
      delete process.env.SEED_SERVICE_SECRET
    }
    expect((await probe({'X-Seed-Service-Secret': 'service-secret', 'X-Forwarded-Uri': '/ipfs/bafy'})).status).toBe(401)
  })

  it('rejects an expired or forged session cookie', async () => {
    expect((await probe({Cookie: sessionCookie(-10), 'X-Forwarded-Uri': '/x'})).status).toBe(401)
    expect((await probe({Cookie: `${WEB_SESSION_COOKIE}=abc.def`, 'X-Forwarded-Uri': '/x'})).status).toBe(401)
  })

  it('passes open paths without a session, honoring the forwarded method', async () => {
    expect((await probe({'X-Forwarded-Uri': '/hm/sign-in?next=%2F'})).status).toBe(204)
    expect((await probe({'X-Forwarded-Uri': '/api/PublishBlobs', 'X-Forwarded-Method': 'POST'})).status).toBe(204)
    expect((await probe({'X-Forwarded-Uri': '/api/PublishBlobs', 'X-Forwarded-Method': 'GET'})).status).toBe(401)
    expect((await probe({'X-Forwarded-Uri': '/ipfs/bafy', 'X-Forwarded-Method': 'POST'})).status).toBe(204)
    expect((await probe({'X-Forwarded-Uri': '/ipfs/bafy', 'X-Forwarded-Method': 'GET'})).status).toBe(401)
  })

  it('acts as a plain session probe when not called through the proxy', async () => {
    expect((await probe({Cookie: sessionCookie()})).status).toBe(204)
    expect((await probe({Accept: 'text/html'})).status).toBe(401)
  })

  it('passes everything when the gate is off', async () => {
    delete process.env.SEED_REQUIRE_SIGN_IN
    expect((await probe({'X-Forwarded-Uri': '/private', Accept: 'text/html'})).status).toBe(204)
  })

  it('refuses everything when the session secret is missing', async () => {
    delete process.env.SEED_SESSION_SECRET
    expect((await probe({Cookie: sessionCookie(), 'X-Forwarded-Uri': '/private'})).status).toBe(401)
  })
})
