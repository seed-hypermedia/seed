/**
 * One playground session: the simulated world, its undo history, the loaded use case and the sync
 * run, with every change applied through `dispatch`. It is the state behind `/api/playground`.
 */
import {DerivedView, deriveView} from './derive'
import {SyncLab, SyncOptions} from './sync-lab'
import {
  HOST_KEY,
  LabChange,
  LabGrant,
  LabResource,
  LabRevocation,
  LabState,
  LabStatement,
  NodeKind,
  Role,
  SyncStep,
  access,
  addRootAnchor,
  allProblems,
  clone,
  completeSync,
  deliver,
  findGrant,
  findResource,
  initialState,
  isNodeKind,
  isRole,
  issue,
  newDevice,
  nodeKinds,
  normalizeState,
  publish,
  reissueCapability,
  revoke,
  roles,
  routes,
  selected,
  syncSteps,
  validateState,
} from './model'

export class PlaygroundError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export type PlaygroundStorage = {
  load(): string | null
  save(text: string): void
}

/** Which use case the world was loaded from, and whether it has been changed since. */
export type PresetView = {id: string | null; modified: boolean}

export type SyncRun = {
  key: string
  resource: string
  revision: number
  steps: SyncStep[]
  index: number
  rows: SyncStep[]
  done: boolean
}

export type ScenarioView = {id: string; title: string; description: string}

export type Selection = {type: string; id: string}

/** A hint for the client about what to select after an action. The server keeps no UI state. */
export type UiHint = {select?: Selection}

export type Snapshot = {
  state: LabState
  derived: DerivedView
  preset: PresetView
  sync: {run: SyncRun | null}
  syncLab: ReturnType<SyncLab['snapshot']> | null
  history: {canUndo: boolean; canRedo: boolean}
  scenarios: ScenarioView[]
  meta: {version: 1; nodeKinds: readonly NodeKind[]; roles: Record<Role, number>; hostKey: string}
}

export type DispatchResult = {snapshot: Snapshot; message?: string; ui?: UiHint}

type Scenario = ScenarioView & {load: (session: PlaygroundSession) => {message: string; ui?: UiHint}}

const UNDO_LIMIT = 50
const SAVE_VERSION = 1

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name]
  if (typeof value !== 'string' || !value) throw new PlaygroundError(`Missing "${name}".`)
  return value
}

function optionalField(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name]
  if (value == null || value === '') return undefined
  if (typeof value !== 'string') throw new PlaygroundError(`"${name}" must be a string.`)
  return value
}

function stringList(value: unknown, name: string): string[] {
  if (value == null) return []
  if (typeof value === 'string')
    return value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  if (Array.isArray(value) && value.every((x) => typeof x === 'string')) return value as string[]
  throw new PlaygroundError(`"${name}" must be a list of ids.`)
}

const groupOf = {
  key: 'keys',
  resource: 'resources',
  grant: 'grants',
  statement: 'statements',
  change: 'changes',
  revocation: 'revocations',
} as const

type Groups = typeof groupOf
type GroupType = keyof Groups

export class PlaygroundSession {
  state: LabState = initialState()
  preset: PresetView = {id: 'start', modified: false}
  run: SyncRun | null = null
  private syncLab: SyncLab | null = null
  private undoStack: LabState[] = []
  private redoStack: LabState[] = []
  private storage: PlaygroundStorage | null

  constructor(storage?: PlaygroundStorage) {
    this.storage = storage ?? null
    this.restore()
  }

  // ---- persistence ----

  private restore() {
    if (!this.storage) return
    let text: string | null = null
    try {
      text = this.storage.load()
    } catch {
      return
    }
    if (!text) return
    try {
      const saved: unknown = JSON.parse(text)
      if (!isRecord(saved) || saved.version !== SAVE_VERSION) return
      const state = validateState(saved.state)
      const preset = this.sanitizePreset(saved.preset)
      const history = (list: unknown): LabState[] => {
        if (!Array.isArray(list)) return []
        const out: LabState[] = []
        for (const entry of list.slice(-UNDO_LIMIT)) {
          try {
            out.push(validateState(entry))
          } catch {
            // Drop an unreadable history entry rather than the whole file.
          }
        }
        return out
      }
      this.state = state
      this.preset = preset
      this.undoStack = history(saved.undo)
      this.redoStack = history(saved.redo)
    } catch {
      // A corrupt file starts a fresh lab; the file is overwritten on the next change.
    }
  }

  private persist() {
    if (!this.storage) return
    this.storage.save(
      JSON.stringify({
        version: SAVE_VERSION,
        state: this.state,
        preset: this.preset,
        undo: this.undoStack,
        redo: this.redoStack,
      }),
    )
  }

  private sanitizePreset(raw: unknown): PresetView {
    if (!isRecord(raw)) return {id: null, modified: true}
    const id = typeof raw.id === 'string' && scenarios.some((x) => x.id === raw.id) ? raw.id : null
    return {id, modified: raw.modified !== false}
  }

