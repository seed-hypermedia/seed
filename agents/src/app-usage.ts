/**
 * The usage ledger of metered apps: the units (pages, calls, whatever an app's `usage` block
 * names) an account consumed on a server-wide mount, per UTC period. A space's own mount spends
 * the space's own key and is never recorded here.
 *
 * Every metered run reserves units before the tool runs, in the same transaction that checks the
 * account's allowance and the server's ceiling, both set on the operator's mount page. The
 * reservation is the budget the tool is told (`ctx.usage.reserved`), so the spend of a call is
 * bounded before any money moves. On success the row settles to what the tool reports it used;
 * on failure it is released. Reserved rows count as used until settled, so concurrent calls
 * cannot overshoot the allowance together.
 */
import type {Database} from 'bun:sqlite'
import {stmt} from '@/statements'

/** A reservation older than this belongs to a call the process lost (crash, restart); it is released. */
const STALE_RESERVATION_MS = 60 * 60_000

/** Which limit set a reservation, reported so a tool can say why a document was cut. */
export type UsageBound = 'call_cap' | 'account_allowance' | 'server_ceiling'

/** Thrown when the account or the server has no units left this period. */
export class UsageQuotaError extends Error {
  constructor(
    readonly scope: 'account' | 'server',
    readonly unit: string,
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      scope === 'account'
        ? `This account has used ${used} of its ${limit} shared ${unit} this period`
        : `This server has used ${used} of its ${limit} shared ${unit} this period`,
    )
    this.name = 'UsageQuotaError'
  }
}

/** The UTC calendar month a timestamp falls in, as `YYYY-MM`. */
export function periodOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

/** Units counted against the period: reserved rows at their reservation, settled rows at their charge. */
export function unitsUsed(db: Database, input: {slug: string; accountId?: string; period: string}): number {
  const sum = `SUM(CASE state WHEN 'reserved' THEN units_reserved WHEN 'settled' THEN units_charged ELSE 0 END) AS units`
  const row = input.accountId
    ? stmt<{units: number | null}, [string, string, string]>(
        db,
        `SELECT ${sum} FROM app_usage WHERE slug = ? AND account_id = ? AND period = ?`,
      ).get(input.slug, input.accountId, input.period)
    : stmt<{units: number | null}, [string, string]>(
        db,
        `SELECT ${sum} FROM app_usage WHERE slug = ? AND period = ?`,
      ).get(input.slug, input.period)
  return row?.units ?? 0
}

/** What `reserveUnits` needs to know: the app, who spends, and the three limits. */
export type ReserveInput = {
  slug: string
  accountId: string
  agentId?: string
  unit: string
  callCap: number
  allowance: number
  ceiling: number
  now: number
}

/** A reservation: the units the tool may spend in this call, and the limit that set that number. */
export type Reservation = {id: string; units: number; boundBy: UsageBound; accountRemaining: number}

/**
 * Reserves units for one run, or throws `UsageQuotaError` when nothing is left. Runs as one
 * transaction so the allowance check and the insert cannot interleave with another call.
 */
export function reserveUnits(db: Database, input: ReserveInput): Reservation {
  return db.transaction(() => {
    stmt<void, [number, number]>(
      db,
      `UPDATE app_usage SET state = 'released', updated_at = ? WHERE state = 'reserved' AND created_at < ?`,
    ).run(input.now, input.now - STALE_RESERVATION_MS)
    const period = periodOf(input.now)
    const accountUsed = unitsUsed(db, {slug: input.slug, accountId: input.accountId, period})
    const serverUsed = unitsUsed(db, {slug: input.slug, period})
    const accountRemaining = input.allowance - accountUsed
    const serverRemaining = input.ceiling - serverUsed
    if (accountRemaining <= 0) throw new UsageQuotaError('account', input.unit, accountUsed, input.allowance)
    if (serverRemaining <= 0) throw new UsageQuotaError('server', input.unit, serverUsed, input.ceiling)
    const candidates: [UsageBound, number][] = [
      ['call_cap', input.callCap],
      ['account_allowance', accountRemaining],
      ['server_ceiling', serverRemaining],
    ]
    // The smallest bound wins; on a tie the earlier (more specific) one names the reason.
    let [boundBy, units] = candidates[0]!
    for (const [bound, limit] of candidates) {
      if (limit < units) [boundBy, units] = [bound, limit]
    }
    const id = crypto.randomUUID()
    stmt<void, [string, string, string, string | null, string, number, number, number]>(
      db,
      `INSERT INTO app_usage (id, slug, account_id, agent_id, period, units_reserved, units_charged, state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 'reserved', ?, ?)`,
    ).run(id, input.slug, input.accountId, input.agentId ?? null, period, units, input.now, input.now)
    return {id, units, boundBy, accountRemaining: accountRemaining - units}
  })()
}

/** Charges the reservation what the tool reported, never more than was reserved. */
export function settleReservation(db: Database, id: string, input: {units: number; now: number}): void {
  stmt<void, [number, number, string]>(
    db,
    `UPDATE app_usage SET state = 'settled', units_charged = MIN(?, units_reserved), updated_at = ?
       WHERE id = ? AND state = 'reserved'`,
  ).run(Math.max(0, Math.floor(input.units)), input.now, id)
}

/** Frees a reservation whose run did not happen. */
export function releaseReservation(db: Database, id: string, now: number): void {
  stmt<void, [number, string]>(
    db,
    `UPDATE app_usage SET state = 'released', updated_at = ? WHERE id = ? AND state = 'reserved'`,
  ).run(now, id)
}
