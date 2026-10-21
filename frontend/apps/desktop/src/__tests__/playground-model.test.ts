import {describe, expect, test} from 'vitest'
import {
  LabState,
  access,
  completeSync,
  initialState,
  issue,
  pathFor,
  publish,
  reissueCapability,
  rendition,
  revoke,
  selected,
  syncSteps,
  validGrant,
  nodeProblems,
  allProblems,
  validRevocation,
  placementProblems,
  validateState,
} from '../playground/model'
import {worldRecords} from '../playground/records'

describe('HM26 playground model', () => {
  test('exact resource scope and writer lattice', () => {
    const s = initialState()
    expect(access(s, 'bob', 'lab').read).toBe(true)
    expect(access(s, 'bob', 'notes').read).toBe(false)
    expect(access(s, 'carol', 'lab').read).toBe(true)
    expect(access(s, 'carol', 'lab').admin).toBe(false)
    expect(() => issue(s, 'carol', 'bob', 'lab', 'reader')).toThrow()
  })

  test('revoke one of two independent routes', () => {
    const s = initialState()
    issue(s, 'alice', 'bob', 'lab', 'reader')
    revoke(s, 'alice', 'g4')
    expect(access(s, 'bob', 'lab').read).toBe(true)
  })

  test('admin chain permanent, scoped, admin only revoke', () => {
    const s = initialState()
    const a = issue(s, 'alice', 'bob', 'lab', 'admin')
    const b = issue(s, 'bob', 'bot', 'lab', 'admin')
    expect(validGrant(s, b)).toBe(true)
    expect(() => revoke(s, 'alice', a.id)).toThrow()
    expect(() => revoke(s, 'carol', 'g4')).toThrow()
    expect(() => issue(s, 'bob', 'bot', 'notes', 'reader')).toThrow()
    revoke(s, 'bob', 'g4')
    expect(access(s, 'bob', 'lab').admin).toBe(true)
  })

  test('current standing rollback and regrant revival', () => {
    const s = initialState()
    expect(selected(s, 'lab')?.id).toBe('v2')
    revoke(s, 'alice', 'g5')
    expect(selected(s, 'lab')?.id).toBe('v1')
    issue(s, 'alice', 'carol', 'lab', 'writer')
    expect(selected(s, 'lab')?.id).toBe('v2')
  })

  test('offline bytes retained without fresh reads', () => {
    const s = initialState()
    completeSync(s, 'bob', 'lab')
    s.devices.bob!.online = false
    revoke(s, 'alice', 'g4')
    expect(s.devices.bob!.cache.lab?.id).toBe('v2')
    expect(completeSync(s, 'bob', 'lab')).toBe(false)
    expect(syncSteps(s, 'bob', 'lab')[0]?.kind).toBe('warn')
  })

  test('host custody is independent of reader authority', () => {
    const s = initialState()
    revoke(s, 'alice', 'g6')
    expect(access(s, 'bob', 'lab').read).toBe(true)
    expect(completeSync(s, 'bob', 'lab')).toBe(false)
    expect(syncSteps(s, 'bob', 'lab')[0]?.kind).toBe('deny')
  })

  test('public read never implies write or roster', () => {
    const s = initialState()
    expect(access(s, 'bob', 'public').read).toBe(true)
    expect(access(s, 'bob', 'public').write).toBe(false)
    expect(access(s, 'bob', 'public').admin).toBe(false)
    expect(() => publish(s, 'bob', 'public', 'hi')).toThrow()
  })

  test('explicit copies survive source grant revocation', () => {
    const s = initialState()
    const g = issue(s, 'alice', 'bot', 'lab', 'reader')
    issue(s, 'alice', 'bot', 'public', 'writer')
    const v = publish(s, 'bot', 'public', selected(s, 'lab')!.text!)
    revoke(s, 'alice', g.id)
    expect(access(s, 'bot', 'lab').read).toBe(false)
    expect(selected(s, 'public')?.id).toBe(v.id)
    expect(s.outbox[0]?.status).toBe('queued')
  })

  test('mutating proof to different scope cannot establish authority', () => {
    const s = initialState()
    const g = issue(s, 'alice', 'bob', 'lab', 'reader')
    g.proof = 'g2'
    expect(validGrant(s, g)).toBe(false)
  })

  test('resource owner anchors independent admin chains', () => {
    const s = initialState()
    s.resources[0]!.owner = 'bob'
    expect(access(s, 'alice', 'lab').admin).toBe(false)
    s.grants.push({id: 'new-root', from: 'bob', to: 'bob', resource: 'lab', role: 'admin', proof: null})
    expect(access(s, 'bob', 'lab').admin).toBe(true)
    expect(access(s, 'carol', 'lab').write).toBe(false)
  })

  test('placement problems: sibling names, loops and cross-root parents are reported, not refused', () => {
    const s = initialState()
    expect(pathFor(s, 'notes')).toBe('/lab/notes')
    const r = {...s.resources[1]!, id: 'extra'}
    expect(placementProblems(s, r)).toEqual([expect.stringMatching(/already named "notes"/)])
    r.segment = ''
    expect(placementProblems(s, r)).toEqual([])
    r.parent = r.id
    expect(placementProblems(s, r)).toEqual([expect.stringMatching(/loops/)])
    r.parent = 'lab'
    r.owner = 'bob'
    expect(placementProblems(s, r)).toEqual([expect.stringMatching(/owned by Alice, a different key/)])
    r.parent = 'nowhere'
    expect(placementProblems(s, r)).toEqual([expect.stringMatching(/"nowhere" does not exist/)])
  })

  test('signed exact revocation is scoped and cannot remove permanent admin', () => {
    const s = initialState()
    revoke(s, 'alice', 'g4')
    expect(s.revocations.length).toBe(1)
    expect(validRevocation(s, s.revocations[0]!)).toBe(true)
    expect(access(s, 'bob', 'lab').read).toBe(false)
    s.revocations[0]!.proof = 'g2'
    expect(access(s, 'bob', 'lab').read).toBe(true)
    s.revocations[0] = {id: 'bad-revoke', author: 'alice', target: 'g1', resource: 'lab', proof: 'g1'}
    expect(validRevocation(s, s.revocations[0])).toBe(false)
    expect(access(s, 'alice', 'lab').admin).toBe(true)
  })

  test('tombstone and redirect select without granting target read or erasing history', () => {
    const s = initialState()
    s.statements.push({id: 'tomb', resource: 'lab', author: 'alice', seq: 10, kind: 'tombstone', prev: 'v2'})
    expect(rendition(s, 'lab').status).toBe('tombstone')
    expect(s.statements.some((v) => v.id === 'v2')).toBe(true)
    s.statements.push({id: 'redir', resource: 'lab', author: 'alice', seq: 11, kind: 'redirect', target: 'notes'})
    expect(rendition(s, 'lab').status).toBe('redirect')
    expect(access(s, 'bob', 'notes').read).toBe(false)
    expect(() => revoke(s, 'alice', 'g1')).toThrow()
  })

  test('change variants keep missing, cyclic and unsupported apply states explicit', () => {
    const s = initialState()
    const v = {
      id: 'dag-node',
      resource: 'lab',
      author: 'alice',
      seq: 20,
      kind: 'changes-snapshot' as const,
      heads: ['c-root'],
      apply: 'bafy-apply',
      snapshot: {untrusted: true},
    }
    s.statements.push(v)
    expect(rendition(s, 'lab').status).toBe('missing')
    s.changes.push({id: 'c-root', resource: 'lab', author: 'alice', deps: [], ops: [{hello: 'world'}]})
    expect(rendition(s, 'lab').status).toBe('unsupported')
    s.changes[0]!.deps = ['c-root']
    expect(rendition(s, 'lab').status).toBe('invalid')
    expect(nodeProblems({...v, prev: 'v2'})).toEqual([expect.stringMatching(/does not take prev/)])
    expect(nodeProblems({kind: 'republish', target: 'notes'})).toEqual([expect.stringMatching(/no payload/)])
    expect(nodeProblems(v)).toEqual([])
  })

  test('malformed states reject atomically; wrong but well-formed blobs are kept and flagged', () => {
    const s = initialState()
    s.resources[1]!.parent = 'notes'
    expect(() => validateState(s)).not.toThrow()
    expect(allProblems(s).notes).toEqual([expect.stringMatching(/loops/)])
    s.resources[1]!.parent = 'lab'
    ;(s.grants[0] as unknown as {role: string}).role = 'toString'
    expect(() => validateState(s)).not.toThrow()
    expect(allProblems(s).g1).toContainEqual(expect.stringMatching(/not a role/))
    expect(access(s, 'alice', 'lab').admin).toBe(false)
    ;(s.grants[0] as unknown as {role: unknown}).role = 7
    expect(() => validateState(s)).toThrow()
    expect(() => validateState({keys: []})).toThrow()
    expect(() => validateState('nope')).toThrow()
  })

  test('validateState returns a copy that evaluates identically', () => {
    const s = initialState()
    s.keys[1]!.name = 'Bób 🗝️'
    completeSync(s, 'bob', 'lab')
    revoke(s, 'alice', 'g4')
    const copy = validateState(JSON.parse(JSON.stringify(s)))
    expect(copy).toEqual(s)
    expect(access(copy, 'bob', 'lab').read).toBe(false)
    expect(copy.devices.bob!.cache.lab?.id).toBe('v2')
  })

  test('reissue appends a fresh grant without editing or revoking the original', () => {
    const s = initialState()
    const before = structuredClone(s.grants.find((g) => g.id === 'g4'))
    const replacement = reissueCapability(s, 'g4', {role: 'writer'})
    expect(replacement.id).not.toBe('g4')
    expect(replacement.reissuedFrom).toBe('g4')
    expect(s.grants.find((g) => g.id === 'g4')).toEqual(before)
    expect(access(s, 'bob', 'lab').write).toBe(true)
    expect(s.revocations.length).toBe(0)
    revoke(s, 'alice', 'g4')
    expect(access(s, 'bob', 'lab').write).toBe(true)
  })

  test('ledger includes exact raw records and links all authority dependencies', () => {
    const s = initialState()
    const records = worldRecords(s)
    const r = records.find((r) => r.type === 'grant' && r.id === 'g4')!
    expect(r.raw).toEqual(s.grants.find((g) => g.id === 'g4'))
    expect(r.refs.map((r) => r.type + ':' + r.id)).toEqual(['key:alice', 'key:bob', 'resource:lab', 'grant:g1'])
    expect(records.filter((r) => r.type === 'device').length).toBe(s.keys.length)
    expect(records.filter((r) => r.type === 'policy').length).toBe(s.resources.length)
  })
})
