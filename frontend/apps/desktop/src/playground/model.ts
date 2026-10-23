/**
 * The HM26 playground model: an educational evaluator of the tentative HM26 authority and sync
 * policy. Keys, CIDs, signatures and peers are simulated; nothing here touches the daemon or a real
 * capability. The rules it implements are documented in hypermedia/protocol/hm26-authority.md.
 */

export type Role = 'reader' | 'writer' | 'admin'

export const roles: Readonly<Record<Role, number>> = Object.freeze({reader: 1, writer: 2, admin: 3})

export function isRole(value: unknown): value is Role {
  return value === 'reader' || value === 'writer' || value === 'admin'
}

/** Node variant names from the published HM26 draft. */
export const nodeKinds = ['snapshot', 'changes', 'changes-snapshot', 'tombstone', 'redirect', 'republish'] as const
export type NodeKind = (typeof nodeKinds)[number]

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === 'string' && (nodeKinds as readonly string[]).includes(value)
}

export type LabKey = {id: string; name: string; note: string}

export type LabResource = {
  id: string
  name: string
  cid: string
  parent: string | null
  public: boolean
  owner: string
  segment: string
}

export type LabGrant = {
  id: string
  from: string
  to: string
  resource: string
  role: Role
  proof: string | null
  revoked?: boolean
  reissuedFrom?: string
}

export type LabStatement = {
  id: string
  resource: string
  author: string
  seq: number
  kind: NodeKind
  text?: string
  state?: unknown
  prev?: string
  target?: string
  heads?: string[]
  apply?: string
  snapshot?: unknown
}

export type LabChange = {id: string; resource: string; author: string; deps: string[]; ops: unknown[]}

export type LabRevocation = {id: string; target: string; author: string; resource: string; proof: string}

export type LabDevice = {
  online: boolean
  follow: boolean
  cache: Record<string, LabStatement>
  knownRevision: number
}

export type LabOffer = {id: string; version: string; resource: string; author: string; status: string}

export type LabState = {
  revision: number
  serial: number
  keys: LabKey[]
  resources: LabResource[]
  grants: LabGrant[]
  statements: LabStatement[]
  devices: Record<string, LabDevice>
  outbox: LabOffer[]
  events: unknown[]
  changes: LabChange[]
  revocations: LabRevocation[]
}

export type Access = {
  read: boolean
  write: boolean
  admin: boolean
  level: number
  grants: LabGrant[]
  public: boolean
}

export type SyncStep = {title: string; detail: string; kind?: 'warn' | 'deny'}

export type Rendition = {
  status: 'missing' | 'tombstone' | 'redirect' | 'unsupported' | 'invalid' | 'snapshot'
  text: string
}

/** The host principal every sync goes through. It is fixed by name in the fixture. */
export const HOST_KEY = 'host'

