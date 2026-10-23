import {createHash} from 'node:crypto'
import {LabState, access, clone, selected} from './model'

/** A content-addressed block in the simulator, with explicitly typed outgoing edges. */
export type SyncBlob = {
  cid: string
  label: string
  kind: 'resource' | 'grant' | 'revocation' | 'ref' | 'manifest' | 'chunk' | 'change'
  bytes: number
  data: string
  links: {cid: string; kind: 'contains' | 'proof' | 'reference'}[]
  object?: {type: string; id: string}
}
/** A simulated SQL row. IDs are internal; the UI resolves them to names. */
export type SqlRow = Record<string, string | number | boolean>
/** The tables materialized independently on each peer. */
export type PeerTables = Record<
  'blobs' | 'edges' | 'authority_cache' | 'resource_heads' | 'complete' | 'frontier' | 'receipts',
  SqlRow[]
>
/** A peer's local storage, independent of the other peer. */
export type SyncPeer = {key: string; name: string; tables: PeerTables}
/** One observable protocol event, including local SQL and graph activity. */
export type SyncEvent = {
  title: string
  detail: string
  kind: 'local' | 'request' | 'response' | 'blocked'
  from: number
  to: number
  method?: string
  payload?: unknown
  active: string[]
  sql: {peer: number; statement: string; tables: (keyof PeerTables)[]}[]
}
/** Initial data placement and disclosure policy for a sync experiment. */
export type SyncOptions = {
  left: string
  right: string
  profile: 'cold' | 'shared' | 'partial' | 'split'
  privacy: 'deduplicate' | 'scoped'
}
type Scope = {resource: string; root: string; control: string[]}
type Task = {
  op: 'Hello' | 'GetControl' | 'OpenScope' | 'ReconcileHeads' | 'walk' | 'FetchBlock' | 'Commit' | 'Ack'
  from: number
  resource?: string
  cid?: string
  parent?: string
}
type Frame = {
  peers: SyncPeer[]
  queue: Task[]
  pending: Task | null
  event: SyncEvent
  done: boolean
  transferred: number
  skipped: number
}

