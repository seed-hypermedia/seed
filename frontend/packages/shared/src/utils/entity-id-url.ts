import {BlockRange, HMComment, ParsedFragment, UnpackedHypermediaId} from '..'
import {DEFAULT_GATEWAY_URL, HYPERMEDIA_SCHEME} from '../constants'
import {NavRoute} from '../routes'
import {entityQueryPathToHmIdPath} from './path-api'
import {StateStream} from './stream'

// View terms for URL paths (e.g., /:activity, /:directory)
export const VIEW_TERMS = [
  ':activity',
  ':discussions',
  ':collaborators',
  ':directory',
] as const
export type ViewTerm = (typeof VIEW_TERMS)[number]

// Route keys that correspond to view terms (excludes 'options' which is panel-only)
export type ViewRouteKey =
  | 'activity'
  | 'discussions'
  | 'collaborators'
  | 'directory'

// Panel keys that can be encoded in URL query param
export type PanelQueryKey =
  | 'activity'
  | 'discussions'
  | 'collaborators'
  | 'directory'
  | 'options'

/**
 * Extract view term from URL path and return cleaned URL + view term
 * e.g., "https://example.com/path/:directory?v=123" -> {url: "https://example.com/path?v=123", viewTerm: ":directory"}
 */
export function extractViewTermFromUrl(url: string): {
  url: string
  viewTerm: ViewTerm | null
} {
  for (const term of VIEW_TERMS) {
    // Match term at end of path (before query/fragment)
    const termPattern = new RegExp(`/${term.replace(':', '\\:')}(?=[?#]|$)`)
    if (termPattern.test(url)) {
      return {
        url: url.replace(termPattern, ''),
        viewTerm: term,
      }
    }
  }
  return {url, viewTerm: null}
}

/**
 * Convert view term to route key for navigation
 */
export function viewTermToRouteKey(
  viewTerm: ViewTerm | null,
): ViewRouteKey | null {
  if (!viewTerm) return null
  const mapping: Record<ViewTerm, ViewRouteKey> = {
    ':activity': 'activity',
    ':discussions': 'discussions',
    ':collaborators': 'collaborators',
    ':directory': 'directory',
  }
  return mapping[viewTerm] ?? null
}

export function createSiteUrl({
  path,
  hostname,
  version,
  latest,
  blockRef,
  blockRange,
}: {
  path: string[] | null | undefined
  hostname: string
  version?: string | null | undefined
  latest?: boolean
  blockRef?: string | null | undefined
  blockRange?: BlockRange | null
}) {
  let res = `${hostname}/`
  if (path && path.length) {
    res += path.join('/')
  }
  res += getHMQueryString({latest, version})
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return res
}

export function getCommentTargetId(
  comment: HMComment | undefined,
): UnpackedHypermediaId | undefined {
  if (!comment) return undefined
  return hmId(comment.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.targetPath || ''),
    version: comment.targetVersion,
  })
}

export function commentIdToHmId(commentId: string): UnpackedHypermediaId {
  const commentIdParts = commentId.split('/')
  const uid = commentIdParts[0]!
  const tsid = commentIdParts[1]!
  return hmId(uid, {
    path: [tsid],
  })
}

export function hmIdToURL({
  uid,
  path,
  version,
  latest,
  blockRef,
  blockRange,
}: UnpackedHypermediaId) {
  let res = `${HYPERMEDIA_SCHEME}://${uid}`

  if (path && path.length) {
    res += `/${path.join('/')}`
  }
  res += getHMQueryString({version, latest})
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }

  return res
}

/**
 * Create URL for OS protocol registration (to open desktop app).
 * Uses 'hm://'
 * This is separate from hmIdToURL which creates document URLs.
 */
export function createOSProtocolUrl({
  uid,
  path,
  version,
  latest,
  blockRef,
  blockRange,
}: UnpackedHypermediaId) {
  // Import at runtime to avoid circular dependency
  const {OS_PROTOCOL_SCHEME} = require('../constants')
  let res = `${OS_PROTOCOL_SCHEME}://${uid}`

  if (path && path.length) {
    res += `/${path.join('/')}`
  }
  res += getHMQueryString({version, latest})
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }

  return res
}
function getRouteViewTerm(route: NavRoute): string | null {
  // For first-class page routes, return their view term
  if (route.key === 'activity') return ':activity'
  if (route.key === 'discussions') return ':discussions'
  if (route.key === 'collaborators') return ':collaborators'
  if (route.key === 'directory') return ':directory'
  return null
}

/**
 * Extract panel key from route for URL query param
 */
function getRoutePanelParam(route: NavRoute): PanelQueryKey | null {
  if (route.key === 'document' && route.panel) {
    return route.panel.key as PanelQueryKey
  }
  if (
    (route.key === 'activity' ||
      route.key === 'discussions' ||
      route.key === 'collaborators' ||
      route.key === 'directory') &&
    route.panel
  ) {
    return route.panel.key as PanelQueryKey
  }
  return null
}
/**
 * Get the comment ID from a route if viewing a specific comment
 */
