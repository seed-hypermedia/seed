import {describe, expect, test} from 'vitest'
import {createPlaygroundHandler, isPlaygroundPath} from '../playground/api'
import {PlaygroundStorage, Snapshot} from '../playground/session'

function memoryStorage(): PlaygroundStorage & {text: string | null} {
  const box: PlaygroundStorage & {text: string | null} = {
    text: null,
    load: () => box.text,
    save: (text) => {
      box.text = text
    },
  }
  return box
}

type Reply = {
  ok: boolean
  snapshot: Snapshot
  message?: string
  error?: string
  ui?: {select?: {type: string; id: string}}
}

function client(storage?: PlaygroundStorage) {
  const {handle, session} = createPlaygroundHandler({storage})
  const get = (pathname: string) => handle({method: 'GET', pathname})
  const act = (action: Record<string, unknown>): Reply & {status: number} => {
    const res = handle({method: 'POST', pathname: '/api/playground/actions', body: JSON.stringify(action)})
    return {status: res.status, ...(JSON.parse(res.body) as Reply)}
  }
  const snapshot = () => JSON.parse(get('/api/playground').body).snapshot as Snapshot
  return {handle, session, get, act, snapshot}
}

describe('playground HTTP surface', () => {
  test('recognizes its own paths only', () => {
    expect(isPlaygroundPath('/hm/playground')).toBe(true)
    expect(isPlaygroundPath('/hm/playground/style.css')).toBe(true)
    expect(isPlaygroundPath('/api/playground')).toBe(true)
    expect(isPlaygroundPath('/api/playground/actions')).toBe(true)
    expect(isPlaygroundPath('/api/Resource')).toBe(false)
    expect(isPlaygroundPath('/hm/playgroundish')).toBe(false)
  })

  test('serves the page and its assets with absolute asset paths', () => {
    const {get} = client()
    const page = get('/hm/playground/')
    expect(page.status).toBe(200)
    expect(page.headers['Content-Type']).toContain('text/html')
    expect(page.body).toContain('/hm/playground/app.mjs')
    expect(page.body).toContain('/hm/playground/style.css')
    expect(get('/hm/playground').body).toBe(page.body)
    expect(get('/hm/playground/app.mjs').headers['Content-Type']).toContain('javascript')
    expect(get('/hm/playground/style.css').headers['Content-Type']).toContain('text/css')
    expect(get('/hm/playground/nope.js').status).toBe(404)
    expect(get('/hm/playground/app.mjs').body).not.toContain('./model.mjs')
  })

  test('the snapshot carries the fixture, derived facts, the use case and the scenarios', () => {
    const {snapshot} = client()
    const snap = snapshot()
    expect(snap.state.keys.map((k) => k.id)).toEqual(['alice', 'bob', 'carol', 'host', 'bot'])
    expect(snap.derived.access.bob!.lab!.read).toBe(true)
    expect(snap.derived.access.bob!.notes!.read).toBe(false)
    expect(snap.derived.access.bob!.lab!.sync).toBe(true)
    expect(snap.derived.resources.lab!.selected).toBe('v2')
    expect(snap.derived.resources.notes!.path).toBe('/lab/notes')
    expect(snap.derived.grants.g4!.status).toBe('valid')
    expect(snap.derived.adminRoute.alice!.lab).toBe('g1')
    expect(snap.derived.adminRoute.bob!.lab).toBeNull()
    expect(snap.derived.records.some((r) => r.type === 'grant' && r.id === 'g4')).toBe(true)
    expect(snap.preset).toEqual({id: 'start', modified: false})
    expect(snap.scenarios.map((x) => x.id)).toEqual([
      'routes',
      'admin',
      'child',
      'rollback',
      'revive',
      'copy',
      'sync-sharing',
      'start',
    ])
    expect(snap.history).toEqual({canUndo: false, canRedo: false})
  })

  test('actions change the world and errors leave it untouched', () => {
    const {act, snapshot} = client()
    const issued = act({type: 'issue', actor: 'alice', to: 'bob', resource: 'notes', role: 'reader'})
    expect(issued.status).toBe(200)
    expect(issued.ui?.select?.type).toBe('grant')
    expect(issued.snapshot.derived.access.bob!.notes!.read).toBe(true)
    expect(issued.snapshot.history.canUndo).toBe(true)

    const before = JSON.stringify(snapshot().state)
    const denied = act({type: 'issue', actor: 'carol', to: 'bob', resource: 'lab', role: 'reader'})
    expect(denied.status).toBe(400)
    expect(denied.ok).toBe(false)
    expect(denied.error).toMatch(/only an admin/)
    expect(JSON.stringify(snapshot().state)).toBe(before)

    expect(act({type: 'bogus'}).status).toBe(404)
    expect(act({type: 'issue'}).status).toBe(400)
    expect(act({type: 'revoke', actor: 'alice', grant: 'g1'}).error).toMatch(/permanent/)
  })

  test('undo and redo walk the history', () => {
    const {act, snapshot} = client()
    act({type: 'revoke', actor: 'alice', grant: 'g4'})
    expect(snapshot().derived.access.bob!.lab!.read).toBe(false)
    const undone = act({type: 'undo'})
    expect(undone.snapshot.derived.access.bob!.lab!.read).toBe(true)
    expect(undone.snapshot.history.canRedo).toBe(true)
    expect(act({type: 'redo'}).snapshot.derived.access.bob!.lab!.read).toBe(false)
    expect(act({type: 'redo'}).status).toBe(400)
  })

  test('the editor path creates, edits, reissues and refuses invalid objects', () => {
    const {act} = client()
    const created = act({
      type: 'saveObject',
      objectType: 'resource',
      data: {name: 'Archive', owner: 'bob', parent: '', segment: 'archive', public: 'false'},
    })
    expect(created.status).toBe(200)
    const rid = created.ui!.select!.id
    expect(created.snapshot.derived.access.bob![rid]!.admin).toBe(true)
    expect(created.snapshot.derived.resources[rid]!.selected).toBeTruthy()

    const reissued = act({
      type: 'saveObject',
      objectType: 'capability',
      id: 'g4',
      data: {from: 'alice', to: 'bob', resource: 'lab', role: 'writer', proof: 'g1'},
    })
    expect(reissued.status).toBe(200)
    const g = reissued.snapshot.state.grants.find((g) => g.reissuedFrom === 'g4')
    expect(g?.role).toBe('writer')
    expect(reissued.snapshot.state.grants.find((g) => g.id === 'g4')?.role).toBe('reader')
    expect(reissued.snapshot.derived.access.bob!.lab!.write).toBe(true)

    const empty = act({
      type: 'saveObject',
      objectType: 'snapshot',
      data: {resource: 'lab', author: 'alice', seq: 9, state: '  '},
    })
    expect(empty.status).toBe(400)
    expect(empty.error).toMatch(/content/)

    // A malformed node is stored and reported, not refused.
    const badNode = act({
      type: 'saveObject',
      objectType: 'changes',
      data: {resource: 'lab', author: 'alice', seq: 9, heads: '', apply: 'x'},
    })
    expect(badNode.status).toBe(200)
    expect(badNode.message).toMatch(/cannot be evaluated: A changes Ref needs at least one head/)
    const badId = badNode.ui?.select?.id as string
    expect(badNode.snapshot.derived.problems[badId]).toEqual([expect.stringMatching(/at least one head/)])
    expect(badNode.snapshot.derived.statements[badId]?.status).toBe('INVALID')
    expect(badNode.snapshot.derived.resources.lab!.selected).not.toBe(badId)

    const redirect = act({
      type: 'saveObject',
      objectType: 'redirect',
      data: {resource: 'lab', author: 'alice', seq: 9, target: 'notes'},
    })
    expect(redirect.snapshot.derived.resources.lab!.rendition.status).toBe('redirect')
    expect(redirect.snapshot.derived.access.bob!.notes!.read).toBe(false)

    const renamed = act({type: 'saveObject', objectType: 'key', id: 'bob', data: {name: 'Robert', note: 'renamed'}})
    expect(renamed.snapshot.state.keys.find((k) => k.id === 'bob')?.name).toBe('Robert')
  })

  test('capabilities cannot be removed; removing a key cascades through its resources', () => {
    const {act} = client()
    expect(act({type: 'remove', objectType: 'grant', id: 'g4'}).status).toBe(400)
    expect(act({type: 'remove', objectType: 'key', id: 'host'}).status).toBe(400)
    expect(act({type: 'remove', objectType: 'key', id: 'alice'}).error).toMatch(/Keep at least one resource/)
    const removed = act({type: 'remove', objectType: 'key', id: 'carol'})
    expect(removed.status).toBe(200)
    expect(removed.snapshot.state.keys.some((k) => k.id === 'carol')).toBe(false)
    expect(removed.snapshot.state.grants.some((g) => g.id === 'g5')).toBe(false)
    expect(removed.snapshot.state.statements.some((v) => v.id === 'v2')).toBe(false)
    expect(removed.snapshot.derived.resources.lab!.selected).toBe('v1')
    const dup = act({type: 'duplicate', objectType: 'resource', id: 'lab'})
    expect(dup.status).toBe(200)
    const copy = dup.snapshot.state.resources.find((r) => r.id === dup.ui!.select!.id)!
    expect(copy.name).toBe('Research lab copy')
    expect(dup.snapshot.derived.access.alice![copy.id]!.admin).toBe(true)
  })

  test('the use case tracks what was loaded and whether it changed', () => {
    const {act} = client()
    const loaded = act({type: 'loadScenario', id: 'routes'})
    expect(loaded.snapshot.preset).toEqual({id: 'routes', modified: false})
    expect(loaded.ui?.select?.type).toBe('grant')
    expect(act({type: 'revoke', actor: 'alice', grant: 'g3'}).snapshot.preset).toEqual({id: 'routes', modified: true})
    expect(act({type: 'undo'}).snapshot.preset.modified).toBe(true)
    expect(act({type: 'reset'}).snapshot.preset).toEqual({id: 'start', modified: false})
    expect(act({type: 'loadScenario', id: 'nope'}).status).toBe(400)
  })

  test('the editor fills in proofs and sequence numbers when the form leaves them out', () => {
    const {act, snapshot} = client()
    const granted = act({
      type: 'saveObject',
      objectType: 'capability',
      data: {from: 'alice', to: 'bot', resource: 'notes', role: 'writer'},
    })
    expect(granted.status).toBe(200)
    const gid = granted.ui!.select!.id
    expect(snapshot().state.grants.find((g) => g.id === gid)?.proof).toBe('g2')
    expect(snapshot().derived.access.bot!.notes!.write).toBe(true)
    const revoked = act({type: 'saveObject', objectType: 'revocation', data: {target: gid, author: 'alice'}})
    expect(revoked.status).toBe(200)
    const rev = snapshot().state.revocations.at(-1)!
    expect(rev).toMatchObject({target: gid, resource: 'notes', proof: 'g2'})
    expect(snapshot().derived.access.bot!.notes!.write).toBe(false)
    const noted = act({
      type: 'saveObject',
      objectType: 'snapshot',
      data: {resource: 'lab', author: 'carol', text: 'Plain text content'},
    })
    expect(noted.status).toBe(200)
    const v = snapshot().state.statements.find((x) => x.id === noted.ui!.select!.id)!
    expect(v).toMatchObject({seq: 3, text: 'Plain text content', state: 'Plain text content'})
    expect(snapshot().derived.resources.lab!.selected).toBe(v.id)
  })

  test('invalid blobs are stored and flagged, never refused', () => {
    const {act} = client()
    // A child placed under another owner's resource: the path cannot resolve, the blob stays.
    const crossRoot = act({
      type: 'saveObject',
      objectType: 'resource',
      data: {name: 'Bob folder', owner: 'bob', parent: 'lab', segment: 'bobs'},
    })
    expect(crossRoot.status).toBe(200)
    expect(crossRoot.message).toMatch(/cannot be evaluated: The parent "Research lab" is owned by Alice/)
    const rid = crossRoot.ui?.select?.id as string
    expect(crossRoot.snapshot.state.resources.some((r) => r.id === rid && r.parent === 'lab')).toBe(true)
    expect(crossRoot.snapshot.derived.problems[rid]).toHaveLength(1)
    expect(crossRoot.snapshot.derived.stats.invalid).toBe(1)

    // A grant whose proof is held by someone else is stored as an invalid route.
    const badProof = act({
      type: 'saveObject',
      objectType: 'capability',
      data: {from: 'bob', to: 'bob', resource: 'lab', role: 'writer', proof: 'g1'},
    })
    expect(badProof.status).toBe(200)
    const gid = badProof.ui?.select?.id as string
    expect(badProof.snapshot.derived.grants[gid]?.status).toBe('invalid')
    expect(badProof.snapshot.derived.problems[gid]).toEqual([expect.stringMatching(/held by Alice, not by the issuer/)])
    expect(badProof.snapshot.derived.access.bob!.lab!.write).toBe(false)

    // A revocation of an admin grant is kept but does nothing.
    const noRevoke = act({
      type: 'saveObject',
      objectType: 'revocation',
      data: {target: 'g1', author: 'alice'},
    })
    expect(noRevoke.status).toBe(200)
    expect(noRevoke.message).toMatch(/Admin grants are permanent/)
    expect(noRevoke.snapshot.derived.access.alice!.lab!.admin).toBe(true)

    // Dangling references survive a reload of the saved world.
    const dangling = act({
      type: 'saveObject',
      objectType: 'snapshot',
      data: {resource: 'lab', author: 'ghost', state: 'from nobody'},
    })
    expect(dangling.status).toBe(200)
    const vid = dangling.ui?.select?.id as string
    expect(dangling.snapshot.derived.problems[vid]).toEqual([expect.stringMatching(/author "ghost" does not exist/)])
    expect(dangling.snapshot.derived.statements[vid]?.status).toBe('INVALID')
    const again = act({type: 'import', state: dangling.snapshot.state})
    expect(again.status).toBe(200)
    expect(Object.keys(again.snapshot.derived.problems).sort()).toEqual([gid, rid, vid, noRevoke.ui?.select?.id].sort())
  })

  test('a sync run steps through the protocol and commits the replica', () => {
    const {act, snapshot} = client()
    expect(act({type: 'syncStep'}).status).toBe(400)
    act({type: 'syncBegin', key: 'bob', resource: 'lab'})
    expect(snapshot().sync.run?.steps.length).toBe(7)
    for (let i = 0; i < 7; i++) act({type: 'syncStep'})
    const snap = snapshot()
    expect(snap.sync.run?.done).toBe(true)
    expect(snap.state.devices.bob!.cache.lab?.id).toBe('v2')
    expect(snap.history.canUndo).toBe(true)
  })

  test('a revocation during an open view trips the live fence', () => {
    const {act, snapshot} = client()
    act({type: 'syncBegin', key: 'bob', resource: 'lab'})
    act({type: 'syncStep'})
    act({type: 'syncStep'})
    act({type: 'syncStep'})
    act({type: 'revoke', actor: 'alice', grant: 'g4'})
    const fenced = act({type: 'syncStep'}).snapshot.sync.run!
    expect(fenced.done).toBe(true)
    expect(fenced.rows.at(-1)?.title).toMatch(/STALE_VIEW/)
    expect(snapshot().state.devices.bob!.cache.lab).toBeUndefined()
  })

  test('use cases are small worlds that make one point each', () => {
    const {act} = client()
    const routes = act({type: 'loadScenario', id: 'routes'})
    expect(routes.status).toBe(200)
    expect(routes.snapshot.state.keys.map((k) => k.id)).toEqual(['alice', 'bob'])
    expect(routes.snapshot.state.grants.length).toBe(3)
    expect(routes.snapshot.derived.grants.g2!.status).toBe('revoked')
    expect(routes.snapshot.derived.access.bob!.doc!.read).toBe(true)
    const admin = act({type: 'loadScenario', id: 'admin'})
    expect(admin.snapshot.derived.access.carol!.doc!.read).toBe(true)
    expect(act({type: 'revoke', actor: 'alice', grant: 'g2'}).status).toBe(400)
    const child = act({type: 'loadScenario', id: 'child'})
    expect(child.snapshot.derived.access.bob!.notes!.read).toBe(true)
    expect(child.snapshot.derived.access.bob!.lab!.read).toBe(false)
    const rollback = act({type: 'loadScenario', id: 'rollback'})
    expect(rollback.snapshot.derived.resources.doc!.selected).toBe('v1')
    const revive = act({type: 'loadScenario', id: 'revive'})
    expect(revive.snapshot.derived.resources.doc!.selected).toBe('v2')
    expect(revive.snapshot.derived.grants.g2!.status).toBe('revoked')
    const copy = act({type: 'loadScenario', id: 'copy'})
    expect(copy.snapshot.derived.access.bot!.src!.read).toBe(false)
    expect(copy.snapshot.state.statements.some((v) => v.resource === 'dst' && v.author === 'bot')).toBe(true)
    const full = act({type: 'loadScenario', id: 'start'})
    expect(full.snapshot.state.keys.length).toBe(5)
    expect(full.snapshot.history.canUndo).toBe(true)
  })

  test('device toggles, publishing and delivery follow custody and authority', () => {
    const {act} = client()
    expect(act({type: 'setDevice', key: 'bob', online: false}).snapshot.state.devices.bob!.online).toBe(false)
    expect(act({type: 'setDevice', key: 'bob', online: 'no'}).status).toBe(400)
    const published = act({type: 'publish', author: 'carol', resource: 'lab', text: 'New field note'})
    expect(published.status).toBe(200)
    const offer = published.snapshot.state.outbox[0]!
    expect(offer.status).toBe('queued')
    expect(act({type: 'deliver', author: 'carol'}).snapshot.state.outbox[0]!.status).toBe('INDEXED')
    expect(act({type: 'publish', author: 'bob', resource: 'lab', text: 'x'}).status).toBe(400)
    expect(act({type: 'revokeRoutes', key: 'carol', resource: 'lab'}).snapshot.derived.access.carol!.lab!.write).toBe(
      false,
    )
    expect(act({type: 'revokeRoutes', key: 'carol', resource: 'lab'}).status).toBe(400)
  })

  test('export and import round trip a world and reject garbage', () => {
    const a = client()
    a.act({type: 'revoke', actor: 'alice', grant: 'g4'})
    const exported = a.get('/api/playground/export')
    expect(exported.headers['Content-Disposition']).toContain('hm26-lab.json')
    const file = JSON.parse(exported.body)
    const b = client()
    const imported = b.act({type: 'import', state: file.state})
    expect(imported.status).toBe(200)
    expect(imported.snapshot.derived.access.bob!.lab!.read).toBe(false)
    expect(b.act({type: 'import', state: {keys: 'x'}}).status).toBe(400)
    expect(
      b.act({
        type: 'import',
        state: {...file.state, keys: []},
      }).status,
    ).toBe(400)
    const malformed = b.handle({method: 'POST', pathname: '/api/playground/actions', body: '{nope'})
    expect(malformed.status).toBe(400)
  })

  test('the world, use case and history survive a restart through storage', () => {
    const storage = memoryStorage()
    const first = client(storage)
    first.act({type: 'loadScenario', id: 'admin'})
    first.act({type: 'revoke', actor: 'alice', grant: 'g3'})
    expect(storage.text).toBeTruthy()
    const second = client(storage)
    const snap = second.snapshot()
    expect(snap.preset).toEqual({id: 'admin', modified: true})
    expect(snap.derived.grants.g3!.status).toBe('revoked')
    expect(snap.history.canUndo).toBe(true)
    expect(second.act({type: 'undo'}).snapshot.derived.grants.g3!.status).toBe('valid')

    storage.text = '{"version":1,"state":{"keys":"broken"}}'
    const third = client(storage)
    expect(third.snapshot().state.keys.length).toBe(5)
    storage.text = 'not json'
    expect(client(storage).snapshot().state.keys.length).toBe(5)
  })

  test('rejects wrong methods and unknown API routes', () => {
    const {handle} = client()
    expect(handle({method: 'POST', pathname: '/api/playground'}).status).toBe(405)
    expect(handle({method: 'GET', pathname: '/api/playground/actions'}).status).toBe(405)
    expect(handle({method: 'GET', pathname: '/api/playground/whatever'}).status).toBe(404)
    expect(handle({method: 'DELETE', pathname: '/hm/playground/'}).status).toBe(405)
  })
})