export function newDevice(follow = true): LabDevice {
  return {online: true, follow, cache: {}, knownRevision: 0}
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function initialState(): LabState {
  const s: LabState = {
    revision: 1,
    serial: 8,
    keys: [
      {id: 'alice', name: 'Alice', note: 'Root / recovery key'},
      {id: 'bob', name: 'Bob', note: 'Reader · laptop'},
      {id: 'carol', name: 'Carol', note: 'Writer · workstation'},
      {id: HOST_KEY, name: 'Atlas host', note: 'Service custody principal'},
      {id: 'bot', name: 'Copy bot', note: 'Automation key'},
    ],
    resources: [
      {id: 'lab', name: 'Research lab', cid: 'bafy…a001', parent: null, public: false, owner: 'alice', segment: 'lab'},
      {
        id: 'notes',
        name: 'Field notes',
        cid: 'bafy…b002',
        parent: 'lab',
        public: false,
        owner: 'alice',
        segment: 'notes',
      },
      {
        id: 'public',
        name: 'Public dispatch',
        cid: 'bafy…c003',
        parent: null,
        public: true,
        owner: 'alice',
        segment: 'dispatch',
      },
    ],
    grants: [
      {id: 'g1', from: 'alice', to: 'alice', resource: 'lab', role: 'admin', proof: null},
      {id: 'g2', from: 'alice', to: 'alice', resource: 'notes', role: 'admin', proof: null},
      {id: 'g3', from: 'alice', to: 'alice', resource: 'public', role: 'admin', proof: null},
      {id: 'g4', from: 'alice', to: 'bob', resource: 'lab', role: 'reader', proof: 'g1'},
      {id: 'g5', from: 'alice', to: 'carol', resource: 'lab', role: 'writer', proof: 'g1'},
      {id: 'g6', from: 'alice', to: HOST_KEY, resource: 'lab', role: 'reader', proof: 'g1'},
      {id: 'g7', from: 'alice', to: HOST_KEY, resource: 'public', role: 'reader', proof: 'g3'},
    ],
    statements: [
      {id: 'v1', resource: 'lab', author: 'alice', seq: 1, text: 'Initial research plan', kind: 'snapshot'},
      {id: 'v2', resource: 'lab', author: 'carol', seq: 2, text: 'Carol’s field observations', kind: 'snapshot'},
      {id: 'v3', resource: 'notes', author: 'alice', seq: 1, text: 'Private field notebook', kind: 'snapshot'},
      {id: 'v4', resource: 'public', author: 'alice', seq: 1, text: 'Hello, public world', kind: 'snapshot'},
    ],
    devices: {
      bob: newDevice(),
      carol: newDevice(),
      alice: newDevice(),
      [HOST_KEY]: newDevice(),
      bot: newDevice(),
    },
    outbox: [],
    events: [],
    changes: [],
    revocations: [],
  }
  return normalizeState(s)
}

export function findKey(s: LabState, id: string): LabKey | undefined {
  return s.keys.find((k) => k.id === id)
}

export function findResource(s: LabState, id: string): LabResource | undefined {
  return s.resources.find((r) => r.id === id)
}

export function findGrant(s: LabState, id: string | null | undefined): LabGrant | undefined {
  return id ? s.grants.find((g) => g.id === id) : undefined
}

/** A grant is revoked when it carries the fixture flag or a valid exact revocation targets it. */
export function isRevoked(s: LabState, grantId: string): boolean {
  const g = findGrant(s, grantId)
  if (!g) return false
  return !!g.revoked || s.revocations.some((v) => v.target === grantId && validRevocation(s, v))
}

export function validGrant(s: LabState, g: LabGrant | undefined, seen: Set<string> = new Set()): boolean {
  if (!g || !isRole(g.role) || seen.has(g.id) || !findKey(s, g.from) || !findKey(s, g.to)) return false
  if (g.role !== 'admin' && isRevoked(s, g.id)) return false
  if (g.from === findResource(s, g.resource)?.owner && g.to === g.from && g.role === 'admin' && !g.proof) return true
  const p = findGrant(s, g.proof)
  seen.add(g.id)
  return !!p && p.role === 'admin' && p.to === g.from && p.resource === g.resource && validGrant(s, p, seen)
}

export function routes(s: LabState, key: string, resource: string): LabGrant[] {
  return s.grants.filter((g) => g.to === key && g.resource === resource && validGrant(s, g))
}

export function access(s: LabState, key: string, resource: string): Access {
  const gs = routes(s, key, resource)
  const level = Math.max(0, ...gs.map((g) => roles[g.role]))
  const r = findResource(s, resource)
  const pub = !!r?.public
  const exists = !!r
  return {
    read: exists && (pub || level >= 1),
    write: exists && level >= 2,
    admin: exists && level >= 3,
    level,
    grants: gs,
    public: pub,
  }
}

/**
 * The selected statement is the highest sequence whose author currently holds writer authority.
 * A statement that cannot be evaluated (see statementProblems) is never selected.
 */
export function selected(s: LabState, resource: string): LabStatement | undefined {
  return s.statements
    .filter((v) => v.resource === resource && !statementProblems(s, v).length && access(s, v.author, resource).write)
    .sort((a, b) => b.seq - a.seq)[0]
}

export function issue(s: LabState, actor: string, to: string, resource: string, role: Role): LabGrant {
  if (!isRole(role) || !findKey(s, to)) throw Error('Choose a valid key and role.')
  const p = routes(s, actor, resource).find((g) => g.role === 'admin')
  if (!p) throw Error('Denied: only an admin of this exact resource may issue grants.')
  const g: LabGrant = {id: `g${s.serial++}`, from: actor, to, resource, role, proof: p.id}
  s.grants.push(g)
  s.revision++
  return g
}

export function revoke(s: LabState, actor: string, id: string): LabGrant {
  const g = findGrant(s, id)
  if (!g) throw Error('Unknown grant')
  if (g.role === 'admin') throw Error('Denied: admin grants and their admin ancestry are permanent.')
  if (!access(s, actor, g.resource).admin) throw Error('Denied: an admin of the same scope must revoke.')
  if (g.revoked) throw Error('Already revoked')
  const proof = routes(s, actor, g.resource).find((p) => p.role === 'admin')
  if (!proof) throw Error('Denied: an admin of the same scope must revoke.')
  s.revocations.push({id: `rev${s.serial++}`, target: g.id, author: actor, resource: g.resource, proof: proof.id})
  s.revision++
  return g
}

export function publish(s: LabState, actor: string, resource: string, text: string): LabStatement {
  if (!access(s, actor, resource).write) throw Error('Denied: writer authority is required.')
  const v: LabStatement = {
    id: `v${s.serial++}`,
    resource,
    author: actor,
    seq: Math.max(0, ...s.statements.map((v) => v.seq)) + 1,
    text,
    kind: 'snapshot',
    state: text,
  }
  s.statements.push(v)
  s.outbox.push({id: `offer-${s.serial++}`, version: v.id, resource, author: actor, status: 'queued'})
  return v
}

/** Deliver an author's queued offers. Only INDEXED is a durable simulated post-commit receipt. */
export function deliver(s: LabState, author: string): LabOffer[] {
  const jobs = s.outbox.filter((j) => j.author === author && j.status !== 'INDEXED')
  for (const j of jobs) {
    j.status = !s.devices[author]?.online
      ? 'WAITING · author offline'
      : !access(s, author, j.resource).write
        ? 'REJECTED · writer authority lost'
        : !access(s, HOST_KEY, j.resource).read
          ? 'WAITING · host lacks custody'
          : 'INDEXED'
  }
  return jobs
}

export function syncSteps(s: LabState, key: string, resource: string): SyncStep[] {
  const d = s.devices[key]
  const a = access(s, key, resource)
  const h = access(s, HOST_KEY, resource)
  const v = selected(s, resource)
  if (!d || !d.online)
    return [
      {
        title: 'OFFLINE · no network request',
        detail: 'Retained local bytes remain available. Authority freshness is stale; no fresh read is claimed.',
        kind: 'warn',
      },
    ]
  if (!a.read)
    return [
      {title: 'Authenticate', detail: `Bind connection to ${key}; peer ID is not reader authority.`},
      {
        title: 'GetControl · own evidence',
        detail: 'Fetch personal grant/revocation proof only. No private head or full roster disclosed.',
      },
      {
        title: 'ACCESS_DENIED',
        detail: 'No valid read route on this exact resource. Following and knowing its CID cannot grant access.',
        kind: 'deny',
      },
    ]
  if (!h.read)
    return [
      {
        title: 'Custody check failed',
        detail: 'Atlas has no reader authority. Stop before disclosing private fingerprints or manifest IDs.',
        kind: 'deny',
      },
    ]
  return [
    {
      title: 'Authenticate both principals',
      detail: `Prove ${key} and Atlas independently; simulated signatures, not a real handshake.`,
    },
    {
      title: 'GetControl',
      detail: `Verify trusted root, permanent admin proof and current grant/revocation union. Authority revision ${s.revision}.`,
    },
    {
      title: 'OpenScope',
      detail: `Create filtered frozen view for this exact resource; bind to live authority revision ${s.revision}.`,
    },
    {
      title: 'ReconcileBlobs',
      detail: 'Compare only authorized sets. A child, hyperlink or known private CID does not expand this set.',
    },
    {
      title: 'FetchBlobs',
      detail: `Fetch ${v?.id || 'missing Ref'}, authorized dependencies for the ${
        v?.kind || 'snapshot'
      } variant. Check hash, signature and association origin. Rendition: ${rendition(s, resource).status}.`,
    },
    {
      title: 'Verify + commit',
      detail:
        'Commit verified facts before acknowledging. Authoritative snapshots redeclare full state; utility snapshots never replace DAG truth. Missing or unsupported materialization stays explicit.',
    },
    {
      title: 'WatchScope',
      detail: 'Persist cursor. Live access fences recheck every transfer; a stale view is not an access lease.',
    },
  ]
}

export function completeSync(s: LabState, key: string, resource: string): boolean {
  const d = s.devices[key]
  if (!d || !d.online || !access(s, key, resource).read || !access(s, HOST_KEY, resource).read) return false
  const v = selected(s, resource)
  if (v) d.cache[resource] = clone(v)
  d.knownRevision = s.revision
  return true
}

/** Upgrade the initial fixture and older saved experiments to the current model. */
export function normalizeState(s: LabState): LabState {
  s.changes ??= []
  s.revocations ??= []
  s.outbox ??= []
  s.events ??= []
  for (const r of s.resources) {
    r.owner ??= 'alice'
    r.segment ??= ({lab: 'lab', notes: 'notes', public: 'dispatch'} as Record<string, string>)[r.id] || ''
  }
  for (const v of s.statements) {
    v.kind ??= 'snapshot'
    if (v.kind === 'snapshot' && !('state' in v)) v.state = v.text ?? ''
  }
  return s
}

/** Check an exact revocation against a permanent, same-scope admin proof. */
export function validRevocation(s: LabState, v: LabRevocation): boolean {
  const g = findGrant(s, v.target)
  const p = findGrant(s, v.proof)
  return (
    !!g &&
    g.role !== 'admin' &&
    v.resource === g.resource &&
    !!p &&
    p.role === 'admin' &&
    p.to === v.author &&
    p.resource === g.resource &&
    validGrant(s, p)
  )
}

/** Resolve an optional placement path independently of resource authority. */
export function pathFor(s: LabState, id: string, seen: Set<string> = new Set()): string {
  const r = findResource(s, id)
  if (!r) return '(missing resource)'
  if (seen.has(id)) return '(placement cycle)'
  seen.add(id)
  const prefix = r.parent ? pathFor(s, r.parent, seen) : ''
  return prefix + '/' + (r.segment ? encodeURIComponent(r.segment) : '[' + r.id + ']')
}

/**
 * Why a resource's placement does not resolve: the lab's unique-sibling name convention, acyclic
 * placement, and one owner per tree. Empty when the placement is fine. The resource is stored
 * either way; these are shown next to it.
 */
export function placementProblems(s: LabState, r: LabResource): string[] {
  const out: string[] = []
  if (!findKey(s, r.owner)) out.push(`The owner key "${r.owner}" does not exist.`)
  if (r.segment && (r.segment.includes('/') || r.segment === '.' || r.segment === '..'))
    out.push('A path name is one segment: no slash, dot or dot-dot.')
  if (
    r.segment &&
    s.resources.some((x) => x.id !== r.id && x.owner === r.owner && x.parent === r.parent && x.segment === r.segment)
  )
    out.push(`Another resource beside this one is already named "${r.segment}".`)
  const seen = new Set([r.id])
  let p = r.parent
  while (p) {
    if (seen.has(p)) {
      out.push('The placement loops: this resource is inside itself.')
      break
    }
    seen.add(p)
    const x = findResource(s, p)
    if (!x) {
      out.push(`The parent "${p}" does not exist.`)
      break
    }
    if (x.owner !== r.owner) {
      out.push(
        `The parent "${x.name}" is owned by ${
          findKey(s, x.owner)?.name || x.owner
        }, a different key. HM26 does not say how a path crosses from one owner's tree into another's, so this placement cannot be resolved.`,
      )
      break
    }
    p = x.parent
  }
  return out
}

/** Why a grant is not a valid route. Empty for a valid or a merely revoked grant. */
export function grantProblems(s: LabState, g: LabGrant): string[] {
  const out: string[] = []
  if (!isRole(g.role)) out.push(`"${g.role}" is not a role. Use reader, writer or admin.`)
  if (!findKey(s, g.from)) out.push(`The issuer "${g.from}" does not exist.`)
  if (!findKey(s, g.to)) out.push(`The recipient "${g.to}" does not exist.`)
  const r = findResource(s, g.resource)
  if (!r) out.push(`The resource "${g.resource}" does not exist.`)
  if (g.from === r?.owner && g.to === g.from && g.role === 'admin' && !g.proof) return out
  if (!g.proof) {
    out.push(
      'No proof. Every grant names the admin grant its issuer holds on this resource. Only the owner granting admin to itself goes without one.',
    )
    return out
  }
  const p = findGrant(s, g.proof)
  if (!p) out.push(`The proof "${g.proof}" does not exist.`)
  else {
    if (p.role !== 'admin') out.push(`The proof ${p.id} is a ${p.role} grant. Only admin grants can issue.`)
    if (p.to !== g.from) out.push(`The proof ${p.id} is held by ${findKey(s, p.to)?.name || p.to}, not by the issuer.`)
    if (p.resource !== g.resource) out.push(`The proof ${p.id} covers another resource. Scope is exact.`)
    if (p.id === g.id || chainReaches(s, p, g.id)) out.push('The proof chain loops back to this grant.')
    else if (!validGrant(s, p)) out.push(`The proof ${p.id} is itself not valid.`)
  }
  return out
}

function chainReaches(s: LabState, from: LabGrant, id: string, seen: Set<string> = new Set()): boolean {
  if (seen.has(from.id)) return false
  seen.add(from.id)
  const p = findGrant(s, from.proof)
  if (!p) return false
  if (p.id === id) return true
  return chainReaches(s, p, id, seen)
}

/** Why a revocation does not count. Empty when it is valid. */
export function revocationProblems(s: LabState, v: LabRevocation): string[] {
  const out: string[] = []
  if (!findKey(s, v.author)) out.push(`The author "${v.author}" does not exist.`)
  const g = findGrant(s, v.target)
  if (!g) out.push(`The target grant "${v.target}" does not exist.`)
  else {
    if (g.role === 'admin') out.push('The target is an admin grant. Admin grants are permanent.')
    if (v.resource !== g.resource) out.push('The revocation names a different resource than the grant it targets.')
  }
  const p = findGrant(s, v.proof)
  if (!p)
    out.push(
      v.proof
        ? `The proof "${v.proof}" does not exist.`
        : 'No proof. Name an admin grant the author holds on this resource.',
    )
  else {
    if (p.role !== 'admin') out.push(`The proof ${p.id} is a ${p.role} grant. Only an admin can revoke.`)
    if (p.to !== v.author)
      out.push(`The proof ${p.id} is held by ${findKey(s, p.to)?.name || p.to}, not by the author.`)
    if (g && p.resource !== g.resource) out.push(`The proof ${p.id} covers another resource. Scope is exact.`)
    if (!validGrant(s, p)) out.push(`The proof ${p.id} is itself not valid.`)
  }
  return out
}

/**
 * Why a statement cannot be evaluated. Being outranked or unauthorized is not a problem here, and
 * neither is a change head that has not arrived: the rendition reports that as missing.
 */
export function statementProblems(s: LabState, v: LabStatement): string[] {
  const out = nodeProblems(v)
  if (!findKey(s, v.author)) out.push(`The author "${v.author}" does not exist.`)
  if (!findResource(s, v.resource)) out.push(`The resource "${v.resource}" does not exist.`)
  if (v.prev && !s.statements.some((x) => x.id === v.prev)) out.push(`The previous Ref "${v.prev}" does not exist.`)
  if (v.kind === 'redirect' && v.target && !findResource(s, v.target))
    out.push(`The redirect target "${v.target}" does not exist.`)
  return out
}

/** Why a change blob cannot be evaluated. */
export function changeProblems(s: LabState, c: LabChange): string[] {
  const out: string[] = []
  if (!findKey(s, c.author)) out.push(`The author "${c.author}" does not exist.`)
  if (!findResource(s, c.resource)) out.push(`The resource "${c.resource}" does not exist.`)
  for (const d of c.deps) if (!s.changes.some((x) => x.id === d)) out.push(`The dependency "${d}" does not exist.`)
  return out
}

/** Every record with problems, by id. Records that evaluate cleanly are not listed. */
export function allProblems(s: LabState): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const put = (id: string, problems: string[]) => {
    if (problems.length) out[id] = problems
  }
  for (const r of s.resources) put(r.id, placementProblems(s, r))
  for (const g of s.grants) put(g.id, grantProblems(s, g))
  for (const v of s.revocations) put(v.id, revocationProblems(s, v))
  for (const v of s.statements) put(v.id, statementProblems(s, v))
  for (const c of s.changes) put(c.id, changeProblems(s, c))
  return out
}

