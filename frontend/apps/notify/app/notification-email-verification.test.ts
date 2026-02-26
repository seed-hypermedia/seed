import {mkdtempSync, rmSync} from 'fs'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  clearNotificationEmailVerificationForAccount,
  getEmail,
  getNotificationConfig,
  getNotificationEmailVerificationForAccount,
  initDatabase,
  markNotificationConfigVerified,
  setNotificationConfig,
  setNotificationEmailVerification,
} from './db'
import {
  applyNotificationEmailVerificationFromEmailLink,
  buildNotificationEmailVerificationUrl,
  EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS,
  isNotificationEmailVerificationExpired,
} from './notification-email-verification'

describe('notification email verification', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync('seed-notif-email-verify-test-')
    process.env.DATA_DIR = tmpDir
    await initDatabase()
  })

  afterEach(async () => {
    const {cleanup} = await import('./db')
    cleanup()
    rmSync(tmpDir, {recursive: true, force: true})
  })

  it('builds verification URL with token query param', () => {
    const built = buildNotificationEmailVerificationUrl({
      notifyServiceHost: 'https://notify.example',
      token: 'abc123',
    })
    expect(built).toContain('/hm/notification-email-verify?')
    expect(built).toContain('token=abc123')
  })

  it('detects expired verification windows', () => {
    const nowMs = Date.now()
    const freshSendTime = new Date(nowMs - EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS + 10_000).toISOString()
    const expiredSendTime = new Date(nowMs - EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS - 10_000).toISOString()
    expect(isNotificationEmailVerificationExpired(freshSendTime, nowMs)).toBe(false)
    expect(isNotificationEmailVerificationExpired(expiredSendTime, nowMs)).toBe(true)
  })

  it('marks config verified and clears verification token for valid links', () => {
    const accountId = 'verify-account-1'
    const email = 'verify1@example.com'
    setNotificationConfig(accountId, email)
    const verification = setNotificationEmailVerification({
      accountId,
      email,
      token: 'verify-token-1',
      sendTime: new Date(Date.now() - 60_000).toISOString(),
    })

    const result = applyNotificationEmailVerificationFromEmailLink({
      token: verification.token,
      nowMs: Date.now(),
    })

    expect(result.applied).toBe(true)
    expect(getNotificationConfig(accountId)?.verifiedTime).not.toBeNull()
    expect(getNotificationEmailVerificationForAccount(accountId)).toBeNull()
  })

  it('returns expired when verification link is too old', () => {
    const accountId = 'verify-account-2'
    const email = 'verify2@example.com'
    setNotificationConfig(accountId, email)
    setNotificationEmailVerification({
      accountId,
      email,
      token: 'verify-token-expired',
      sendTime: new Date(Date.now() - EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS - 5_000).toISOString(),
    })

    const result = applyNotificationEmailVerificationFromEmailLink({
      token: 'verify-token-expired',
      nowMs: Date.now(),
    })

    expect(result.applied).toBe(false)
    if (result.applied) throw new Error('expected failed result')
    expect(result.reason).toBe('verification-expired')
    expect(getNotificationConfig(accountId)?.verifiedTime).toBeNull()
    expect(getNotificationEmailVerificationForAccount(accountId)).not.toBeNull()
  })

  it('returns email mismatch when account email changed after token issuance', () => {
    const accountId = 'verify-account-3'
    setNotificationConfig(accountId, 'before@example.com')
    setNotificationEmailVerification({
      accountId,
      email: 'before@example.com',
      token: 'verify-token-mismatch',
    })
    setNotificationConfig(accountId, 'after@example.com')

    const result = applyNotificationEmailVerificationFromEmailLink({
      token: 'verify-token-mismatch',
    })

    expect(result.applied).toBe(false)
    if (result.applied) throw new Error('expected failed result')
    expect(result.reason).toBe('notification-config-email-mismatch')
  })

  it('returns already-verified when config is already verified', () => {
    const accountId = 'verify-account-4'
    const email = 'verify4@example.com'
    setNotificationConfig(accountId, email)
    expect(markNotificationConfigVerified(accountId, email)).toBe(true)
    setNotificationEmailVerification({
      accountId,
      email,
      token: 'verify-token-already',
    })

    const result = applyNotificationEmailVerificationFromEmailLink({
      token: 'verify-token-already',
    })

    expect(result.applied).toBe(false)
    if (result.applied) throw new Error('expected failed result')
    expect(result.reason).toBe('already-verified')
    expect(getNotificationEmailVerificationForAccount(accountId)).toBeNull()
  })

  it('returns invalid token for unknown links', () => {
    const result = applyNotificationEmailVerificationFromEmailLink({token: 'not-found'})
    expect(result.applied).toBe(false)
    if (result.applied) throw new Error('expected failed result')
    expect(result.reason).toBe('invalid-token')
  })

  it('includes admin token when available for redirect flows', () => {
    const accountId = 'verify-account-5'
    const email = 'verify5@example.com'
    setNotificationConfig(accountId, email)
    const adminToken = getEmail(email)?.adminToken
    if (!adminToken) throw new Error('expected admin token')
    clearNotificationEmailVerificationForAccount(accountId)
    setNotificationEmailVerification({
      accountId,
      email,
      token: 'verify-token-redirect',
      sendTime: new Date(Date.now() - EMAIL_NOTIFICATION_VERIFICATION_EXPIRY_MS - 1).toISOString(),
    })

    const result = applyNotificationEmailVerificationFromEmailLink({
      token: 'verify-token-redirect',
      nowMs: Date.now(),
    })

    expect(result.applied).toBe(false)
    if (result.applied) throw new Error('expected failed result')
    expect(result.adminToken).toBe(adminToken)
  })
})
