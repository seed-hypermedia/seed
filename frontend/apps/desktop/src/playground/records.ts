import {LabState, access, isRevoked, selected, statementProblems, validGrant, validRevocation} from './model'

export const recordTypes = [
  'key',
  'resource',
  'grant',
  'statement',
  'change',
  'revocation',
  'policy',
  'device',
  'offer',
  'meta',
] as const
export type RecordType = (typeof recordTypes)[number]

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && (recordTypes as readonly string[]).includes(value)
}

export type RecordRef = {type: RecordType; id: string; label: string}

export type LedgerRecord = {
  type: RecordType
  id: string
  label: string
  collection: string
  owner: string | null
  resource: string | null
  status: string
  raw: unknown
  refs: RecordRef[]
}

type RefInput = [RecordType, string, string?] | false | null | undefined | ''

/** Build a flat ledger of every model record, with explicit references and raw source data. */
export function worldRecords(s: LabState): LedgerRecord[] {
  const key = (id: string) => s.keys.find((k) => k.id === id)?.name || id
  const rname = (id: string) => s.resources.find((r) => r.id === id)?.name || id
  const refs = (...xs: RefInput[]): RecordRef[] =>
    xs
      .filter((x): x is [RecordType, string, string?] => Array.isArray(x))
      .map(([type, id, label]) => ({type, id, label: label || id}))
  return [
    ...s.keys.map(
      (k): LedgerRecord => ({
        type: 'key',
        id: k.id,
        label: k.name,
        collection: 'keys',
        owner: k.id,
        resource: null,
        status: 'PRINCIPAL',
        raw: k,
        refs: [],
      }),
    ),
    ...s.resources.map((r): LedgerRecord => {
      const v = selected(s, r.id)
      return {
        type: 'resource',
        id: r.id,
        label: r.name,
        collection: 'resources',
        owner: r.owner,
        resource: r.id,
        status: r.public ? 'PUBLIC' : 'PRIVATE',
        raw: r,
        refs: refs(
          ['key', r.owner, key(r.owner)],
          r.parent && ['resource', r.parent, rname(r.parent)],
          v && ['statement', v.id, 'selected ' + v.id],
        ),
      }
    }),
    ...s.grants.map(
      (g): LedgerRecord => ({
        type: 'grant',
        id: g.id,
        label: g.role + ' → ' + key(g.to),
        collection: 'grants',
        owner: g.from,
        resource: g.resource,
        status: isRevoked(s, g.id) ? 'REVOKED' : validGrant(s, g) ? 'VALID' : 'INVALID',
        raw: g,
        refs: refs(
          ['key', g.from, 'issuer ' + key(g.from)],
          ['key', g.to, 'recipient ' + key(g.to)],
          ['resource', g.resource, rname(g.resource)],
          g.proof && ['grant', g.proof, 'proof ' + g.proof],
          g.reissuedFrom && ['grant', g.reissuedFrom, 'reissued from ' + g.reissuedFrom],
        ),
      }),
    ),
    ...s.statements.map(
      (v): LedgerRecord => ({
        type: 'statement',
        id: v.id,
        label: v.kind,
        collection: 'statements',
        owner: v.author,
        resource: v.resource,
        status:
          selected(s, v.resource)?.id === v.id
            ? 'SELECTED'
            : statementProblems(s, v).length
              ? 'INVALID'
              : access(s, v.author, v.resource).write
                ? 'OLDER'
                : 'INELIGIBLE',
        raw: v,
        refs: refs(
          ['key', v.author, key(v.author)],
          ['resource', v.resource, rname(v.resource)],
          v.prev && ['statement', v.prev, 'prev ' + v.prev],
          v.target && ['resource', v.target, 'target ' + rname(v.target)],
          ...(v.heads || []).map((h): RefInput => ['change', h, 'head ' + h]),
        ),
      }),
    ),
    ...s.changes.map(
      (v): LedgerRecord => ({
        type: 'change',
        id: v.id,
        label: 'Change DAG operations',
        collection: 'changes',
        owner: v.author,
        resource: v.resource,
        status: 'RETAINED',
        raw: v,
        refs: refs(
          ['key', v.author, key(v.author)],
          ['resource', v.resource, rname(v.resource)],
          ...v.deps.map((d): RefInput => ['change', d, 'dependency ' + d]),
        ),
      }),
    ),
    ...s.revocations.map(
      (v): LedgerRecord => ({
        type: 'revocation',
        id: v.id,
        label: 'revoke ' + v.target,
        collection: 'revocations',
        owner: v.author,
        resource: v.resource,
        status: validRevocation(s, v) ? 'VALID' : 'INVALID',
        raw: v,
        refs: refs(
          ['key', v.author, key(v.author)],
          ['resource', v.resource, rname(v.resource)],
          ['grant', v.target, 'target ' + v.target],
          ['grant', v.proof, 'proof ' + v.proof],
        ),
      }),
    ),
    ...s.resources.map(
      (r): LedgerRecord => ({
        type: 'policy',
        id: 'policy-' + r.id,
        label: 'ResourcePolicy · ' + r.name,
        collection: 'resources (derived policy view)',
        owner: r.owner,
        resource: r.id,
        status: r.public ? 'PUBLIC' : 'PRIVATE',
        raw: {
          id: 'policy-' + r.id,
          resource: r.id,
          signer: r.owner,
          public: r.public,
          note: 'Synthetic policy view; runtime schema is not published.',
        },
        refs: refs(['key', r.owner, key(r.owner)], ['resource', r.id, r.name]),
      }),
    ),
    ...s.keys.map(
      (k): LedgerRecord => ({
        type: 'device',
        id: k.id,
        label: key(k.id) + ' local replica',
        collection: 'devices',
        owner: k.id,
        resource: null,
        status: s.devices[k.id]?.online ? 'ONLINE' : 'OFFLINE',
        raw: s.devices[k.id],
        refs: refs(['key', k.id, key(k.id)]),
      }),
    ),
    ...s.outbox.map(
      (j): LedgerRecord => ({
        type: 'offer',
        id: j.id,
        label: 'offer ' + j.version,
        collection: 'outbox',
        owner: j.author,
        resource: j.resource,
        status: j.status,
        raw: j,
        refs: refs(
          ['key', j.author, key(j.author)],
          ['resource', j.resource, rname(j.resource)],
          ['statement', j.version, j.version],
        ),
      }),
    ),
    {
      type: 'meta',
      id: 'world',
      label: 'World counters + event records',
      collection: 'world',
      owner: null,
      resource: null,
      status: 'MODEL',
      raw: {revision: s.revision, serial: s.serial, events: s.events},
      refs: [],
    },
  ]
}