function getRouteCommentId(
  route: NavRoute,
): {uid: string; path: string[]} | null {
  // Check discussions page route
  if (route.key === 'discussions' && route.openComment) {
    const [uid, ...path] = route.openComment.split('/')
    if (uid && path.length) return {uid, path}
  }
  // Check document with discussions panel
  if (
    route.key === 'document' &&
    route.panel?.key === 'discussions' &&
    route.panel.openComment
  ) {
    const [uid, ...path] = route.panel.openComment.split('/')
    if (uid && path.length) return {uid, path}
  }
  return null
}

export function routeToUrl(
  route: NavRoute,
  opts?: {
    hostname?: string | null | undefined
    originHomeId?: UnpackedHypermediaId | undefined
  },
) {
  // Check if viewing a specific comment - generate comment URL instead
  const commentId = getRouteCommentId(route)
  if (commentId) {
    return createWebHMUrl(commentId.uid, {
      path: commentId.path,
      hostname: opts?.hostname,
      originHomeId: opts?.originHomeId,
    })
  }

  const panelParam = getRoutePanelParam(route)

  if (route.key === 'document') {
    const url = createWebHMUrl(route.id.uid, {
      ...route.id,
      hostname: opts?.hostname,
      originHomeId: opts?.originHomeId,
      viewTerm: getRouteViewTerm(route),
      panel: panelParam,
    })
    return url
  }
  if (route.key === 'feed') {
    return createWebHMUrl(route.id.uid, {
      ...route.id,
      hostname: opts?.hostname,
      originHomeId: opts?.originHomeId,
    })
  }
  if (
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'discussions'
  ) {
    return createWebHMUrl(route.id.uid, {
      ...route.id,
      hostname: opts?.hostname,
      originHomeId: opts?.originHomeId,
      viewTerm: getRouteViewTerm(route),
      panel: panelParam,
    })
  }
  return 'TODO'
}

export function createWebHMUrl(
  uid: string,
  {
    version,
    blockRef,
    blockRange,
    hostname,
    latest,
    path,
    originHomeId,
    feed,
    viewTerm,
    panel,
  }: {
    version?: string | null | undefined
    blockRef?: string | null | undefined
    blockRange?: BlockRange | null
    hostname?: string | null | undefined
    latest?: boolean | null
    path?: string[] | null
    originHomeId?: UnpackedHypermediaId
    feed?: boolean
    viewTerm?: string | null
    panel?: PanelQueryKey | null
  } = {},
) {
  let webPath = `/hm/${uid}`
  if (originHomeId?.uid === uid) {
    webPath = ''
  }
  const urlHost =
    hostname === undefined
      ? DEFAULT_GATEWAY_URL
      : hostname === null
      ? ''
      : hostname
  let res = `${urlHost}${webPath}`
  if (path && path.length) {
    res += `/${path.join('/')}`
  }
  if (res === '') res = '/'
  if (viewTerm) {
    res += `/${viewTerm}`
  }
  res += getHMQueryString({
    latest: null,
    version: latest ? undefined : version,
    feed,
    panel,
  })
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return res
}

function getHMQueryString({
  feed,
  version,
  latest,
  panel,
}: {
  feed?: boolean
  version?: string | null
  latest?: boolean | null
  panel?: PanelQueryKey | null
}) {
  const query: Record<string, string | null> = {}
  if (version) {
    query.v = version
  }
  if (latest) {
    query.l = null
  }
  if (feed) {
    query.feed = 'true'
  }
  if (panel) {
    query.panel = panel
  }
  return serializeQueryString(query)
}

function packBaseId(uid: string, path?: string[] | null) {
  const filteredPath = path?.filter((p) => p !== '') || []
  const restPath = filteredPath.length ? `/${filteredPath.join('/')}` : ''
  return `${HYPERMEDIA_SCHEME}://${uid}${restPath}`
}

