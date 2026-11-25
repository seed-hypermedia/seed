import {createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Compass,
  Expand,
  Focus,
  Globe2,
  Layers3,
  Link2,
  Loader2,
  MessageCircle,
  Pin,
  Search,
  Shrink,
  Sprout,
  UserRound,
  FileText,
  X,
} from 'lucide-react'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {Content, safeUrl} from './Content'
import {
  allocateCards,
  focusBounds,
  focusPositions,
  pathGroup,
  contentText,
  commentConnections,
  extractLinks,
  webUrl,
  type CanvasDocument,
  type Connection,
  type Layout,
  type Thread,
} from './graph'
import {clientFor} from './network'
import {STORAGE_KEY, useAtlas} from './use-atlas'

type CardData = {
  document: CanvasDocument
  expanded: boolean
  siteName: string
  thread?: Thread
  count: number
  compact?: boolean
  group?: string
  [key: string]: unknown
}
type AtlasNode = Node<CardData, 'document'>
type Actions = {
  select: (id: string) => void
  expand: (id: string) => void
  focus: (id: string) => void
  expandSite: (uid: string) => void
  unpin: (id: string) => void
}
const CardActions = createContext<Actions>(null!)

const DocumentCard = memo(function DocumentCard({data, selected, id}: NodeProps<AtlasNode>) {
  const actions = useContext(CardActions)
  const doc = data.document
  const cover = doc.cover && safeUrl(doc.cover, doc.origin)
  const preview = useMemo(() => doc.summary || contentText(doc.content || []).slice(0, 340), [doc.summary, doc.content])
  if (data.group)
    return (
      <div className="path-group-label">
        {data.siteName} <b>{data.group}</b>
      </div>
    )
  if (doc.resourceType === 'account') {
    const avatar = doc.avatar && safeUrl(doc.avatar, doc.origin)
    return (
      <article
        className={`canvas-card account-card ${data.compact && !selected ? 'overview-card' : ''} ${
          selected ? 'is-selected' : ''
        }`}
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
        <header className="card-drag">
          <span>
            <UserRound size={16} /> ACCOUNT
          </span>
        </header>
        <button className="account-identity nodrag" onClick={() => actions.select(id)}>
          <span className="account-avatar">
            {avatar && !data.compact ? <img src={avatar} alt="" loading="lazy" /> : <UserRound size={24} />}
          </span>
          <strong>{doc.title}</strong>
        </button>
        {(!data.compact || selected) && (
          <>
            {doc.summary && <p className="card-preview">{doc.summary}</p>}
            {doc.error && (
              <div className="card-error nodrag">
                {doc.error}
                <button onClick={() => actions.select(id)}>Retry</button>
              </div>
            )}
            <footer className="card-footer nodrag">
              <button onClick={() => actions.focus(id)}>
                <Focus size={14} /> Connections
              </button>
              <a href={webUrl(doc.id)} target="_blank" rel="noreferrer">
                Profile <ArrowUpRight size={14} />
              </a>
            </footer>
            {doc.accountSiteUrl && (
              <button className="expand-site nodrag" onClick={() => actions.expandSite(doc.siteUid)}>
                <Globe2 size={14} /> Explore site
              </button>
            )}
          </>
        )}
      </article>
    )
  }
  if (data.compact && !selected && !data.expanded)
    return (
      <article className={`canvas-card overview-card ${doc.external ? 'external-card' : ''}`}>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
        <header className="card-drag">
          {doc.external ? <Globe2 size={16} /> : <FileText size={16} />}
          {doc.resourceType === 'redirect'
            ? 'REDIRECT'
            : doc.resourceType === 'tombstone'
              ? 'DELETED'
              : doc.path.length
                ? `/${doc.path.join('/')}`
                : 'HOME'}
        </header>
        <button className="card-title nodrag" onClick={() => actions.focus(id)}>
          {doc.title}
        </button>
      </article>
    )
  if (doc.resourceType === 'redirect' || doc.resourceType === 'tombstone')
    return (
      <article className={`canvas-card resource-card ${selected ? 'is-selected' : ''}`}>
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
        <header className="card-drag">
          <span>{data.siteName}</span>
          <b>{doc.resourceType === 'redirect' ? 'REDIRECT' : 'DELETED'}</b>
        </header>
        <button className="card-title nodrag" onClick={() => actions.select(id)}>
          {doc.title}
        </button>
        <p className="card-preview">
          {doc.resourceType === 'tombstone'
            ? 'This document was deleted.'
            : doc.republish
              ? 'Republished from another document.'
              : 'This document moved.'}
        </p>
        {doc.redirectTarget && (
          <a className="resource-target nodrag" href={webUrl(doc.redirectTarget)} target="_blank" rel="noreferrer">
            {unpackHmId(doc.redirectTarget)?.path?.join('/') || 'Site home'} <ArrowUpRight size={14} />
          </a>
        )}
        <footer className="card-footer nodrag">
          <button onClick={() => actions.focus(id)}>
            <Focus size={14} /> Focus
          </button>
          <a href={webUrl(doc.id)} target="_blank" rel="noreferrer">
            Open source <ArrowUpRight size={14} />
          </a>
        </footer>
      </article>
    )
  if (data.thread)
    return (
      <article className={`canvas-card thread-card ${selected ? 'is-selected' : ''}`}>
        <Handle type="target" position={Position.Left} />
        <header className="card-drag">
          <span>
            <MessageCircle size={14} /> Conversation
          </span>
          <button
            className="nodrag icon-button"
            aria-label="Unpin conversation"
            onClick={() => actions.unpin(data.thread!.id)}
          >
            <X size={14} />
          </button>
        </header>
        <button className="thread-document nodrag" onClick={() => actions.select(doc.id)}>
          {doc.title}
          <ArrowUpRight size={14} />
        </button>
        <div className="thread-stack nodrag nowheel">
          {data.thread.comments.map((comment) => (
            <div className="reply-card" key={comment.id}>
              <div className="reply-author">
                {data.thread!.authors[comment.author] || 'Seed author'}
                {comment.replyParent && <small>reply</small>}
              </div>
              <Content content={comment.content} origin={doc.origin} />
            </div>
          ))}
        </div>
      </article>
    )
  return (
    <article
      className={`canvas-card ${doc.external ? 'external-card' : ''} ${data.expanded ? 'expanded-card' : ''} ${
        selected ? 'is-selected' : ''
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <header className="card-drag">
        <span>
          {doc.external ? <Globe2 size={16} /> : <FileText size={16} />}
          {data.siteName}
        </span>
        <span>{doc.external ? 'LINKED SITE' : doc.path.length ? doc.path[0] : 'HOME'}</span>
      </header>
      <div className="card-title-row">
        <button className="card-title nodrag" onClick={() => actions.select(id)}>
          {doc.title}
        </button>
        <button
          className="icon-button nodrag"
          title="Focus on connections"
          aria-label={`Focus on ${doc.title}`}
          onClick={() => actions.focus(id)}
        >
          <Focus size={16} />
        </button>
      </div>
      {cover && (!doc.external || data.expanded) && (
        <img className="card-cover nodrag" src={cover} alt="" loading="lazy" />
      )}
      {doc.error && (
        <div className="card-error nodrag">
          {doc.error}
          <button onClick={() => actions.select(id)}>Retry</button>
        </div>
      )}
      {data.expanded ? (
        <div className="full-content nodrag nowheel">
          {doc.content ? (
            <Content content={doc.content} origin={doc.origin} />
          ) : (
            <p className="muted">
              <Loader2 className="spin" size={14} /> Loading content…
            </p>
          )}
        </div>
      ) : (
        !doc.external && (
          <p className="card-preview nodrag">
            {preview || (doc.content ? 'This document has no text preview.' : 'Loading document…')}
          </p>
        )
      )}
      <footer className="card-footer nodrag">
        <button onClick={() => actions.expand(id)}>
          {data.expanded ? <Shrink size={14} /> : <Expand size={14} />} {data.expanded ? 'Collapse' : 'Read'}
        </button>
        <button onClick={() => actions.select(id)} title="Open conversations">
          <MessageCircle size={14} />
          {doc.commentCount || ''}
        </button>
        <span className="connection-count" title="Known connections">
          <Link2 size={13} />
          {data.count}
        </span>
        <a
          href={webUrl(doc.id)}
          target="_blank"
          rel="noreferrer"
          title="Open on the web"
          aria-label={`Open ${doc.title} on the web`}
        >
          <ArrowUpRight size={16} />
        </a>
      </footer>
      {doc.external && (
        <button className="expand-site nodrag" onClick={() => actions.expandSite(doc.siteUid)}>
          <Layers3 size={14} /> Explore this site <ArrowUpRight size={14} />
        </button>
      )}
    </article>
  )
})
const nodeTypes = {document: DocumentCard}

/** Read-only spatial browser for live Seed documents and conversations. */
export default function App() {
  const atlas = useAtlas()
  const flow = useReactFlow<AtlasNode>()
  const [nodes, setNodes, onNodesChange] = useNodesState<AtlasNode>([])
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [panel, setPanel] = useState<'conversations' | 'connections'>('conversations')
  const [expanded, setExpanded] = useState(new Set(atlas.saved?.expanded || []))
  const [pinned, setPinned] = useState(atlas.saved?.pinned || [])
  const [storageError, setStorageError] = useState(false)
  const [externalMeta, setExternalMeta] = useState<
    Record<string, {title?: string; siteName?: string; siteUrl?: string}>
  >({})
  const metadataAttempted = useRef(new Set<string>())
  const metadataQueue = useRef<CanvasDocument[]>([])
  const metadataActive = useRef(0)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  const positions = useRef<Layout['positions']>(atlas.saved?.positions || {})
  const viewport = useRef(atlas.saved?.viewport || {x: 80, y: 100, zoom: 0.85})
  const allocation = useRef(new Map<string, number>())
  const compact = useStore((state) => state.transform[2] < 0.35)
  const linkCache = useMemo(() => new WeakMap<CanvasDocument, Connection[]>(), [atlas.sites, atlas.resolvedUrls])
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const connections = useMemo(() => {
    const all = new Map<string, Connection>()
    for (const document of Object.values(atlas.documents)) {
      if (document.unavailable) continue
      let links = linkCache.get(document)
      if (!links) {
        links = extractLinks(document.id, document.content || [], atlas.sites, atlas.resolvedUrls)
        linkCache.set(document, links)
      }
      for (const link of links) if (!atlas.documents[link.target]?.unavailable) all.set(link.id, link)
    }
    const currentPairs = new Set([...all.values()].map((link) => `${link.source}|${link.target}`))
    for (const links of Object.values(atlas.citations))
      for (const link of links) {
        if (atlas.documents[link.source]?.unavailable || atlas.documents[link.target]?.unavailable) continue
        // A loaded document's current body is authoritative; old citation versions must not resurrect removed links.
        const source = atlas.documents[link.source]
        if (source?.content && link.kind !== 'comment' && !currentPairs.has(`${link.source}|${link.target}`)) continue
        all.set(link.id, link)
      }
    for (const link of commentConnections(
      Object.values(atlas.threads).flat(),
      atlas.documents,
      atlas.sites,
      atlas.resolvedUrls,
    ))
      all.set(link.id, link)
    return [...all.values()]
  }, [atlas.documents, atlas.citations, atlas.sites, atlas.threads, atlas.resolvedUrls, linkCache])

  const cards = useMemo(() => {
    const result = {...atlas.documents}
    for (const connection of connections)
      for (const id of [connection.source, connection.target]) {
        if (result[id]) continue
        const parsed = unpackHmId(id)
        if (!parsed) continue
        const site = atlas.sites.find((s) => s.uid === parsed.uid)
        result[id] = {
          id,
          siteUid: parsed.uid,
          origin: site?.origin || 'https://hyper.media',
          path: id.endsWith('/:profile') ? [] : parsed.path || [],
          resourceType: id.endsWith('/:profile') ? 'account' : undefined,
          title: id.endsWith('/:profile')
            ? 'Seed account'
            : externalMeta[id]?.title || parsed.path?.at(-1)?.replace(/-/g, ' ') || 'Linked site',
          version: '',
          external: !site,
          commentCount: 0,
        }
      }
    return result
  }, [atlas.documents, connections, atlas.sites, externalMeta])

  useEffect(() => {
    const pending = Object.values(cards).filter(
      (d) => (d.external || d.resourceType === 'account') && !metadataAttempted.current.has(d.id),
    )
    pending.forEach((d) => metadataAttempted.current.add(d.id))
    metadataQueue.current.push(...pending)
    async function worker() {
      metadataActive.current++
      while (metadataQueue.current.length && mounted.current) {
        const doc = metadataQueue.current.shift()!
        if (doc.resourceType === 'account') {
          atlas.materialize(doc.id, doc.origin)
          continue
        }
        try {
          const client = clientFor(doc.origin)
          const [metadata, account] = await Promise.all([
            client.request('ResourceMetadata', unpackHmId(doc.id)!),
            client.request('Account', doc.siteUid),
          ])
          if (mounted.current)
            setExternalMeta((previous) => ({
              ...previous,
              [doc.id]: {
                title: metadata.metadata?.name || doc.title,
                siteName: account.type === 'account' ? account.metadata?.name : undefined,
                siteUrl: account.type === 'account' ? account.metadata?.siteUrl : undefined,
              },
            }))
        } catch {
          /* A linked resource may not yet be available on the gateway. The card remains usable. */
        }
      }
      metadataActive.current--
    }
    while (metadataActive.current < 2 && metadataQueue.current.length) void worker()
  }, [cards, atlas.materialize])

  const neighborhood = useMemo(() => {
    if (!focused) return null
    const ids = new Set([focused])
    connections.forEach((c) => {
      if (c.source === focused || c.target === focused) {
        ids.add(c.source)
        ids.add(c.target)
      }
    })
    return ids
  }, [focused, connections])

  const focusedPositions = useMemo(
    () => (focused ? focusPositions(focused, connections) : null),
    [focused, connections],
  )

  useEffect(() => {
    setNodes((previous) => {
      const existing = new Map(previous.map((n) => [n.id, n]))
      positions.current = allocateCards(Object.values(cards), positions.current, allocation.current)
      const counts = new Map<string, number>()
      connections.forEach((c) => {
        counts.set(c.source, (counts.get(c.source) || 0) + 1)
        counts.set(c.target, (counts.get(c.target) || 0) + 1)
      })
      const next: AtlasNode[] = Object.values(cards).map((doc) => {
        const old = existing.get(doc.id)
        const siteName =
          atlas.sites.find((s) => s.uid === doc.siteUid)?.title || externalMeta[doc.id]?.siteName || 'External site'
        const hidden = !!neighborhood && !neighborhood.has(doc.id)
        const count = counts.get(doc.id) || 0
        const isExpanded = expanded.has(doc.id)
        const position = focusedPositions?.[doc.id] || positions.current[doc.id]
        if (
          old &&
          old.position.x === position.x &&
          old.position.y === position.y &&
          old.data.document === doc &&
          old.hidden === hidden &&
          old.selected === (doc.id === selected) &&
          old.data.count === count &&
          old.data.expanded === isExpanded &&
          old.data.siteName === siteName &&
          old.data.compact === compact
        )
          return old
        return {
          ...old,
          id: doc.id,
          type: 'document',
          initialWidth: 310,
          initialHeight: 300,
          position,
          zIndex: doc.id === selected ? 200 : expanded.has(doc.id) ? 100 : 0,
          dragHandle: '.card-drag',
          selected: doc.id === selected,
          hidden: !!neighborhood && !neighborhood.has(doc.id),
          data: {
            document: doc,
            compact,
            expanded: expanded.has(doc.id),
            count: counts.get(doc.id) || 0,
            siteName:
              atlas.sites.find((s) => s.uid === doc.siteUid)?.title ||
              externalMeta[doc.id]?.siteName ||
              'External site',
          },
        }
      })
      if (!neighborhood) {
        const groups = new Map<string, AtlasNode[]>()
        const branches = new Set(
          Object.values(cards)
            .filter((d) => d.path.length > 1)
            .map((d) => `${d.siteUid}/${d.path[0]}`),
        )
        for (const node of next) {
          const doc = node.data.document
          const key = `${doc.siteUid}/${pathGroup(doc, branches)}`
          const group = groups.get(key) || []
          group.push(node)
          groups.set(key, group)
        }
        for (const [key, group] of groups) {
          const first = group[0]
          const doc = first.data.document
          next.push({
            id: `group:${key}`,
            type: 'document',
            position: {
              x: Math.min(...group.map((n) => n.position.x)),
              y: Math.min(...group.map((n) => n.position.y)) - 80,
            },
            draggable: false,
            selectable: false,
            connectable: false,
            data: {
              document: doc,
              expanded: false,
              count: group.length,
              siteName: first.data.siteName,
              group: `${pathGroup(doc, branches)} · ${group.length}`,
            },
          })
        }
      }
      for (const pin of pinned) {
        const doc = cards[pin.documentId]
        const thread = atlas.threads[pin.documentId]?.find((t) => t.id === pin.threadId)
        if (!doc || !thread) continue
        const id = `thread:${thread.id}`
        const old = existing.get(id)
        const parentPosition = next.find((n) => n.id === doc.id)?.position || {x: 0, y: 0}
        positions.current[id] ||= {x: parentPosition.x + 410, y: parentPosition.y + 60}
        next.push({
          ...old,
          id,
          type: 'document',
          dragHandle: '.card-drag',
          position: positions.current[id],
          hidden: !!neighborhood,
          data: {document: doc, thread, expanded: true, count: 0, siteName: ''},
        })
      }
      return next
    })
  }, [
    cards,
    connections,
    expanded,
    selected,
    neighborhood,
    pinned,
    atlas.threads,
    atlas.sites,
    externalMeta,
    compact,
    layoutRevision,
    focusedPositions,
    setNodes,
  ])

  const fittedNeighborhood = useRef('')
  useEffect(() => {
    if (!focused || !focusedPositions) {
      fittedNeighborhood.current = ''
      return
    }
    const key = `${focused}|${Object.keys(focusedPositions).join('|')}`
    if (fittedNeighborhood.current === key) return
    const nodeIds = new Set(nodes.map((node) => node.id))
    if (Object.keys(focusedPositions).some((id) => cards[id] && !nodeIds.has(id))) return
    const bounds = focusBounds(
      focused,
      connections,
      nodes.map((node) => ({...node, position: focusedPositions[node.id] || node.position})),
    )
    if (!bounds) return
    fittedNeighborhood.current = key
    void flow.fitBounds(bounds, {padding: 0.2, duration: 300})
  }, [focused, focusedPositions, connections, nodes, cards, flow])

  const edges = useMemo(() => {
    const pairs = new Map<string, Edge>()
    for (const connection of connections) {
      if (compact && connection.source !== selected && connection.target !== selected) continue
      const id = `${connection.source}->${connection.target}`
      const active = !selected || connection.source === selected || connection.target === selected
      pairs.set(id, {
        id,
        source: connection.source,
        target: connection.target,
        type: 'default',
        hidden: !!focused && connection.source !== focused && connection.target !== focused,
        style: {
          stroke: connection.kind === 'comment' ? 'var(--conversation)' : 'var(--connection)',
          strokeWidth: active ? 3 : 2,
          strokeDasharray: connection.kind === 'comment' ? '8 5' : undefined,
          opacity: 1,
        },
      })
    }
    for (const pin of pinned)
      pairs.set(`pin:${pin.threadId}`, {
        id: `pin:${pin.threadId}`,
        source: pin.documentId,
        target: `thread:${pin.threadId}`,
        style: {stroke: 'var(--conversation)', strokeWidth: 2, strokeDasharray: '5 5'},
        hidden: !!focused,
      })
    return [...pairs.values()]
  }, [connections, selected, neighborhood, pinned, compact, focused])

  useEffect(() => {
    atlas.watched.current = new Set([...pinned.map((p) => p.documentId), ...(selected ? [selected] : [])])
    if (selected) void atlas.refreshThreads(selected)
  }, [selected, pinned, atlas.refreshThreads, atlas.watched])

  const saveLayout = useCallback(() => {
    const siteUrls = atlas.sites.map((s) => s.url || s.origin)
    if (!siteUrls.length) return
    const layout: Layout = {
      version: 1,
      sites: [...new Set([...(atlas.saved?.sites || []), ...siteUrls])],
      positions: positions.current,
      viewport: viewport.current,
      pinned,
      expanded: [...expanded],
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [atlas.sites, pinned, expanded, atlas.saved])

  useEffect(() => {
    saveLayout()
  }, [saveLayout])

  useEffect(() => {
    const timer = setTimeout(saveLayout, 300)
    return () => clearTimeout(timer)
  }, [nodes, saveLayout])

  function select(id: string) {
    setSelected(id)
    if (cards[id]?.resourceType === 'account') setPanel('connections')
    if (focused) {
      setFocused(id)
      fitFocus(id)
    }
    if (!atlas.documents[id]?.content || atlas.documents[id]?.error || atlas.documents[id]?.citationError)
      atlas.materialize(id)
  }
  function focus(id: string) {
    select(id)
    setFocused(id)
    fitFocus(id)
  }
  function fitFocus(id: string) {
    const local = focusPositions(id, connections)
    const bounds = focusBounds(
      id,
      connections,
      nodes.map((n) => ({...n, position: local[n.id] || n.position})),
    )
    if (bounds) void flow.fitBounds(bounds, {padding: 0.2, duration: 300})
  }
  function expand(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (!atlas.documents[id]?.content) atlas.materialize(id)
  }
  const actions: Actions = {
    select,
    focus,
    expand,
    expandSite: (uid) => {
      const external = Object.values(cards).find((d) => d.siteUid === uid)
      const knownUrl = external && (external.accountSiteUrl || externalMeta[external.id]?.siteUrl)
      void atlas.addSite(knownUrl || `https://hyper.media/hm/${uid}`)
    },
    unpin: (id) => setPinned((previous) => previous.filter((p) => p.threadId !== id)),
  }

  const latestActions = useRef(actions)
  latestActions.current = actions
  const stableActions = useMemo<Actions>(
    () => ({
      select: (id) => latestActions.current.select(id),
      focus: (id) => latestActions.current.focus(id),
      expand: (id) => latestActions.current.expand(id),
      expandSite: (uid) => latestActions.current.expandSite(uid),
      unpin: (id) => latestActions.current.unpin(id),
    }),
    [],
  )

  const current = selected ? cards[selected] : null
  const related = connections.filter((c) => c.source === selected || c.target === selected)
  const searchResults = query
    ? Object.values(cards)
        .filter((d) => `${d.title} ${d.summary || ''}`.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 20)
    : []
  const syncStale = !!atlas.lastSync && now - atlas.lastSync > 15000
  const hasCards = Object.keys(cards).length > 0
  const error =
    atlas.error ||
    (storageError ? 'This browser could not save the layout. Your current canvas is still available.' : '')

  return (
    <CardActions.Provider value={stableActions}>
      <main className="atlas-app">
        <header className="app-bar">
          <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
            <span className="brand-mark">
              <Sprout size={22} />
            </span>
            <span>
              Seed <b>Atlas</b>
            </span>
            <span className="beta">EXPERIMENT</span>
          </a>
          <div className="site-switcher">
            <Globe2 size={15} />
            <span>
              {atlas.sites.length
                ? atlas.sites.length === 1
                  ? atlas.sites[0].title
                  : `${atlas.sites.length} connected sites`
                : 'Your network, in view'}
            </span>
          </div>
          <button
            className="add-site-button"
            onClick={() => {
              setUrl('')
              setAdding(!adding)
            }}
          >
            + Add a site
          </button>
        </header>
        {adding && (
          <form
            className="site-popover"
            onSubmit={(e) => {
              e.preventDefault()
              void atlas.addSite(url)
              setAdding(false)
            }}
          >
            <label htmlFor="site-url">Seed site URL</label>
            <div>
              <input
                id="site-url"
                placeholder="https://your-site.example"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
              <button className="primary" disabled={atlas.loading}>
                Add site
              </button>
            </div>
          </form>
        )}
        {hasCards && (
          <div className="canvas-toolbar">
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="Find a document"
                placeholder="Find a document…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="icon-button" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => {
                setFocused(null)
                setSelected(null)
                const siteNodes = nodes
                  .filter((n) => !n.data.document.external && !n.data.group)
                  .map((n) => ({...n, position: positions.current[n.id] || n.position}))
                const bounds = focusBounds(
                  '__all__',
                  siteNodes.map((n) => ({source: '__all__', target: n.id})),
                  siteNodes,
                )
                if (bounds) void flow.fitBounds(bounds, {padding: 0.12, duration: 350})
              }}
            >
              <Expand size={15} /> Whole site
            </button>
            <button
              onClick={() => {
                allocation.current = new Map()
                positions.current = allocateCards(Object.values(cards), {}, allocation.current)
                setNodes((previous) =>
                  previous
                    .filter((n) => !n.data.group)
                    .map((n) => ({...n, position: positions.current[n.id] || n.position})),
                )
                setFocused(null)
                setLayoutRevision((value) => value + 1)
                const arranged = nodes
                  .filter((node) => !node.data.group && !node.data.document.external)
                  .map((node) => ({...node, position: positions.current[node.id] || node.position}))
                const bounds = focusBounds(
                  '__all__',
                  arranged.map((node) => ({source: '__all__', target: node.id})),
                  arranged,
                )
                if (bounds) void flow.fitBounds(bounds, {padding: 0.12, duration: 350})
              }}
            >
              <Layers3 size={15} /> Arrange by path
            </button>
            {compact && <span className="overview-note">Overview · select a page to show connections</span>}
            {focused && (
              <button
                className="focus-chip"
                onClick={() => {
                  setFocused(null)
                  void flow.setViewport(viewport.current)
                }}
              >
                <Focus size={14} /> Focus view <X size={13} />
              </button>
            )}
            {query && (
              <div className="search-results">
                {searchResults.length ? (
                  searchResults.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => {
                        setQuery('')
                        select(doc.id)
                        setFocused(null)
                        const bounds = focusBounds(
                          doc.id,
                          [],
                          nodes.map((n) => ({...n, position: positions.current[n.id] || n.position})),
                        )
                        if (bounds) void flow.fitBounds(bounds, {padding: 0.2, duration: 300})
                      }}
                    >
                      <span>{doc.title}</span>
                      <ArrowUpRight size={14} />
                    </button>
                  ))
                ) : (
                  <p>No matching documents</p>
                )}
              </div>
            )}
          </div>
        )}
        <div className={`canvas-area ${current ? 'with-sidebar' : ''}`}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={(changes) => {
              if (!focused)
                for (const change of changes) {
                  if (change.type === 'position' && change.position) positions.current[change.id] = change.position
                }
              onNodesChange(changes)
            }}
            nodesDraggable={!focused}
            onNodeDragStop={(_, node, draggedNodes) => {
              if (focused) return
              for (const moved of draggedNodes.length ? draggedNodes : [node]) {
                positions.current[moved.id] = moved.position
              }
              saveLayout()
            }}
            onNodeClick={(_, node) => {
              if (!node.data.thread && !node.data.group) select(node.id)
            }}
            onPaneClick={() => {
              if (!focused) setSelected(null)
            }}
            onEdgeClick={(_, edge) => {
              select(edge.source)
              setPanel('connections')
            }}
            onMoveEnd={(_, value) => {
              if (!focused) {
                viewport.current = value
                saveLayout()
              }
            }}
            defaultViewport={viewport.current}
            minZoom={0.005}
            maxZoom={2}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            onlyRenderVisibleElements
            panOnScroll
            selectionOnDrag={false}
            proOptions={{hideAttribution: false}}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#c6c9bc" />
            {hasCards && (
              <>
                <Controls showInteractive={false} />
                <MiniMap
                  pannable
                  zoomable
                  nodeColor={(n) =>
                    n.id.startsWith('thread:')
                      ? '#854000'
                      : n.data.document && (n.data.document as CanvasDocument).external
                        ? '#235789'
                        : '#384552'
                  }
                  maskColor="rgba(244,242,235,.75)"
                />
              </>
            )}
          </ReactFlow>
          {hasCards && (
            <div className="canvas-legend" aria-label="Card types">
              <span>
                <FileText size={15} /> Page
              </span>
              <span>
                <Globe2 size={15} /> Linked page
              </span>
              <span>
                <UserRound size={15} /> Account
              </span>
              <span>
                <MessageCircle size={15} /> Conversation
              </span>
            </div>
          )}
          {!hasCards && (
            <section className="welcome">
              <div className="welcome-eyebrow">
                <span className="site-dot" /> A LIVING MAP OF YOUR IDEAS
              </div>
              <h1>
                See how it
                <br />
                <em>all connects.</em>
              </h1>
              <p>
                Documents, conversations, and the links between them.
                <br />
                Bring a Seed site into your own open space.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void atlas.addSite(url)
                }}
              >
                <Globe2 size={18} />
                <input
                  aria-label="Seed site URL"
                  placeholder="https://your-site.example"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <button className="primary" disabled={atlas.loading}>
                  {atlas.loading ? <Loader2 size={18} className="spin" /> : <ArrowUpRight size={18} />}{' '}
                  {atlas.loading ? 'Loading site' : 'Explore site'}
                </button>
              </form>
              <button
                className="demo-site-button"
                disabled={atlas.loading}
                onClick={() => void atlas.addSite('https://seedteamtalks.hyper.media')}
              >
                See a demo site <ArrowUpRight size={16} />
              </button>
              <div className="welcome-hints">
                <span>
                  <Compass size={15} /> Follow connections
                </span>
                <span>
                  <MessageCircle size={15} /> Discover conversations
                </span>
                <span>
                  <Pin size={15} /> Make it yours
                </span>
              </div>
            </section>
          )}
        </div>
        {current && (
          <aside className="detail-sidebar" aria-label="Document details">
            <div className="sidebar-top">
              <span>{current.resourceType === 'account' ? 'ACCOUNT' : 'DOCUMENT'}</span>
              <button
                className="icon-button"
                aria-label="Close details"
                onClick={() => {
                  setSelected(null)
                  if (focused) {
                    setFocused(null)
                    void flow.setViewport(viewport.current)
                  }
                }}
              >
                <X size={18} />
              </button>
            </div>
            <h2>{current.title}</h2>
            <p className="sidebar-site">
              <Globe2 size={13} />
              {atlas.sites.find((s) => s.uid === current.siteUid)?.title ||
                externalMeta[current.id]?.siteName ||
                'External site'}
            </p>
            <div className="source-actions">
              <a href={webUrl(current.id)} target="_blank" rel="noreferrer">
                Open web <ArrowUpRight size={14} />
              </a>
              <a href={current.id}>
                Open Seed <ArrowUpRight size={14} />
              </a>
              <button onClick={() => focus(current.id)}>
                <Focus size={14} /> Focus
              </button>
            </div>
            <div className="sidebar-tabs">
              <button
                disabled={current.resourceType === 'account'}
                className={panel === 'conversations' ? 'active' : ''}
                onClick={() => setPanel('conversations')}
              >
                <MessageCircle size={15} /> Conversations
              </button>
              <button className={panel === 'connections' ? 'active' : ''} onClick={() => setPanel('connections')}>
                <Link2 size={15} /> Connections <small>{related.length}</small>
              </button>
            </div>
            <div className="sidebar-scroll">
              {panel === 'conversations' && current.resourceType !== 'account' ? (
                <>
                  {atlas.threadErrors[current.id] && (
                    <div className="inline-error">
                      {atlas.threadErrors[current.id]}
                      <button onClick={() => void atlas.refreshThreads(current.id)}>Retry</button>
                    </div>
                  )}
                  {!atlas.threads[current.id] && !atlas.threadErrors[current.id] && (
                    <p className="empty-panel">
                      <Loader2 size={18} className="spin" /> Loading conversations…
                    </p>
                  )}
                  {atlas.threads[current.id]?.length === 0 && (
                    <div className="empty-panel">
                      <MessageCircle size={28} />
                      <h3>A quiet corner.</h3>
                      <p>No conversations on this document yet.</p>
                    </div>
                  )}
                  {atlas.threads[current.id]?.map((thread) => (
                    <section className="sidebar-thread" key={thread.id}>
                      <div className="thread-heading">
                        <span>
                          {thread.comments.length} {thread.comments.length === 1 ? 'comment' : 'comments'}
                        </span>
                        <button
                          className={pinned.some((p) => p.threadId === thread.id) ? 'is-pinned' : ''}
                          onClick={() =>
                            setPinned((previous) =>
                              previous.some((p) => p.threadId === thread.id)
                                ? previous.filter((p) => p.threadId !== thread.id)
                                : [...previous, {documentId: current.id, threadId: thread.id}],
                            )
                          }
                        >
                          <Pin size={13} />
                          {pinned.some((p) => p.threadId === thread.id) ? 'Pinned' : 'Pin to canvas'}
                        </button>
                      </div>
                      {thread.comments.map((comment) => (
                        <article className="sidebar-comment" key={comment.id}>
                          <div className="reply-author">
                            <span className="avatar">{(thread.authors[comment.author] || 'S').slice(0, 1)}</span>
                            {thread.authors[comment.author] || 'Seed author'}
                            {comment.replyParent && <small>reply</small>}
                          </div>
                          <Content content={comment.content} origin={current.origin} />
                        </article>
                      ))}
                    </section>
                  ))}
                </>
              ) : (
                <>
                  <p className="connections-note">
                    Links and citations known to this server. Incoming results may be limited.
                  </p>
                  {related.length === 0 && <p className="empty-panel">No connections found yet.</p>}
                  {related.map((connection) => {
                    const outgoing = connection.source === current.id
                    const target = outgoing ? connection.target : connection.source
                    return (
                      <div className="connection-row" key={connection.id}>
                        <button
                          onClick={() => {
                            select(target)
                            setFocused(null)
                            const bounds = focusBounds(
                              target,
                              [],
                              nodes.map((n) => ({...n, position: positions.current[n.id] || n.position})),
                            )
                            if (bounds) void flow.fitBounds(bounds, {padding: 0.2, duration: 300})
                          }}
                        >
                          {outgoing ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}
                          <span>
                            <small>
                              {connection.kind === 'comment'
                                ? 'Mentioned in a conversation'
                                : outgoing
                                  ? 'Links to'
                                  : 'Linked from'}
                            </small>
                            {cards[target]?.title || 'Linked document'}
                          </span>
                        </button>
                        <a
                          title="Open original reference"
                          href={safeUrl(connection.reference, current.origin)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ArrowUpRight size={14} />
                        </a>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          </aside>
        )}
        {error && (
          <div className="error-toast" role="alert">
            {error}
            <button
              onClick={() => {
                atlas.setError('')
                setStorageError(false)
              }}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <footer className="status-bar">
          <div>
            <span className={`status-dot ${atlas.syncError || syncStale ? 'paused' : ''}`} />
            <span title={atlas.syncError || 'Checks for updates every three seconds while this tab is visible'}>
              {atlas.syncError
                ? 'Connection interrupted · retrying'
                : atlas.loading
                  ? 'Loading site…'
                  : syncStale
                    ? 'Waiting for server…'
                    : atlas.lastSync
                      ? 'Live updates'
                      : 'Ready to explore'}
            </span>
            {atlas.pending > 0 && <span className="muted">· {atlas.pending} documents loading</span>}
          </div>
          <div>
            {hasCards && (
              <>
                <span>{Object.values(cards).filter((d) => !d.external).length} documents</span>
                <span>{connections.length} connections</span>
              </>
            )}
            <span className="save-label">{storageError ? 'Layout not saved' : 'Saved in this browser'}</span>
          </div>
        </footer>
      </main>
    </CardActions.Provider>
  )
}
