import type {BlockRange, HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  parseCustomURL as _parseCustomURL,
  parseFragment as _parseFragment,
  unpackHmId as _unpackHmId,
} from '@seed-hypermedia/client/hm-types'
import {DEFAULT_GATEWAY_URL, HYPERMEDIA_SCHEME, OS_PROTOCOL_SCHEME} from '../constants'
import {NavRoute} from '../routes'
import {entityQueryPathToHmIdPath} from './path-api'
import {StateStream} from './stream'

/**
 * Activity filter slug <-> filterEventType mapping for URL encoding
 */
export const ACTIVITY_FILTER_SLUGS: Record<string, string[]> = {
  comments: ['Comment'],
  versions: ['Ref'],
  citations: ['comment/Embed', 'doc/Embed', 'doc/Link', 'doc/Button'],
}

export function activityFilterToSlug(filterEventType?: string[]): string | null {
  if (!filterEventType?.length) return null
  for (const [slug, types] of Object.entries(ACTIVITY_FILTER_SLUGS)) {
    if (types.length === filterEventType.length && types.every((t, i) => t === filterEventType[i])) {
      return slug
    }
  }
  return null
}

export function activitySlugToFilter(slug: string): string[] | undefined {
  return ACTIVITY_FILTER_SLUGS[slug]
}

export const SITE_PROFILE_TABS = ['profile', 'membership', 'followers', 'following'] as const
export type SiteProfileTab = (typeof SITE_PROFILE_TABS)[number]

export const SITE_PROFILE_VIEW_TERMS = [':profile', ':membership', ':followers', ':following'] as const
export type SiteProfileViewTerm = (typeof SITE_PROFILE_VIEW_TERMS)[number]

// View terms for URL paths (e.g., /:activity, /:directory)
// ':discussions' and ':comment' kept for backward compat URL parsing
export const VIEW_TERMS = [
  ':activity',
  ':comments',
  ':comment',
  ':discussions',
  ':collaborators',
  ':directory',
  ':feed',
  ...SITE_PROFILE_VIEW_TERMS,
] as const
export type ViewTerm = (typeof VIEW_TERMS)[number]

// Route keys that correspond to view terms (excludes 'options' which is panel-only)
export type ViewRouteKey = 'activity' | 'comments' | 'collaborators' | 'directory' | 'feed' | SiteProfileTab

// Panel keys that can be encoded in URL query param
export type PanelQueryKey = 'activity' | 'comments' | 'collaborators' | 'directory' | 'options'

/**
 * Extract view term from URL path and return cleaned URL + view term
 * e.g., "https://example.com/path/:directory?v=123" -> {url: "https://example.com/path?v=123", viewTerm: ":directory"}
 */
