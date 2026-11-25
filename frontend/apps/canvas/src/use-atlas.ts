import {useCallback, useEffect, useRef, useState} from 'react'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {
  canonicalId,
  linkId,
  parseLayout,
  reconcileSite,
  type CanvasDocument,
  type Connection,
  type Site,
  type Thread,
} from './graph'
import {
  clientFor,
  listSite,
  readCitations,
  readDocument,
  readNewEvents,
  readThreads,
  resolveSite,
  resolveWebReference,
} from './network'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

/** Storage key shared by the reader and the canvas layout writer. */
export const STORAGE_KEY = 'seed-atlas-layout-v1'

/** Owns live Seed snapshots; canvas positions remain in a separate UI state. */
export function useAtlas() {
  const [saved] = useState(() => {
    try {
      return parseLayout(localStorage.getItem(STORAGE_KEY))
    } catch {
      return null
    }
  })
  const [sites, setSites] = useState<Site[]>([])
  const [documents, setDocuments] = useState<Record<string, CanvasDocument>>({})
  const [citations, setCitations] = useState<Record<string, Connection[]>>({})
  const [threads, setThreads] = useState<Record<string, Thread[]>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(0)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncError, setSyncError] = useState('')
  const [threadErrors, setThreadErrors] = useState<Record<string, string>>({})
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({})
  const docsRef = useRef(documents)
  const sitesRef = useRef(sites)
  const watched = useRef(new Set<string>(saved?.pinned.map((p) => p.documentId)))
  const checkpoints = useRef(new Map<string, Set<string>>())
  const alive = useRef(true)
  const work = useRef(new Map<string, {document: CanvasDocument; priority: boolean}>())
  const active = useRef(new Set<string>())
  const busyThreads = useRef(new Set<string>())
  const syncing = useRef(new Set<string>())
  const scanning = useRef(new Set<string>())
  const lastScan = useRef(new Map<string, number>())
  const siteFailures = useRef(new Map<string, string>())
  const loadingSites = useRef(new Set<string>())
  const referenceQueue = useRef<string[]>([])
  const referenceSeen = useRef(new Set<string>())
  const referenceActive = useRef(0)
  const revisions = useRef(new Map<string, number>())

  const resolveLinks = useCallback((content: HMBlockNode[]) => {
    const visit = (nodes: HMBlockNode[]) => {
      for (const {block, children} of nodes) {
        const links = [
          'link' in block ? block.link : undefined,
          ...('annotations' in block && Array.isArray(block.annotations) ? block.annotations.map((a) => a.link) : []),
        ]
        for (const link of links) {
          if (
            typeof link !== 'string' ||
            !/^https?:\/\//.test(link) ||
            linkId(link, sitesRef.current) ||
            referenceSeen.current.has(link)
          )
            continue
          referenceSeen.current.add(link)
          referenceQueue.current.push(link)
        }
        if (children) visit(children)
      }
    }
    visit(content)
    async function worker() {
      referenceActive.current++
      while (referenceQueue.current.length && alive.current) {
        const url = referenceQueue.current.shift()!
        try {
          const resolved = await resolveWebReference(url)
          const id = resolved && canonicalId(resolved.id.id)
          if (id && alive.current) setResolvedUrls((previous) => ({...previous, [url]: id}))
        } catch {
          /* Ordinary web links and unavailable sites remain accessible in the document. */
        }
      }
      referenceActive.current--
    }
    while (referenceActive.current < 2 && referenceQueue.current.length) void worker()
  }, [])

  const update = useCallback((items: CanvasDocument[]) => {
    if (!alive.current) return
    const next = {...docsRef.current}
    items.forEach((item) => {
      next[item.id] = item
    })
    docsRef.current = next
    setDocuments(next)
  }, [])

  const refreshThreads = useCallback(
    async (id: string) => {
      const document = docsRef.current[id]
      if (!document || (document.resourceType && document.resourceType !== 'document') || busyThreads.current.has(id))
        return
      busyThreads.current.add(id)
      try {
        const result = await readThreads(document)
        result.forEach((thread) => thread.comments.forEach((comment) => resolveLinks(comment.content)))
        if (alive.current) {
          setThreads((previous) => ({...previous, [id]: result}))
          setThreadErrors((previous) => ({...previous, [id]: ''}))
        }
      } catch (e) {
        if (alive.current)
          setThreadErrors((previous) => ({
            ...previous,
            [id]: e instanceof Error ? e.message : 'Could not load conversations.',
          }))
      } finally {
        busyThreads.current.delete(id)
      }
    },
    [resolveLinks],
  )

  const drain = useCallback(
    function drainQueue() {
      if (!alive.current) return
      while (active.current.size < 4 && work.current.size) {
        const entries = [...work.current.values()]
        const next =
          entries.find((entry) => entry.priority && !active.current.has(entry.document.id)) ||
          entries.find((entry) => !active.current.has(entry.document.id))
        if (!next) break
        // Keep one request slot available for selected documents and live changes.
        if (!next.priority && active.current.size >= 3) break
        const {document} = next
        const revision = revisions.current.get(document.id) || 0
        work.current.delete(document.id)
        active.current.add(document.id)
        void (async () => {
          try {
            const result = {...(await readDocument(document)), citationError: false}
            const current = docsRef.current[document.id]
            if ((revisions.current.get(document.id) || 0) !== revision) return
            update([
              {...result, external: current?.external ?? result.external, origin: current?.origin || result.origin},
            ])
            resolveLinks(result.content || [])
            if (!result.unavailable && result.resourceType === 'document') {
              try {
                const links = await readCitations(result)
                if (alive.current && (revisions.current.get(document.id) || 0) === revision)
                  setCitations((previous) => ({...previous, [document.id]: links}))
              } catch {
                if (alive.current && (revisions.current.get(document.id) || 0) === revision) {
                  update([{...docsRef.current[document.id], citationError: true}])
                  setSyncError('Some incoming connections could not load. Select the document to retry.')
                }
              }
            } else if (alive.current) {
              setCitations((previous) => ({...previous, [document.id]: []}))
              setThreads((previous) => ({...previous, [document.id]: []}))
            }
          } catch (e) {
            const current = docsRef.current[document.id] || document
            if ((revisions.current.get(document.id) || 0) === revision)
              update([{...current, error: e instanceof Error ? e.message : 'Could not load this document.'}])
          } finally {
            active.current.delete(document.id)
            if (alive.current) {
              setPending(work.current.size + active.current.size)
              drainQueue()
            }
          }
        })()
      }
      setPending(work.current.size + active.current.size)
    },
    [update, resolveLinks],
  )

  const enqueue = useCallback(
    (document: CanvasDocument, priority = false) => {
      if (!work.current.has(document.id)) work.current.set(document.id, {document, priority})
      else if (priority) work.current.set(document.id, {document, priority})
      drain()
    },
    [drain],
  )

  const materialize = useCallback(
    (id: string, origin?: string) => {
      const key = canonicalId(id)
      if (!key) return
      const parsed = unpackHmId(key)
      if (!parsed) return
      const site = sitesRef.current.find((s) => s.uid === parsed.uid)
      const previous = docsRef.current[key]
      const document: CanvasDocument = previous || {
        id: key,
        siteUid: parsed.uid,
        path: key.endsWith('/:profile') ? [] : parsed.path || [],
        resourceType: key.endsWith('/:profile') ? 'account' : undefined,
        origin: site?.origin || origin || 'https://hyper.media',
        title: key.endsWith('/:profile') ? 'Seed account' : parsed.path?.at(-1)?.replace(/-/g, ' ') || 'Linked site',
        version: '',
        external: !site,
        commentCount: 0,
      }
      if (!previous) update([document])
      revisions.current.set(key, (revisions.current.get(key) || 0) + 1)
      enqueue(document, true)
    },
    [enqueue, update],
  )

  const snapshot = useCallback(
    async (site: Site) => {
      if (scanning.current.has(site.uid)) return
      scanning.current.add(site.uid)
      lastScan.current.set(site.uid, Date.now())
      try {
        const initial = !Object.values(docsRef.current).some((d) => d.siteUid === site.uid && !d.external)
        const listing: CanvasDocument[] = []
        await listSite(site, (batch) => {
          listing.push(...batch)
          if (initial) {
            const fresh = batch.filter((d) => !docsRef.current[d.id])
            update(fresh)
            fresh.forEach((d) => enqueue(d))
          }
        })
        if (!alive.current) return
        const result = reconcileSite(docsRef.current, listing, site.uid)
        const changedRecords = Object.values(result.documents).filter((d) => d !== docsRef.current[d.id])
        const previous = docsRef.current
        if (changedRecords.length) update(changedRecords)
        for (const document of result.changed) {
          if (previous[document.id]?.version !== document.version || previous[document.id]?.unavailable) {
            revisions.current.set(document.id, (revisions.current.get(document.id) || 0) + 1)
            work.current.set(document.id, {document, priority: !initial})
          } else if (!active.current.has(document.id) && !work.current.has(document.id)) enqueue(document)
        }
        drain()
        // Reconcile only after a complete listing. Partial failures must never delete cards.
        if (result.removed.length) {
          result.removed.forEach((id) => {
            revisions.current.set(id, (revisions.current.get(id) || 0) + 1)
            work.current.delete(id)
          })
          setCitations((previous) => {
            const next = {...previous}
            result.removed.forEach((id) => {
              delete next[id]
            })
            return next
          })
        }
      } finally {
        scanning.current.delete(site.uid)
      }
    },
    [enqueue, update, drain],
  )

  const addSite = useCallback(
    async (input: string) => {
      if (loadingSites.current.has(input)) return
      loadingSites.current.add(input)
      setLoading(true)
      setError('')
      try {
        const site = await resolveSite(input)
        const existing = sitesRef.current.find((s) => s.uid === site.uid)
        if (existing) {
          await snapshot(existing)
          return
        }
        const baseline = await readNewEvents(
          (token) =>
            clientFor(site.origin).request('ListEvents', {
              pageSize: 25,
              pageToken: token || undefined,
              filterResource: `hm://${site.uid}*`,
              order: 'observed',
            }),
          null,
        )
        checkpoints.current.set(site.uid, baseline.checkpoint)
        sitesRef.current = [...sitesRef.current, site]
        setSites(sitesRef.current)
        await snapshot(site)
        if (!alive.current) return
        const restored = new Set([...(saved?.expanded || []), ...(saved?.pinned.map((pin) => pin.documentId) || [])])
        for (const id of restored) {
          if (unpackHmId(id)?.uid === site.uid) materialize(id)
        }
        for (const pin of saved?.pinned || []) {
          if (unpackHmId(pin.documentId)?.uid === site.uid) void refreshThreads(pin.documentId)
        }
        if (alive.current) setLastSync(Date.now())
      } catch (e) {
        if (alive.current) setError(e instanceof Error ? e.message : 'Could not load the site.')
      } finally {
        loadingSites.current.delete(input)
        if (alive.current) setLoading(loadingSites.current.size > 0)
      }
    },
    [snapshot, saved, materialize, refreshThreads],
  )

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      work.current.clear()
    }
  }, [])

  useEffect(() => {
    const tick = () => {
      if (document.hidden || !sitesRef.current.length) return
      for (const site of sitesRef.current) {
        if (!scanning.current.has(site.uid) && Date.now() - (lastScan.current.get(site.uid) || 0) >= 30000) {
          void snapshot(site)
            .then(() => siteFailures.current.delete(`listing:${site.uid}`))
            .catch((e) => {
              siteFailures.current.set(
                `listing:${site.uid}`,
                `${site.title}: ${e instanceof Error ? e.message : 'Could not refresh documents.'}`,
              )
            })
        }
        if (syncing.current.has(site.uid)) continue
        syncing.current.add(site.uid)
        void (async () => {
          try {
            const client = clientFor(site.origin)
            const result = await readNewEvents(
              (token) =>
                client.request('ListEvents', {
                  pageSize: 25,
                  pageToken: token || undefined,
                  order: 'observed',
                  filterResource: `hm://${site.uid}*`,
                }),
              checkpoints.current.get(site.uid) || null,
            )
            const changed = new Set<string>()
            for (const event of result.events) {
              const values = [
                event.docId,
                (event.source as {id?: unknown} | undefined)?.id,
                (event.target as {id?: unknown} | undefined)?.id,
              ]
              for (const value of values) {
                const raw = typeof value === 'string' ? value : (value as {id?: string} | undefined)?.id
                const id = raw ? canonicalId(raw) : null
                if (id && (docsRef.current[id] || id.startsWith(`hm://${site.uid}/`) || id === `hm://${site.uid}`))
                  changed.add(id)
              }
            }
            for (const id of changed) materialize(id, site.origin)
            checkpoints.current.set(site.uid, result.checkpoint)
            siteFailures.current.delete(site.uid)
            if (alive.current) setLastSync(Date.now())
          } catch (e) {
            siteFailures.current.set(
              site.uid,
              `${site.title}: ${e instanceof Error ? e.message : 'Could not update site.'}`,
            )
          } finally {
            syncing.current.delete(site.uid)
            if (alive.current) setSyncError([...siteFailures.current.values()].join(' '))
          }
        })()
      }
      for (const id of watched.current) {
        void refreshThreads(id)
        const doc = docsRef.current[id]
        if ((doc?.external || doc?.resourceType === 'account') && !active.current.has(id) && !work.current.has(id))
          enqueue(doc, true)
      }
    }
    const timer = window.setInterval(() => {
      void tick()
    }, 3000)
    const resume = () => {
      void tick()
    }
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [materialize, snapshot, refreshThreads, enqueue])

  return {
    saved,
    sites,
    documents,
    citations,
    threads,
    error,
    loading,
    pending,
    lastSync,
    syncError,
    threadErrors,
    addSite,
    materialize,
    refreshThreads,
    watched,
    setError,
    resolvedUrls,
  }
}
