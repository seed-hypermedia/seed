import type {HMBlockNode, HMComment} from '@seed-hypermedia/client/hm-types'
import {z} from 'zod'

/** A public site loaded into this canvas. */
export type Site = {uid: string; origin: string; title: string; url?: string}
/** A current document snapshot, independent of its canvas position. */
export type CanvasDocument = {
  id: string
  siteUid: string
  origin: string
  path: string[]
  title: string
  version: string
  content?: HMBlockNode[]
  external: boolean
  commentCount: number
  summary?: string
  cover?: string
  error?: string
  citationError?: boolean
  unavailable?: boolean
  resourceType?: 'document' | 'redirect' | 'tombstone' | 'account'
  avatar?: string
  accountSiteUrl?: string
  redirectTarget?: string
  republish?: boolean
}
/** A directional connection with its original block/version reference. */
export type Connection = {
  id: string
  source: string
  target: string
  sourceBlock: string
  reference: string
  kind: 'link' | 'citation' | 'comment'
}
/** A conversation retained as one movable group. */
export type Thread = {id: string; documentId: string; comments: HMComment[]; authors: Record<string, string>}

/** Normalizes document views while retaining profile views as distinct account identities. */
export function canonicalId(value: string): string | null {
  if (!value.startsWith('hm://')) return null
  const [resource, view] = value.slice(5).split(/[?#]/)[0].split(':')
  const bare = `hm://${resource}`.replace(/\/$/, '')
  if (view === 'profile' && /^hm:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(bare)) return `hm://${resource.split('/')[0]}/:profile`
  return /^hm:\/\/[^/\s]+(?:\/[^\s]*)?$/.test(bare) ? bare : null
}

/** Resolves an existing Seed URI or a URL from one of the known sites. */
export function linkId(value: string, sites: Site[]): string | null {
  if (value.startsWith('hm://')) return canonicalId(value)
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol)) return null
    const site = sites.find((s) => s.origin === url.origin)
    if (!site) return null
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '')
    if (path.startsWith('/hm/')) return canonicalId(`hm://${path.slice(4)}`)
    return canonicalId(`hm://${site.uid}${path}`)
  } catch {
    return null
  }
}

/** Walks block content and annotations to derive graph edges, including nested embeds. */
export function extractLinks(
  source: string,
  content: HMBlockNode[],
  sites: Site[],
  resolvedUrls: Record<string, string> = {},
): Connection[] {
  const found = new Map<string, Connection>()
  function visit(nodes: HMBlockNode[]) {
    for (const node of nodes) {
      const block = node.block
      const values: string[] = []
      if ('link' in block && typeof block.link === 'string') values.push(block.link)
      if ('annotations' in block && Array.isArray(block.annotations)) {
        for (const annotation of block.annotations) if (annotation.link) values.push(annotation.link)
      }
      for (const reference of values) {
        const target = resolvedUrls[reference] || linkId(reference, sites)
        if (!target || target === source) continue
        const id = `${source}|${block.id}|${target}`
        found.set(id, {id, source, target, sourceBlock: block.id, reference, kind: 'link'})
      }
      if (node.children) visit(node.children)
    }
  }
  visit(content)
  return [...found.values()]
}

/** Replaces document snapshots without mutating unrelated entries or layout state. */
export function mergeDocuments(previous: Record<string, CanvasDocument>, documents: CanvasDocument[]) {
  const next = {...previous}
  for (const document of documents) next[document.id] = document
  return next
}