  // ---- snapshot ----

  snapshot(): Snapshot {
    return {
      state: this.state,
      derived: deriveView(this.state),
      preset: this.preset,
      sync: {run: this.run},
      syncLab: this.syncLab?.snapshot() ?? null,
      history: {canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0},
      scenarios: scenarios.map(({id, title, description}) => ({id, title, description})),
      meta: {version: 1, nodeKinds, roles, hostKey: HOST_KEY},
    }
  }

  exportJSON(): string {
    return JSON.stringify(
      {notice: 'Educational HM26 tentative policy simulation; no real cryptographic proofs', state: this.state},
      null,
      2,
    )
  }

  // ---- history ----

  private remember() {
    this.undoStack.push(clone(this.state))
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack.length = 0
    this.preset = {...this.preset, modified: true}
  }

  /** Run a mutation atomically: the state only changes when the result validates. */
  private act<T>(fn: (s: LabState) => T): T {
    const before = clone(this.state)
    try {
      const result = fn(this.state)
      normalizeState(this.state)
      validateState(this.state)
      this.undoStack.push(before)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
      this.redoStack.length = 0
      this.preset = {...this.preset, modified: true}
      return result
    } catch (e) {
      this.state = before
      throw e instanceof PlaygroundError ? e : new PlaygroundError(e instanceof Error ? e.message : String(e))
    }
  }

  private resetRun() {
    this.run = null
    this.syncLab = null
  }

  // ---- dispatch ----

  dispatch(raw: unknown): DispatchResult {
    if (!isRecord(raw) || typeof raw.type !== 'string') throw new PlaygroundError('An action needs a "type".')
    let result: Omit<DispatchResult, 'snapshot'>
    try {
      result = this.apply(raw.type, raw)
    } catch (e) {
      // Model errors are the user's mistake (a denied grant, a malformed blob), never a server fault.
      throw e instanceof PlaygroundError ? e : new PlaygroundError(e instanceof Error ? e.message : String(e))
    }
    this.persist()
    return {...result, snapshot: this.snapshot()}
  }

