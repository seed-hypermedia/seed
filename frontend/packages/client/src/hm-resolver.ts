import {entityQueryPathToHmIdPath, parseFragment, unpackHmId, type UnpackedHypermediaId} from './hm-types'

/**
 * Domain metadata from the daemon's domain store. The string form is kept
 * for older/simple resolvers that only return an account UID.
 */
export type DomainResolution =
  | string
  | {
      registeredAccountUid: string
      isGateway?: boolean
    }
  | null
export type DomainResolverFn = (hostname: string) => Promise<DomainResolution>

/**
 * Callback fired when a background domain check detects that a domain
 * now points to a different account UID than what was cached.
 */
export type DomainIdChangedCallback = (domain: string, oldUid: string, newUid: string) => void

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
  let blockRange: {start: number; end: number} | {expanded: boolean} | null = null
  let panel: string | null = null
  let parsedUrl: URL | null = null
  try {
    parsedUrl = new URL(url)
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
  if (opts?.domainResolver && parsedUrl) {
    try {
      const resolved = await resolveFromDomainResolver(opts.domainResolver, url, parsedUrl, {
        latest,
        blockRef,
        blockRange,
        panel,
      })
      if (resolved) {
        return resolved
      }
    } catch {
      // Domain resolver failed, fall through to OPTIONS
    }
  }

  // Fall back to OPTIONS request (original method, requires network)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'OPTIONS',
    })
  } catch (error) {
    if (opts?.domainResolver && parsedUrl) {
      try {
        const resolved = await resolveFromDomainResolver(opts.domainResolver, url, parsedUrl, {
          latest,
          blockRef,
          blockRange,
          panel,
        })
        if (resolved) {
          return resolved
        }
      } catch {
        // Preserve the original fetch error when fallback resolution also fails.
      }
    }
    throw error
  }
  if (response.status === 200) {
    const rawId = response.headers.get('x-hypermedia-id')
    const id = rawId ? decodeURIComponent(rawId) : null
    const version = response.headers.get('x-hypermedia-version')
    const encodedTitle = response.headers.get('x-hypermedia-title')
    const title = encodedTitle ? decodeURIComponent(encodedTitle) : null
    const rawTarget = response.headers.get('x-hypermedia-target')
    const target = rawTarget ? unpackHmId(decodeURIComponent(rawTarget)) : null
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
      let spaceHostname: string | null = null
      try {
        const inputUrl = new URL(url)
        if (!inputUrl.pathname.startsWith('/hm/')) {
          spaceHostname = inputUrl.origin
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
          hostname: spaceHostname || hmId.hostname,
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
 * Resolve a string that may be an hm:// ID, a gateway URL, or a space web URL
 * into an UnpackedHypermediaId. Tries synchronous parsing first, then falls
 * back to an OPTIONS request for web URLs.
 */
export async function resolveId(input: string, opts?: ResolveOptions): Promise<UnpackedHypermediaId> {
  const parsed = unpackHmId(input)
  if (parsed) return parsed

  if (input.startsWith('http://') || input.startsWith('https://')) {
    const resolved = await resolveHypermediaUrl(input, opts)
    if (resolved?.hmId) return resolved.hmId
    throw new Error(`URL does not appear to be a Seed Hypermedia resource: ${input}`)
  }

  throw new Error(`Invalid Hypermedia ID: ${input}`)
}

async function resolveFromDomainResolver(
  domainResolver: DomainResolverFn,
  url: string,
  parsedUrl: URL,
  opts: {
    latest: boolean
    blockRef: string | null
    blockRange: {start: number; end: number} | {expanded: boolean} | null
    panel: string | null
  },
): Promise<ResolvedUrl | null> {
  const domainResolution = await domainResolver(parsedUrl.hostname)
  const uid = typeof domainResolution === 'string' ? domainResolution : domainResolution?.registeredAccountUid ?? null
  if (!uid) return null

  // Only gateway domains treat /hm/* paths as embedded canonical HM ids;
  // on ordinary custom domains /hm/... is a normal space path.
  const isGateway = typeof domainResolution === 'object' && !!domainResolution?.isGateway
  const gatewayHmId = isGateway && parsedUrl.pathname.startsWith('/hm/') ? unpackHmId(url) : null
  if (gatewayHmId) {
    return {
      id: gatewayHmId.id,
      hmId: gatewayHmId,
      version: gatewayHmId.version,
      title: null,
      target: null,
      authors: null,
      type: null,
      panel: opts.panel,
    }
  }

  return buildResolvedUrlFromDomainUid(parsedUrl, uid, opts)
}

function buildResolvedUrlFromDomainUid(
  parsedUrl: URL,
  uid: string,
  {
    latest,
    blockRef,
    blockRange,
    panel,
  }: {
    latest: boolean
    blockRef: string | null
    blockRange: {start: number; end: number} | {expanded: boolean} | null
    panel: string | null
  },
): ResolvedUrl {
  const pathSegments = entityQueryPathToHmIdPath(parsedUrl.pathname)
  const profilePath = resolveProfilePath(uid, pathSegments)
  const resolvedUid = profilePath?.uid || uid
  const path = profilePath?.path || (pathSegments.length > 0 ? pathSegments : null)
  const version = parsedUrl.searchParams.get('v') || null
  const pathStr = path ? '/' + path.join('/') : ''
  const spaceHostname = parsedUrl.origin

  return {
    id: `hm://${resolvedUid}${pathStr}`,
    hmId: {
      id: `hm://${resolvedUid}${pathStr}`,
      uid: resolvedUid,
      path,
      version,
      blockRef,
      blockRange,
      hostname: spaceHostname,
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

function resolveProfilePath(spaceUid: string, pathSegments: string[]): {uid: string; path: string[]} | null {
  if (pathSegments[0] !== ':profile') return null
  return {
    uid: pathSegments[1] || spaceUid,
    path: [':profile'],
  }
}
