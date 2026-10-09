/**
 * Usage ledger for the server's shared Datalab key.
 *
 * Every metered conversion reserves pages before the Datalab call, in the same transaction that
 * checks the account's monthly allowance and the server's monthly ceiling. The reservation is what
 * Datalab is told as `max_pages`, so the spend of a call is bounded before any money moves. On
 * success the row settles to the page count Datalab reports; on failure it is released. Reserved
 * rows count as used until settled, so concurrent calls cannot overshoot the allowance together.
 */

import type {Database} from 'bun:sqlite'
import {stmt} from '@/statements'

/** Most pages one conversion may bill, whatever the caller asks for. */
export const CONVERT_PAGES_PER_CALL_CAP = 200

/** A reservation older than this belongs to a call the process lost (crash, restart); it is released. */
const STALE_RESERVATION_MS = 30 * 60_000

/** Which limit stopped a reservation, reported so the result can say why a document was cut. */
export type ReservationBound = 'requested' | 'call_cap' | 'account_allowance' | 'server_ceiling'

/** Thrown when the account or the server has no shared pages left this month. */
export class ConversionQuotaError extends Error {
  constructor(
    readonly scope: 'account' | 'server',
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      scope === 'account'
        ? `This account has used ${used} of its ${limit} shared conversion pages this month`
        : `This server has used ${used} of its ${limit} shared conversion pages this month`,
    )
    this.name = 'ConversionQuotaError'
  }
}

/** The UTC calendar month a timestamp falls in, as `YYYY-MM`. */
export function periodOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

/** Pages counted against the period: reserved rows at their reservation, settled rows at their charge. */
export function pagesUsed(db: Database, input: {accountId?: string; period: string}): number {
  const row = input.accountId
    ? stmt<{pages: number | null}, [string, string]>(
        db,
        `SELECT SUM(CASE state WHEN 'reserved' THEN pages_reserved WHEN 'settled' THEN pages_charged ELSE 0 END) AS pages
           FROM conversion_usage WHERE account_id = ? AND period = ?`,
      ).get(input.accountId, input.period)
    : stmt<{pages: number | null}, [string]>(
        db,
        `SELECT SUM(CASE state WHEN 'reserved' THEN pages_reserved WHEN 'settled' THEN pages_charged ELSE 0 END) AS pages
           FROM conversion_usage WHERE period = ?`,
      ).get(input.period)
  return row?.pages ?? 0
}

/** What `reservePages` needs to know. `requested` is the caller's own page bound, if any. */
export type ReserveInput = {
  accountId: string
  agentId?: string
  sourceName: string
  requested?: number
  accountAllowance: number
  globalCeiling: number
  now: number
}

/** A reservation: the pages Datalab may bill for this call, and the limit that set that number. */
export type Reservation = {id: string; pages: number; boundBy: ReservationBound; accountRemaining: number}

/**
 * Reserves pages for one conversion, or throws `ConversionQuotaError` when nothing is left. Runs
 * as one transaction so the allowance check and the insert cannot interleave with another call.
 */
export function reservePages(db: Database, input: ReserveInput): Reservation {
  return db.transaction(() => {
    stmt<void, [number, number]>(
      db,
      `UPDATE conversion_usage SET state = 'released', updated_at = ? WHERE state = 'reserved' AND created_at < ?`,
    ).run(input.now, input.now - STALE_RESERVATION_MS)
    const period = periodOf(input.now)
    const accountUsed = pagesUsed(db, {accountId: input.accountId, period})
    const globalUsed = pagesUsed(db, {period})
    const accountRemaining = input.accountAllowance - accountUsed
    const globalRemaining = input.globalCeiling - globalUsed
    if (accountRemaining <= 0) throw new ConversionQuotaError('account', accountUsed, input.accountAllowance)
    if (globalRemaining <= 0) throw new ConversionQuotaError('server', globalUsed, input.globalCeiling)
    const candidates: [ReservationBound, number][] = [
      ['call_cap', CONVERT_PAGES_PER_CALL_CAP],
      ['account_allowance', accountRemaining],
      ['server_ceiling', globalRemaining],
    ]
    if (input.requested !== undefined) candidates.unshift(['requested', input.requested])
    // The smallest bound wins; on a tie the earlier (more specific) one names the reason.
    let [boundBy, pages] = candidates[0]!
    for (const [bound, limit] of candidates) {
      if (limit < pages) [boundBy, pages] = [bound, limit]
    }
    const id = crypto.randomUUID()
    stmt<void, [string, string, string | null, string, number, string | null, number, number]>(
      db,
      `INSERT INTO conversion_usage (id, account_id, agent_id, period, pages_reserved, pages_charged, state, request_id, source_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'reserved', NULL, ?, ?, ?)`,
    ).run(id, input.accountId, input.agentId ?? null, period, pages, input.sourceName, input.now, input.now)
    return {id, pages, boundBy, accountRemaining: accountRemaining - pages}
  })()
}

/** Charges the reservation what Datalab reported, never more than was reserved. */
export function settleReservation(
  db: Database,
  id: string,
  input: {pageCount: number; requestId?: string; now: number},
): void {
  stmt<void, [number, string | null, number, string]>(
    db,
    `UPDATE conversion_usage SET state = 'settled', pages_charged = MIN(?, pages_reserved), request_id = ?, updated_at = ?
       WHERE id = ? AND state = 'reserved'`,
  ).run(Math.max(0, Math.floor(input.pageCount)), input.requestId ?? null, input.now, id)
}

/** Frees a reservation whose conversion did not happen. */
export function releaseReservation(db: Database, id: string, now: number): void {
  stmt<void, [number, string]>(
    db,
    `UPDATE conversion_usage SET state = 'released', updated_at = ? WHERE id = ? AND state = 'reserved'`,
  ).run(now, id)
}