  private apply(type: string, body: Record<string, unknown>): Omit<DispatchResult, 'snapshot'> {
    const s = () => this.state
    const name = (id: string) => s().keys.find((k) => k.id === id)?.name || id
    switch (type) {
      case 'issue': {
        const actor = field(body, 'actor')
        const to = field(body, 'to')
        const resource = field(body, 'resource')
        const role = field(body, 'role')
        if (!isRole(role)) throw new PlaygroundError('Choose a valid role.')
        const g = this.act((s) => issue(s, actor, to, resource, role))
        return {
          message: `Issued ${g.id}. ${
            g.role === 'admin'
              ? 'Permanent delegation: this admin grant cannot be revoked.'
              : 'All independent valid routes now participate in access.'
          }`,
          ui: {select: {type: 'grant', id: g.id}},
        }
      }
      case 'revoke': {
        const actor = field(body, 'actor')
        const grant = field(body, 'grant')
        const g = this.act((s) => revoke(s, actor, grant))
        return {message: `Revoked ${g.id}. Retained bytes survive; the next live fence invalidates stale views.`}
      }
      case 'revokeRoutes': {
        const key = field(body, 'key')
        const resource = field(body, 'resource')
        this.act((s) => {
          const r = findResource(s, resource)
          if (!r) throw Error('Unknown resource.')
          const gs = routes(s, key, resource).filter((g) => g.role !== 'admin')
          if (!gs.length)
            throw Error('No revocable routes. Admin is permanent; public read can survive grant revocation.')
          gs.forEach((g) => revoke(s, r.owner, g.id))
        })
        return {message: 'Revoked reader/writer routes. Retained cache remains; next live fence invalidates old view.'}
      }
      case 'publish': {
        const author = field(body, 'author')
        const resource = field(body, 'resource')
        const text = field(body, 'text').trim()
        if (!text) throw new PlaygroundError('Enter snapshot content.')
        const v = this.act((s) => publish(s, author, resource, text))
        return {
          message: `${v.id} signed and committed locally. Delivery is pending${
            s().devices[author]?.online ? '' : '; author is offline'
          }.`,
        }
      }
      case 'deliver': {
        const author = field(body, 'author')
        this.act((s) => deliver(s, author))
        return {message: 'Reused stable offer IDs. Only INDEXED means a durable simulated post-commit receipt.'}
      }
      case 'createKey': {
        const keyName = field(body, 'name').trim()
        if (!keyName) throw new PlaygroundError('Enter a principal name')
        const note = optionalField(body, 'note') ?? 'User-created simulated key'
        const id = this.act((s) => {
          const id = `key${s.serial++}`
          s.keys.push({id, name: keyName, note})
          s.devices[id] = newDevice(false)
          return id
        })
        return {message: `Created ${keyName}. No authority until explicitly granted.`, ui: {select: {type: 'key', id}}}
      }
      case 'saveObject':
        return this.saveObject(body)
      case 'duplicate':
        return this.duplicate(body)
      case 'remove':
        return this.remove(body)
      case 'setDevice': {
        const key = field(body, 'key')
        const online = body.online
        const follow = body.follow
        if (online != null && typeof online !== 'boolean') throw new PlaygroundError('"online" must be a boolean.')
        if (follow != null && typeof follow !== 'boolean') throw new PlaygroundError('"follow" must be a boolean.')
        const d = this.act((s) => {
          const d = s.devices[key]
          if (!d) throw Error('Unknown device.')
          if (typeof online === 'boolean') d.online = online
          if (typeof follow === 'boolean') d.follow = follow
          return d
        })
        return {
          message:
            typeof follow === 'boolean'
              ? d.follow
                ? 'Interest recorded. Following schedules work but grants no authority.'
                : 'Follow removed. Manual demand sync is still available if authorized.'
              : d.online
                ? `${name(key)}’s device is online.`
                : `${name(key)}’s device is offline. Retained bytes stay; authority knowledge goes stale.`,
        }
      }
      case 'reset':
        return this.loadScenario('start')
      case 'loadScenario':
        return this.loadScenario(field(body, 'id'))
      case 'undo': {
        const previous = this.undoStack.pop()
        if (!previous) throw new PlaygroundError('Nothing to undo.')
        this.redoStack.push(clone(this.state))
        this.state = previous
        this.preset = {...this.preset, modified: true}
        this.resetRun()
        return {message: 'Undid the last change.'}
      }
      case 'redo': {
        const next = this.redoStack.pop()
        if (!next) throw new PlaygroundError('Nothing to redo.')
        this.undoStack.push(clone(this.state))
        this.state = next
        this.preset = {...this.preset, modified: true}
        this.resetRun()
        return {message: 'Redid the change.'}
      }
      case 'import': {
        const raw = isRecord(body.state)
          ? body.state
          : isRecord(body.data) && isRecord(body.data.state)
            ? body.data.state
            : null
        if (!raw) throw new PlaygroundError('The import needs a "state" object.')
        const state = validateState(raw)
        this.remember()
        this.state = state
        this.preset = {id: null, modified: true}
        this.resetRun()
        return {
          message: 'Loaded the imported world. Every access decision was recomputed.',
          ui: {select: {type: 'resource', id: state.resources[0]!.id}},
        }
      }
      case 'syncLabBegin': {
        const left = field(body, 'left')
        const right = field(body, 'right')
        const profile = field(body, 'profile')
        const privacy = field(body, 'privacy')
        if (!['cold', 'shared', 'partial', 'split'].includes(profile))
          throw new PlaygroundError('Unknown replica layout.')
        if (!['deduplicate', 'scoped'].includes(privacy)) throw new PlaygroundError('Unknown privacy policy.')
        this.syncLab = new SyncLab(s(), {left, right, profile, privacy} as SyncOptions)
        return {}
      }
      case 'syncLabStep': {
        if (!this.syncLab) throw new PlaygroundError('Build the replicas first.')
        this.syncLab.step(s())
        return {}
      }
      case 'syncLabSeek': {
        if (!this.syncLab || typeof body.index !== 'number') throw new PlaygroundError('Choose a sync step.')
        this.syncLab.seek(body.index)
        return {}
      }
      case 'syncBegin': {
        const key = field(body, 'key')
        const resource = field(body, 'resource')
        if (!this.state.devices[key]) throw new PlaygroundError('Unknown principal.')
        if (!findResource(this.state, resource)) throw new PlaygroundError('Unknown resource.')
        this.beginSync(key, resource)
        return {}
      }
      case 'syncStep': {
        if (!this.run) throw new PlaygroundError('Start a sync first.')
        this.stepSync()
        return {}
      }
      case 'syncReset': {
        this.resetRun()
        return {}
      }
      default:
        throw new PlaygroundError(`Unknown action "${type}".`, 404)
    }
  }

  // ---- use cases ----

  private loadScenario(id: string): Omit<DispatchResult, 'snapshot'> {
    const scenario = scenarios.find((x) => x.id === id)
    if (!scenario) throw new PlaygroundError('Unknown use case.')
    const before = clone(this.state)
    try {
      this.state = initialState()
      this.resetRun()
      const result = scenario.load(this)
      normalizeState(this.state)
      validateState(this.state)
      this.undoStack.push(before)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
      this.redoStack.length = 0
      this.preset = {id, modified: false}
      return result
    } catch (e) {
      this.state = before
      throw e instanceof PlaygroundError ? e : new PlaygroundError(e instanceof Error ? e.message : String(e))
    }
  }

  // ---- sync run ----

  beginSync(key: string, resource: string) {
    this.run = {
      key,
      resource,
      revision: this.state.revision,
      steps: syncSteps(this.state, key, resource),
      index: 0,
      rows: [],
      done: false,
    }
  }

