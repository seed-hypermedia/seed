import {hmIdPathToEntityQueryPath} from './utils/path-api'

/**
 * Blob-type scope keyword for `discoveryUrl`. The server owns the mapping
 * to the underlying blob-type allowlist; clients only refer to scopes by
 * keyword. `'all'` produces no suffix (default) — every blob type is
 * discovered. `'profile'` requests only the blobs needed to render an
 * account's name + avatar.
 */
export type DiscoveryScope = 'all' | 'profile'

/**
 * Recursion mode for `discoveryUrl`. `'none'` (default) only fetches the
 * exact resource. `'children'` fetches direct children (depth=1).
 * `'descendants'` fetches the full subtree below the resource. Recursion
 * is mutually exclusive with `scope` other than `'all'`.
 */
export type DiscoveryRecursion = 'none' | 'children' | 'descendants'

export type DiscoveryUrlOptions = {
  uid: string
  path?: string[] | null
  recursion?: DiscoveryRecursion
  scope?: DiscoveryScope
}

/**
 * Builds an hm:// URL accepted by `DiscoverResourceRequest.id`.
 *
 * The returned string is canonical: identical inputs produce byte-identical
 * URLs, so it can be used as a stable dedup key for in-flight discovery
 * requests on the client side.
 *
 * Throws if `recursion` and `scope` are both set to non-default values —
 * the server rejects that combination too.
 */
export function discoveryUrl(opts: DiscoveryUrlOptions): string {
  const recursion = opts.recursion ?? 'none'
  const scope = opts.scope ?? 'all'
  if (recursion !== 'none' && scope !== 'all') {
    throw new Error(`discoveryUrl: recursion (${recursion}) and scope (${scope}) are mutually exclusive`)
  }
  const path = hmIdPathToEntityQueryPath(opts.path ?? null)
  let suffix = ''
  if (recursion === 'children') {
    suffix = '/*'
  } else if (recursion === 'descendants') {
    suffix = '/**'
  } else if (scope === 'profile') {
    suffix = path === '' ? '/:profile' : ':profile'
  }
  return `hm://${opts.uid}${path}${suffix}`
}
