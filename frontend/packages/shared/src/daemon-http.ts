import type {Interceptor} from '@connectrpc/connect'
import {DAEMON_HTTP_URL} from './constants'

declare global {
  interface Window {
    /** In-memory credential supplied by the desktop preload. */
    daemonAppSecret?: string
  }
}

function appSecret(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.daemonAppSecret
}

/** Authenticate renderer RPCs to the desktop daemon. */
export const daemonAuthInterceptor: Interceptor = (next) => (request) => {
  const secret = appSecret()
  if (secret) request.header.set('X-Seed-App-Secret', secret)
  return next(request)
}

/** Fetch the daemon without exposing its app credential to other origins or redirects. */
export function daemonFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  if (url.origin !== new URL(DAEMON_HTTP_URL).origin) {
    throw new Error('daemonFetch requires the daemon origin')
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  const secret = appSecret()
  if (secret) headers.set('X-Seed-App-Secret', secret)
  return fetch(input, {...init, headers, redirect: 'error'})
}