/** Reconciles a complete listing, retaining readable content until newer bodies arrive. */
export function reconcileSite(previous: Record<string, CanvasDocument>, listing: CanvasDocument[], uid: string) {
  const documents = {...previous}
  const changed: CanvasDocument[] = []
  const removed: string[] = []
  const present = new Set(listing.map((d) => d.id))
  for (const metadata of listing) {
    const old = previous[metadata.id]
    const needsRead =
      !old || old.version !== metadata.version || old.unavailable || !old.content || !!old.error || !!old.citationError
    const next = {...old, ...metadata, content: old?.content, error: old?.error, unavailable: false}
    if (needsRead) changed.push(next)
    if (
      needsRead ||
      old?.commentCount !== metadata.commentCount ||
      old?.title !== metadata.title ||
      old?.external ||
      old?.origin !== metadata.origin
    )
      documents[next.id] = next
  }
  for (const old of Object.values(previous)) {
    if (
      old.siteUid === uid &&
      old.resourceType !== 'account' &&
      !old.external &&
      !present.has(old.id) &&
      !old.unavailable
    ) {
      documents[old.id] = {
        ...old,
        unavailable: true,
        content: [],
        error: 'This document is no longer listed by the site.',
      }
      removed.push(old.id)
    }
  }
  return {documents, changed, removed}
}