export function packHmId(hmId: UnpackedHypermediaId): string {
  const {path, version, latest, blockRef, blockRange, uid} = hmId
  if (!uid) throw new Error('uid is required')
  let responseUrl = packBaseId(uid, path)
  responseUrl += getHMQueryString({
    version,
    latest,
  })
  if (blockRef) {
    responseUrl += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return responseUrl
}

export function hmDocId(uid: string, opts?: Parameters<typeof hmId>[1]) {
  return hmId(uid, opts)
}

type ParsedURL = {
  scheme: string | null
  path: string[]
  query: Record<string, string>
  fragment: string | null
}

export function parseCustomURL(url: string): ParsedURL | null {
  if (!url) return null
  const [scheme, rest] = url.split('://')
  if (!rest) return null
  const [pathAndQuery, fragment = null] = rest.split('#')
  const [path, queryString] = pathAndQuery?.split('?') || []
  const query = new URLSearchParams(queryString)
  const queryObject = Object.fromEntries(query.entries())
  return {
    scheme: scheme || null,
    path: path?.split('/') || [],
    query: queryObject,
    fragment,
  }
}

// this is used to convert an object that is a superset of HMId to an exact HMId. This is used in the case of embed props (but maybe we should reconsider this approach of spreading id directly into embed props)
export function narrowHmId(id: UnpackedHypermediaId): UnpackedHypermediaId {
  return {
    id: id.id,
    uid: id.uid,
    path: id.path,
    version: id.version,
    blockRef: id.blockRef,
    blockRange: id.blockRange,
    hostname: id.hostname,
    scheme: id.scheme,
    latest: id.latest,
  }
}

export function hmId(
  idPath: string | null | undefined,
  opts: {
    version?: string | null
    blockRef?: string | null
    blockRange?: BlockRange | null
    path?: string[] | null
    latest?: boolean | null
    hostname?: string | null
  } = {},
): UnpackedHypermediaId {
  const [uid, ...path] = (idPath || '').split('/')
  const effectivePath = opts.path || path || null
  return {
    ...opts,
    uid: uid || '',
    id: uid ? packBaseId(uid, effectivePath) : '',
    path: effectivePath,
    version: opts.version || null,
    blockRef: opts.blockRef || null,
    blockRange: opts.blockRange || null,
    hostname: opts.hostname || null,
    scheme: null,
  }
}

// Special static paths that should not be treated as Hypermedia document UIDs
const STATIC_HM_PATHS = new Set([
  'download',
  'connect',
  'register',
  'device-link',
  'profile',
])

export function unpackHmId(hypermediaId?: string): UnpackedHypermediaId | null {
  if (!hypermediaId) return null
  const parsed = parseCustomURL(hypermediaId)
  if (!parsed) return null
  let uid
  let path: string[]
  let hostname = null
  if (parsed.scheme === 'https' || parsed.scheme === 'http') {
    if (parsed.path[1] !== 'hm') return null
    hostname = parsed.path[0]
    uid = parsed.path[2]
    // Skip special static paths
    if (uid && STATIC_HM_PATHS.has(uid)) return null
    path = parsed.path.slice(3)
  } else if (parsed.scheme === HYPERMEDIA_SCHEME || parsed.scheme === 'hm') {
    // Accept 'hm' scheme for compatibility
    uid = parsed.path[0]
    path = parsed.path.slice(1)
  } else {
    return null
  }
  const version = parsed.query.v || null
  const fragment = parseFragment(parsed.fragment)

  // When blockRef is present, version takes precedence over latest
  // because the block only exists in a specific version
  const hasBlockRef = !!fragment?.blockId
  const latest = hasBlockRef
    ? false
    : parsed.query.l === null || parsed.query.l === '' || !version

  let blockRange = null
  if (fragment) {
    if ('start' in fragment) {
      blockRange = {
        start: fragment.start,
        end: fragment.end,
      }
    } else if ('expanded' in fragment) {
      blockRange = {
        expanded: fragment.expanded,
      }
    }
  }
  return {
    id: packBaseId(uid || '', path),
    uid: uid || '',
    path: path || null,
    version,
    blockRef: fragment ? fragment.blockId : null,
    blockRange,
    hostname: hostname || null,
    latest,
    scheme: parsed.scheme,
  }
}

export function isHypermediaScheme(url?: string) {
  return (
    !!url?.startsWith(`${HYPERMEDIA_SCHEME}://`) || !!url?.startsWith('hm://')
  )
}

export function isPublicGatewayLink(text: string, gwUrl: StateStream<string>) {
  const matchesGateway = text.indexOf(gwUrl.get()) === 0
  return !!matchesGateway
}

export function idToUrl(
  hmId: UnpackedHypermediaId,
  opts?: {
    originHomeId?: UnpackedHypermediaId
    feed?: boolean
  },
) {
  return createWebHMUrl(hmId.uid, {
    version: hmId.version,
    blockRef: hmId.blockRef,
    blockRange: hmId.blockRange,
    path: hmId.path,
    hostname: hmId.hostname,
    originHomeId: opts?.originHomeId,
    feed: opts?.feed,
    latest: hmId.latest,
  })
}

export function normalizeHmId(
  urlMaybe: string,
  gwUrl: StateStream<string>,
): string | undefined {
  if (isHypermediaScheme(urlMaybe)) return urlMaybe
  if (isPublicGatewayLink(urlMaybe, gwUrl)) {
    const unpacked = unpackHmId(urlMaybe)
    if (unpacked?.uid) {
      return packHmId(
        hmId(unpacked.uid, {
          path: unpacked.path,
          blockRange: unpacked.blockRange,
          blockRef: unpacked.blockRef,
          version: unpacked.version,
          latest: unpacked.latest,
        }),
      )
    }
    return undefined
  } else {
    return undefined
  }
}

function serializeQueryString(query: Record<string, string | null>) {
  const queryString = Object.entries(query)
    .map(([key, value]) => (value === null ? key : `${key}=${value}`))
    .join('&')
  if (!queryString) return ''
  return `?${queryString}`
}

export function hmIdWithVersion(
  id: string | null | undefined,
  version: string | null | undefined,
  blockRef?: string | null | undefined,
  blockRange?: BlockRange | null,
) {
  if (!id) return null
  const unpacked = unpackHmId(id)
  if (!unpacked) return null
  const effectiveVersion = version || unpacked.version
  return packHmId(
    hmId(unpacked.uid, {
      path: unpacked.path,
      version: effectiveVersion,
      blockRef,
      blockRange,
      latest: !effectiveVersion ? unpacked.latest : null,
    }),
  )
}

export function extractBlockRefOfUrl(
  url: string | null | undefined,
): string | null {
  const fragment = url?.match(/#(.*)$/)?.[1] || null

  if (fragment) {
    return parseFragment(fragment)?.blockId || null
  } else {
    return null
  }
}

export function extractBlockRangeOfUrl(
  url: string | null | undefined,
): BlockRange | null {
  const fragment = url?.match(/#(.*)$/)?.[1] || null

  if (fragment) {
    let res = parseFragment(fragment)
    if (res) {
      const {blockId, ...range} = res
      return range
    } else {
      return null
    }
  } else {
    return null
  }
}

export function parseFragment(input: string | null): ParsedFragment | null {
  if (!input) return null
  // Match blockId (any chars except + or [) followed by optional suffix
  const regex = /^([^\+\[]+)((\+)|\[(\d+)\:(\d+)\])?$/
  const match = input.match(regex)
  if (match) {
    const blockId = match[1] || ''
    const expanded = match[3] // '+' or undefined
    const rangeStart = match[4] // start number or undefined
    const rangeEnd = match[5] // end number or undefined

    if (expanded === '+') {
      return {
        blockId,
        expanded: true,
      }
    } else if (
      typeof rangeStart !== 'undefined' &&
      typeof rangeEnd !== 'undefined'
    ) {
      return {
        blockId,
        start: parseInt(rangeStart),
        end: parseInt(rangeEnd),
      }
    } else {
      return {
        blockId,
        expanded: false,
      }
    }
  } else {
    return {
      blockId: input,
      expanded: false,
    }
  }
}

export function serializeBlockRange(
  range: BlockRange | null | undefined,
): string {
  let res = ''
  if (range) {
    if ('expanded' in range && range.expanded) {
      res += '+'
    } else if ('start' in range) {
      res += `[${range.start}:${range.end}]`
    }
  }

  return res
}

export function displayHostname(fullHost: string): string {
  return fullHost.replace(/https?:\/\//, '')
}

export function hmIdMatches(a: UnpackedHypermediaId, b: UnpackedHypermediaId) {
  return (
    // @ts-expect-error
    a.type === b.type &&
    a.uid === b.uid &&
    a.version == b.version &&
    pathMatches(a.path, b.path)
  )
}

export function pathMatches(
  a: string[] | null,
  b: string[] | null | undefined,
) {
  // Handle cases where either value is null/undefined and the other is empty array
  if (!a && (!b || b.length === 0)) return true
  if (!b && (!a || a.length === 0)) return true

  // Handle regular array comparison
  if (!a?.length || !b?.length) return a?.length === b?.length
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function isIdParentOfOrEqual(
  parent: UnpackedHypermediaId,
  possibleChild: UnpackedHypermediaId,
) {
  if (parent.uid !== possibleChild.uid) return false
  if (!parent.path?.length && !possibleChild.path?.length) return true
  if (!parent.path) return true
  return parent.path?.every((v, i) => v === possibleChild.path?.[i])
}

export function isPathParentOfOrEqual(
  parentPath?: string[] | null,
  possibleChildPath?: string[] | null,
) {
  if (!parentPath?.length && !possibleChildPath?.length) return true
  if (!parentPath) return true
  return parentPath?.every((v, i) => v === possibleChildPath?.[i])
}

export function latestId(id: UnpackedHypermediaId): UnpackedHypermediaId {
  return {
    ...id,
    latest: true,
    version: null,
  }
}

export function getParent(
  id: UnpackedHypermediaId | null | undefined,
): UnpackedHypermediaId | null {
  if (!id) return null
  const parentPath = id.path?.slice(0, -1) || []
  return hmId(id.uid, {
    path: parentPath,
  })
}