  stepSync() {
    const run = this.run
    if (!run || run.done) return
    const s = this.state
    if (!s.devices[run.key]?.online && run.steps[run.index]?.kind !== 'warn') {
      run.rows.push({
        title: 'TRANSPORT_OFFLINE',
        detail:
          'Connection dropped. Preserve completed blocks and cursor; authenticate and refresh control on reconnect.',
        kind: 'warn',
      })
      run.done = true
    } else if (run.revision !== s.revision) {
      run.rows.push({
        title: 'STALE_VIEW · live authorization fence',
        detail:
          'Authority changed after this view opened. Stop transfer and invalidate view. Refresh control before reopening; disclose no further private head or bytes.',
        kind: 'deny',
      })
      run.done = true
    } else {
      const row = run.steps[run.index++]
      if (row) run.rows.push(row)
      if (run.index >= run.steps.length) {
        run.done = true
        if (!run.steps.some((x) => x.kind === 'deny' || x.kind === 'warn')) {
          // A completed sync changes the replica, so it is an undoable world change.
          this.remember()
          completeSync(s, run.key, run.resource)
        }
      }
    }
  }

  // ---- object editor ----

  /**
   * The message after a blob is stored. An invalid blob is kept and reported, never refused: the
   * point of the playground is to see what the rules do with it.
   */
  private saved(id: string, ok = 'World updated. Decisions recomputed; experiment saved on this node.'): string {
    const problems = allProblems(this.state)[id]
    return problems ? `Saved ${id}, but it cannot be evaluated: ${problems[0]}` : ok
  }

