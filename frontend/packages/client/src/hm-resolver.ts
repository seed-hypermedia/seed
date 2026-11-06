import {pageParamsFromUrl} from './page-input'
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
  /** Distinguish failed HTTP/malformed metadata from a verified ordinary web page. */
  requireSuccessfulResponse?: boolean
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
/** Converts a domain-based hm:// reference to its HTTPS resolution URL; canonical IDs return null. */
export function hmDomainUrlToWebUrl(input: string): string | null {
  if (!input.startsWith('hm://')) return null
  const parsed = unpackHmId(input)
  if (!parsed?.uid.includes('.')) return null
  const url = new URL(`https://${input.slice('hm://'.length)}`)
  if (url.username || url.password) throw new Error('Hypermedia domain URLs cannot contain credentials')
  return url.href
}

export async function resolveHypermediaUrl(url: string, opts?: ResolveOptions): Promise<ResolvedUrl | null> {
  url = hmDomainUrlToWebUrl(url) || url
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
  if (opts?.requireSuccessfulResponse && response.status !== 200) {
    throw new Error(`Hypermedia URL resolution failed with HTTP ${response.status}`)
  }
  if (response.status === 200) {
    const rawId = response.headers.get('x-hypermedia-id')
    if (
      opts?.requireSuccessfulResponse &&
      !rawId &&
      [
        'x-hypermedia-id',
        'x-hypermedia-version',
        'x-hypermedia-title',
        'x-hypermedia-target',
        'x-hypermedia-authors',
        'x-hypermedia-type',
      ].some((header) => response.headers.has(header))
    ) {
      throw new Error('Missing Hypermedia identity response header')
    }
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
        if (opts?.requireSuccessfulResponse) throw new Error('Invalid Hypermedia identity response header')
        return null
      }
      return {
        id,
        hmId: {
          ...hmId,
          ...(pageParamsFromUrl(url) ? {pageParams: pageParamsFromUrl(url)} : {}),
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
export async function resolveId(input: string, opts?: ResolveOptions): Promise<UnpackedHypermediaId> {
  const domainUrl = hmDomainUrlToWebUrl(input)
  const parsed = domainUrl ? null : unpackHmId(input)
  if (parsed) return parsed

  if (domainUrl || input.startsWith('http://') || input.startsWith('https://')) {
    const resolved = await resolveHypermediaUrl(domainUrl || input, opts)
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
  // on ordinary custom domains /hm/... is a normal site path.
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
  const siteHostname = parsedUrl.origin

  return {
    id: `hm://${resolvedUid}${pathStr}`,
    hmId: {
      id: `hm://${resolvedUid}${pathStr}`,
      uid: resolvedUid,
      path,
      version,
      blockRef,
      blockRange,
      hostname: siteHostname,
      scheme: 'hm',
      ...(pageParamsFromUrl(parsedUrl.href) ? {pageParams: pageParamsFromUrl(parsedUrl.href)} : {}),
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

function resolveProfilePath(siteUid: string, pathSegments: string[]): {uid: string; path: string[]} | null {
  if (pathSegments[0] !== ':profile') return null
  return {
    uid: pathSegments[1] || siteUid,
    path: [':profile'],
  }
}

const COMMENT_VIEW_TERMS = new Set([':comments', ':comment', ':discussions'])
const COMMENT_PANEL_PREFIXES = new Set(['comments', 'comment', 'discussions'])

/** Extracts a two-segment `<uid>/<tsid>` comment id from a `?panel=…` value, or null.
 * Only the two-segment comment-id form resolves; `comments/<block id>` opens a block's
 * discussion rather than a comment. */
function extractCommentIdFromPanel(panel: string | null): string | null {
  if (!panel) return null
  const [viewTerm, first, second] = panel.split('/')
  if (!viewTerm || !COMMENT_PANEL_PREFIXES.has(viewTerm)) return null
  if (first && second) return `${first}/${second}`
  return null
}

/** Extracts a comment id from a path ending in `/:comments/<id>` or `/:comments/<uid>/<tsid>`.
 * Kept permissive: the single-segment `/:comments/<id>` path form still resolves. */
function extractCommentIdFromPath(pathParts: string[]): string | null {
  if (pathParts.length >= 3) {
    const thirdToLast = pathParts[pathParts.length - 3]!
    if (thirdToLast && COMMENT_VIEW_TERMS.has(thirdToLast)) {
      return `${pathParts[pathParts.length - 2]}/${pathParts[pathParts.length - 1]}`
    }
  }
  if (pathParts.length >= 2) {
    const secondToLast = pathParts[pathParts.length - 2]
    if (secondToLast && COMMENT_VIEW_TERMS.has(secondToLast)) return pathParts[pathParts.length - 1] || null
  }
  return null
}

/** Parses a `?reply=<uid>/<tsid>` value, requiring the two-segment comment-id form. */
function parseReplyCommentId(reply: string | null): string | null {
  if (!reply) return null
  const [first, second] = reply.split('/')
  if (first && second) return `${first}/${second}`
  return null
}

/**
 * The comment a Hypermedia URL addresses, as `<author uid>/<tsid>`, or null when the URL
 * addresses no single comment.
 *
 * A comment appears in a URL as the `/:comments/<uid>/<tsid>` main view or the
 * `?panel=comments/<uid>/<tsid>` side panel, either of which may carry
 * `?reply=<uid>/<tsid>`. A selected reply is the comment the URL is about, so it wins over
 * the thread root. `?panel=comments/<block id>` opens a block's discussion rather than a
 * comment, so only the two-segment comment-id form resolves from the panel parameter.
 */
export function extractCommentIdFromUrl(url: string): string | null {
  const isWeb = url.startsWith('http://') || url.startsWith('https://')
  let panelCommentId: string | null = null
  let pathCommentId: string | null = null
  let reply: string | null = null

  if (isWeb) {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return null
    }
    panelCommentId = extractCommentIdFromPanel(parsedUrl.searchParams.get('panel'))
    reply = parseReplyCommentId(parsedUrl.searchParams.get('reply'))
    // Gateway `/hm/…` URLs expose the canonical path through unpackHmId; site URLs
    // expose it through the pathname.
    const unpacked = unpackHmId(url)
    const pathParts = unpacked?.path ?? parsedUrl.pathname.split('/').filter(Boolean)
    pathCommentId = extractCommentIdFromPath(pathParts)
  } else {
    // `hm://` is a custom scheme; read the query off the raw string so `new URL`'s
    // scheme validation does not reject it.
    const [withoutHash] = url.split('#')
    const [withoutQuery, queryString] = withoutHash!.split('?')
    const searchParams = new URLSearchParams(queryString)
    panelCommentId = extractCommentIdFromPanel(searchParams.get('panel'))
    reply = parseReplyCommentId(searchParams.get('reply'))
    const parsed = unpackHmId(withoutQuery)
    pathCommentId = parsed?.path ? extractCommentIdFromPath(parsed.path) : null
  }

  const threadCommentId = panelCommentId || pathCommentId
  if (!threadCommentId) return null
  // `?reply=` is honored only when the URL already names a comment thread.
  return reply ?? threadCommentId
}
