import {encode as cborEncode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {asResponse, createActionArgs, createLoaderArgs} from './route-test-utils'

const {
  clearNotificationEmailVerificationForAccountMock,
  getNotificationConfigMock,
  getNotificationEmailVerificationForAccountMock,
  isInboxRegisteredMock,
  markNotificationConfigVerifiedMock,
  removeNotificationConfigMock,
  setNotificationConfigMock,
  setNotificationEmailVerificationMock,
} = vi.hoisted(() => ({
  clearNotificationEmailVerificationForAccountMock: vi.fn(),
  getNotificationConfigMock: vi.fn(),
  getNotificationEmailVerificationForAccountMock: vi.fn(),
  isInboxRegisteredMock: vi.fn(),
  markNotificationConfigVerifiedMock: vi.fn(),
  removeNotificationConfigMock: vi.fn(),
  setNotificationConfigMock: vi.fn(),
  setNotificationEmailVerificationMock: vi.fn(),
}))

const {sendEmailMock} = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
}))

const {validateSignatureMock} = vi.hoisted(() => ({
  validateSignatureMock: vi.fn(),
}))

const {resolveAccountIdMock} = vi.hoisted(() => ({
  resolveAccountIdMock: vi.fn(),
}))

vi.mock('@/db', () => ({
  clearNotificationEmailVerificationForAccount: clearNotificationEmailVerificationForAccountMock,
  getNotificationConfig: getNotificationConfigMock,
  getNotificationEmailVerificationForAccount: getNotificationEmailVerificationForAccountMock,
  isInboxRegistered: isInboxRegisteredMock,
  markNotificationConfigVerified: markNotificationConfigVerifiedMock,
  removeNotificationConfig: removeNotificationConfigMock,
  setNotificationConfig: setNotificationConfigMock,
  setNotificationEmailVerification: setNotificationEmailVerificationMock,
}))

vi.mock('@/mailer', () => ({
  sendEmail: sendEmailMock,
}))

vi.mock('@/validate-signature', () => ({
  validateSignature: validateSignatureMock,
}))

vi.mock('@/verify-delegation', () => ({
  resolveAccountId: resolveAccountIdMock,
}))

describe('hm.api.notification-config route', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NOTIFY_TRUSTED_PREVALIDATORS = 'https://vault.example.com'
    clearNotificationEmailVerificationForAccountMock.mockReset()
    getNotificationConfigMock.mockReset()
    getNotificationEmailVerificationForAccountMock.mockReset()
    isInboxRegisteredMock.mockReset()
    markNotificationConfigVerifiedMock.mockReset()
    removeNotificationConfigMock.mockReset()
    setNotificationConfigMock.mockReset()
    setNotificationEmailVerificationMock.mockReset()
    sendEmailMock.mockReset()
    validateSignatureMock.mockReset()
    resolveAccountIdMock.mockReset()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.NOTIFY_TRUSTED_PREVALIDATORS
  })

  it('returns a CORS preflight response for OPTIONS requests', async () => {
    const {loader} = await import('./routes/hm.api.notification-config')
    const response = asResponse(
      await loader(
        createLoaderArgs(
          new Request('http://localhost/hm/api/notification-config', {
            method: 'OPTIONS',
          }),
        ),
      ),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
  })

  it('preserves email prevalidation and CORS headers on success', async () => {
    const accountId = 'account-prevalidated'
    const signer = new Uint8Array(base58btc.decode(base58btc.encode(new Uint8Array([1, 2, 3]))))
    const verifiedTime = '2026-04-09T18:00:00.000Z'
    const {action} = await import('./routes/hm.api.notification-config')

    validateSignatureMock.mockResolvedValue(true)
    resolveAccountIdMock.mockResolvedValue(accountId)
    getNotificationConfigMock.mockReturnValue({
      accountId,
      email: 'user@example.com',
      verifiedTime,
    })
    getNotificationEmailVerificationForAccountMock.mockReturnValue(null)
    isInboxRegisteredMock.mockReturnValue(true)
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          signerAccountUid: base58btc.encode(signer),
        }),
        {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        },
      ),
    )

    const body = cborEncode({
      action: 'set-notification-config',
      signer,
      time: Date.now(),
      sig: new Uint8Array([9, 9, 9]),
      email: 'User@example.com',
      emailPrevalidation: {
        email: 'user@example.com',
        signer,
        host: 'https://vault.example.com',
        sig: new Uint8Array([8, 8, 8]),
      },
    })

    const response = asResponse(
      await action(
        createActionArgs(
          new Request('http://localhost/hm/api/notification-config', {
            method: 'POST',
            body: body as BufferSource,
            headers: {'Content-Type': 'application/cbor'},
          }),
        ),
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(setNotificationConfigMock).toHaveBeenCalledWith(accountId, 'user@example.com')
    expect(markNotificationConfigVerifiedMock).toHaveBeenCalledWith(accountId, 'user@example.com')
    expect(clearNotificationEmailVerificationForAccountMock).toHaveBeenCalledWith(accountId)
    expect(sendEmailMock).not.toHaveBeenCalled()

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      accountId,
      email: 'user@example.com',
      verifiedTime,
      isRegistered: true,
    })
  })
})