/** Summarize a selected blob without inventing native tombstone/redirect resolution rules. */
export function rendition(s: LabState, id: string): Rendition {
  const v = selected(s, id)
  if (!v) return {status: 'missing', text: 'No authorized Ref.'}
  if (v.kind === 'tombstone')
    return {
      status: 'tombstone',
      text: 'Tombstone selected. No live rendition in this lab; retained history is not erased.',
    }
  if (v.kind === 'redirect')
    return {
      status: 'redirect',
      text:
        'Redirect → ' +
        (findResource(s, v.target || '')?.name || v.target) +
        '. Target access is checked independently; no inherited read rights.',
    }
  if (v.kind === 'republish')
    return {
      status: 'unsupported',
      text: 'Republish is a schema placeholder. Payload and resolution remain unspecified.',
    }
  if (v.kind === 'changes' || v.kind === 'changes-snapshot') {
    const seen = new Set<string>()
    let missing = false
    let cycle = false
    const walk = (cid: string, stack: Set<string> = new Set()) => {
      if (stack.has(cid)) {
        cycle = true
        return
      }
      if (seen.has(cid)) return
      const c = s.changes.find((c) => c.id === cid)
      if (!c) {
        missing = true
        return
      }
      seen.add(cid)
      for (const d of c.deps) walk(d, new Set(stack).add(cid))
    }
    for (const h of v.heads || []) walk(h)
    return {
      status: cycle ? 'invalid' : missing ? 'missing' : 'unsupported',
      text: cycle
        ? 'Change DAG contains a cycle.'
        : missing
          ? 'Missing a named change dependency. State remains incomplete.'
          : 'Change DAG present. Apply runtime is unspecified; utility snapshots are not promoted to authoritative state.',
    }
  }
  return {status: 'snapshot', text: typeof v.state === 'string' ? v.state : JSON.stringify(v.state)}
}

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const str = (x: unknown): x is string => typeof x === 'string' && x.length <= 20000

