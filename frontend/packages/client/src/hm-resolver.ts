import {
  parseFragment,
  unpackHmId,
  type UnpackedHypermediaId,
} from './hm-types'

/**
 * A domain resolver function that maps a hostname to an account UID
 * using the daemon's domain store. Returns the UID if cached, or null.
 */
export type DomainResolverFn = (hostname: string) => Promise<string | null>

/**
 * Callback fired when a background domain check detects that a domain
 * now points to a different account UID than what was cached.
 */
export type DomainIdChangedCallback = (
  domain: string,
  oldUid: string,
  newUid: string,
) => void

export type ResolveOptions = {
  domainResolver?: DomainResolverFn
}

/**
 * Resolve a web URL to its Hypermedia metadata.
 *
 * If opts.domainResolver is provided, it is tried first for fast cached
 * resolution (works offline). Falls back to an OPTIONS request if the
 * domain resolver returns null or is not provided.
 */
export type ResolvedUrl = {
  id: string
  hmId: UnpackedHypermediaId
  version: string | null
  title: string | null
  target: UnpackedHypermediaId | null
  authors: UnpackedHypermediaId[] | null
  type: string | null
  panel: string | null
}
export async function resolveHypermediaUrl(url: string, opts?: ResolveOptions): Promise<ResolvedUrl | null> {
  // Parse query params and fragment from original URL
  let latest = false
  let blockRef: string | null = null
  let blockRange:
    | {start: number; end: number}
    | {expanded: boolean}
    | null = null
  let panel: string | null = null
  let parsedHostname: string | null = null
  try {
    const parsedUrl = new URL(url)
    parsedHostname = parsedUrl.hostname
    const hasVersion = parsedUrl.searchParams.has('v')
    const hasLatest = parsedUrl.searchParams.has('l')
    panel = parsedUrl.searchParams.get('panel')

    // Extract blockRef and blockRange from fragment first
    if (parsedUrl.hash) {
      const fragment = parseFragment(parsedUrl.hash.slice(1))
      if (fragment) {
        blockRef = fragment.blockId
        if ('start' in fragment && fragment.start !== undefined) {
          blockRange = {start: fragment.start, end: fragment.end!}
        } else if ('expanded' in fragment && fragment.expanded) {
          blockRange = {expanded: fragment.expanded}
        }
      }
    }

    // When blockRef is present, version takes precedence over latest
    // because the block only exists in a specific version
    latest = blockRef ? false : hasLatest || !hasVersion
  } catch {
    // If URL parsing fails, continue with defaults
  }

  // Try domain resolver first (fast, cached, works offline).
  if (opts?.domainResolver && parsedHostname) {
    try {
      const parsedUrl = new URL(url)
      const uid = await opts.domainResolver(parsedHostname)
      if (uid) {
        const pathSegments = parsedUrl.pathname.split('/').filter(Boolean)
        const path = pathSegments.length > 0 ? pathSegments : null
        const version = parsedUrl.searchParams.get('v') || null
        const pathStr = path ? '/' + path.join('/') : ''
        const siteHostname = parsedUrl.origin

        return {
          id: `hm://${uid}${pathStr}`,
          hmId: {
            id: `hm://${uid}${pathStr}`,
            uid,
            path,
            version,
            blockRef,
            blockRange,
            hostname: siteHostname,
            scheme: 'hm',
            latest,
          } as UnpackedHypermediaId,
          version,
          title: null,
          target: null,
          authors: null,
          type: null,
          panel,
        }
      }
    } catch {
      // Domain resolver failed, fall through to OPTIONS
    }
  }

  // Fall back to OPTIONS request (original method, requires network)
  const response = await fetch(url, {
    method: 'OPTIONS',
  })
  if (response.status === 200) {
    const rawId = response.headers.get('x-hypermedia-id')
    const id = rawId ? decodeURIComponent(rawId) : null
    const version = response.headers.get('x-hypermedia-version')
    const encodedTitle = response.headers.get('x-hypermedia-title')
    const title = encodedTitle ? decodeURIComponent(encodedTitle) : null
    const rawTarget = response.headers.get('x-hypermedia-target')
    const target = rawTarget
      ? unpackHmId(decodeURIComponent(rawTarget))
      : null
    const rawAuthors = response.headers.get('x-hypermedia-authors')
    const authors = rawAuthors
      ? decodeURIComponent(rawAuthors)
          .split(',')
          .map((author) => unpackHmId(author))
          .filter((author): author is UnpackedHypermediaId => author !== null)
      : null
    const type = response.headers.get('x-hypermedia-type')
    if (id) {
      const hmId = unpackHmId(id)
      const resolvedVersion = version ?? hmId?.version ?? null
      let siteHostname: string | null = null
      try {
        const inputUrl = new URL(url)
        if (!inputUrl.pathname.startsWith('/hm/')) {
          siteHostname = inputUrl.origin
        }
      } catch {
        // ignore parse errors
      }
      if (!hmId) {
        return null
      }
      return {
        id,
        hmId: {
          ...hmId,
          version: resolvedVersion,
          latest,
          blockRef,
          blockRange,
          hostname: siteHostname || hmId.hostname,
        },
        version,
        title,
        target,
        authors,
        type,
        panel,
      }
    }
    return null
  }
  return null
}

/**
 * Resolve a string that may be an hm:// ID, a gateway URL, or a site web URL
 * into an UnpackedHypermediaId. Tries synchronous parsing first, then falls
 * back to an OPTIONS request for web URLs.
 */
export async function resolveId(
  input: string,
  opts?: ResolveOptions,
): Promise<UnpackedHypermediaId> {
  const parsed = unpackHmId(input)
  if (parsed) return parsed

  if (input.startsWith('http://') || input.startsWith('https://')) {
    const resolved = await resolveHypermediaUrl(input, opts)
    if (resolved?.hmId) return resolved.hmId
    throw new Error(
      `URL does not appear to be a Seed Hypermedia resource: ${input}`,
    )
  }

  throw new Error(`Invalid Hypermedia ID: ${input}`)
}
