// Pure rules for the SEED_REQUIRE_SIGN_IN gate. Kept free of server imports so
// the sign-in page can reuse the `next` validation in the browser. The proxy's
// allowlist is generated from the same lists so the two never disagree.

export const SIGN_IN_PATH = '/hm/sign-in'

// Everything a browser needs to get from "no session" to "signed in", plus the
// static files the shell itself is built from. Anything else is closed.
export const OPEN_EXACT_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  '/hm/auth/callback',
  '/hm/api/config',
  '/hm/api/site-url',
  '/hm/api/auth',
  '/hm/api/session',
  '/hm/api/version',
  '/hm/api/register',
  '/hm/register',
  // Creating the organization's space must work before any content exists;
  // the route itself refuses to publish without a signed-in identity.
  '/hm/create-site',
  // Email notification settings, reached from a link in a notification email:
  // the token in the URL is the credential, and its holder need not be a member.
  // The notify API it calls (/hm/api/notify/*) is routed by the proxy straight to
  // the notify service, so this gate never sees those requests.
  '/hm/email-notifications',
  '/vault',
  '/robots.txt',
  '/healthz',
]

export const OPEN_PATH_PREFIXES: readonly string[] = [
  '/vault/',
  '/assets/',
  '/build/',
  '/favicon',
  '/.well-known/',
  // Remix lazy route discovery fetches the manifest for the open pages too.
  '/__manifest',
]

// Calls the sign-in flow makes before any cookie can exist: the vault callback
// stores the delegation blobs and looks the account up, and the vault UI
// (proxied under /vault) uploads profile blobs straight to the daemon.
export const OPEN_METHOD_RULES: readonly {method: string; path: string; prefix?: boolean}[] = [
  {method: 'POST', path: '/api/PublishBlobs'},
  // The deploy script creates the organization's space before any member
  // exists; the route itself demands the vault admin secret.
  {method: 'POST', path: '/hm/api/enterprise-bootstrap'},
  // After a hostname change the deploy script republishes the home document's
  // siteUrl; the same admin secret guards it.
  {method: 'POST', path: '/hm/api/enterprise-site-url'},
  {method: 'GET', path: '/api/Account'},
  {method: 'HEAD', path: '/api/Account'},
  {method: 'POST', path: '/ipfs/', prefix: true},
]

function normalizePath(pathname: string): string {
  // Remix single-fetch data requests are the page path with a `.data` suffix;
  // a trailing slash is redirected away later in the pipeline. Treat both as
  // the page itself so they do not first bounce through sign-in.
  let path = pathname.endsWith('.data') ? pathname.slice(0, -'.data'.length) : pathname
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

export function isOpenPath(pathname: string, method: string = 'GET'): boolean {
  const path = normalizePath(pathname)
  if (OPEN_EXACT_PATHS.includes(path)) return true
  if (OPEN_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  const verb = method.toUpperCase()
  return OPEN_METHOD_RULES.some(
    (rule) => rule.method === verb && (rule.prefix ? path.startsWith(rule.path) : path === rule.path),
  )
}

/**
 * Only ever send a signed-in user somewhere on this origin. Rejects absolute
 * URLs, protocol-relative `//host` forms (and the `/\` variant browsers treat
 * the same way), and the sign-in page itself so a stale `next` cannot loop.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/')) return '/'
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  if (raw === SIGN_IN_PATH || raw.startsWith(`${SIGN_IN_PATH}?`) || raw.startsWith(`${SIGN_IN_PATH}/`)) return '/'
  return raw
}

export function signInUrl(next: string): string {
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`
}

export function gateDocumentRequest(input: {
  enabled: boolean
  pathname: string
  search: string
  method?: string
  hasSession: boolean
}): {redirect?: string} {
  if (!input.enabled || input.hasSession || isOpenPath(input.pathname, input.method)) return {}
  return {redirect: signInUrl(`${input.pathname}${input.search}`)}
}
