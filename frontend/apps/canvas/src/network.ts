import {createSeedClient} from '@seed-hypermedia/client/client'
import {
  unpackHmId,
  packHmId,
  type HMBlockNode,
  type HMResource,
  type HMAccountResult,
} from '@seed-hypermedia/client/hm-types'
import {canonicalId, type CanvasDocument, type Connection, type Site, type Thread} from './graph'

/** Minimal event envelope; the SDK validates the outer response. */
export type FeedEvent = {id?: unknown; [key: string]: unknown}
/** Pages to a known event before committing a new checkpoint, including after reconnect. */
export async function readNewEvents(
  read: (token: string) => Promise<{events: FeedEvent[]; nextPageToken: string}>,
  previous: Set<string> | null,
) {
  const first = await read('')
  const checkpoint = new Set(first.events.flatMap((e) => (typeof e.id === 'string' ? [e.id] : [])))
  if (!previous) return {events: [], checkpoint}
  const events: FeedEvent[] = []
  const seen = new Set<string>()
  const tokens = new Set<string>()
  let page = first
  while (true) {
    let reached = false
    for (const event of page.events) {
      if (typeof event.id !== 'string') continue
      if (previous.has(event.id)) {
        reached = true
        continue
      }
      if (!seen.has(event.id)) {
        events.push(event)
        seen.add(event.id)
      }
    }
    if (reached || !page.nextPageToken) break
    if (tokens.has(page.nextPageToken)) throw new Error('The activity feed repeated a page. Please retry.')
    tokens.add(page.nextPageToken)
    page = await read(page.nextPageToken)
  }
  return {events, checkpoint: checkpoint.size ? checkpoint : previous}
}

/** Seed reads with bounded request duration, without an app backend or private credentials. */
export function clientFor(origin: string) {
  return createSeedClient(origin, {
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      }),
  })
}

/** Resolves public web references through Seed's exposed identity headers. */
export async function resolveWebReference(url: string) {
  const response = await fetch(url, {method: 'OPTIONS', signal: AbortSignal.timeout(12000)})
  if (!response.ok) throw new Error(`The site returned HTTP ${response.status}.`)
  const rawId = response.headers.get('x-hypermedia-id')
  if (!rawId) return null
  const raw = decodeURIComponent(rawId)
  const profile = decodeURIComponent(new URL(url).pathname).split(':')[1] === 'profile'
  const canonical = canonicalId(raw)
  const id = canonical && unpackHmId(profile ? `hm://${canonical.slice(5).split('/')[0]}/:profile` : canonical)
  if (!id) throw new Error('The site returned an invalid Seed address.')
  const title = response.headers.get('x-hypermedia-title')
  return {id, title: title ? decodeURIComponent(title) : null}
}

/** Resolves the site's actual document identity, including hosted gateway aliases. */
export async function resolveSite(input: string): Promise<Site> {
  const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Enter a public Seed site URL.')
  const result = await resolveWebReference(url.href)
  if (!result) throw new Error('This URL did not identify a Seed site.')
  return {origin: url.origin, uid: result.id.uid, title: result.title || url.hostname, url: url.href}
}

/** Lists every page of a site's documents, delivering usable metadata as it arrives. */
export async function listSite(site: Site, receive: (docs: CanvasDocument[]) => void): Promise<Set<string>> {
  const client = clientFor(site.origin)
  const ids = new Set<string>()
  const tokens = new Set<string>()
  let pageToken: string | undefined
  do {
    const page = await client.request('QueryDocuments', {
      filter: {spaceMatch: {space: site.uid}},
      pageSize: 500,
      pageToken,
      sort: [{attribute: 'BUILTIN_SORT_ATTRIBUTE_PATH'}],
    })
    const documents = (page.documents || [])
      .filter((raw) => !raw.path?.includes(':') || raw.path.split(':')[1] === 'profile')
      .map((raw) => {
        const id = canonicalId(`hm://${raw.account}${raw.path || ''}`)!
        ids.add(id)
        const metadata = raw.metadata || {}
        const activity = raw.activitySummary as {commentCount?: number} | undefined
        return {
          id,
          siteUid: site.uid,
          origin: site.origin,
          path: id.endsWith('/:profile') ? [] : (raw.path || '').split('/').filter(Boolean),
          resourceType: id.endsWith('/:profile') ? ('account' as const) : undefined,
          title: typeof metadata.name === 'string' ? metadata.name : raw.path || site.title,
          version: raw.version || '',
          external: false,
          commentCount: Number(activity?.commentCount || 0),
          summary: typeof metadata.summary === 'string' ? metadata.summary : undefined,
          cover: typeof metadata.cover === 'string' ? metadata.cover : undefined,
        }
      })
    receive(documents)
    pageToken = page.nextPageToken
    if (pageToken && tokens.has(pageToken)) throw new Error('The document list repeated a page. Please retry.')
    if (pageToken) tokens.add(pageToken)
  } while (pageToken)
  return ids
}

