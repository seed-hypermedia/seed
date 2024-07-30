import {z} from 'zod'
import {StateStream} from './stream'

export const HYPERMEDIA_PUBLIC_WEB_GATEWAY = 'https://hyper.media'

export const HYPERMEDIA_SCHEME = 'hm'

export const HYPERMEDIA_ENTITY_TYPES = {
  a: 'Account',
  c: 'Comment',
  draft: 'Local Draft',
} as const

export type HMEntityType = keyof typeof HYPERMEDIA_ENTITY_TYPES

export function createPublicWebHmUrl(
  type: keyof typeof HYPERMEDIA_ENTITY_TYPES,
  eid: string,
  {
    version,
    blockRef,
    blockRange,
    hostname,
    latest,
  }: {
    version?: string | null | undefined
    blockRef?: string | null | undefined
    blockRange?: BlockRange | ExpandedBlockRange | null
    hostname?: string | null | undefined
    latest?: boolean | null
  } = {},
) {
  const webPath = `/${type}/${eid}`
  const urlHost =
    hostname === undefined
      ? HYPERMEDIA_PUBLIC_WEB_GATEWAY
      : hostname === null
      ? ''
      : hostname
  let res = `${urlHost}${webPath}`
  const query: Record<string, string | null> = {}
  if (version) {
    query.v = version
  }
  if (latest) {
    query.l = null
  }
  res += serializeQueryString(query)
  if (blockRef) {
    res += `#${blockRef}${serializeBlockRange(blockRange)}`
  }

  return res
}

export function createHmId(
  type: keyof typeof HYPERMEDIA_ENTITY_TYPES,
  id: string,
  opts: {
    version?: string | null
    blockRef?: string | null
    blockRange?: BlockRange | ExpandedBlockRange | null
    id?: string
    path?: string[] | null
    latest?: boolean | null
  } = {},
): string {
  let path = `${type}/${id}`
  if (opts?.path) path += `/${opts.path.join('/')}`
  let url = new URL(`${HYPERMEDIA_SCHEME}://${path}`)
  let responseUrl = url.toString()
  const query: Record<string, string | null> = {}
  if (opts.version) {
    query.v = opts.version
  }
  if (opts.latest) {
    query.l = null
  }
  responseUrl += serializeQueryString(query)
  if (opts?.blockRef) {
    responseUrl += `#${opts.blockRef}${serializeBlockRange(opts.blockRange)}`
  }

  return responseUrl
}

export function serializeHmId(hmId: UnpackedHypermediaId): string {
  return createHmId(hmId.type, hmId.eid, {
    version: hmId.version,
    blockRef: hmId.blockRef,
    blockRange: hmId.blockRange,
    latest: hmId.latest,
    path: hmId.path,
  })
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
  const [path, queryString] = pathAndQuery.split('?')
  const query = new URLSearchParams(queryString)
  const queryObject = Object.fromEntries(query.entries())
  return {
    scheme,
    path: path.split('/'),
    query: queryObject,
    fragment,
  }
}

function inKeys<V extends string>(
  key: string,
  values: Record<V, string>,
): V | null {
  // TODO: change to expect-error instead
  // @ts-ignore
  if (values[key]) return key as V
  return null
}

export const unpackedHmIdSchema = z.object({
  id: z.string(),
  type: z.union([z.literal('a'), z.literal('c'), z.literal('draft')]),
  eid: z.string(),
  qid: z.string(),
  path: z.array(z.string()).nullable(),
  version: z.string().nullable(),
  blockRef: z.string().nullable(),
  blockRange: z
    .object({start: z.number(), end: z.number()})
    .or(
      z.object({
        expanded: z.boolean(),
      }),
    )
    .nullable(),
  hostname: z.string().nullable(),
  scheme: z.string().nullable(),
  latest: z.boolean().nullable().optional(),
})

export type UnpackedHypermediaId = z.infer<typeof unpackedHmIdSchema>

export function hmId(
  type: keyof typeof HYPERMEDIA_ENTITY_TYPES,
  eid: string,
  opts: {
    version?: string | null
    blockRef?: string | null
    blockRange?: BlockRange | ExpandedBlockRange | null
    path?: string[] | null
    latest?: boolean | null
    hostname?: string | null
  } = {},
): UnpackedHypermediaId {
  if (!eid) throw new Error('eid is required')
  return {
    id: createHmId(type, eid, opts),
    type,
    eid,
    qid: createHmId(type, eid),
    path: opts.path || null,
    version: opts.version || null,
    blockRef: opts.blockRef || null,
    blockRange: opts.blockRange || null,
    hostname: opts.hostname || null,
    scheme: null,
    ...opts,
  }
}

