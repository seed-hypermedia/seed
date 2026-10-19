import {LabState, access, completeSync, initialState, isRevoked, issue, revoke, selected, validGrant} from './model'

export type MissionAction = 'grant' | 'reissue' | 'revoke' | 'redirect' | 'tombstone' | 'sync'

export type Mission = {
  id: string
  title: string
  chapter: string
  xp: number
  story: string
  rule: string
  setup: () => LabState
  scope: string
  key: string
  action: MissionAction
  target?: string
  checks: [string, (s: LabState) => boolean][]
  hints: string[]
}

const base = () => initialState()

/** Puzzle missions are real model predicates, not scripted success animations. */
export const missions: Mission[] = [
  {
    id: 'first-contact',
    title: 'First contact',
    chapter: '01 / READ AUTHORITY',
    xp: 100,
    story: 'Bob has a laptop and a resource address. Neither is permission. Get him a read-only copy of Research lab.',
    rule: 'A key identifies a principal. An exact-resource capability grants authority. Sync needs both the reader and the hosting principal to be authorized.',
    setup: () => {
      const s = base()
      revoke(s, 'alice', 'g4')
      return s
    },
    scope: 'lab',
    key: 'bob',
    action: 'grant',
    checks: [
      ['Bob can read Research lab', (s) => access(s, 'bob', 'lab').read],
      ['Bob cannot write', (s) => !access(s, 'bob', 'lab').write],
      [
        'Bob has synced the selected version',
        (s) => !!s.devices.bob?.cache.lab && s.devices.bob.cache.lab.id === selected(s, 'lab')?.id,
      ],
    ],
    hints: [
      'Alice owns Research lab and can issue a reader capability to Bob. The old grant is revoked, so make a new one.',
      'Use Issue grant with Alice → Bob, Research lab, reader. Then open Sync, start a session and step through it until the replica is committed.',
    ],
  },
  {
    id: 'own-scope',
    title: 'The hidden room',
    chapter: '02 / PLACEMENT ≠ AUTHORITY',
    xp: 150,
    story:
      'Bob needs Field notes, but the parent Research lab must remain private. Arrange direct access and a working host.',
    rule: 'A parent names a place in the resource tree. It never extends a capability to the child, or from a child back to the parent.',
    setup: () => {
      const s = base()
      revoke(s, 'alice', 'g4')
      return s
    },
    scope: 'notes',
    key: 'bob',
    action: 'grant',
    checks: [
      ['Bob can read Field notes', (s) => access(s, 'bob', 'notes').read],
      ['Bob cannot read the parent lab', (s) => !access(s, 'bob', 'lab').read],
      ['Atlas can hold the child resource', (s) => access(s, 'host', 'notes').read],
      [
        'Bob has synced Field notes',
        (s) => !!s.devices.bob?.cache.notes && s.devices.bob.cache.notes.id === selected(s, 'notes')?.id,
      ],
    ],
    hints: [
      'Make two exact-scope reader grants on Field notes: one for Bob and one for Atlas. No parent grant is needed.',
      'The host is a principal too. After both grants, sync as Bob on Field notes.',
    ],
  },
  {
    id: 'new-signature',
    title: 'A new signature',
    chapter: '03 / IMMUTABLE CAPABILITIES',
    xp: 150,
    story: 'Bob has reader grant g4. Give him writer authority without altering a single field of the original grant.',
    rule: 'A signed capability is immutable. Reissuing appends a new capability. The original remains a valid independent route until properly revoked.',
    setup: base,
    scope: 'lab',
    key: 'bob',
    action: 'reissue',
    checks: [
      [
        'g4 remains the original reader grant',
        (s) => {
          const g = s.grants.find((g) => g.id === 'g4')
          return (
            g?.role === 'reader' &&
            g.from === 'alice' &&
            g.to === 'bob' &&
            g.resource === 'lab' &&
            g.proof === 'g1' &&
            !isRevoked(s, 'g4')
          )
        },
      ],
      [
        'A new writer capability cites g4 as its reissue source',
        (s) =>
          s.grants.some(
            (g) =>
              g.reissuedFrom === 'g4' &&
              g.id !== 'g4' &&
              g.role === 'writer' &&
              g.to === 'bob' &&
              g.resource === 'lab' &&
              validGrant(s, g),
          ),
      ],
      ['Bob can write Research lab', (s) => access(s, 'bob', 'lab').write],
    ],
    hints: [
      'Select g4 in the world or the ledger, then choose Reissue capability. Change the new grant’s role to writer.',
      'The new grant needs Alice’s same-scope admin proof g1. No revocation is needed for this mission.',
    ],
  },
  {
    id: 'one-wire',
    title: 'Cut one wire',
    chapter: '04 / INDEPENDENT ROUTES',
    xp: 175,
    story: 'Bob has two reader grants. Revoke g4, but keep his read access alive through the other route.',
    rule: 'Revocation targets an exact capability. It is not a key-wide ban. Validators union the surviving valid routes.',
    setup: () => {
      const s = base()
      issue(s, 'alice', 'bob', 'lab', 'reader')
      return s
    },
    scope: 'lab',
    key: 'bob',
    action: 'revoke',
    checks: [
      ['A valid revocation targets g4', (s) => isRevoked(s, 'g4')],
      ['Bob still has read access', (s) => access(s, 'bob', 'lab').read],
      ['The original g4 record still exists', (s) => s.grants.some((g) => g.id === 'g4' && g.role === 'reader')],
    ],
    hints: [
      'Open g4 and add a revocation blob signed by Alice, with permanent admin proof g1.',
      'Do not remove Bob or revoke the second reader grant. Inspect Bob’s surviving proof in the permissions table.',
    ],
  },
  {
    id: 'rollback',
    title: 'The vanishing version',
    chapter: '05 / CURRENT-STANDING POLICY',
    xp: 200,
    story:
      'Carol wrote selected version v2. Revoke her final writer grant and observe what the proposed current-standing policy does.',
    rule: 'Under this tentative policy, writer revocation reevaluates current statements. It can roll selection back. Bytes already received are not erased.',
    setup: () => {
      const s = base()
      completeSync(s, 'bob', 'lab')
      return s
    },
    scope: 'lab',
    key: 'carol',
    action: 'revoke',
    target: 'g5',
    checks: [
      ['Carol has lost writer authority', (s) => !access(s, 'carol', 'lab').write],
      ['Alice’s v1 is selected again', (s) => selected(s, 'lab')?.id === 'v1'],
      ['Bob retains the previously received v2', (s) => s.devices.bob?.cache.lab?.id === 'v2'],
    ],
    hints: [
      'Revoke g5 as Alice with proof g1. The node statements themselves stay immutable.',
      'Look at selected statement v1 and Bob’s local replica. Current selection and retained bytes are different facts.',
    ],
  },
  {
    id: 'redirect',
    title: 'A door is not a key',
    chapter: '06 / REDIRECTS',
    xp: 200,
    story:
      'Point Research lab at Field notes. Bob may see the redirect, but he must not acquire read authority on its target.',
    rule: 'A redirect names another resource identity. Native resolution is still open; the lab always evaluates target permissions independently.',
    setup: base,
    scope: 'lab',
    key: 'alice',
    action: 'redirect',
    checks: [
      [
        'The selected lab statement is a redirect to Field notes',
        (s) => {
          const v = selected(s, 'lab')
          return v?.kind === 'redirect' && v.target === 'notes'
        },
      ],
      ['Bob can still read the source', (s) => access(s, 'bob', 'lab').read],
      ['Bob cannot read the target', (s) => !access(s, 'bob', 'notes').read],
    ],
    hints: [
      'Create a redirect node statement for Research lab, signed by Alice, with Field notes as the target.',
      'Use a sequence above 2 so the new authorized statement wins. Do not grant Bob access to Field notes.',
    ],
  },
  {
    id: 'tombstone',
    title: 'Leave a trace',
    chapter: '07 / TOMBSTONES & HISTORY',
    xp: 225,
    story: 'Tombstone Research lab and deliver that statement to Bob. Keep both older versions in the raw ledger.',
    rule: 'The lab shows a tombstone as no live rendition. It is a new statement, not deletion of immutable history. Native revival semantics remain open.',
    setup: base,
    scope: 'lab',
    key: 'bob',
    action: 'tombstone',
    checks: [
      ['A tombstone is the selected statement', (s) => selected(s, 'lab')?.kind === 'tombstone'],
      [
        'The original v1 and v2 remain in the ledger',
        (s) => ['v1', 'v2'].every((id) => s.statements.some((v) => v.id === id)),
      ],
      ['Bob has synced the tombstone', (s) => s.devices.bob?.cache.lab?.kind === 'tombstone'],
    ],
    hints: [
      'Create a tombstone node on Research lab, signed by Alice, at a sequence higher than 2.',
      'Sync as Bob. The local replica should retain the tombstone statement; the ledger should still contain v1 and v2.',
    ],
  },
  {
    id: 'offline',
    title: 'You cannot un-send bytes',
    chapter: '08 / OFFLINE KNOWLEDGE',
    xp: 250,
    story:
      'Let Bob receive v2, disconnect his laptop, and revoke his read grant. Show what revocation can and cannot change.',
    rule: 'An honest online peer stops future disclosure after a valid revoke. An offline device may have stale knowledge, and received bytes cannot be recalled.',
    setup: base,
    scope: 'lab',
    key: 'bob',
    action: 'sync',
    checks: [
      ['Bob retains v2 locally', (s) => s.devices.bob?.cache.lab?.id === 'v2'],
      ['Bob’s device is offline', (s) => !!s.devices.bob && !s.devices.bob.online],
      ['Current authority denies Bob a read', (s) => !access(s, 'bob', 'lab').read],
    ],
    hints: [
      'First finish a sync as Bob. Then switch his device offline.',
      'Add an exact revocation for g4 signed by Alice with g1. The replica should still contain v2.',
    ],
  },
]

export function findMission(id: string | null | undefined): Mission | undefined {
  return id ? missions.find((m) => m.id === id) : undefined
}

export type MissionCheck = {label: string; passed: boolean}

/** Evaluate a mission directly against the current permission and replica model. */
export function evaluateMission(id: string, s: LabState): MissionCheck[] {
  const mission = findMission(id)
  if (!mission) return []
  return mission.checks.map(([label, test]) => {
    let passed = false
    try {
      passed = !!test(s)
    } catch {
      passed = false
    }
    return {label, passed}
  })
}

export type MissionProgress = {solved: number; xp: number; rank: string}

/** Compute earned experience without awarding a mission more than once. */
export function missionProgress(completed: string[]): MissionProgress {
  const solved = missions.filter((m) => completed.includes(m.id))
  const xp = solved.reduce((n, m) => n + m.xp, 0)
  return {
    solved: solved.length,
    xp,
    rank: solved.length >= 6 ? 'Proof engineer' : solved.length >= 3 ? 'Access operator' : 'Key apprentice',
  }
}