/** SQL contracts shown alongside the in-memory tables; these are proposed simulator schemas. */
export const syncSchemas: Record<keyof PeerTables, string> = {
  blobs: 'CREATE TABLE blobs (cid TEXT PRIMARY KEY, kind TEXT, bytes INTEGER, verified INTEGER);',
  edges:
    'CREATE TABLE edges (parent TEXT, child TEXT, kind TEXT, PRIMARY KEY(parent, child, kind));\nCREATE INDEX edges_child ON edges(child);',
  authority_cache:
    'CREATE TABLE authority_cache (principal TEXT, resource TEXT, revision TEXT, can_read INTEGER, PRIMARY KEY(principal, resource));',
  resource_heads: 'CREATE TABLE resource_heads (resource TEXT PRIMARY KEY, head TEXT, revision TEXT);',
  complete:
    'CREATE TABLE complete (cid TEXT, rules TEXT, PRIMARY KEY(cid, rules));\n-- Complete closures are pinned: eviction invalidates ancestor markers first.',
  frontier: 'CREATE TABLE frontier (resource TEXT, cid TEXT, parent TEXT, PRIMARY KEY(resource, cid));',
  receipts: 'CREATE TABLE receipts (resource TEXT, head TEXT, revision TEXT, PRIMARY KEY(resource, head));',
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
function emptyTables(): PeerTables {
  return {blobs: [], edges: [], authority_cache: [], resource_heads: [], complete: [], frontier: [], receipts: []}
}
function upsert(rows: SqlRow[], row: SqlRow, keys: string[]) {
  const i = rows.findIndex((r) => keys.every((k) => r[k] === row[k]))
  if (i < 0) rows.push(row)
  else rows[i] = row
}

/**
 * A reversible, two-peer sync machine over the playground's current world. It models protocol
 * messages and indexed tables, not cryptographic authentication, a SQL engine, or actual RBSR.
 * Fixture payloads are deliberately supplied bytes: merely naming an unrelated CID never admits it.
 */
export class SyncLab {
  readonly options: SyncOptions
  readonly blobs: Record<string, SyncBlob> = {}
  readonly scopes: Scope[] = []
  private readonly world: LabState
  private readonly fingerprint: string
  private readonly frames: Frame[] = []
  private cursor = 0

  constructor(world: LabState, options: SyncOptions) {
    if (options.left === options.right) throw Error('Choose two different principals.')
    if (![options.left, options.right].every((key) => world.keys.some((k) => k.id === key)))
      throw Error('Unknown peer.')
    this.options = options
    this.world = clone(world)
    this.fingerprint = this.worldDigest(world)
    this.buildGraph()
    const peers = [options.left, options.right].map((key) => ({
      key,
      name: world.keys.find((k) => k.id === key)!.name,
      tables: emptyTables(),
    }))
    for (const [index, scope] of Array.from(this.scopes.entries())) {
      const eligible = peers.map((p) => access(world, p.key, scope.resource).read)
      peers.forEach((p, i) => {
        if (!eligible[i]) return
        const owns = options.profile === 'split' ? i === index % 2 || !eligible[1 - i] : i === 0 || !eligible[0]
        // Custodians start with their control index; other readers hold only their own and writer evidence.
        this.control(scope.resource, [p.key], owns).forEach((cid) => this.store(p, cid))
        if (owns) {
          this.closure(scope.root).forEach((cid) => this.store(p, cid))
          this.complete(p, scope.root)
          p.tables.resource_heads.push({resource: scope.resource, head: scope.root, revision: this.fingerprint})
        }
      })
    }
    if (options.profile === 'partial' || options.profile === 'shared') {
      const scope = this.scopes.find((s) => peers.every((p) => access(world, p.key, s.resource).read))
      if (scope) {
        if (options.profile === 'partial') {
          this.store(peers[1]!, scope.root)
          peers[1]!.tables.resource_heads.push({resource: scope.resource, head: scope.root, revision: this.fingerprint})
        } else {
          const subtree = this.blobs[scope.root]!.links.find((l) => l.kind === 'contains')?.cid
          if (subtree) {
            this.closure(subtree).forEach((cid) => this.store(peers[1]!, cid))
            this.complete(peers[1]!, subtree)
          }
        }
      }
    }
    this.frames.push({
      peers,
      queue: [{op: 'Hello', from: 0}],
      pending: null,
      done: false,
      transferred: 0,
      skipped: 0,
      event: {
        title: 'Ready to connect',
        detail: 'Each panel is independent local storage. Step to authenticate both peers.',
        kind: 'local',
        from: 0,
        to: 1,
        active: [],
        sql: [],
      },
    })
  }

  private worldDigest(s: LabState) {
    // Any fixture edit fences the run, even an edit that forgot to bump the authority counter.
    return digest([s.resources, s.grants, s.revocations, s.statements, s.changes])
  }

  private add(
    kind: SyncBlob['kind'],
    label: string,
    value: unknown,
    links: SyncBlob['links'] = [],
    object?: SyncBlob['object'],
  ) {
    const data = JSON.stringify({kind, value, links})
    const cid = digest(data)
    this.blobs[cid] ??= {cid, kind, label, data, bytes: Buffer.byteLength(data), links, object}
    return cid
  }

  private buildGraph() {
    const resources = new Map(
      this.world.resources.map((r) => [r.id, this.add('resource', r.name, r, [], {type: 'resource', id: r.id})]),
    )
    const grants = new Map<string, string>()
    const grant = (id: string, visiting = new Set<string>()): string | undefined => {
      if (grants.has(id)) return grants.get(id)
      if (visiting.has(id)) return undefined
      const g = this.world.grants.find((g) => g.id === id)
      if (!g) return undefined
      const proof = g.proof ? grant(g.proof, new Set([...Array.from(visiting), id])) : resources.get(g.resource)
      const name = this.world.keys.find((k) => k.id === g.to)?.name || 'Unknown principal'
      const cid = this.add('grant', `${name} · ${g.role}`, g, proof ? [{cid: proof, kind: 'proof'}] : [], {
        type: 'grant',
        id,
      })
      grants.set(id, cid)
      return cid
    }
    this.world.grants.forEach((g) => grant(g.id))
    for (const r of this.world.resources) {
      const control = [resources.get(r.id)!]
      this.world.grants.filter((g) => g.resource === r.id).forEach((g) => control.push(grants.get(g.id)!))
      this.world.revocations
        .filter((v) => v.resource === r.id)
        .forEach((v) => {
          const links = [grants.get(v.target), grants.get(v.proof)]
            .filter((x): x is string => !!x)
            .map((cid) => ({cid, kind: 'proof' as const}))
          control.push(this.add('revocation', 'Revoked grant', v, links, {type: 'revocation', id: v.id}))
        })
      const ref = selected(this.world, r.id)
      if (!ref) continue
      const changes = new Map<string, string>()
      const change = (id: string, visiting = new Set<string>()): string => {
        if (changes.has(id)) return changes.get(id)!
        const c = this.world.changes.find((c) => c.id === id)
        // Cross-resource links need a separate admission rule. Never turn a known CID into containment.
        if (!c || c.resource !== r.id || visiting.has(id)) return `unresolved:${id}`
        const links = c.deps.map((dep) => ({
          cid: change(dep, new Set([...Array.from(visiting), id])),
          kind: 'contains' as const,
        }))
        const cid = this.add('change', 'Change operations', c, links, {type: 'change', id})
        changes.set(id, cid)
        return cid
      }
      const links: SyncBlob['links'] = (ref.heads || []).map((head) => ({cid: change(head), kind: 'contains'}))
      const payload = ref.state ?? ref.snapshot ?? ref.text
      if (payload !== undefined) {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
        // Supplied payload bytes, chunked by paragraph for legible structural sharing experiments.
        let level = text
          .split('\n\n')
          .map((part, i) => this.add('chunk', part.slice(0, 32) || `Content ${i + 1}`, part))
        while (level.length > 1) {
          const next: string[] = []
          for (let i = 0; i < level.length; i += 2)
            next.push(
              this.add(
                'manifest',
                'Content branch',
                null,
                level.slice(i, i + 2).map((cid) => ({cid, kind: 'contains'})),
              ),
            )
          level = next
        }
        if (level[0]) links.push({cid: level[0], kind: 'contains'})
      }
      // Targets and previous Refs are not adopted content. Their authority is checked separately.
      if (ref.target && resources.has(ref.target)) links.push({cid: resources.get(ref.target)!, kind: 'reference'})
      links.push({cid: resources.get(r.id)!, kind: 'proof'})
      const writer = this.world.grants.find(
        (g) =>
          g.resource === r.id &&
          g.to === ref.author &&
          access(this.world, ref.author, r.id).grants.some((a) => a.id === g.id) &&
          g.role !== 'reader',
      )
      if (writer) links.push({cid: grants.get(writer.id)!, kind: 'proof'})
      const {state: _state, snapshot: _snapshot, text: _text, ...envelope} = ref
      const root = this.add('ref', `${r.name} · ${ref.kind}`, envelope, links, {type: 'statement', id: ref.id})
      this.scopes.push({resource: r.id, root, control})
    }
  }

  private closure(cid: string, seen = new Set<string>()): string[] {
    if (seen.has(cid) || !this.blobs[cid]) return []
    seen.add(cid)
    return [
      cid,
      ...this.blobs[cid]!.links.filter((l) => l.kind === 'contains').flatMap((l) => this.closure(l.cid, seen)),
    ]
  }

  private control(resource: string, principals: string[], full = false): string[] {
    const scope = this.scopes.find((s) => s.resource === resource)!
    if (full) return scope.control
    const ref = selected(this.world, resource)
    const wanted = new Set([...principals, ref?.author])
    const ids = new Set(this.world.grants.filter((g) => g.resource === resource && wanted.has(g.to)).map((g) => g.id))
    const visit = (id: string) => {
      const proof = this.world.grants.find((g) => g.id === id)?.proof
      if (proof && !ids.has(proof)) {
        ids.add(proof)
        visit(proof)
      }
    }
    Array.from(ids).forEach(visit)
    // Include revocation proofs as well as delegation ancestry, including inactive routes.
    for (const v of this.world.revocations.filter((v) => v.resource === resource && ids.has(v.target))) {
      ids.add(v.proof)
      visit(v.proof)
    }
    return scope.control.filter((cid) => {
      const b = this.blobs[cid]!
      return (
        b.kind === 'resource' ||
        (b.kind === 'grant' && ids.has(b.object!.id)) ||
        (b.kind === 'revocation' && this.world.revocations.some((v) => v.id === b.object!.id && ids.has(v.target)))
      )
    })
  }

  private store(peer: SyncPeer, cid: string) {
    const b = this.blobs[cid]
    if (!b) return
    upsert(peer.tables.blobs, {cid, kind: b.kind, bytes: b.bytes, verified: true}, ['cid'])
    b.links.forEach((l) =>
      upsert(peer.tables.edges, {parent: cid, child: l.cid, kind: l.kind}, ['parent', 'child', 'kind']),
    )
  }

  private complete(peer: SyncPeer, cid: string, seen = new Set<string>()): boolean {
    if (peer.tables.complete.some((r) => r.cid === cid && r.rules === 'containment-v1')) return true
    if (seen.has(cid) || !peer.tables.blobs.some((r) => r.cid === cid)) return false
    seen.add(cid)
    const links = this.blobs[cid]?.links.filter((l) => l.kind === 'contains') || []
    const complete = links.map((l) => this.complete(peer, l.cid, new Set(seen))).every(Boolean)
    if (complete) upsert(peer.tables.complete, {cid, rules: 'containment-v1'}, ['cid', 'rules'])
    return complete
  }

  /** Expose the selected frame and trace, including the graph catalog for the omniscient lab UI. */
  snapshot() {
    const frame = this.frames[this.cursor]!
    return {
      options: this.options,
      blobs: this.blobs,
      scopes: this.scopes,
      peers: frame.peers,
      event: frame.event,
      done: frame.done,
      cursor: this.cursor,
      length: this.frames.length,
      trace: this.frames.map((f) => f.event),
      transferred: frame.transferred,
      skipped: frame.skipped,
      schemas: syncSchemas,
    }
  }

  /** Inspect a previous frame without altering the editable playground world. */
  seek(index: number) {
    if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) throw Error('Unknown sync step.')
    this.cursor = index
  }

  /** Advance one local operation or one RPC request/response, checking the live fence first. */
  step(currentWorld: LabState) {
    if (this.cursor < this.frames.length - 1) {
      this.cursor++
      return
    }
    const prior = this.frames[this.cursor]!
    if (prior.done) return
    const frame = clone(prior)
    const task = frame.pending || frame.queue[0]
    if (!task) return
    const from = task.from
    const to = 1 - from
    const event: SyncEvent = {title: task.op, detail: '', kind: 'local', from, to, active: [], sql: []}
    frame.event = event
    const sql = (peer: number, statement: string, ...tables: (keyof PeerTables)[]) =>
      event.sql.push({peer, statement, tables})
    if (
      this.worldDigest(currentWorld) !== this.fingerprint ||
      !frame.peers.every((p) => currentWorld.devices[p.key]?.online)
    ) {
      const changed = this.worldDigest(currentWorld) !== this.fingerprint
      event.title = changed ? 'Scope invalidated' : 'Peer offline'
      event.detail = changed
        ? 'The world changed. Cached authority is invalid; no further heads or bytes are sent. Rebuild to refresh control. Retained bytes stay.'
        : 'Transport stopped. Retained blocks and outstanding frontier remain visible.'
      event.kind = 'blocked'
      frame.peers.forEach((p, i) => {
        p.tables.authority_cache = []
        sql(i, 'DELETE FROM authority_cache; -- invalidate live scope', 'authority_cache')
      })
      frame.done = true
    } else if (frame.pending) {
      frame.pending = null
      event.kind = 'response'
      event.from = to
      event.to = from
      event.method = task.op
      this.execute(frame, task, sql)
    } else {
      frame.queue.shift()
      if (task.op === 'walk' || task.op === 'Commit') this.execute(frame, task, sql)
      else {
        event.kind = 'request'
        event.method = task.op
        event.title = `${task.op} →`
        event.detail = 'Request in flight. No bytes or cache rows have changed yet.'
        event.payload = {
          method: task.op,
          ...(task.resource ? {resource: task.resource, revision: this.fingerprint} : {}),
          ...(task.cid ? {cid: task.cid, parent: task.parent || 'accepted head'} : {}),
        }
        event.active = task.cid ? [task.cid] : []
        frame.pending = task
      }
    }
    if (!frame.queue.length && !frame.pending) frame.done = true
    this.frames.push(frame)
    this.cursor++
  }

  private execute(
    frame: Frame,
    task: Task,
    sql: (peer: number, statement: string, ...tables: (keyof PeerTables)[]) => void,
  ) {
    const receiver = frame.peers[task.from]!
    const sender = frame.peers[1 - task.from]!
    const rt = receiver.tables
    const st = sender.tables
    const e = frame.event
    const scope = this.scopes.find((s) => s.resource === task.resource)
    const authorized = (resource: string) => [receiver, sender].every((p) => access(this.world, p.key, resource).read)
    const enqueue = (...tasks: Task[]) => frame.queue.unshift(...tasks)
    switch (task.op) {
      case 'Hello':
        e.title = 'Both principals authenticated'
        e.detail = 'Simulated identity handshake. Transport identity alone grants no resource access.'
        e.payload = {principals: frame.peers.map((p) => p.key), protocol: 'hm26-lab/1'}
        enqueue({op: 'GetControl', from: 1}, {op: 'GetControl', from: 0})
        break
      case 'GetControl': {
        const scopes = this.scopes.filter((s) => authorized(s.resource))
        const blocks = Array.from(
          new Set(scopes.flatMap((s) => this.control(s.resource, [receiver.key, sender.key]))),
        ).filter((cid) => st.blobs.some((r) => r.cid === cid))
        blocks.forEach((cid) => this.store(receiver, cid))
        e.title = scopes.length ? 'Control evidence refreshed' : 'No shared authorized resources'
        e.detail = scopes.length
          ? 'Only shared resource scopes and the participants’ and writers’ proof ancestry are exchanged; unrelated membership stays local.'
          : 'No content scopes can open between these principals. No private inventory is advertised.'
        e.active = blocks
        e.payload = {
          evidence: blocks.map((cid) => ({cid, block: JSON.parse(this.blobs[cid]!.data)})),
          revision: this.fingerprint,
        }
        sql(
          task.from,
          'INSERT OR IGNORE INTO blobs VALUES (:evidence);\nINSERT OR IGNORE INTO edges VALUES (:proof_edges);',
          'blobs',
          'edges',
        )
        // Both directions exchange control before any content scope opens.
        frame.queue.push(...scopes.map((s): Task => ({op: 'OpenScope', from: task.from, resource: s.resource})))
        break
      }
      case 'OpenScope':
        if (!scope || !authorized(scope.resource)) {
          e.kind = 'blocked'
          e.title = 'Scope denied'
          break
        }
        for (const [i, p] of Array.from(frame.peers.entries())) {
          upsert(
            p.tables.authority_cache,
            {principal: frame.peers[1 - i]!.key, resource: scope.resource, revision: this.fingerprint, can_read: true},
            ['principal', 'resource'],
          )
          sql(
            i,
            'INSERT OR REPLACE INTO authority_cache VALUES (:principal, :resource, :revision, 1);',
            'authority_cache',
          )
        }
        e.title = 'Resource scope opened'
        e.detail =
          'Read authority on this exact resource is cached at the current revision. No descendant ACLs are materialized.'
        e.active = this.control(
          scope.resource,
          frame.peers.map((p) => p.key),
        )
        e.payload = {resource: scope.resource, revision: this.fingerprint, allowed: true}
        enqueue({op: 'ReconcileHeads', from: task.from, resource: scope.resource})
        break
      case 'ReconcileHeads': {
        const head = st.resource_heads.find((r) => r.resource === task.resource)
        e.title = head ? 'Resource head advertised' : 'No local head to offer'
        e.detail =
          'Compare scoped resource records, not a union of blob inventories. Matching heads still require a completeness check. Set comparison stands in for RBSR here.'
        e.payload = {heads: head ? [head] : []}
        sql(1 - task.from, 'SELECT head FROM resource_heads WHERE resource = :resource;', 'resource_heads')
        if (head) {
          upsert(rt.resource_heads, {...head}, ['resource'])
          upsert(rt.frontier, {resource: task.resource!, cid: String(head.head), parent: ''}, ['resource', 'cid'])
          sql(
            task.from,
            "INSERT OR REPLACE INTO resource_heads VALUES (:resource, :head, :revision);\nINSERT OR IGNORE INTO frontier VALUES (:resource, :head, '');",
            'resource_heads',
            'frontier',
          )
          e.active = [String(head.head)]
          enqueue(
            {op: 'walk', from: task.from, resource: task.resource, cid: String(head.head)},
            {op: 'Commit', from: task.from, resource: task.resource, cid: String(head.head)},
          )
        }
        break
      }
      case 'walk': {
        const complete = rt.complete.some((r) => r.cid === task.cid && r.rules === 'containment-v1')
        sql(task.from, "SELECT 1 FROM complete WHERE cid = :cid AND rules = 'containment-v1';", 'complete')
        e.active = [task.cid!]
        if (complete && this.options.privacy === 'deduplicate') {
          frame.skipped++
          rt.frontier = rt.frontier.filter((r) => r.cid !== task.cid || r.resource !== task.resource)
          sql(task.from, 'DELETE FROM frontier WHERE resource = :resource AND cid = :cid;', 'frontier')
          e.title = 'Complete subtree skipped'
          e.detail =
            'One local completeness lookup skips this entire sub-DAG. The absence of requests can reveal possession, but never the resource it came from.'
        } else if (rt.blobs.some((r) => r.cid === task.cid) && this.options.privacy === 'deduplicate') {
          e.title = 'Block present · descendants incomplete'
          e.detail = 'Having the root does not mean having its descendants. Resume from its containment edges.'
          this.expand(frame, task, sql)
        } else {
          e.title = this.options.privacy === 'scoped' ? 'Uniform scoped traversal' : 'Missing block queued'
          e.detail =
            this.options.privacy === 'scoped'
              ? 'Fetch the complete offered closure even if bytes are local. This run reveals no cross-resource completeness shortcut; disk storage still deduplicates.'
              : 'Fetch only through this resource and an admitted parent edge. There is no global HAS endpoint.'
          enqueue({...task, op: 'FetchBlock'})
        }
        break
      }
      case 'FetchBlock': {
        const cid = task.cid!
        const b = this.blobs[cid]
        const parent = task.parent ? this.blobs[task.parent] : undefined
        // A root is explicitly admitted by selection. Every other block must follow an offered
        // parent in this session's frontier; arbitrary CID references never expand that scope.
        const admitted =
          !!scope &&
          (scope.root === cid || !!parent?.links.some((l) => l.cid === cid && l.kind === 'contains')) &&
          rt.frontier.some((r) => r.resource === task.resource && r.cid === cid && r.parent === (task.parent || ''))
        if (!b || !admitted || !authorized(task.resource!) || !st.blobs.some((r) => r.cid === cid)) {
          e.title = 'Block unavailable in this scope'
          e.detail =
            'Missing, unadmitted and inaccessible blocks use the same response. The unresolved frontier remains; no complete marker or receipt is written.'
          e.payload = {status: 'UNAVAILABLE'}
          e.kind = 'blocked'
          e.active = [cid]
          break
        }
        if (digest(b.data) !== cid) throw Error('Simulated block hash mismatch.')
        this.store(receiver, cid)
        frame.transferred += b.bytes
        e.title = 'Block verified and stored'
        e.detail =
          'Hash verified; immutable bytes and typed edges are stored once. Only containment edges extend this resource’s frontier.'
        e.payload = {cid, bytes: b.bytes, block: JSON.parse(b.data)}
        e.active = [cid]
        sql(1 - task.from, 'SELECT * FROM blobs WHERE cid = :admitted_cid; -- after live authority fence', 'blobs')
        sql(
          task.from,
          'INSERT OR IGNORE INTO blobs VALUES (:cid, :kind, :bytes, 1);\nINSERT OR IGNORE INTO edges VALUES (:typed_edges);',
          'blobs',
          'edges',
        )
        this.expand(frame, task, sql)
        break
      }
      case 'Commit': {
        const complete = this.complete(receiver, task.cid!)
        e.active = [task.cid!]
        sql(
          task.from,
          'WITH RECURSIVE closure AS (...) SELECT missing FROM closure;\n-- Mark complete bottom-up only when every containment dependency is present.',
          'blobs',
          'edges',
          'complete',
        )
        e.title = complete ? 'Closure committed' : 'Replication incomplete'
        e.detail = complete
          ? 'Bottom-up completeness is cached under fixed traversal rules. Closures are pinned for this experiment; acknowledgement comes after this local transaction.'
          : 'Matching heads did not finish the download. Missing or rejected dependencies remain in frontier, with no acknowledgement.'
        if (complete) {
          rt.frontier = rt.frontier.filter((r) => r.resource !== task.resource)
          sql(task.from, 'DELETE FROM frontier WHERE resource = :resource;\nCOMMIT;', 'frontier')
          enqueue({...task, op: 'Ack'})
        } else e.kind = 'blocked'
        break
      }
      case 'Ack':
        upsert(st.receipts, {resource: task.resource!, head: task.cid!, revision: this.fingerprint}, [
          'resource',
          'head',
        ])
        e.title = 'Committed receipt recorded'
        e.detail =
          'The serving peer records acknowledgement only after the receiving peer committed a complete closure.'
        e.payload = {status: 'INDEXED', resource: task.resource, head: task.cid}
        e.active = [task.cid!]
        sql(1 - task.from, 'INSERT OR REPLACE INTO receipts VALUES (:resource, :head, :revision);', 'receipts')
        break
    }
  }

  private expand(
    frame: Frame,
    task: Task,
    sql: (peer: number, statement: string, ...tables: (keyof PeerTables)[]) => void,
  ) {
    const tables = frame.peers[task.from]!.tables
    const children = this.blobs[task.cid!]?.links.filter((l) => l.kind === 'contains') || []
    tables.frontier = tables.frontier.filter((r) => r.cid !== task.cid || r.resource !== task.resource)
    const tasks: Task[] = []
    for (const {cid} of children) {
      if (tables.frontier.some((r) => r.resource === task.resource && r.cid === cid)) continue
      upsert(tables.frontier, {resource: task.resource!, cid, parent: task.cid!}, ['resource', 'cid'])
      tasks.push({...task, op: 'walk', cid, parent: task.cid})
    }
    frame.queue.unshift(...tasks)
    sql(
      task.from,
      'DELETE FROM frontier WHERE resource = :resource AND cid = :parent;\nINSERT OR IGNORE INTO frontier VALUES (:resource, :child, :parent);',
      'frontier',
    )
  }
}