/** Validate an untrusted experiment (an import or a saved file) before installing it. */
export function validateState(raw: unknown): LabState {
  if (!isRecord(raw)) throw Error('The data does not contain a lab state.')
  const s = clone(raw) as unknown as LabState
  const ids = new Set<string>()
  const required = ['keys', 'resources', 'grants', 'statements', 'changes', 'revocations', 'outbox'] as const
  normalizeStateShape(s)
  for (const group of required) {
    const list = s[group] as unknown
    if (!Array.isArray(list) || list.length > 300) throw Error('Invalid or oversized ' + group + ' collection.')
    for (const x of list) {
      if (!isRecord(x) || typeof x.id !== 'string' || !/^[-\w]+$/.test(x.id) || ids.has(x.id))
        throw Error('Every object needs a unique safe ID.')
      ids.add(x.id)
    }
  }
  if (!s.keys.length || !s.resources.length) throw Error('Keep at least one key and resource in the lab.')
  const has = (group: 'keys' | 'resources' | 'grants', id: unknown) =>
    typeof id === 'string' && (s[group] as {id: string}[]).some((x) => x.id === id)
  if (!isRecord(s.devices)) throw Error('Invalid device state.')
  for (const k of s.keys) {
    if (!str(k.name) || !str(k.note ?? '')) throw Error('Invalid principal.')
    const d: unknown = s.devices[k.id]
    if (
      !isRecord(d) ||
      typeof d.online !== 'boolean' ||
      typeof d.follow !== 'boolean' ||
      !isRecord(d.cache) ||
      !Number.isSafeInteger(d.knownRevision ?? 0)
    )
      throw Error('Invalid device state.')
    for (const v of Object.values(d.cache)) {
      if (!isRecord(v) || !str(v.id) || !str(v.resource) || !str(v.author) || (v.text != null && !str(v.text)))
        throw Error('Invalid retained cache.')
    }
  }
  const cids = new Set<string>()
  for (const r of s.resources) {
    if (cids.has(r.cid)) throw Error('Each resource needs a unique original node CID.')
    cids.add(r.cid)
    if (!str(r.name) || !str(r.cid) || !str(r.segment) || typeof r.public !== 'boolean')
      throw Error('Invalid resource.')
    if (r.parent !== null && !str(r.parent)) throw Error('Invalid resource.')
    if (!str(r.owner)) throw Error('Invalid resource.')
  }
  for (const g of s.grants) {
    if (
      !str(g.from) ||
      !str(g.to) ||
      !str(g.resource) ||
      !str(g.role) ||
      (g.proof !== null && !str(g.proof)) ||
      (g.revoked != null && typeof g.revoked !== 'boolean') ||
      (g.reissuedFrom != null && !str(g.reissuedFrom))
    )
      throw Error('Invalid capability references.')
  }
  for (const v of s.statements) {
    if (!str(v.author) || !str(v.resource) || !Number.isSafeInteger(v.seq) || !str(v.kind)) throw Error('Invalid Ref.')
  }
  for (const c of s.changes) {
    if (!str(c.author) || !str(c.resource) || !Array.isArray(c.deps) || !c.deps.every(str) || !Array.isArray(c.ops))
      throw Error('Invalid change blob.')
  }
  for (const v of s.revocations) {
    if (!str(v.author) || !str(v.resource) || !str(v.target) || !str(v.proof)) throw Error('Invalid revocation blob.')
  }
  for (const j of s.outbox) {
    if (!has('keys', j.author) || !has('resources', j.resource) || !str(j.version) || !str(j.status))
      throw Error('Invalid outbox job.')
  }
  if (!Number.isSafeInteger(s.revision) || s.revision < 1 || !Number.isSafeInteger(s.serial) || s.serial < 1)
    throw Error('Invalid revision or serial.')
  if (!Array.isArray(s.events)) s.events = []
  return s
}

