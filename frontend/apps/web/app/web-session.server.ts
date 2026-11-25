import {createHmac, timingSafeEqual} from 'node:crypto'
import {requireSignInEnabled} from './require-sign-in.server'

// The daemon auth cookie only proves "this key has a blob in the database";
// membership is decided once at sign-in and remembered in this signed cookie,
// which the proxy's forward_auth and the document gate both check offline.
const IS_PRODUCTION = process.env.NODE_ENV === 'production'
export const WEB_SESSION_COOKIE = IS_PRODUCTION ? '__Host-HM-Session' : 'HM-Session'

/** `exp` is a unix timestamp in seconds, matching the daemon token's expiry. */
export type WebSession = {account: string; exp: number}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function signWebSession(session: WebSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return `${payload}.${hmac(payload, secret)}`
}

export function verifyWebSession(value: string, secret: string, nowSeconds = Date.now() / 1000): WebSession | null {
  const dot = value.indexOf('.')
  if (dot <= 0) return null
  const payload = value.slice(0, dot)
  const expected = Buffer.from(hmac(payload, secret))
  const actual = Buffer.from(value.slice(dot + 1))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  let session: unknown
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!session || typeof session !== 'object') return null
  const {account, exp} = session as Partial<WebSession>
  if (typeof account !== 'string' || !account || typeof exp !== 'number') return null
  if (exp <= nowSeconds) return null
  return {account, exp}
}

let warnedMissingSecret = false

/** Null when the gate cannot mint or verify sessions; callers must then refuse. */
export function webSessionSecret(): string | null {
  const secret = process.env.SEED_SESSION_SECRET
  if (secret) return secret
  if (requireSignInEnabled() && !warnedMissingSecret) {
    warnedMissingSecret = true
    console.error('SEED_REQUIRE_SIGN_IN is on but SEED_SESSION_SECRET is unset; every request is treated as signed out')
  }
  return null
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    return part.slice(eq + 1).trim() || null
  }
  return null
}

export function getWebSession(request: Request): WebSession | null {
  const secret = webSessionSecret()
  if (!secret) return null
  const value = readCookie(request, WEB_SESSION_COOKIE)
  return value ? verifyWebSession(value, secret) : null
}

/** Header the box's own services (the agents service) send instead of a session cookie. */
export const SERVICE_SECRET_HEADER = 'X-Seed-Service-Secret'

/**
 * True when the request carries the deployment's service secret
 * (SEED_SERVICE_SECRET). Services on the box poll and read the site server-side
 * and have no browser session; the secret is never sent to a browser.
 */
export function hasServiceSecret(request: Request): boolean {
  const secret = process.env.SEED_SERVICE_SECRET
  const presented = request.headers.get(SERVICE_SECRET_HEADER)
  if (!secret || !presented) return false
  const expected = Buffer.from(secret)
  const actual = Buffer.from(presented)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

/** A member's session cookie, or one of the box's own services. */
export function isSignedInRequest(request: Request): boolean {
  return !!getWebSession(request) || hasServiceSecret(request)
}

// Hand-rolled rather than Remix's createCookie so the value stays the plain
// `payload.signature` form that other services on the box can verify.
function cookieAttributes(expires: Date): string {
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Expires=${expires.toUTCString()}`]
  if (IS_PRODUCTION) attrs.push('Secure')
  return attrs.join('; ')
}

export function webSessionSetCookie(value: string, expiresAtSeconds: number): string {
  return `${WEB_SESSION_COOKIE}=${value}; ${cookieAttributes(new Date(expiresAtSeconds * 1000))}`
}

export function webSessionClearCookie(): string {
  return `${WEB_SESSION_COOKIE}=; ${cookieAttributes(new Date(0))}`
}
