import {AsyncLocalStorage} from 'node:async_hooks'

const DAEMON_AUTH_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-HM-Auth-Token' : 'HM-Auth-Token'

const authTokenStorage = new AsyncLocalStorage<string | null>()

export const daemonAuthCookie = {
  async parse(cookieHeader: string | null): Promise<string | null> {
    if (!cookieHeader) return null
    const cookies = cookieHeader.split(';')
    for (const cookie of cookies) {
      const [rawName, ...rawValue] = cookie.trim().split('=')
      if (rawName === DAEMON_AUTH_COOKIE) {
        return decodeURIComponent(rawValue.join('='))
      }
    }
    return null
  },
  async serialize(value: string, options?: {expires?: Date}): Promise<string> {
    const parts = [`${DAEMON_AUTH_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
    if (process.env.NODE_ENV === 'production') parts.push('Secure')
    if (options?.expires) parts.push(`Expires=${options.expires.toUTCString()}`)
    return parts.join('; ')
  },
}

export async function getDaemonAuthToken(request: Request): Promise<string | null> {
  const value = await daemonAuthCookie.parse(request.headers.get('Cookie'))
  return typeof value === 'string' && value ? value : null
}

export function getCurrentDaemonAuthToken(): string | null {
  return authTokenStorage.getStore() || null
}

export function withDaemonAuthToken<T>(token: string | null, fn: () => T): T {
  return authTokenStorage.run(token, fn)
}

export async function daemonAuthSetCookie(token: string, expiresAt: number): Promise<string> {
  return daemonAuthCookie.serialize(token, {
    expires: new Date(expiresAt * 1000),
  })
}

export async function daemonAuthClearCookie(): Promise<string> {
  return daemonAuthCookie.serialize('', {
    expires: new Date(0),
  })
}
