import {
  HOST_KEY,
  LabState,
  Rendition,
  access,
  allProblems,
  isRevoked,
  pathFor,
  rendition,
  routes,
  selected,
  statementProblems,
  validGrant,
  validRevocation,
} from './model'
import {LedgerRecord, worldRecords} from './records'

export type GrantStatus = 'valid' | 'revoked' | 'invalid'

/** INVALID: the statement cannot be evaluated. INELIGIBLE: its author cannot write right now. */
export type StatementStatus = 'SELECTED' | 'OLDER' | 'INELIGIBLE' | 'INVALID'

export type AccessView = {
  read: boolean
  write: boolean
  admin: boolean
  level: number
  /** Ids of the valid grants that give this key its rights on the resource. */
  grants: string[]
  public: boolean
  /** Whether a sync as this key could complete right now: read right, host custody, device online. */
  sync: boolean
}

export type ResourceView = {
  path: string
  selected: string | null
  rendition: Rendition
}

/**
 * Everything the client needs that is computed from the state rather than stored in it. The client
 * never evaluates authority itself; it reads these facts.
 */
export type DerivedView = {
  resources: Record<string, ResourceView>
  grants: Record<string, {status: GrantStatus}>
  revocations: Record<string, {valid: boolean}>
  statements: Record<string, {status: StatementStatus}>
  access: Record<string, Record<string, AccessView>>
  /** For each key and resource, the id of a valid admin grant held by the key, if any. */
  adminRoute: Record<string, Record<string, string | null>>
  /**
   * Why a record cannot be evaluated, by id: a placement that does not resolve, a grant whose
   * proof is wrong, a statement that names a missing author. Records that evaluate cleanly are
   * absent. The record itself is still stored; nothing is refused for being wrong.
   */
  problems: Record<string, string[]>
  records: LedgerRecord[]
  stats: {principals: number; resources: number; activeGrants: number; revocations: number; invalid: number}
}

export function deriveView(s: LabState): DerivedView {
  const resources: DerivedView['resources'] = {}
  for (const r of s.resources) {
    resources[r.id] = {path: pathFor(s, r.id), selected: selected(s, r.id)?.id ?? null, rendition: rendition(s, r.id)}
  }
  const grants: DerivedView['grants'] = {}
  for (const g of s.grants) {
    grants[g.id] = {status: isRevoked(s, g.id) ? 'revoked' : validGrant(s, g) ? 'valid' : 'invalid'}
  }
  const revocations: DerivedView['revocations'] = {}
  for (const v of s.revocations) revocations[v.id] = {valid: validRevocation(s, v)}
  const statements: DerivedView['statements'] = {}
  for (const v of s.statements) {
    statements[v.id] = {
      status:
        resources[v.resource]?.selected === v.id
          ? 'SELECTED'
          : statementProblems(s, v).length
            ? 'INVALID'
            : access(s, v.author, v.resource).write
              ? 'OLDER'
              : 'INELIGIBLE',
    }
  }
  const accessView: DerivedView['access'] = {}
  const adminRoute: DerivedView['adminRoute'] = {}
  for (const k of s.keys) {
    accessView[k.id] = {}
    adminRoute[k.id] = {}
    for (const r of s.resources) {
      const a = access(s, k.id, r.id)
      accessView[k.id][r.id] = {
        read: a.read,
        write: a.write,
        admin: a.admin,
        level: a.level,
        grants: a.grants.map((g) => g.id),
        public: a.public,
        sync: a.read && access(s, HOST_KEY, r.id).read && !!s.devices[k.id]?.online,
      }
      adminRoute[k.id][r.id] = routes(s, k.id, r.id).find((g) => g.role === 'admin')?.id ?? null
    }
  }
  const problems = allProblems(s)
  return {
    resources,
    grants,
    revocations,
    statements,
    access: accessView,
    adminRoute,
    problems,
    records: worldRecords(s),
    stats: {
      principals: s.keys.length,
      resources: s.resources.length,
      activeGrants: s.grants.filter((g) => validGrant(s, g)).length,
      revocations: s.grants.filter((g) => isRevoked(s, g.id)).length,
      invalid: Object.keys(problems).length,
    },
  }
}
