/**
 * Notify service URLs.
 *
 * Notify lives on a site's own origin at `/hm/api/notify`. A client may hold either:
 * - a canonical base whose pathname ends with `/hm/api/notify` (e.g. `https://hyper.media/hm/api/notify`), or
 * - a legacy origin-only value (e.g. `https://notify.example.com`), whose endpoints live at `/hm/api/<leaf>`.
 *
 * The retired hosted notify hostnames are rewritten to their canonical replacements.
 */

export const NOTIFY_API_PREFIX = '/hm/api/notify'

export const HOSTED_NOTIFY_SERVICE_URL = 'https://hyper.media/hm/api/notify'

const RETIRED_NOTIFY_HOSTS: Record<string, string> = {
  'notify.seed.hyper.media': HOSTED_NOTIFY_SERVICE_URL,
  'notify-dev.seed.hyper.media': 'https://dev.hyper.media/hm/api/notify',
}

/** Trims, strips trailing slashes, and rewrites retired hosted notify hosts. Returns null for empty input. */
export function normalizeNotifyServiceUrl(input: string | null | undefined): string | null {
  const trimmed = input?.trim().replace(/\/+$/, '')
  if (!trimmed) return null
  try {
    const replacement = RETIRED_NOTIFY_HOSTS[new URL(trimmed).hostname.toLowerCase()]
    if (replacement) return replacement
  } catch {
    // Not a parseable URL; leave it for the caller to fail on.
  }
  return trimmed
}

/** True when the base's pathname ends with `/hm/api/notify`. */
export function isCanonicalNotifyServiceUrl(base: string): boolean {
  try {
    return new URL(base).pathname.replace(/\/+$/, '').endsWith(NOTIFY_API_PREFIX)
  } catch {
    return false
  }
}

/** The origin of a notify base URL. */
export function notifyServiceOrigin(base: string): string {
  return new URL(base).origin
}

/** URL for a notify endpoint: `${base}/${leaf}` for canonical bases, `${origin}/hm/api/${leaf}` for legacy ones. */
export function notifyEndpointUrl(base: string, leaf: string): string {
  const normalized = normalizeNotifyServiceUrl(base) ?? base
  const cleanLeaf = leaf.replace(/^\/+/, '')
  if (isCanonicalNotifyServiceUrl(normalized)) {
    const url = new URL(normalized)
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}/${cleanLeaf}`
  }
  return `${notifyServiceOrigin(normalized)}/hm/api/${cleanLeaf}`
}