export function unpackHmId(hypermediaId?: string): UnpackedHypermediaId | null {
  if (!hypermediaId) return null
  const parsed = parseCustomURL(hypermediaId)

  if (!parsed) return null
  if (parsed.scheme === HYPERMEDIA_SCHEME) {
    const [rawType, eid, ...path] = parsed.path
    const type = inKeys(rawType, HYPERMEDIA_ENTITY_TYPES)
    const version = parsed.query.v || null
    const latest = parsed.query.l !== undefined
    if (!type) return null
    const qid = createHmId(type, eid)
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
      id: hypermediaId,
      qid,
      type,
      eid,
      path: path || null,
      version,
      blockRef: fragment ? fragment.blockId : null,
      blockRange,
      hostname: null,
      latest,
      scheme: parsed.scheme,
    }
  }
  if (parsed?.scheme === 'https' || parsed?.scheme === 'http') {
    const type = inKeys(parsed.path[1], HYPERMEDIA_ENTITY_TYPES)
    const eid = parsed.path[2]
    const version = parsed.query.v || null
    const latest = parsed.query.l !== undefined
    let hostname = parsed.path[0]
    if (!type) return null
    const qid = createHmId(type, eid)
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
      id: hypermediaId,
      qid,
      type,
      eid,
      path: parsed.path.slice(2) || null,
      version,
      blockRef: fragment ? fragment.blockId : null,
      blockRange,
      hostname,
      latest,
      scheme: parsed.scheme,
    }
  }
  return null
}

export function isHypermediaScheme(url?: string) {
  return !!url?.startsWith(`${HYPERMEDIA_SCHEME}://`)
}

export function isPublicGatewayLink(text: string, gwUrl: StateStream<string>) {
  const matchesGateway = text.indexOf(gwUrl.get()) === 0
  return !!matchesGateway
}

export function idToUrl(
  hmId: string,
  hostname?: string | null | undefined,
  {
    version,
    blockRef,
    blockRange,
  }: {
    version?: string | null | undefined
    blockRef?: string | null | undefined
    blockRange?: BlockRange | ExpandedBlockRange | null | undefined
  } = {},
) {
  const unpacked = unpackHmId(hmId)
  if (!unpacked?.type) return null
  return createPublicWebHmUrl(unpacked.type, unpacked.eid, {
    version: version || unpacked.version,
    blockRef: blockRef || unpacked.blockRef,
    blockRange: blockRange || unpacked.blockRange,
    hostname,
  })
}

export function normalizeHmId(
  urlMaybe: string,
  gwUrl: StateStream<string>,
): string | undefined {
  if (isHypermediaScheme(urlMaybe)) return urlMaybe
  if (isPublicGatewayLink(urlMaybe, gwUrl)) {
    const unpacked = unpackHmId(urlMaybe)

    console.log(`== ~ unpacked:`, urlMaybe, unpacked)

    if (unpacked?.eid && unpacked.type) {
      return createHmId(unpacked.type, unpacked.eid, {
        blockRange: unpacked.blockRange,
        blockRef: unpacked.blockRef,
        version: unpacked.version,
      })
    }
    return undefined
  }
}

export function createHmDocLink({
  documentId,
  version,
  blockRef,
  blockRange,
  latest,
}: {
  documentId: string
  version?: string | null
  blockRef?: string | null
  blockRange?: BlockRange | ExpandedBlockRange | null
  latest?: boolean
}): string {
  let res = documentId
  const query: Record<string, string | null> = {}
  if (version) {
    query.v = version
  }
  if (latest) {
    query.l = null
  }
  res += serializeQueryString(query)
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

export function labelOfEntityType(type: keyof typeof HYPERMEDIA_ENTITY_TYPES) {
  return HYPERMEDIA_ENTITY_TYPES[type]
}

export function hmIdWithVersion(
  hmId: string | null | undefined,
  version: string | null | undefined,
  blockRef?: string | null | undefined,
  blockRange?: BlockRange | ExpandedBlockRange | null,
) {
  if (!hmId) return null
  const unpacked = unpackHmId(hmId)
  if (!unpacked) return null
  return createHmId(unpacked.type, unpacked.eid, {
    path: unpacked.path,
    version: version || unpacked.version,
    blockRef,
    blockRange,
  })
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
): BlockRange | ExpandedBlockRange | null {
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

export type ParsedFragment =
  | {blockId: string}
  | (BlockRange & {blockId: string})
  | (ExpandedBlockRange & {blockId: string})

export type BlockRange = {
  start: number
  end: number
}
export type ExpandedBlockRange = {
  expanded: boolean
}

export function parseFragment(input: string | null): ParsedFragment | null {
  if (!input) return null
  const regex =
    /^(?<blockId>\S{8})((?<expanded>\+)|\[(?<rangeStart>\d+)\:(?<rangeEnd>\d+)\])?$/
  const match = input.match(regex)
  if (match && match.groups) {
    if (match.groups.expanded == '+') {
      return {
        blockId: match.groups.blockId,
        expanded: true,
      }
    } else if (
      typeof match.groups.rangeStart != 'undefined' ||
      typeof match.groups.rangeEnd != 'undefined'
    ) {
      return {
        blockId: match.groups.blockId,
        start: parseInt(match.groups.rangeStart || '0'),
        end: parseInt(match.groups.rangeEnd || '0'),
      }
    } else {
      return {
        blockId: match.groups.blockId,
      }
    }
  } else {
    return {
      blockId: input,
    }
  }
}

export function serializeBlockRange(
  range: BlockRange | ExpandedBlockRange | null | undefined,
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

export function getParentIds(entityId: string): string[] {
  const unpacked = unpackHmId(entityId)
  const parentIds: string[] = []
  if (unpacked) {
    parentIds.push(createHmId(unpacked.type, unpacked.eid))
    const pathTerms = unpacked.path
    pathTerms?.forEach((pathTerm, index) => {
      if (index === pathTerms.length - 1) return
      pathTerms.push(pathTerm)
      parentIds.push(
        createHmId(unpacked.type, unpacked.eid, {
          path: pathTerms,
        }),
      )
    })
  }
  return parentIds
}