  private saveObject(body: Record<string, unknown>): Omit<DispatchResult, 'snapshot'> {
    const type = field(body, 'objectType')
    const id = optionalField(body, 'id')
    const data = isRecord(body.data) ? body.data : {}
    const s = this.state
    const parse = (value: unknown, label: string): unknown => {
      if (typeof value !== 'string') return value
      try {
        return JSON.parse(value)
      } catch {
        throw new PlaygroundError('Enter valid JSON in ' + label + '.')
      }
    }

    if (type === 'key') {
      const keyName = optionalField(data, 'name')?.trim()
      if (!keyName) throw new PlaygroundError('Give this key a display name.')
      const note = optionalField(data, 'note') ?? ''
      const editing = !!id && s.keys.some((k) => k.id === id)
      const kid = this.act((s) => {
        const k = {id: editing ? id! : `key${s.serial++}`, name: keyName, note}
        if (editing) s.keys[s.keys.findIndex((x) => x.id === k.id)] = k
        else {
          s.keys.push(k)
          s.devices[k.id] = newDevice(false)
        }
        s.revision++
        return k.id
      })
      return {
        message: this.saved(kid),
        ui: {select: {type: 'key', id: kid}},
      }
    }

    if (type === 'resource') {
      const label = optionalField(data, 'name')?.trim()
      if (!label) throw new PlaygroundError('Give this resource a display label.')
      const editing = !!id && s.resources.some((r) => r.id === id)
      const rid = this.act((s) => {
        const old = editing ? findResource(s, id!)! : null
        const r: LabResource = {
          id: editing ? id! : `r${s.serial++}`,
          name: label,
          owner: optionalField(data, 'owner') ?? old?.owner ?? 'alice',
          parent: optionalField(data, 'parent') ?? null,
          segment: optionalField(data, 'segment')?.trim() ?? '',
          public: data.public === true || data.public === 'true',
          cid: optionalField(data, 'cid')?.trim() || old?.cid || `bafy-demo-${s.serial++}`,
        }
        if (editing && old) {
          s.resources[s.resources.findIndex((x) => x.id === r.id)] = r
          if (old.owner !== r.owner) {
            const descendants = new Set([r.id])
            let changed = true
            while (changed) {
              changed = false
              for (const c of s.resources)
                if (c.parent && descendants.has(c.parent) && !descendants.has(c.id)) {
                  descendants.add(c.id)
                  changed = true
                }
            }
            for (const c of s.resources.filter((c) => descendants.has(c.id))) {
              c.owner = r.owner
              addRootAnchor(s, c)
            }
          }
        } else {
          s.resources.push(r)
          addRootAnchor(s, r)
          s.statements.push({
            id: `v${s.serial++}`,
            resource: r.id,
            author: r.owner,
            seq: Math.max(0, ...s.statements.map((v) => v.seq)) + 1,
            kind: 'snapshot',
            state: {title: r.name},
            text: r.name,
          })
        }
        s.revision++
        return r.id
      })
      return {
        message: this.saved(rid),
        ui: {select: {type: 'resource', id: rid}},
      }
    }

    if (type === 'policy') {
      const resource = field(data, 'resource')
      const isPublic = data.public === true || data.public === 'true'
      this.act((s) => {
        const r = findResource(s, resource)
        if (!r) throw Error('Unknown resource.')
        r.public = isPublic
        s.revision++
      })
      return {
        message: this.saved('policy-' + resource),
        ui: {select: {type: 'policy', id: 'policy-' + resource}},
      }
    }

    if (type === 'capability') {
      const reissuing = !!id && s.grants.some((g) => g.id === id)
      const role = field(data, 'role')
      if (!isRole(role)) throw new PlaygroundError('Choose a valid role.')
      const from = field(data, 'from')
      const resource = field(data, 'resource')
      // Without an explicit proof, use the admin grant the issuer holds on that resource. The
      // owner's own root anchor is the one grant that correctly has no proof.
      const proof =
        'proof' in data
          ? optionalField(data, 'proof')?.trim() || null
          : routes(s, from, resource).find((g) => g.role === 'admin' && g.proof !== null)?.id ??
            routes(s, from, resource).find((g) => g.role === 'admin')?.id ??
            null
      const fields = {from, to: field(data, 'to'), resource, role, proof}
      const revoked = data.revoked === true || data.revoked === 'true'
      if (role === 'admin' && revoked)
        throw new PlaygroundError('Admin grants cannot be revoked. Choose active or change the fixture role.')
      const gid = this.act((s) => {
        let g: LabGrant
        if (reissuing) g = reissueCapability(s, id!, fields)
        else {
          g = {id: `g${s.serial++}`, ...fields}
          if (revoked) g.revoked = true
          s.grants.push(g)
        }
        s.revision++
        return g.id
      })
      return {
        message: this.saved(
          gid,
          reissuing ? `Issued ${gid}. Original ${id} is unchanged and retains its independent authority.` : undefined,
        ),
        ui: {select: {type: 'grant', id: gid}},
      }
    }

    if (type === 'revocation') {
      const editing = !!id && s.revocations.some((v) => v.id === id)
      const target = field(data, 'target')
      const targetGrant = findGrant(s, target)
      const resource = optionalField(data, 'resource') ?? targetGrant?.resource
      if (!resource) throw new PlaygroundError('Choose the grant to revoke.')
      const author = field(data, 'author')
      const v: Omit<LabRevocation, 'id'> = {
        resource,
        author,
        target,
        proof:
          'proof' in data
            ? optionalField(data, 'proof')?.trim() ?? ''
            : routes(s, author, resource).find((g) => g.role === 'admin')?.id ?? '',
      }
      const rid = this.act((s) => {
        const obj: LabRevocation = {id: editing ? id! : `rev${s.serial++}`, ...v}
        if (editing) s.revocations[s.revocations.findIndex((x) => x.id === obj.id)] = obj
        else s.revocations.push(obj)
        s.revision++
        return obj.id
      })
      return {
        message: this.saved(rid),
        ui: {select: {type: 'revocation', id: rid}},
      }
    }

    if (type === 'change') {
      const editing = !!id && s.changes.some((c) => c.id === id)
      const ops = parse(data.ops, 'ORDERED OPERATIONS')
      if (!Array.isArray(ops)) throw new PlaygroundError('Operations must be a JSON array.')
      const c: Omit<LabChange, 'id'> = {
        resource: field(data, 'resource'),
        author: field(data, 'author'),
        deps: stringList(data.deps, 'deps'),
        ops,
      }
      const cid = this.act((s) => {
        const obj: LabChange = {id: editing ? id! : `c${s.serial++}`, ...c}
        if (editing) s.changes[s.changes.findIndex((x) => x.id === obj.id)] = obj
        else s.changes.push(obj)
        s.revision++
        return obj.id
      })
      return {
        message: this.saved(cid),
        ui: {select: {type: 'change', id: cid}},
      }
    }

    if (isNodeKind(type)) {
      const editing = !!id && s.statements.some((v) => v.id === id)
      const seq =
        data.seq == null || data.seq === '' ? Math.max(0, ...s.statements.map((v) => v.seq)) + 1 : Number(data.seq)
      if (!Number.isSafeInteger(seq) || seq < 0) throw new PlaygroundError('Enter a whole number sequence.')
      const v: Omit<LabStatement, 'id'> = {
        resource: field(data, 'resource'),
        author: field(data, 'author'),
        kind: type,
        seq,
      }
      const prev = optionalField(data, 'prev')?.trim()
      if (prev) v.prev = prev
      if (type === 'snapshot') {
        // Plain text is the common case. JSON is accepted when it parses.
        const raw = data.state ?? data.text ?? ''
        let parsed: unknown = raw
        if (typeof raw === 'string') {
          try {
            parsed = JSON.parse(raw)
          } catch {
            parsed = raw.trim()
          }
        }
        if (parsed === '') throw new PlaygroundError('Enter the snapshot content.')
        v.state = parsed
        v.text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed)
      }
      if (type === 'redirect') v.target = field(data, 'target')
      if (type === 'changes' || type === 'changes-snapshot') {
        v.heads = stringList(data.heads, 'heads')
        v.apply = optionalField(data, 'apply')?.trim()
      }
      if (type === 'changes-snapshot') v.snapshot = parse(data.snapshot, 'UTILITY SNAPSHOT')
      const vid = this.act((s) => {
        const obj: LabStatement = {id: editing ? id! : `v${s.serial++}`, ...v}
        if (editing) s.statements[s.statements.findIndex((x) => x.id === obj.id)] = obj
        else s.statements.push(obj)
        s.revision++
        return obj.id
      })
      return {
        message: this.saved(vid),
        ui: {select: {type: 'statement', id: vid}},
      }
    }

