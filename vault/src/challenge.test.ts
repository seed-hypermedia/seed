import {describe, expect, test} from 'bun:test'
import {randomBytes} from 'node:crypto'
import * as cookies from './cookies'

describe('challenge', () => {
  const secret = randomBytes(32)
  const challengeStr = 'some-challenge'
  const sessionId = 'some-session-id'

  test('computeHmac produces consistent output', () => {
    const hmac1 = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-login', challengeStr)
    const hmac2 = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-login', challengeStr)
    expect(hmac1).toBe(hmac2)
  })

  test('verifyHmac accepts valid hmac', () => {
    const hmac = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-login', challengeStr)
    expect(cookies.webauthnChallengeVerifyHmac(secret, hmac, 'webauthn-login', challengeStr)).toBe(true)
  })

  test('verifyHmac rejects invalid hmac', () => {
    const hmac = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-login', challengeStr)
    expect(cookies.webauthnChallengeVerifyHmac(secret, 'invalid-hmac', 'webauthn-login', challengeStr)).toBe(false)
    expect(cookies.webauthnChallengeVerifyHmac(secret, `${hmac}a`, 'webauthn-login', challengeStr)).toBe(false)
  })

  test('verifyHmac checks purpose', () => {
    const hmac = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-login', challengeStr)
    // Should produce different hmac for different purpose
    expect(cookies.webauthnChallengeVerifyHmac(secret, hmac, 'webauthn-register', challengeStr, sessionId)).toBe(false)
  })

  test('verifyHmac checks challenge', () => {
    const hmac = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-login', challengeStr)
    expect(cookies.webauthnChallengeVerifyHmac(secret, hmac, 'webauthn-login', 'other-challenge')).toBe(false)
  })

  test('webauthn-register requires sessionId', () => {
    expect(() => cookies.webauthnChallengeComputeHmac(secret, 'webauthn-register', challengeStr)).toThrow()
  })

  test('verifyHmac with sessionId binding', () => {
    const hmac = cookies.webauthnChallengeComputeHmac(secret, 'webauthn-register', challengeStr, sessionId)
    expect(cookies.webauthnChallengeVerifyHmac(secret, hmac, 'webauthn-register', challengeStr, sessionId)).toBe(true)
    expect(cookies.webauthnChallengeVerifyHmac(secret, hmac, 'webauthn-register', challengeStr, 'other-session')).toBe(
      false,
    )
  })

  test('createCookieHeader format', () => {
    const cookie = cookies.webauthnChallengeCreateCookie('some-hmac', false)
    expect(cookie).toContain('wac=some-hmac')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=300')
    expect(cookie).not.toContain('Secure')
  })

  test('createCookieHeader format prod', () => {
    const cookie = cookies.webauthnChallengeCreateCookie('some-hmac', true)
    expect(cookie).toContain(`${cookies.webauthnChallengeCookieName(true)}=some-hmac`)
    expect(cookie).toContain('Secure')
  })

  test('clearCookieHeader format', () => {
    const cookie = cookies.webauthnChallengeClearCookie(false)
    expect(cookie).toContain('wac=')
    expect(cookie).toContain('Max-Age=0')
  })
})
