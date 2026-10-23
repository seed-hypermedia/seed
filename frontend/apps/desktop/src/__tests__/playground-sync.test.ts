import {describe, expect, test} from 'vitest'
import {clone} from '../playground/model'
import {PlaygroundSession} from '../playground/session'
import {SyncLab, SyncOptions} from '../playground/sync-lab'

function setup(profile: SyncOptions['profile'] = 'cold', privacy: SyncOptions['privacy'] = 'deduplicate') {
  const session = new PlaygroundSession()
  session.dispatch({type: 'loadScenario', id: 'sync-sharing'})
  const lab = new SyncLab(session.state, {left: 'alice', right: 'bob', profile, privacy})
  return {session, lab}
}
function finish(lab: SyncLab, session: PlaygroundSession) {
  for (let n = 0; !lab.snapshot().done && n < 500; n++) lab.step(session.state)
  expect(lab.snapshot().done).toBe(true)
  return lab.snapshot()
}

describe('two-peer sync simulation', () => {
  test('cold replication converges only the authorized resources, with shared subtrees reused', () => {
    const {session, lab} = setup()
    const original = clone(session.state)
    const end = finish(lab, session)
    const [alice, bob] = end.peers
    const heads = bob!.tables.resource_heads.map((r) => r.resource)
    expect(heads).toEqual(['lab', 'notes'])
    expect(bob!.tables.frontier).toEqual([])
    expect(alice!.tables.receipts.map((r) => r.resource)).toEqual(['lab', 'notes'])
    for (const head of bob!.tables.resource_heads)
      expect(bob!.tables.complete.some((r) => r.cid === head.head)).toBe(true)
    expect(end.skipped).toBeGreaterThan(0)
    const privateScope = end.scopes.find((s) => s.resource === 'private')!
    expect(bob!.tables.blobs.some((r) => r.cid === privateScope.root)).toBe(false)
    expect(JSON.stringify(end.trace.map((e) => e.payload))).not.toContain(privateScope.root)
    expect(session.state).toEqual(original)
  })

  test('every RPC has a separate request and response, with no storage changes on request', () => {
    const {session, lab} = setup()
    let previous = clone(lab.snapshot().peers)
    for (let n = 0; !lab.snapshot().done && n < 500; n++) {
      lab.step(session.state)
      const frame = lab.snapshot()
      if (frame.event.kind === 'request') expect(frame.peers).toEqual(previous)
      if (frame.event.kind === 'response') {
        const before = frame.trace[frame.cursor - 1]!
        expect(before.kind).toBe('request')
        expect(before.method).toBe(frame.event.method)
        expect(before.from).toBe(frame.event.to)
      }
      previous = clone(frame.peers)
    }
  })

  test('identical heads with missing descendants still trigger fetches', () => {
    const {session, lab} = setup('partial')
    const before = lab.snapshot()
    const head = before.peers[1]!.tables.resource_heads[0]!.head
    expect(before.peers[1]!.tables.blobs.some((r) => r.cid === head)).toBe(true)
    expect(before.peers[1]!.tables.complete.some((r) => r.cid === head)).toBe(false)
    const end = finish(lab, session)
    expect(end.trace.some((e) => e.title === 'Block present · descendants incomplete')).toBe(true)
    expect(end.trace.some((e) => e.method === 'FetchBlock')).toBe(true)
    expect(end.peers[1]!.tables.complete.some((r) => r.cid === head)).toBe(true)
  })

  test('split storage transfers content in both directions', () => {
    const {session, lab} = setup('split')
    const end = finish(lab, session)
    const senders = new Set(
      end.trace.filter((e) => e.method === 'FetchBlock' && e.kind === 'response').map((e) => e.from),
    )
    expect(Array.from(senders).sort()).toEqual([0, 1])
    for (const p of end.peers) {
      for (const scope of end.scopes.filter((s) => s.resource !== 'private')) {
        expect(p.tables.complete.some((r) => r.cid === scope.root)).toBe(true)
      }
    }
  })

  test('uniform transfer hides completeness reuse while preserving physical deduplication', () => {
    const fast = setup('shared')
    const uniform = setup('shared', 'scoped')
    const a = finish(fast.lab, fast.session)
    const b = finish(uniform.lab, uniform.session)
    expect(a.skipped).toBeGreaterThan(0)
    expect(b.skipped).toBe(0)
    expect(b.transferred).toBeGreaterThan(a.transferred)
    expect(new Set(b.peers[1]!.tables.blobs.map((r) => r.cid)).size).toBe(b.peers[1]!.tables.blobs.length)
    expect(b.peers[1]!.tables.blobs.map((r) => r.cid).sort()).toEqual(a.peers[1]!.tables.blobs.map((r) => r.cid).sort())
  })

  test('revocation between fetch request and response invalidates caches without disclosing bytes', () => {
    const {session, lab} = setup()
    for (let n = 0; n < 100; n++) {
      lab.step(session.state)
      if (lab.snapshot().event.method === 'FetchBlock' && lab.snapshot().event.kind === 'request') break
    }
    const before = clone(lab.snapshot().peers.map((p) => p.tables.blobs))
    session.dispatch({type: 'revoke', actor: 'alice', grant: 'g2'})
    lab.step(session.state)
    const after = lab.snapshot()
    expect(after.event.title).toBe('Scope invalidated')
    expect(after.event.payload).toBeUndefined()
    expect(after.peers.map((p) => p.tables.blobs)).toEqual(before)
    expect(after.peers.every((p) => p.tables.authority_cache.length === 0)).toBe(true)
  })

  test('offline peers stop before the handshake and retain all storage', () => {
    const {session, lab} = setup()
    const before = clone(lab.snapshot().peers.map((p) => p.tables.blobs))
    session.state.devices.bob!.online = false
    lab.step(session.state)
    expect(lab.snapshot().event.title).toBe('Peer offline')
    expect(lab.snapshot().peers.map((p) => p.tables.blobs)).toEqual(before)
  })

  test('world edits without a revision bump also fence a scope', () => {
    const {session, lab} = setup()
    session.state.statements[0]!.text = 'Edited fixture'
    lab.step(session.state)
    expect(lab.snapshot().event.title).toBe('Scope invalidated')
  })

  test('a CID link into another resource cannot import its private content', () => {
    const {session} = setup()
    session.state.changes = [
      {id: 'private-change', resource: 'private', author: 'alice', deps: [], ops: ['secret']},
      {id: 'public-change', resource: 'lab', author: 'alice', deps: ['private-change'], ops: []},
    ]
    const ref = session.state.statements[0]!
    ref.kind = 'changes'
    ref.heads = ['public-change']
    ref.apply = 'apply-fixture'
    delete ref.state
    delete ref.text
    const lab = new SyncLab(session.state, {left: 'alice', right: 'bob', profile: 'cold', privacy: 'deduplicate'})
    const end = finish(lab, session)
    expect(end.trace.some((e) => e.title === 'Block unavailable in this scope')).toBe(true)
    expect(end.peers[1]!.tables.frontier.some((r) => r.resource === 'lab')).toBe(true)
    expect(end.peers[0]!.tables.receipts.some((r) => r.resource === 'lab')).toBe(false)
    expect(JSON.stringify(end.trace.map((e) => e.payload))).not.toContain('secret')
  })

  test('rewinding restores exact prior rows and continuing replays deterministically', () => {
    const {session, lab} = setup()
    lab.step(session.state)
    const first = clone(lab.snapshot())
    finish(lab, session)
    lab.seek(1)
    expect(lab.snapshot().peers).toEqual(first.peers)
    expect(lab.snapshot().event).toEqual(first.event)
    lab.seek(0)
    lab.step(session.state)
    expect(lab.snapshot().peers).toEqual(first.peers)
    expect(() => lab.seek(-1)).toThrow('Unknown sync step')
  })

  test('API exposes the same machine, validates options and resets it with the world', () => {
    const session = new PlaygroundSession()
    expect(() => session.dispatch({type: 'syncLabStep'})).toThrow()
    const options = {type: 'syncLabBegin', left: 'alice', right: 'bob', profile: 'cold', privacy: 'deduplicate'}
    expect(() => session.dispatch({...options, left: 'bob'})).toThrow()
    expect(() => session.dispatch({...options, profile: 'unknown'})).toThrow()
    expect(session.dispatch(options).snapshot.syncLab?.cursor).toBe(0)
    expect(session.dispatch({type: 'syncLabStep'}).snapshot.syncLab?.cursor).toBe(1)
    expect(session.dispatch({type: 'syncLabSeek', index: 0}).snapshot.syncLab?.cursor).toBe(0)
    expect(session.dispatch({type: 'loadScenario', id: 'sync-sharing'}).snapshot.syncLab).toBeNull()
  })
})