    throw new PlaygroundError(`Unknown object type "${type}".`)
  }

  private duplicate(body: Record<string, unknown>): Omit<DispatchResult, 'snapshot'> {
    const type = field(body, 'objectType')
    const id = field(body, 'id')
    if (type === 'policy')
      throw new PlaygroundError('Each resource has one root policy. Edit its audience or duplicate the resource.')
    if (type === 'grant')
      throw new PlaygroundError('Capabilities are immutable. Reissue the capability to create a new signed record.')
    if (!(type in groupOf)) throw new PlaygroundError('Unknown object type.')
    const group = groupOf[type as GroupType]
    const newId = this.act((s) => {
      const list = s[group] as {id: string}[]
      const original = list.find((x) => x.id === id)
      if (!original) throw Error('Object not found.')
      const o = clone(original) as Record<string, unknown> & {id: string}
      const prefix = (
        {resource: 'r', statement: 'v', grant: 'g', revocation: 'rev', change: 'c', key: 'key'} as Record<
          string,
          string
        >
      )[type]
      o.id = `${prefix}${s.serial++}`
      if (type === 'key') {
        o.name = String(o.name) + ' copy'
        s.devices[o.id] = newDevice(false)
      }
      if (type === 'resource') {
        const r = o as unknown as LabResource
        r.name += ' copy'
        r.cid = `bafy-demo-${s.serial++}`
        r.segment = ''
        s.resources.push(r)
        addRootAnchor(s, r)
        const v = selected(s, id)
        if (v) s.statements.push({...clone(v), id: `v${s.serial++}`, resource: r.id, author: r.owner})
      } else {
        if (type === 'statement')
          (o as unknown as LabStatement).seq = Math.max(0, ...s.statements.map((v) => v.seq)) + 1
        ;(s[group] as unknown[]).push(o)
      }
      s.revision++
      return o.id
    })
    return {message: 'Duplicated. The copy can be edited independently.', ui: {select: {type, id: newId}}}
  }

  private remove(body: Record<string, unknown>): Omit<DispatchResult, 'snapshot'> {
    const type = field(body, 'objectType')
    const id = field(body, 'id')
    if (type === 'grant') throw new PlaygroundError('Capabilities are immutable. Add an exact revocation blob instead.')
    if (type === 'key' && id === HOST_KEY)
      throw new PlaygroundError(
        'Atlas is the fixed transport peer in this sync demo. You can rename it and edit its grants.',
      )
    if (type === 'policy') {
      this.act((s) => {
        const r = findResource(s, id.replace(/^policy-/, ''))
        if (!r) throw Error('Unknown resource.')
        r.public = false
        s.revision++
      })
      return {message: 'Root policy reset to private. Already disclosed bytes remain retained.'}
    }
    if (!(type in groupOf)) throw new PlaygroundError('Unknown object type.')
    const group = groupOf[type as GroupType]
    const first = this.act((s) => {
      if (!(s[group] as {id: string}[]).some((x) => x.id === id)) throw Error('Object not found.')
      if (type === 'resource' || type === 'key') {
        const removed = new Set(type === 'resource' ? [id] : s.resources.filter((r) => r.owner === id).map((r) => r.id))
        let again = true
        while (again) {
          again = false
          for (const r of s.resources)
            if (r.parent && removed.has(r.parent) && !removed.has(r.id)) {
              removed.add(r.id)
              again = true
            }
        }
        if (s.resources.length === removed.size)
          throw Error('Keep at least one resource. Create another resource before removing this owner or subtree.')
        s.resources = s.resources.filter((r) => !removed.has(r.id))
        s.grants = s.grants.filter(
          (g) => !removed.has(g.resource) && (type !== 'key' || (g.from !== id && g.to !== id)),
        )
        s.statements = s.statements.filter((v) => !removed.has(v.resource) && (type !== 'key' || v.author !== id))
        s.changes = s.changes.filter((v) => !removed.has(v.resource) && (type !== 'key' || v.author !== id))
        s.revocations = s.revocations.filter((v) => !removed.has(v.resource) && (type !== 'key' || v.author !== id))
        s.outbox = s.outbox.filter((v) => !removed.has(v.resource) && (type !== 'key' || v.author !== id))
        if (type === 'key') {
          s.keys = s.keys.filter((k) => k.id !== id)
          delete s.devices[id]
        }
        for (const d of Object.values(s.devices)) removed.forEach((rid) => delete d.cache[rid])
      } else {
        ;(s[group] as unknown[]) = (s[group] as {id: string}[]).filter((x) => x.id !== id)
      }
      s.revision++
      return s.resources[0]!.id
    })
    this.resetRun()
    return {
      message: 'Removed from the simulated experiment. Dependent proofs may now be invalid. Undo restores it.',
      ui: {select: {type: 'resource', id: first}},
    }
  }
}