function normalizeStateShape(s: LabState): void {
  for (const k of ['changes', 'revocations', 'outbox'] as const) s[k] ??= []
  if (!Array.isArray(s.keys) || !Array.isArray(s.resources) || !Array.isArray(s.statements))
    throw Error('Malformed lab collections.')
  normalizeState(s)
}

/** What is wrong with the modeled fields of a node variant. Empty when the shape is right. */
export function nodeProblems(v: Partial<LabStatement>): string[] {
  const out: string[] = []
  if (!isNodeKind(v.kind)) return [`"${v.kind}" is not a Ref kind.`]
  if (v.kind === 'changes' || v.kind === 'changes-snapshot') {
    if (!Array.isArray(v.heads) || !v.heads.length || !v.heads.every((h) => typeof h === 'string'))
      out.push('A changes Ref needs at least one head.')
    if (typeof v.apply !== 'string' || !v.apply) out.push('A changes Ref needs an exact apply identifier.')
    if (v.prev) out.push('A changes Ref does not take prev.')
  }
  if (v.kind === 'snapshot' && !('state' in v)) out.push('A snapshot Ref needs state.')
  if (v.kind === 'changes-snapshot' && !('snapshot' in v)) out.push('A changes-snapshot Ref needs a utility snapshot.')
  if (v.kind === 'redirect' && (typeof v.target !== 'string' || !v.target))
    out.push('A redirect Ref needs a target resource.')
  if (v.kind === 'republish' && (v.prev || v.target || v.heads || 'state' in v || 'snapshot' in v))
    out.push('Republish has no payload and no prev.')
  return out
}

/**
 * Reissue a capability as a new immutable record; the original is never changed or revoked. The
 * new grant is stored even when its references do not resolve; the derived view reports why.
 */
export function reissueCapability(s: LabState, id: string, fields: Partial<LabGrant>): LabGrant {
  const old = findGrant(s, id)
  if (!old) throw Error('Capability not found.')
  const data = {...old, ...fields}
  const g: LabGrant = {
    id: `g${s.serial++}`,
    from: data.from,
    to: data.to,
    resource: data.resource,
    role: data.role,
    proof: data.proof ?? null,
    reissuedFrom: old.id,
  }
  s.grants.push(g)
  return g
}

/** Make sure a resource has its owner's self-admin root anchor. */
export function addRootAnchor(s: LabState, r: LabResource): void {
  if (
    !s.grants.some(
      (g) => g.resource === r.id && g.from === r.owner && g.to === r.owner && g.role === 'admin' && !g.proof,
    )
  )
    s.grants.push({id: `g${s.serial++}`, resource: r.id, from: r.owner, to: r.owner, role: 'admin', proof: null})
}
