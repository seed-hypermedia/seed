import {afterAll, beforeAll, describe, expect, it} from 'bun:test'
import {serve, type Server} from 'bun'
import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {
  cleanup,
  getEmail,
  getNotificationConfig,
  getNotificationReadState,
  initDatabase,
  setNotificationConfig,
  setNotificationEmailVerification,
  setSubscription,
} from './db'
import {createRoutes, notFound} from './routes'

const API_LEAVES = [
  'notifications',
  'notification-config',
  'notification-inbox',
  'notification-read-state',
  'public-subscribe',
  'email-notif-token',
  'unsubscribe',
]

describe('notify route table', () => {
  let dataDir: string
  let server: Server<undefined>
  let base: string

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'seed-notify-routes-'))
    process.env.DATA_DIR = dataDir
    await initDatabase()
    server = serve({port: 0, routes: createRoutes(), fetch: notFound})
    base = server.url.origin
  })

  afterAll(() => {
    server.stop(true)
    cleanup()
    rmSync(dataDir, {recursive: true, force: true})
  })

  function get(path: string) {
    return fetch(`${base}${path}`, {redirect: 'manual'})
  }

  it('answers the health check', async () => {
    const response = await get('/hm/api/notify/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({status: 'ok', service: 'notify'})
  })

  it('serves every API leaf canonically and at its legacy path, with CORS preflight', async () => {
    for (const leaf of API_LEAVES) {
      for (const path of [`/hm/api/notify/${leaf}`, `/hm/api/${leaf}`]) {
        const response = await fetch(`${base}${path}`, {method: 'OPTIONS'})
        expect({path, status: response.status}).toEqual({path, status: 204})
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      }
    }
    const nested = await fetch(`${base}/hm/api/notify/public-subscribe/z6Mk-site`, {method: 'OPTIONS'})
    expect(nested.status).toBe(204)
  })

  it('rejects GET on the signed POST-only endpoints with CORS headers', async () => {
    for (const path of ['/hm/api/notify/notifications', '/hm/api/notification-config']) {
      const response = await get(path)
      expect(response.status).toBe(405)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    }
  })

  it('returns CORS JSON errors for undecodable signed requests', async () => {
    for (const leaf of ['notifications', 'notification-inbox', 'notification-read-state', 'notification-config']) {
      const response = await fetch(`${base}/hm/api/notify/${leaf}`, {
        method: 'POST',
        body: new Uint8Array([1, 2, 3]),
        headers: {'Content-Type': 'application/cbor'},
      })
      expect(response.status).toBe(500)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(await response.json()).toHaveProperty('error')
    }
  })

  it('keeps the email-link endpoints canonical-only', async () => {
    for (const leaf of ['read-redirect', 'verify-email', 'health']) {
      expect((await get(`/hm/api/${leaf}`)).status).toBe(404)
    }
    expect((await get('/hm/email-notifications')).status).toBe(404)
  })

  it('read-redirect marks the event read and redirects to the target', async () => {
    setSubscription({id: 'acc-read', email: 'reader@example.com', notifySiteDiscussions: true})
    const token = getEmail('reader@example.com')!.adminToken
    const params = new URLSearchParams({
      token,
      accountId: 'acc-read',
      eventId: 'event-1',
      eventAtMs: '1700000000000',
      redirectTo: 'https://site.example/hm/doc',
    })
    const response = await get(`/hm/api/notify/read-redirect?${params}`)
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://site.example/hm/doc')
    expect(getNotificationReadState('acc-read').readEvents).toEqual([{eventId: 'event-1', eventAtMs: 1700000000000}])
  })

  it('read-redirect never follows a non-http target', async () => {
    const response = await get(
      `/hm/api/notify/read-redirect?${new URLSearchParams({token: 'tok', redirectTo: 'javascript:alert(1)'})}`,
    )
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/hm/email-notifications?token=tok')
  })

  it('read-redirect does not follow a target without a real email token', async () => {
    for (const token of ['', 'not-a-token']) {
      const response = await get(
        `/hm/api/notify/read-redirect?${new URLSearchParams({token, redirectTo: 'https://evil.example/x'})}`,
      )
      expect(response.status).toBe(302)
      expect(response.headers.get('Location')).not.toContain('evil.example')
    }
  })

  it('verify-email marks the config verified and redirects to the settings page', async () => {
    setNotificationConfig('acc-verify', 'verify@example.com')
    setNotificationEmailVerification({accountId: 'acc-verify', email: 'verify@example.com', token: 'verify-token'})
    const adminToken = getEmail('verify@example.com')!.adminToken

    const response = await get('/hm/api/notify/verify-email?token=verify-token')
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe(`/hm/email-notifications?token=${adminToken}&verification=verified`)
    expect(getNotificationConfig('acc-verify')?.verifiedTime).toBeTruthy()

    const invalid = await get('/hm/api/notify/verify-email?token=nope')
    expect(invalid.headers.get('Location')).toBe('/hm/email-notifications?verification=invalid-token')
  })

  it('unsubscribes through both the canonical and legacy paths', async () => {
    setSubscription({id: 'acc-unsub', email: 'unsub@example.com', notifySiteDiscussions: true})
    const token = getEmail('unsub@example.com')!.adminToken

    const canonical = await fetch(`${base}/hm/api/notify/unsubscribe?token=${token}`, {method: 'POST'})
    expect(canonical.status).toBe(200)
    expect(getEmail('unsub@example.com')!.isUnsubscribed).toBe(true)

    const tokenResponse = await get(`/hm/api/email-notif-token?token=${token}`)
    expect(tokenResponse.status).toBe(200)
    expect(await tokenResponse.json()).toMatchObject({email: 'unsub@example.com', isUnsubscribed: true})
  })

  it('answers unknown paths with a CORS 404', async () => {
    const response = await get('/hm/api/notify/nope')
    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})