type WorldSpec = {
  keys: [id: string, name: string, note: string][]
  resources: {id: string; name: string; owner: string; parent?: string; public?: boolean; segment?: string}[]
  grants: [id: string, from: string, to: string, resource: string, role: Role, proof: string | null][]
  statements: [id: string, resource: string, author: string, seq: number, text: string][]
}

/** A small world with only the blobs a use case is about. */
function world(spec: WorldSpec): LabState {
  const s: LabState = {
    revision: 1,
    serial: 100,
    keys: spec.keys.map(([id, name, note]) => ({id, name, note})),
    resources: spec.resources.map((r) => ({
      id: r.id,
      name: r.name,
      cid: `bafy…${r.id}`,
      parent: r.parent ?? null,
      public: r.public ?? false,
      owner: r.owner,
      segment: r.segment ?? r.id,
    })),
    grants: spec.grants.map(([id, from, to, resource, role, proof]) => ({id, from, to, resource, role, proof})),
    statements: spec.statements.map(([id, resource, author, seq, text]) => ({
      id,
      resource,
      author,
      seq,
      kind: 'snapshot',
      text,
      state: text,
    })),
    devices: Object.fromEntries(spec.keys.map(([id]) => [id, newDevice()])),
    outbox: [],
    events: [],
    changes: [],
    revocations: [],
  }
  return normalizeState(s)
}

const alice: [string, string, string] = ['alice', 'Alice', 'Owner']
const bob: [string, string, string] = ['bob', 'Bob', 'Reader']
const carol: [string, string, string] = ['carol', 'Carol', 'Writer']
const oneDoc = (owner = 'alice') => [{id: 'doc', name: 'Notes', owner, segment: 'notes'}]