const point = z.object({x: z.number().finite(), y: z.number().finite()})
const layoutSchema = z.object({
  version: z.literal(1),
  sites: z.array(
    z
      .string()
      .url()
      .refine((s) => /^https?:\/\//.test(s)),
  ),
  positions: z.record(z.string(), point),
  viewport: point.extend({zoom: z.number().min(0.005).max(4)}),
  pinned: z.array(z.object({documentId: z.string(), threadId: z.string()})),
  expanded: z.array(z.string()),
})
/** Browser-local canvas preferences; document bodies are refreshed from Seed. */
export type Layout = z.infer<typeof layoutSchema>

/** Names a path group, collecting top-level leaf pages rather than making a group per leaf. */
export function pathGroup(document: CanvasDocument, branches: Set<string>): string {
  if (document.resourceType === 'account') return 'People & accounts'
  if (document.external) return 'Linked documents'
  if (!document.path.length) return 'Home'
  return branches.has(`${document.siteUid}/${document.path[0]}`) ? `/${document.path[0]}` : 'Pages'
}

/** Assigns free card positions by site section without moving any saved card. */
export function allocateCards(
  documents: CanvasDocument[],
  saved: Layout['positions'],
  sections: Map<string, number>,
): Layout['positions'] {
  const positions = {...saved}
  const groups = new Map<string, CanvasDocument[]>()
  const branches = new Set(documents.filter((d) => d.path.length > 1).map((d) => `${d.siteUid}/${d.path[0]}`))
  const sorted = [...documents].sort(
    (a, b) =>
      a.siteUid.localeCompare(b.siteUid) ||
      Number(a.external) - Number(b.external) ||
      a.path.length - b.path.length ||
      a.id.localeCompare(b.id),
  )
  for (const doc of sorted) {
    const section = `${doc.siteUid}/${pathGroup(doc, branches)}`
    const group = groups.get(section) || []
    group.push(doc)
    groups.set(section, group)
  }
  // Index occupied cells once. New cards inspect neighboring cells, not the entire canvas.
  const cells = new Map<string, {x: number; y: number}[]>()
  const occupy = (p: {x: number; y: number}) => {
    const key = `${Math.floor(p.x / 370)},${Math.floor(p.y / 360)}`
    const points = cells.get(key) || []
    points.push(p)
    cells.set(key, points)
  }
  Object.values(saved).forEach(occupy)
  let nextX = Math.max(-1180, ...Object.values(saved).map((p) => p.x), ...sections.values()) + 1180
  for (const [section, group] of groups) {
    if (!sections.has(section)) {
      const existing = group.flatMap((d) => (saved[d.id] ? [saved[d.id].x] : []))
      sections.set(section, existing.length ? Math.min(...existing) : nextX)
      if (!existing.length) nextX += 1560
    }
    group.forEach((doc, index) => {
      if (positions[doc.id]) return
      const offset = doc.path.length > 1 ? 1 : 0
      const candidate = {x: sections.get(section)! + ((index % 3) + offset) * 370, y: Math.floor(index / 3) * 360}
      const occupied = () => {
        const cx = Math.floor(candidate.x / 370),
          cy = Math.floor(candidate.y / 360)
        for (let x = cx - 1; x <= cx + 1; x++)
          for (let y = cy - 1; y <= cy + 1; y++)
            if (
              cells
                .get(`${x},${y}`)
                ?.some((p) => Math.abs(p.x - candidate.x) < 340 && Math.abs(p.y - candidate.y) < 330)
            )
              return true
        return false
      }
      while (occupied()) candidate.y += 360
      positions[doc.id] = candidate
      occupy(candidate)
    })
  }
  return positions
}
/** Validates saved state at the storage boundary so a damaged save cannot break startup. */
export function parseLayout(raw: string | null): Layout | null {
  if (!raw) return null
  try {
    const layout = layoutSchema.parse(JSON.parse(raw))
    const positions: Layout['positions'] = {}
    for (const [id, position] of Object.entries(layout.positions)) {
      const key = canonicalId(id) || (id.startsWith('thread:') ? id : null)
      if (key && (!positions[key] || key === id)) positions[key] = position
    }
    return {
      ...layout,
      positions,
      expanded: [...new Set(layout.expanded.flatMap((id) => canonicalId(id) || []))],
      pinned: layout.pinned.flatMap((pin) => {
        const documentId = canonicalId(pin.documentId)
        return documentId ? [{...pin, documentId}] : []
      }),
    }
  } catch {
    return null
  }
}

/** Extracts readable text for document previews and search. */
export function contentText(nodes: HMBlockNode[]): string {
  return nodes
    .map((n) => ['text' in n.block ? n.block.text : '', contentText(n.children || [])].filter(Boolean).join(' '))
    .join('\n')
}

/** Converts a Seed reference into a public gateway URL without discarding its version or fragment. */
export function webUrl(id: string): string {
  return id.startsWith('hm://') ? `https://hyper.media/hm/${id.slice(5)}` : id
}

/** Computes focus bounds from explicit positions, including nodes not measured or currently visible. */
export function focusBounds(
  id: string,
  connections: Pick<Connection, 'source' | 'target'>[],
  nodes: {id: string; position: {x: number; y: number}; measured?: {width?: number; height?: number}}[],
) {
  const ids = new Set([id])
  for (const edge of connections) {
    if (edge.source === id) ids.add(edge.target)
    if (edge.target === id) ids.add(edge.source)
  }
  const visible = nodes.filter((node) => ids.has(node.id))
  if (!visible.length) return null
  const x = Math.min(...visible.map((n) => n.position.x))
  const y = Math.min(...visible.map((n) => n.position.y))
  return {
    x,
    y,
    width: Math.max(...visible.map((n) => n.position.x + (n.measured?.width || 340))) - x,
    height: Math.max(...visible.map((n) => n.position.y + (n.measured?.height || 330))) - y,
  }
}

/** Places a focused document beside its direct neighbors without changing saved site positions. */
export function focusPositions(id: string, connections: Pick<Connection, 'source' | 'target'>[]): Layout['positions'] {
  const neighbors = new Set<string>()
  for (const edge of connections) {
    if (edge.source === id && edge.target !== id) neighbors.add(edge.target)
    if (edge.target === id && edge.source !== id) neighbors.add(edge.source)
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(neighbors.size)))
  const positions: Layout['positions'] = {[id]: {x: 0, y: 0}}
  ;[...neighbors].sort().forEach((neighbor, index) => {
    positions[neighbor] = {x: 600 + (index % columns) * 570, y: Math.floor(index / columns) * 740}
  })
  return positions
}

/** Derives comment links only while their parent and target remain available documents. */
export function commentConnections(
  threads: Thread[],
  documents: Record<string, CanvasDocument>,
  sites: Site[],
  resolvedUrls: Record<string, string>,
): Connection[] {
  return threads.flatMap((thread) => {
    const parent = documents[thread.documentId]
    if (!parent || parent.unavailable || (parent.resourceType && parent.resourceType !== 'document')) return []
    return thread.comments.flatMap((comment) =>
      extractLinks(thread.documentId, comment.content, sites, resolvedUrls)
        .filter((link) => !documents[link.target]?.unavailable && documents[link.target]?.resourceType !== 'tombstone')
        .map((link) => ({...link, id: `comment:${comment.id}:${link.id}`, kind: 'comment' as const})),
    )
  })
}
