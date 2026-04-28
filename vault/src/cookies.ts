import {createHmac, timingSafeEqual} from 'node:crypto'
import * as base64 from '@seed-hypermedia/client/base64'
import {Cookie} from 'bun'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** Returns the cookie name for webauthn challenge cookies. */
export function webauthnChallengeCookieName(isProd: boolean): string {
  return isProd ? '__Secure-wac' : 'wac'
}

/**
 * Compute the HMAC commitment for a challenge.
 * The `purpose` is "webauthn-login" or "webauthn-register".
 * For register, `sessionId` must be provided for binding.
 */
export function webauthnChallengeComputeHmac(
  secret: Uint8Array,
  purpose: 'webauthn-login' | 'webauthn-register',
  challenge: string,
  sessionId?: string,
): string {
  const hmac = createHmac('sha256', secret)
  hmac.update(purpose)
  hmac.update('\0')
  hmac.update(challenge)

  if (purpose === 'webauthn-register') {
    if (!sessionId) {
      throw new Error('sessionId is required for webauthn-register purpose')
    }
    hmac.update('\0')
    hmac.update(sessionId)
  }

  return base64.encode(new Uint8Array(hmac.digest()))
}

/**
 * Verify a challenge cookie against the expected HMAC.
 * Returns true if the cookie matches.
 * Uses timing-safe comparison.
 */
export function webauthnChallengeVerifyHmac(
  secret: Uint8Array,
  cookieValue: string,
  purpose: 'webauthn-login' | 'webauthn-register',
  challenge: string,
  sessionId?: string,
): boolean {
  if (!cookieValue) return false

  // Recompute the HMAC with the expected inputs.
  const expectedHmacString = webauthnChallengeComputeHmac(secret, purpose, challenge, sessionId)

  const a = new TextEncoder().encode(cookieValue)
  const b = new TextEncoder().encode(expectedHmacString)

  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

/** Create a Set-Cookie header string for the challenge cookie. */
export function webauthnChallengeCreateCookie(hmacValue: string, isProdArg: boolean): string {
  const cookie = new Cookie({
    name: webauthnChallengeCookieName(isProdArg),
    value: hmacValue,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 300, // 5 minutes
    path: '/vault',
    secure: isProdArg,
  })

  return cookie.toString()
}

/** Returns a Set-Cookie header string that clears the challenge cookie. */
export function webauthnChallengeClearCookie(isProdArg: boolean): string {
  const cookie = new Cookie({
    name: webauthnChallengeCookieName(isProdArg),
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 0,
    path: '/vault',
    secure: isProdArg,
  })

  return cookie.toString()
}

/** Payload stored in the HttpOnly email verification binding cookie. */
export type EmailCookieValue = {
  binding: string
  email: string
  newEmail: string | null
}

/** Returns the email verification binding cookie name. */
export function emailVerificationCookieName(isProd: boolean): string {
  return isProd ? '__Secure-evb' : 'evb'
}

/** Encodes the email verification binding cookie payload. */
export function encodeEmailCookieValue(value: EmailCookieValue): string {
  return base64.encode(textEncoder.encode(JSON.stringify(value)))
}

/** Decodes the email verification binding cookie payload. */
export function decodeEmailCookieValue(value: string): EmailCookieValue | null {
  try {
    const parsed = JSON.parse(textDecoder.decode(base64.decode(value))) as Partial<EmailCookieValue>
    if (
      typeof parsed.binding !== 'string' ||
      typeof parsed.email !== 'string' ||
      !(typeof parsed.newEmail === 'string' || parsed.newEmail === null)
    ) {
      return null
    }

    return {
      binding: parsed.binding,
      email: parsed.email,
      newEmail: parsed.newEmail,
    }
  } catch {
    return null
  }
}

/** Create a Set-Cookie header string for the email verification binding cookie. */
export function createEmailCookieHeader(value: string, maxAgeSeconds: number, isProdArg: boolean): string {
  const cookie = new Cookie({
    name: emailVerificationCookieName(isProdArg),
    value,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: maxAgeSeconds,
    path: '/vault',
    secure: isProdArg,
  })

  return cookie.toString()
}

/** Returns a Set-Cookie header string that clears the email verification binding cookie. */
export function clearEmailCookieHeader(isProdArg: boolean): string {
  const cookie = new Cookie({
    name: emailVerificationCookieName(isProdArg),
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 0,
    path: '/vault',
    secure: isProdArg,
  })

  return cookie.toString()
}
