import {mkdtempSync, rmSync} from 'fs'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  getEmail,
  getNotificationReadState,
  initDatabase,
  mergeNotificationReadState,
  setNotificationConfig,
  setSubscription,
} from './db'
import {
  applyNotificationReadFromEmailLink,
  buildNotificationReadRedirectUrl,
  getSafeNotificationRedirectTarget,
} from './notification-read-redirect'

describe('notification read redirect helpers', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync('seed-notif-read-redirect-test-')
    process.env.DATA_DIR = tmpDir
    await initDatabase()
  })

  afterEach(async () => {
    const {cleanup} = await import('./db')
    cleanup()
    rmSync(tmpDir, {recursive: true, force: true})
  })

  function createTokenForAccount(accountId: string, email: string) {
    setSubscription({
      id: accountId,
      email,
    })
    const record = getEmail(email)
    if (!record) throw new Error('Expected email record to exist')
    return record.adminToken
  }

  it('builds redirect URL with encoded query payload', () => {
    const built = buildNotificationReadRedirectUrl({
      notifyServiceHost: 'https://notify.example',
      token: 'token123',
      accountId: 'acc1',
      eventId: 'mention-event',
      eventAtMs: 1234,
      redirectTo: 'https://site.example/hm/acc1',
    })
    expect(built).toContain('/hm/notification-read-redirect?')
    expect(built).toContain('token=token123')
    expect(built).toContain('redirectTo=https%3A%2F%2Fsite.example%2Fhm%2Facc1')
  })

  it('accepts only http/https redirect targets', () => {
    expect(getSafeNotificationRedirectTarget('https://site.example/hm/abc')).toBe('https://site.example/hm/abc')
    expect(getSafeNotificationRedirectTarget('javascript:alert(1)')).toBeNull()
  })

  it('marks read state when token and subscription are valid', () => {
    const accountId = 'z-account-1'
    const token = createTokenForAccount(accountId, 'reader@example.com')

    const result = applyNotificationReadFromEmailLink({
      token,
      accountId,
      eventId: 'mention-event-id',
      eventAtMs: 12345,
    })

    expect(result.applied).toBe(true)
    const state = getNotificationReadState(accountId)
    expect(state.readEvents).toEqual([{eventId: 'mention-event-id', eventAtMs: 12345}])
  })

  it('does not mark read state when token is invalid', () => {
    const result = applyNotificationReadFromEmailLink({
      token: 'invalid',
      accountId: 'z-account-1',
      eventId: 'mention-event-id',
      eventAtMs: 12345,
    })
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('invalid-token')
  })

  it('does not mark read state when account subscription is missing', () => {
    const token = createTokenForAccount('z-account-1', 'reader@example.com')
    const result = applyNotificationReadFromEmailLink({
      token,
      accountId: 'z-account-2',
      eventId: 'mention-event-id',
      eventAtMs: 12345,
    })
    expect(result.applied).toBe(false)
    expect(result.reason).toBe('subscription-not-found')
  })

  it('marks read state when token email matches notification config', () => {
    const accountId = 'z-account-config'
    const email = 'config-reader@example.com'
    setNotificationConfig(accountId, email)
    const token = getEmail(email)?.adminToken
    if (!token) throw new Error('Expected email token')

    const result = applyNotificationReadFromEmailLink({
      token,
      accountId,
      eventId: 'mention-event-id',
      eventAtMs: 67890,
    })

    expect(result.applied).toBe(true)
    const state = getNotificationReadState(accountId)
    expect(state.readEvents).toEqual([{eventId: 'mention-event-id', eventAtMs: 67890}])
  })

  it('preserves watermark and bumps stateUpdatedAtMs when applying redirect read', () => {
    const accountId = 'z-account-watermark'
    const token = createTokenForAccount(accountId, 'watermark@example.com')
    mergeNotificationReadState(accountId, {
      markAllReadAtMs: 10_000,
      stateUpdatedAtMs: 10_000,
      readEvents: [],
    })
    const before = getNotificationReadState(accountId)

    const result = applyNotificationReadFromEmailLink({
      token,
      accountId,
      eventId: 'new-mention-event',
      eventAtMs: 12_345,
    })

    expect(result.applied).toBe(true)
    const state = getNotificationReadState(accountId)
    expect(state.markAllReadAtMs).toBe(10_000)
    expect(state.stateUpdatedAtMs).toBeGreaterThan(before.stateUpdatedAtMs)
    expect(state.readEvents).toEqual([{eventId: 'new-mention-event', eventAtMs: 12_345}])
  })
})
