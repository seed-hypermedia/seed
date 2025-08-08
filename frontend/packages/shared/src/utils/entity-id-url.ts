import {
  ExactBlockRange,
  ExpandedBlockRange,
  ParsedFragment,
  UnpackedHypermediaId,
} from '..'
import {DEFAULT_GATEWAY_URL, HYPERMEDIA_SCHEME} from '../constants'
import {StateStream} from './stream'

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
  blockRange?: ExactBlockRange | ExpandedBlockRange | null
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

export function createHMUrl({
  uid,
  path,
  version,
  latest,
  blockRef,
  blockRange,
}: UnpackedHypermediaId) {
  let res = `hm://${uid}`

  if (path && path.length) {
    res += `/${path.join('/')}`
  }
  res += getHMQueryString({version, latest})
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }

  return res
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
  }: {
    version?: string | null | undefined
    blockRef?: string | null | undefined
    blockRange?: ExactBlockRange | ExpandedBlockRange | null
    hostname?: string | null | undefined
    latest?: boolean | null
    path?: string[] | null
    originHomeId?: UnpackedHypermediaId
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
  res += getHMQueryString({latest, version})
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return res
}

function getHMQueryString({
  version,
  latest,
}: {
  version?: string | null
  latest?: boolean | null
}) {
  const query: Record<string, string | null> = {}
  if (version) {
    query.v = version
  }
  if (latest) {
    query.l = null
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
  // @ts-expect-error
  const [path, queryString] = pathAndQuery.split('?')
  const query = new URLSearchParams(queryString)
  const queryObject = Object.fromEntries(query.entries())
  return {
    // @ts-expect-error
    scheme,
    // @ts-expect-error
    path: path.split('/'),
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
  uid: string,
  opts: {
    version?: string | null
    blockRef?: string | null
    blockRange?: ExactBlockRange | ExpandedBlockRange | null
    path?: string[] | null
    latest?: boolean | null
    hostname?: string | null
  } = {},
): UnpackedHypermediaId {
  if (!uid) throw new Error('uid is required')
  return {
    ...opts,
    uid,
    id: packBaseId(uid, opts.path),
    path: opts.path || null,
    version: opts.version || null,
    blockRef: opts.blockRef || null,
    blockRange: opts.blockRange || null,
    hostname: opts.hostname || null,
    scheme: null,
  }
}

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
    path = parsed.path.slice(3)
  } else if (parsed.scheme === HYPERMEDIA_SCHEME) {
    uid = parsed.path[0]
    path = parsed.path.slice(1)
  } else {
    return null
  }
  const version = parsed.query.v || null
  const latest = parsed.query.l === null || parsed.query.l === ''
  const fragment = parseFragment(parsed.fragment)

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
    // @ts-expect-error
    id: packBaseId(uid, path),
    // @ts-expect-error
    uid,
    path: path || null,
    version,
    blockRef: fragment ? fragment.blockId : null,
    blockRange,
    // @ts-expect-error
    hostname,
    latest,
    scheme: parsed.scheme,
  }
}

export function isHypermediaScheme(url?: string) {
  return !!url?.startsWith(`${HYPERMEDIA_SCHEME}://`)
}

export function isPublicGatewayLink(text: string, gwUrl: StateStream<string>) {
  const matchesGateway = text.indexOf(gwUrl.get()) === 0
  return !!matchesGateway
}

export function idToUrl(
  hmId: UnpackedHypermediaId,
  opts?: {
    originHomeId?: UnpackedHypermediaId
  },
) {
  return createWebHMUrl(hmId.uid, {
    version: hmId.version,
    blockRef: hmId.blockRef,
    blockRange: hmId.blockRange,
    path: hmId.path,
    hostname: hmId.hostname,
    originHomeId: opts?.originHomeId,
  })
}

export function normalizeHmId(
  urlMaybe: string,
  gwUrl: StateStream<string>,
// @ts-expect-error
): string | undefined {
  if (isHypermediaScheme(urlMaybe)) return urlMaybe
  if (isPublicGatewayLink(urlMaybe, gwUrl)) {
    const unpacked = unpackHmId(urlMaybe)
    if (unpacked?.uid) {
      return packHmId(
        hmId(unpacked.uid, {
          blockRange: unpacked.blockRange,
          blockRef: unpacked.blockRef,
          version: unpacked.version,
        }),
      )
    }
    return undefined
  }
}

// TODO: migrate to existing ID functions
export function createHmDocLink_DEPRECATED({
  documentId,
  version,
  blockRef,
  blockRange,
  latest,
}: {
  documentId: string
  version?: string | null
  blockRef?: string | null
  blockRange?: ExactBlockRange | ExpandedBlockRange | null
  latest?: boolean
}): string {
  let res = documentId
  res += getHMQueryString({version, latest})
  if (blockRef) {
    res += `${
      !blockRef.startsWith('#') ? '#' : ''
    }${blockRef}${serializeBlockRange(blockRange)}`
  }
  return res
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
  blockRange?: ExactBlockRange | ExpandedBlockRange | null,
) {
  if (!id) return null
  const unpacked = unpackHmId(id)
  if (!unpacked) return null
  return packHmId(
    hmId(unpacked.uid, {
      path: unpacked.path,
      version: version || unpacked.version,
      blockRef,
      blockRange,
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
): ExactBlockRange | ExpandedBlockRange | null {
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
  const regex =
    /^(?<blockId>\S{8})((?<expanded>\+)|\[(?<rangeStart>\d+)\:(?<rangeEnd>\d+)\])?$/
  const match = input.match(regex)
  if (match && match.groups) {
    if (match.groups.expanded == '+') {
      return {
        type: 'block',
        // @ts-expect-error
        blockId: match.groups.blockId,
        expanded: true,
      }
    } else if (
      typeof match.groups.rangeStart != 'undefined' ||
      typeof match.groups.rangeEnd != 'undefined'
    ) {
      return {
        type: 'block-range',
        // @ts-expect-error
        blockId: match.groups.blockId,
        start: parseInt(match.groups.rangeStart || '0'),
        end: parseInt(match.groups.rangeEnd || '0'),
      }
    } else {
      return {
        type: 'block',
        // @ts-expect-error
        blockId: match.groups.blockId,
        expanded: false,
      }
    }
  } else {
    return {
      type: 'block',
      blockId: input,
      expanded: false,
    }
  }
}

export function serializeBlockRange(
  range: ExactBlockRange | ExpandedBlockRange | null | undefined,
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
