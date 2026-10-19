import {afterEach, describe, expect, it} from 'vitest'
import {gateDocumentRequest, isOpenPath, safeNextPath, signInUrl} from './require-sign-in'
import {requireSignInEnabled} from './require-sign-in.server'

describe('isOpenPath', () => {
  it.each([
    '/hm/sign-in',
    '/hm/sign-in/',
    '/hm/sign-in.data',
    '/hm/auth/callback',
    '/hm/auth/callback.data',
    '/hm/api/config',
    '/hm/api/auth',
    '/hm/api/session',
    '/hm/api/version',
    '/hm/api/register',
    '/hm/register',
    '/hm/register.data',
    '/hm/create-site',
    '/hm/email-notifications',
    '/hm/email-notifications.data',
    '/vault',
    '/vault/',
    '/vault/delegate',
    '/vault/assets/app.js',
    '/assets/entry.client-abc123.js',
    '/build/client/root.js',
    '/favicon.ico',
    '/favicon.png',
    '/robots.txt',
    '/.well-known/webfinger',
    '/__manifest',
    '/__manifest?p=%2Fhm%2Fsign-in',
    '/healthz',
    '/api/Account',
  ])('leaves %s reachable without a session', (path) => {
    expect(isOpenPath(path)).toBe(true)
  })

  it.each([
    '/',
    '/_root.data',
    '/some-doc',
    '/some-doc.data',
    '/hm',
    '/hm/z6MkSomeAccount',
    '/hm/z6MkSomeAccount/path',
    '/hm/embed/z6MkSomeAccount',
    '/hm/agents',
    '/hm/notifications',
    '/hm/api/resource/z6MkSomeAccount',
    '/hm/api/discover',
    '/hm/api/admin',
    '/hm/api/file/bafy',
    '/hm/sign-in-extra',
    '/hm/registered',
    '/vaults/anything',
    '/vaultx',
    '/assets',
    '/ipfs/bafy',
    '/api/Resource',
    '/api/PublishBlobs',
    '/doc.md',
  ])('closes GET %s', (path) => {
    expect(isOpenPath(path)).toBe(false)
  })

  it('opens the calls the sign-in flow makes before any cookie exists, by method', () => {
    expect(isOpenPath('/api/PublishBlobs', 'POST')).toBe(true)
    expect(isOpenPath('/api/PublishBlobs', 'post')).toBe(true)
    expect(isOpenPath('/api/PublishBlobs', 'GET')).toBe(false)
    expect(isOpenPath('/api/Account', 'GET')).toBe(true)
    expect(isOpenPath('/api/Account', 'HEAD')).toBe(true)
    expect(isOpenPath('/api/Account', 'POST')).toBe(false)
    expect(isOpenPath('/ipfs/bafy', 'POST')).toBe(true)
    expect(isOpenPath('/ipfs/file-upload', 'POST')).toBe(true)
    expect(isOpenPath('/ipfs/bafy', 'GET')).toBe(false)
    expect(isOpenPath('/ipfs', 'POST')).toBe(false)
    expect(isOpenPath('/api/Resource', 'POST')).toBe(false)
  })

  it('opens the enterprise bootstrap for the deploy script, POST only', () => {
    expect(isOpenPath('/hm/api/enterprise-bootstrap', 'POST')).toBe(true)
    expect(isOpenPath('/hm/api/enterprise-bootstrap/', 'POST')).toBe(true)
    expect(isOpenPath('/hm/api/enterprise-bootstrap', 'GET')).toBe(false)
    expect(isOpenPath('/hm/api/enterprise-bootstrap')).toBe(false)
    expect(isOpenPath('/hm/api/enterprise-bootstrap/anything', 'POST')).toBe(false)
  })

  it('opens the enterprise site-url update for the deploy script, POST only', () => {
    expect(isOpenPath('/hm/api/enterprise-site-url', 'POST')).toBe(true)
    expect(isOpenPath('/hm/api/enterprise-site-url/', 'POST')).toBe(true)
    expect(isOpenPath('/hm/api/enterprise-site-url', 'GET')).toBe(false)
    expect(isOpenPath('/hm/api/enterprise-site-url')).toBe(false)
    expect(isOpenPath('/hm/api/enterprise-site-url/anything', 'POST')).toBe(false)
  })
})

describe('safeNextPath', () => {
  it('defaults to the home page', () => {
    expect(safeNextPath(null)).toBe('/')
    expect(safeNextPath(undefined)).toBe('/')
    expect(safeNextPath('')).toBe('/')
  })

  it('keeps same-origin paths with their query and hash', () => {
    expect(safeNextPath('/docs/intro?panel=comments#block')).toBe('/docs/intro?panel=comments#block')
  })

  it('refuses anything that could leave the origin', () => {
    expect(safeNextPath('https://evil.example/phish')).toBe('/')
    expect(safeNextPath('//evil.example/phish')).toBe('/')
    expect(safeNextPath('/\\evil.example/phish')).toBe('/')
    expect(safeNextPath('javascript:alert(1)')).toBe('/')
  })

  it('never points back at the sign-in page', () => {
    expect(safeNextPath('/hm/sign-in')).toBe('/')
    expect(safeNextPath('/hm/sign-in?next=%2F')).toBe('/')
    expect(safeNextPath('/hm/sign-in/')).toBe('/')
  })
})

describe('gateDocumentRequest', () => {
  it('does nothing when the gate is off', () => {
    expect(gateDocumentRequest({enabled: false, pathname: '/private', search: '', hasSession: false})).toEqual({})
  })

  it('lets a session through', () => {
    expect(gateDocumentRequest({enabled: true, pathname: '/private', search: '', hasSession: true})).toEqual({})
  })

  it('lets open paths through without a session', () => {
    expect(
      gateDocumentRequest({enabled: true, pathname: '/hm/sign-in', search: '?next=%2F', hasSession: false}),
    ).toEqual({})
    expect(
      gateDocumentRequest({enabled: true, pathname: '/ipfs/bafy', search: '', method: 'POST', hasSession: false}),
    ).toEqual({})
  })

  it('redirects closed paths to sign-in and preserves where the user was going', () => {
    const result = gateDocumentRequest({enabled: true, pathname: '/docs/intro', search: '?panel=x', hasSession: false})
    expect(result.redirect).toBe(signInUrl('/docs/intro?panel=x'))
    const url = new URL(result.redirect!, 'http://site.example')
    expect(url.pathname).toBe('/hm/sign-in')
    expect(url.searchParams.get('next')).toBe('/docs/intro?panel=x')
  })
})

describe('requireSignInEnabled', () => {
  const original = process.env.SEED_REQUIRE_SIGN_IN
  afterEach(() => {
    if (original === undefined) delete process.env.SEED_REQUIRE_SIGN_IN
    else process.env.SEED_REQUIRE_SIGN_IN = original
  })

  it('is off unless SEED_REQUIRE_SIGN_IN opts in', () => {
    delete process.env.SEED_REQUIRE_SIGN_IN
    expect(requireSignInEnabled()).toBe(false)
    process.env.SEED_REQUIRE_SIGN_IN = '0'
    expect(requireSignInEnabled()).toBe(false)
    process.env.SEED_REQUIRE_SIGN_IN = '1'
    expect(requireSignInEnabled()).toBe(true)
    process.env.SEED_REQUIRE_SIGN_IN = 'true'
    expect(requireSignInEnabled()).toBe(true)
  })
})