export function extractViewTermFromUrl(url: string): {
  url: string
  viewTerm: ViewTerm | null
  activityFilter?: string
  commentId?: string
  accountUid?: string
} {
  // Check for :comments/UID/TSID or :comment/UID/TSID pattern (2 path segments)
  const commentsPattern = /\/\:comments?\/([^/?#]+\/[^/?#]+)(?=[?#]|$)/
  const commentsMatch = url.match(commentsPattern)
  if (commentsMatch) {
    return {
      url: url.replace(commentsMatch[0], ''),
      viewTerm: ':comments',
      commentId: commentsMatch[1],
    }
  }

  // Check for :activity/<slug> pattern
  const activitySlugPattern = /\/\:activity\/([a-z]+)(?=[?#]|$)/
  const activitySlugMatch = url.match(activitySlugPattern)
  if (activitySlugMatch) {
    return {
      url: url.replace(activitySlugMatch[0], ''),
      viewTerm: ':activity',
      activityFilter: activitySlugMatch[1],
    }
  }

  // Check for profile-family patterns like /:profile or /:profile/accountUid
  const profileFamilyPattern = /\/\:(profile|membership|followers|following)(?:\/([^/?#]+))?(?=[?#]|$)/
  const profileFamilyMatch = url.match(profileFamilyPattern)
  if (profileFamilyMatch) {
    return {
      url: url.replace(profileFamilyMatch[0], ''),
      viewTerm: `:${profileFamilyMatch[1]}` as SiteProfileViewTerm,
      accountUid: profileFamilyMatch[2],
    }
  }

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
export function viewTermToRouteKey(viewTerm: ViewTerm | null): ViewRouteKey | null {
  if (!viewTerm) return null
  const mapping: Record<ViewTerm, ViewRouteKey> = {
    ':activity': 'activity',
    ':comments': 'comments',
    ':comment': 'comments', // backward compat
    ':discussions': 'comments', // backward compat
    ':collaborators': 'collaborators',
    ':directory': 'directory',
    ':feed': 'feed',
    ':profile': 'profile',
    ':membership': 'membership',
    ':followers': 'followers',
    ':following': 'following',
  }
  return mapping[viewTerm] ?? null
}

export function isSiteProfileTab(value: string | null | undefined): value is SiteProfileTab {
  return !!value && (SITE_PROFILE_TABS as readonly string[]).includes(value)
}

export function createSiteUrl({
  path,
  hostname,
  version,
  latest,
  blockRef,
  blockRange,
  viewTerm,
  panel,
}: {
  path: string[] | null | undefined
  hostname: string
  version?: string | null | undefined
  latest?: boolean
  blockRef?: string | null | undefined
  blockRange?: BlockRange | null
  viewTerm?: string | null
  panel?: string | null
}) {
  let res = hostname
  if (path && path.length) {
    res += '/' + path.join('/')
  }
  if (viewTerm) {
    res += '/' + viewTerm
  }
  res += getHMQueryString({latest, version, panel})
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return res
}

/**
 * Build a comment URL relative to a document context.
 * Produces site-style URLs when siteUrl is provided, gateway URLs otherwise.
 *
 * For `:comments` main view → `.../path/:comments/COMMENT_ID`
 * For document with panel   → `.../path?panel=comments/COMMENT_ID`
 * With blockRef             → append `#BLOCK_ID+` or `#BLOCK_ID[start:end]`
 */
export function createCommentUrl({
  docId,
  commentId,
  siteUrl,
  blockRef,
  blockRange,
  latest,
}: {
  docId: UnpackedHypermediaId
  commentId: string
  siteUrl?: string | null
  blockRef?: string | null
  blockRange?: BlockRange | null
  latest?: boolean | null
}): string {
  const viewTermWithComment = `:comments/${commentId}`
  if (siteUrl) {
    return createSiteUrl({
      path: docId.path,
      hostname: siteUrl,
      latest: latest ?? undefined,
      viewTerm: viewTermWithComment,
      blockRef,
      blockRange,
    })
  }
  return createWebHMUrl(docId.uid, {
    path: docId.path,
    latest,
    viewTerm: viewTermWithComment,
    blockRef,
    blockRange,
  })
}

export function getCommentTargetId(comment: HMComment | undefined): UnpackedHypermediaId | undefined {
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

export function hmIdToURL({uid, path, version, latest, blockRef, blockRange}: UnpackedHypermediaId) {
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
export function createOSProtocolUrl({uid, path, version, latest, blockRef, blockRange}: UnpackedHypermediaId) {
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
/**
 * Extract panel param from route for URL query param
 * Supports:
 * - "comments/COMMENT_ID" for specific comment open in panel
 * - "comments/BLOCKID" for block-specific comments
 * - "comments", "activity", etc. for general panels
 */
export function getRoutePanelParam(route: NavRoute): string | null {
  let panel:
    | {
        key: string
        targetBlockId?: string
        openComment?: string
      }
    | null
    | undefined = null

  if (route.key === 'document' && route.panel) {
    panel = route.panel
  } else if (
    (route.key === 'activity' ||
      route.key === 'comments' ||
      route.key === 'collaborators' ||
      route.key === 'directory' ||
      route.key === 'feed') &&
    route.panel
  ) {
    panel = route.panel
  }

  if (!panel) return null

  // Priority 1: Encode openComment - most specific
  if (panel.key === 'comments' && panel.openComment) {
    return `comments/${panel.openComment}`
  }

  // Priority 2: Encode targetBlockId into comments panel param
  if (panel.key === 'comments' && panel.targetBlockId) {
    return `comments/${panel.targetBlockId}`
  }

  // Encode activity filter slug into panel param
  if (panel.key === 'activity') {
    const filterSlug = activityFilterToSlug((panel as {filterEventType?: string[]}).filterEventType)
    if (filterSlug) return `activity/${filterSlug}`
  }

  return panel.key as PanelQueryKey
}

export function routeToUrl(
  route: NavRoute,
  opts?: {
    hostname?: string | null | undefined
    originHomeId?: UnpackedHypermediaId | undefined
  },
) {
  const panelParam = getRoutePanelParam(route)

  if (route.key === 'document') {
    const url = createWebHMUrl(route.id.uid, {
      ...route.id,
      hostname: opts?.hostname,
      originHomeId: opts?.originHomeId,
      panel: panelParam,
    })
    return url
  }
  if (
    route.key === 'feed' ||
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'comments'
  ) {
    // View-term routes use /:viewTerm in the path
    let viewTermPath = `:${route.key}`
    // Append activity filter slug to view term path
    if (route.key === 'activity') {
      const filterSlug = activityFilterToSlug(route.filterEventType)
      if (filterSlug) {
        viewTermPath = `:activity/${filterSlug}`
      }
    }
    // For comments with openComment, put commentId in view term path
    if (route.key === 'comments' && route.openComment) {
      viewTermPath = `:comments/${route.openComment}`
    }
    let effectivePanelParam = panelParam
    // View-term URLs need uid + path + blockRef for fragment
    return createWebHMUrl(route.id.uid, {
      path: route.id.path,
      blockRef: route.id.blockRef,
      blockRange: route.id.blockRange,
      hostname: opts?.hostname,
      originHomeId: opts?.originHomeId,
      viewTerm: viewTermPath,
      panel: effectivePanelParam,
    })
  }
  if (route.key === 'site-profile') {
    const urlHost = opts?.hostname === undefined ? DEFAULT_GATEWAY_URL : opts?.hostname === null ? '' : opts.hostname
    const siteBase = opts?.originHomeId?.uid === route.id.uid ? '' : `/hm/${route.id.uid}`
    const accountSuffix = route.accountUid && route.accountUid !== route.id.uid ? `/${route.accountUid}` : ''
    return `${urlHost}${siteBase}/:${route.tab}${accountSuffix}`
  }
  if (route.key === 'profile') {
    const urlHost = opts?.hostname === undefined ? DEFAULT_GATEWAY_URL : opts?.hostname === null ? '' : opts.hostname
    const siteBase = opts?.originHomeId?.uid === route.id.uid ? '' : `/hm/${route.id.uid}`
    const tab = route.tab || 'profile'
    return `${urlHost}${siteBase}/:${tab}`
  }
  if (route.key === 'contact') {
    const urlHost = opts?.hostname ?? DEFAULT_GATEWAY_URL
    return `${urlHost}/hm/contact/${route.id.uid}`
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
    viewTerm?: string | null
    panel?: string | null
  } = {},
) {
  let webPath = `/hm/${uid}`
  if (originHomeId?.uid === uid) {
    webPath = ''
  }
  const urlHost = hostname === undefined ? DEFAULT_GATEWAY_URL : hostname === null ? '' : hostname
  let res = `${urlHost}${webPath}`
  if (path && path.length) {
    res += `/${path.join('/')}`
  }
  if (viewTerm) {
    res += `/${viewTerm}`
  }
  if (res === '') res = '/'
  res += getHMQueryString({
    latest: latest ?? null,
    version: latest ? undefined : version,
    panel,
  })
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return res
}

function getHMQueryString({
  version,
  latest,
  panel,
}: {
  version?: string | null
  latest?: boolean | null
  panel?: string | null
}) {
  const query: Record<string, string | null> = {}
  if (version) {
    query.v = version
  }
  if (latest && version) {
    query.l = null
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

/** @deprecated Import from `@seed-hypermedia/client/hm-types` instead. */
export const parseCustomURL = _parseCustomURL

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

/** @deprecated Import from `@seed-hypermedia/client/hm-types` instead. */
export const unpackHmId = _unpackHmId

export function isHypermediaScheme(url?: string) {
  return !!url?.startsWith(`${HYPERMEDIA_SCHEME}://`) || !!url?.startsWith('hm://')
}

export function isPublicGatewayLink(text: string, gwUrl: StateStream<string>) {
  const matchesGateway = text.indexOf(gwUrl.get()) === 0
  return !!matchesGateway
}

export function idToUrl(
  hmId: UnpackedHypermediaId,
  opts?: {
    originHomeId?: UnpackedHypermediaId
    panel?: string | null
  },
) {
  return createWebHMUrl(hmId.uid, {
    version: hmId.version,
    blockRef: hmId.blockRef,
    blockRange: hmId.blockRange,
    path: hmId.path,
    hostname: hmId.hostname,
    originHomeId: opts?.originHomeId,
    panel: opts?.panel,
    latest: hmId.latest,
  })
}

export function normalizeHmId(urlMaybe: string, gwUrl: StateStream<string>): string | undefined {
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

export function extractBlockRefOfUrl(url: string | null | undefined): string | null {
  const fragment = url?.match(/#(.*)$/)?.[1] || null

  if (fragment) {
    return parseFragment(fragment)?.blockId || null
  } else {
    return null
  }
}

export function extractBlockRangeOfUrl(url: string | null | undefined): BlockRange | null {
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

/** @deprecated Import from `@seed-hypermedia/client/hm-types` instead. */
export const parseFragment = _parseFragment

export function serializeBlockRange(range: BlockRange | null | undefined): string {
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
    a.type === b.type && a.uid === b.uid && a.version == b.version && pathMatches(a.path, b.path)
  )
}

export function pathMatches(a: string[] | null, b: string[] | null | undefined) {
  // Handle cases where either value is null/undefined and the other is empty array
  if (!a && (!b || b.length === 0)) return true
  if (!b && (!a || a.length === 0)) return true

  // Handle regular array comparison
  if (!a?.length || !b?.length) return a?.length === b?.length
  return a.length === b.length && a.every((v, i) => v === b[i])
}

export function isIdParentOfOrEqual(parent: UnpackedHypermediaId, possibleChild: UnpackedHypermediaId) {
  if (parent.uid !== possibleChild.uid) return false
  if (!parent.path?.length && !possibleChild.path?.length) return true
  if (!parent.path) return true
  return parent.path?.every((v, i) => v === possibleChild.path?.[i])
}

export function isPathParentOfOrEqual(parentPath?: string[] | null, possibleChildPath?: string[] | null) {
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

export function getParent(id: UnpackedHypermediaId | null | undefined): UnpackedHypermediaId | null {
  if (!id) return null
  const parentPath = id.path?.slice(0, -1) || []
  return hmId(id.uid, {
    path: parentPath,
  })
}