/** The use cases. Each is a preset of blobs, as small as the point it makes allows. */
const scenarios: Scenario[] = [
  {
    id: 'routes',
    title: 'Two routes, one revoke',
    description:
      'Alice gives Bob two reader grants on one document, then revokes one. Bob still reads through the other.',
    load: (p) => {
      p.state = world({
        keys: [alice, bob],
        resources: oneDoc(),
        grants: [
          ['g1', 'alice', 'alice', 'doc', 'admin', null],
          ['g2', 'alice', 'bob', 'doc', 'reader', 'g1'],
          ['g3', 'alice', 'bob', 'doc', 'reader', 'g1'],
        ],
        statements: [['v1', 'doc', 'alice', 1, 'Meeting notes']],
      })
      revoke(p.state, 'alice', 'g2')
      return {message: 'g2 is revoked. Bob still reads Notes through g3.', ui: {select: {type: 'grant', id: 'g3'}}}
    },
  },
  {
    id: 'admin',
    title: 'Permanent delegation',
    description:
      'Alice makes Bob an admin. Bob grants Carol. Neither admin grant can be revoked, only Carol’s reader grant.',
    load: (p) => {
      p.state = world({
        keys: [alice, bob, carol],
        resources: oneDoc(),
        grants: [
          ['g1', 'alice', 'alice', 'doc', 'admin', null],
          ['g2', 'alice', 'bob', 'doc', 'admin', 'g1'],
          ['g3', 'bob', 'carol', 'doc', 'reader', 'g2'],
        ],
        statements: [['v1', 'doc', 'alice', 1, 'Meeting notes']],
      })
      return {
        message: 'Bob’s admin grant g2 is permanent and proves g3. Try revoking g2: the model refuses.',
        ui: {select: {type: 'grant', id: 'g2'}},
      }
    },
  },
  {
    id: 'child',
    title: 'Child sharing',
    description: 'Notes sits inside Lab. Bob has a reader grant on Notes only, so he reads Notes and nothing of Lab.',
    load: (p) => {
      p.state = world({
        keys: [alice, bob],
        resources: [
          {id: 'lab', name: 'Lab', owner: 'alice'},
          {id: 'notes', name: 'Notes', owner: 'alice', parent: 'lab'},
        ],
        grants: [
          ['g1', 'alice', 'alice', 'lab', 'admin', null],
          ['g2', 'alice', 'alice', 'notes', 'admin', null],
          ['g3', 'alice', 'bob', 'notes', 'reader', 'g2'],
        ],
        statements: [
          ['v1', 'lab', 'alice', 1, 'Lab overview'],
          ['v2', 'notes', 'alice', 1, 'Field notes'],
        ],
      })
      return {
        message: 'Bob reads Notes through g3. Placement under Lab gives him nothing on Lab.',
        ui: {select: {type: 'key', id: 'bob'}},
      }
    },
  },
  {
    id: 'rollback',
    title: 'The writer rollback',
    description:
      'Carol wrote the newest version. Her writer grant is revoked, so her version is ineligible and Alice’s older one is selected again.',
    load: (p) => {
      p.state = world({
        keys: [alice, carol],
        resources: oneDoc(),
        grants: [
          ['g1', 'alice', 'alice', 'doc', 'admin', null],
          ['g2', 'alice', 'carol', 'doc', 'writer', 'g1'],
        ],
        statements: [
          ['v1', 'doc', 'alice', 1, 'First draft'],
          ['v2', 'doc', 'carol', 2, 'Carol’s edit'],
        ],
      })
      revoke(p.state, 'alice', 'g2')
      return {
        message: 'Carol’s v2 is retained but ineligible. The selected version rolls back to Alice’s v1.',
        ui: {select: {type: 'statement', id: 'v2'}},
      }
    },
  },
  {
    id: 'revive',
    title: 'Regrant, revive',
    description:
      'The rollback world, then a fresh writer grant for Carol. Her old version is eligible again and selected.',
    load: (p) => {
      p.state = world({
        keys: [alice, carol],
        resources: oneDoc(),
        grants: [
          ['g1', 'alice', 'alice', 'doc', 'admin', null],
          ['g2', 'alice', 'carol', 'doc', 'writer', 'g1'],
        ],
        statements: [
          ['v1', 'doc', 'alice', 1, 'First draft'],
          ['v2', 'doc', 'carol', 2, 'Carol’s edit'],
        ],
      })
      revoke(p.state, 'alice', 'g2')
      const g = issue(p.state, 'alice', 'carol', 'doc', 'writer')
      return {
        message: `${g.id} makes Carol a writer again, so her old v2 is selected again. This is a tentative policy tradeoff.`,
        ui: {select: {type: 'statement', id: 'v2'}},
      }
    },
  },
  {
    id: 'copy',
    title: 'Copy, then cut access',
    description:
      'A bot reads a private document and writes a public one. It copies once, then loses the reader grant. The copy stays.',
    load: (p) => {
      p.state = world({
        keys: [alice, ['bot', 'Copy bot', 'Automation key']],
        resources: [
          {id: 'src', name: 'Private notes', owner: 'alice'},
          {id: 'dst', name: 'Public dispatch', owner: 'alice', public: true},
        ],
        grants: [
          ['g1', 'alice', 'alice', 'src', 'admin', null],
          ['g2', 'alice', 'alice', 'dst', 'admin', null],
          ['g3', 'alice', 'bot', 'src', 'reader', 'g1'],
          ['g4', 'alice', 'bot', 'dst', 'writer', 'g2'],
        ],
        statements: [
          ['v1', 'src', 'alice', 1, 'Secret plan'],
          ['v2', 'dst', 'alice', 1, 'Hello, public world'],
        ],
      })
      publish(p.state, 'bot', 'dst', 'Copy: ' + (selected(p.state, 'src')?.text ?? ''))
      revoke(p.state, 'alice', 'g3')
      return {
        message:
          'The bot copied Secret plan into Public dispatch, then lost g3. The copy survives; no further copies can be made.',
        ui: {select: {type: 'resource', id: 'dst'}},
      }
    },
  },
  {
    id: 'sync-sharing',
    title: 'Sync · shared sub-DAGs',
    description:
      'Two private resources share supplied content. Alice and Bob can read both; a third resource stays private to Alice. Try split replicas, partial downloads, and a live revocation.',
    load: (p) => {
      p.state = world({
        keys: [alice, bob],
        resources: [
          {id: 'lab', name: 'Research lab', owner: 'alice'},
          {id: 'notes', name: 'Field notes', owner: 'alice'},
          {id: 'private', name: 'Private journal', owner: 'alice'},
        ],
        grants: [
          ['g1', 'alice', 'alice', 'lab', 'admin', null],
          ['g2', 'alice', 'bob', 'lab', 'reader', 'g1'],
          ['g3', 'alice', 'alice', 'notes', 'admin', null],
          ['g4', 'alice', 'bob', 'notes', 'reader', 'g3'],
          ['g5', 'alice', 'alice', 'private', 'admin', null],
        ],
        statements: [
          ['v1', 'lab', 'alice', 1, 'Shared methods\n\nShared observations\n\nLab analysis\n\nNext experiment'],
          [
            'v2',
            'notes',
            'alice',
            1,
            'Shared methods\n\nShared observations\n\nField measurements\n\nField conclusions',
          ],
          ['v3', 'private', 'alice', 1, 'Unpublished journal\n\nPrivate conclusions'],
        ],
      })
      return {
        message:
          'Shared content is supplied as bytes in both resources. Private journal never enters Bob’s sync scope.',
        ui: {select: {type: 'resource', id: 'lab'}},
      }
    },
  },
  {
    id: 'start',
    title: 'Everything at once',
    description:
      'The full fixture: Alice owns a lab with a private child and a public dispatch. Bob reads the lab, Carol writes it, Atlas hosts it.',
    load: () => ({message: 'Full fixture loaded.', ui: {select: {type: 'resource', id: 'lab'}}}),
  },
]