/** Loads current content; redirects and deleted documents remain explicit canvas states. */
export async function readDocument(document: CanvasDocument): Promise<CanvasDocument> {
  if (document.id.endsWith('/:profile')) {
    return applyAccount(document, await clientFor(document.origin).request('Account', document.siteUid))
  }
  const id = unpackHmId(document.id)
  if (!id) throw new Error('Invalid Seed document address.')
  const resource = await clientFor(document.origin).request('Resource', {...id, latest: true, version: null})
  return applyResource(document, resource)
}

/** Converts a resource response to a card without following redirects or reading tombstone content. */
export function applyResource(document: CanvasDocument, resource: HMResource): CanvasDocument {
  if (resource.type === 'redirect' || resource.type === 'tombstone') {
    return {
      ...document,
      content: [],
      resourceType: resource.type,
      unavailable: false,
      error: undefined,
      redirectTarget: resource.type === 'redirect' ? packHmId(resource.redirectTarget) : undefined,
      republish: resource.type === 'redirect' ? resource.republish : undefined,
      cover: undefined,
    }
  }
  if (resource.type !== 'document') {
    return {
      ...document,
      content: [],
      unavailable: true,
      error:
        resource.type === 'not-found'
          ? 'Not available on this server yet.'
          : `This resource is ${resource.type}. Open it in Seed to follow its history.`,
    }
  }
  return {
    ...document,
    resourceType: 'document',
    redirectTarget: undefined,
    republish: undefined,
    version: resource.document.version,
    content: resource.document.content as HMBlockNode[],
    title: resource.document.metadata.name || document.title,
    unavailable: false,
    error: undefined,
    cover: resource.document.metadata.cover || document.cover,
  }
}

/** Fetches the server's available incoming links, preserving source block references. */
export async function readCitations(document: CanvasDocument): Promise<Connection[]> {
  const targetId = unpackHmId(document.id)!
  const {citations} = await clientFor(document.origin).request('ListCitations', {targetId})
  return citations.flatMap((citation) => {
    const source = canonicalId(citation.sourceDocument || citation.source)
    if (!source || source === document.id) return []
    const sourceBlock = citation.sourceContext || ''
    return [
      {
        id: `${source}|${sourceBlock}|${document.id}`,
        source,
        target: document.id,
        sourceBlock,
        reference: citation.source,
        kind: citation.citationType?.startsWith('comment/') ? ('comment' as const) : ('citation' as const),
      },
    ]
  })
}

/** Loads complete comment bodies and groups them by stable thread identity. */
export async function readThreads(document: CanvasDocument): Promise<Thread[]> {
  const client = clientFor(document.origin)
  const response = await client.request('ListComments', {targetId: unpackHmId(document.id)!})
  const groups = new Map<string, Thread>()
  const comments = response.comments
  const authorNames: Record<string, string> = {}
  for (const [uid, author] of Object.entries(response.authors))
    authorNames[uid] = author.metadata?.name || 'Seed author'
  for (const comment of comments) {
    const id = comment.threadRoot || comment.id
    const thread = groups.get(id) || {id, documentId: document.id, comments: [], authors: authorNames}
    thread.comments.push(comment)
    groups.set(id, thread)
  }
  return [...groups.values()].map((thread) => ({
    ...thread,
    comments: thread.comments.sort((a, b) => {
      if (a.id === thread.id) return -1
      if (b.id === thread.id) return 1
      const aTime =
        typeof a.createTime === 'string' ? Date.parse(a.createTime) : Number(a.createTime?.seconds || 0) * 1000
      const bTime =
        typeof b.createTime === 'string' ? Date.parse(b.createTime) : Number(b.createTime?.seconds || 0) * 1000
      return aTime - bTime
    }),
  }))
}

/** Reads public account metadata without requesting a document body or following its home redirect. */
export function applyAccount(document: CanvasDocument, account: HMAccountResult): CanvasDocument {
  if (account.type !== 'account')
    return {
      ...document,
      resourceType: 'account',
      content: [],
      error: 'Account details are not available on this server yet.',
    }
  return {
    ...document,
    resourceType: 'account',
    content: [],
    path: [],
    title: account.metadata?.name || 'Seed account',
    avatar: account.metadata?.icon,
    summary: account.metadata?.summary,
    accountSiteUrl: account.metadata?.siteUrl,
    cover: undefined,
    error: undefined,
    unavailable: false,
  }
}
