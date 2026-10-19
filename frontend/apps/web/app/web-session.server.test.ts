import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  getWebSession,
  signWebSession,
  verifyWebSession,
  WEB_SESSION_COOKIE,
  webSessionClearCookie,
  webSessionSetCookie,
} from './web-session.server'

const SECRET = 'test-session-secret'
const NOW = 1_800_000_000

describe('web session cookie', () => {
  it('round-trips a signed session', () => {
    const value = signWebSession({account: 'z6MkMember', exp: NOW + 3600}, SECRET)
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(verifyWebSession(value, SECRET, NOW)).toEqual({account: 'z6MkMember', exp: NOW + 3600})
  })

  it('rejects an expired session', () => {
    const value = signWebSession({account: 'z6MkMember', exp: NOW - 1}, SECRET)
    expect(verifyWebSession(value, SECRET, NOW)).toBeNull()
  })

  it('rejects a tampered payload or signature', () => {
    const value = signWebSession({account: 'z6MkMember', exp: NOW + 3600}, SECRET)
    const [payload, sig] = value.split('.') as [string, string]
    const forged = Buffer.from(JSON.stringify({account: 'z6MkAttacker', exp: NOW + 3600})).toString('base64url')
    expect(verifyWebSession(`${forged}.${sig}`, SECRET, NOW)).toBeNull()
    expect(verifyWebSession(`${payload}.${sig.slice(0, -2)}xx`, SECRET, NOW)).toBeNull()
    expect(verifyWebSession(value, 'other-secret', NOW)).toBeNull()
    expect(verifyWebSession('garbage', SECRET, NOW)).toBeNull()
    expect(verifyWebSession('', SECRET, NOW)).toBeNull()
  })

  it('serializes a host-only, http-only cookie and a clearing counterpart', () => {
    const set = webSessionSetCookie('abc.def', NOW)
    expect(set.startsWith(`${WEB_SESSION_COOKIE}=abc.def; `)).toBe(true)
    expect(set).toContain('Path=/')
    expect(set).toContain('HttpOnly')
    expect(set).toContain('SameSite=Lax')
    expect(set).toContain(`Expires=${new Date(NOW * 1000).toUTCString()}`)
    expect(webSessionClearCookie()).toContain(`${WEB_SESSION_COOKIE}=; `)
    expect(webSessionClearCookie()).toContain('Expires=Thu, 01 Jan 1970')
  })
})

describe('getWebSession', () => {
  const originalSecret = process.env.SEED_SESSION_SECRET
  beforeEach(() => {
    process.env.SEED_SESSION_SECRET = SECRET
  })
  afterEach(() => {
    if (originalSecret === undefined) delete process.env.SEED_SESSION_SECRET
    else process.env.SEED_SESSION_SECRET = originalSecret
  })

  function requestWithCookies(cookie: string | null) {
    return new Request('http://site.localhost/', cookie ? {headers: {Cookie: cookie}} : undefined)
  }

  it('reads the session out of the cookie header among other cookies', () => {
    const value = signWebSession({account: 'z6MkMember', exp: Date.now() / 1000 + 60}, SECRET)
    const session = getWebSession(requestWithCookies(`other=1; ${WEB_SESSION_COOKIE}=${value}; HM-Auth-Token=x`))
    expect(session?.account).toBe('z6MkMember')
  })

  it('is null without a cookie, with a bad cookie, or without a configured secret', () => {
    const value = signWebSession({account: 'z6MkMember', exp: Date.now() / 1000 + 60}, SECRET)
    expect(getWebSession(requestWithCookies(null))).toBeNull()
    expect(getWebSession(requestWithCookies(`${WEB_SESSION_COOKIE}=nope.nope`))).toBeNull()
    delete process.env.SEED_SESSION_SECRET
    expect(getWebSession(requestWithCookies(`${WEB_SESSION_COOKIE}=${value}`))).toBeNull()
  })
})
