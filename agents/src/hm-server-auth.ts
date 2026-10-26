/**
 * Service authentication towards the agents' own Hypermedia site.
 *
 * An Enterprise site answers only signed-in members; the agents service runs on the same box and
 * polls and reads the site server-side, with no browser session. The deployment gives it a shared
 * secret (`SEED_AGENTS_HM_SERVER_SECRET`, the web app's `SEED_SERVICE_SECRET`) that the site's gate
 * accepts in place of a session cookie. Every request to the site's origin carries it, whichever
 * client makes the call (the Seed client, IPFS uploads, document reads), so it is attached at the
 * fetch layer.
 */

/** Header the web app's sign-in gate checks; see frontend/apps/web/app/web-session.server.ts. */
export const SERVICE_SECRET_HEADER = 'X-Seed-Service-Secret'

const MAX_REDIRECTS = 10

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    return new URL(input.url)
  } catch {
    return null
  }
}

/**
 * Wraps `fetch` so requests to one of `origins` carry the service secret. Redirects of those
 * requests are followed by hand: `fetch` keeps custom headers across a cross-origin redirect, and
 * the secret must never leave the site.
 */
export function withHmServerAuth(baseFetch: typeof fetch, origins: string[], secret: string): typeof fetch {
  const allowed = new Set(origins.map((origin) => new URL(origin).origin))
  const authFetch = async (input: RequestInfo | URL, init?: RequestInit, hops = 0): Promise<Response> => {
    const url = requestUrl(input)
    if (!url || !allowed.has(url.origin)) return baseFetch(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    headers.set(SERVICE_SECRET_HEADER, secret)
    const callerRedirect = init?.redirect ?? (input instanceof Request ? input.redirect : 'follow')
    const response = await baseFetch(input, {...init, headers, redirect: 'manual'})
    const location = response.headers.get('Location')
    if (callerRedirect !== 'follow' || !location || response.status < 300 || response.status >= 400) return response
    if (hops >= MAX_REDIRECTS) throw new TypeError(`Too many redirects fetching ${url.href}`)
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    // 303, and 301/302 after a POST, turn into a GET without a body, as fetch itself does.
    const toGet = response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')
    const next = new URL(location, url)
    const nextInit: RequestInit = toGet ? {...init, method: 'GET', body: undefined} : {...init}
    if (input instanceof Request && !init) {
      nextInit.method ??= input.method
      nextInit.headers = input.headers
    }
    // Same origin: recurse so the secret is attached again. Elsewhere: plain fetch, no secret.
    return allowed.has(next.origin) ? authFetch(next, nextInit, hops + 1) : baseFetch(next, nextInit)
  }
  return Object.assign((input: RequestInfo | URL, init?: RequestInit) => authFetch(input, init), baseFetch)
}

/** Installs {@link withHmServerAuth} on the global `fetch` when a secret is configured. */
export function installHmServerAuth(origins: string[], secret: string | undefined): void {
  if (!secret) return
  globalThis.fetch = withHmServerAuth(globalThis.fetch, origins, secret)
}
