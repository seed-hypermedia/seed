import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as appUsage from '@/app-usage'
import * as sqlite from '@/sqlite'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeDb(accounts: string[]): Database {
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  const now = Date.now()
  for (const id of accounts)
    db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, [id, now, now])
  cleanups.push(() => sqlite.closeDatabase(db))
  return db
}

const limits = {slug: 'convert', unit: 'pages', callCap: 200, allowance: 1000, ceiling: 20000}

describe('app usage ledger', () => {
  test('periodOf is the UTC month', () => {
    expect(appUsage.periodOf(Date.UTC(2026, 9, 26, 23, 59))).toBe('2026-10')
    expect(appUsage.periodOf(Date.UTC(2026, 10, 1, 0, 0))).toBe('2026-11')
  })

  test('the reservation is the smallest of the call cap, the account allowance and the server ceiling', () => {
    const db = makeDb(['a', 'b'])
    const now = Date.UTC(2026, 9, 26)
    expect(appUsage.reserveUnits(db, {...limits, accountId: 'a', now})).toMatchObject({units: 200, boundBy: 'call_cap'})
    expect(appUsage.reserveUnits(db, {...limits, accountId: 'a', now, callCap: 5000})).toMatchObject({
      units: 800,
      boundBy: 'account_allowance',
      accountRemaining: 0,
    })
    // Another account spends against the same server ceiling, which the two reservations have eaten into.
    expect(
      appUsage.reserveUnits(db, {...limits, accountId: 'b', now, callCap: 50_000, allowance: 50_000}),
    ).toMatchObject({
      units: 19_000,
      boundBy: 'server_ceiling',
    })
    expect(appUsage.unitsUsed(db, {slug: 'convert', period: '2026-10'})).toBe(20_000)
  })

  test('refuses when the account or the server has nothing left, naming the unit', () => {
    const db = makeDb(['a', 'b'])
    const now = Date.UTC(2026, 9, 26)
    appUsage.reserveUnits(db, {...limits, accountId: 'a', now, callCap: 5000})
    expect(() => appUsage.reserveUnits(db, {...limits, accountId: 'a', now})).toThrow(
      'This account has used 1000 of its 1000 shared pages this period',
    )
    appUsage.reserveUnits(db, {...limits, accountId: 'b', now, callCap: 50_000, allowance: 50_000})
    expect(() => appUsage.reserveUnits(db, {...limits, accountId: 'b', now, allowance: 50_000})).toThrow(
      'This server has used 20000 of its 20000 shared pages this period',
    )
  })

  test('settle charges at most the reservation, release frees it, and both are final', () => {
    const db = makeDb(['a'])
    const now = Date.UTC(2026, 9, 26)
    const first = appUsage.reserveUnits(db, {...limits, accountId: 'a', now})
    appUsage.settleReservation(db, first.id, {units: 7, now})
    expect(appUsage.unitsUsed(db, {slug: 'convert', accountId: 'a', period: '2026-10'})).toBe(7)
    const second = appUsage.reserveUnits(db, {...limits, accountId: 'a', now})
    appUsage.settleReservation(db, second.id, {units: 999, now})
    expect(appUsage.unitsUsed(db, {slug: 'convert', accountId: 'a', period: '2026-10'})).toBe(207)
    const third = appUsage.reserveUnits(db, {...limits, accountId: 'a', now})
    appUsage.releaseReservation(db, third.id, now)
    expect(appUsage.unitsUsed(db, {slug: 'convert', accountId: 'a', period: '2026-10'})).toBe(207)
    // Settling a released row, or releasing a settled one, changes nothing.
    appUsage.settleReservation(db, third.id, {units: 100, now})
    appUsage.releaseReservation(db, second.id, now)
    expect(appUsage.unitsUsed(db, {slug: 'convert', accountId: 'a', period: '2026-10'})).toBe(207)
  })

  test('a stale reservation is released by the next reserve, and periods and apps are kept apart', () => {
    const db = makeDb(['a'])
    const october = Date.UTC(2026, 9, 26)
    appUsage.reserveUnits(db, {...limits, accountId: 'a', now: october})
    expect(appUsage.unitsUsed(db, {slug: 'convert', accountId: 'a', period: '2026-10'})).toBe(200)
    // An hour and a bit later the call that reserved is taken for lost; its pages come back.
    appUsage.reserveUnits(db, {...limits, slug: 'other', unit: 'calls', accountId: 'a', now: october + 61 * 60_000})
    expect(appUsage.unitsUsed(db, {slug: 'convert', accountId: 'a', period: '2026-10'})).toBe(0)
    expect(appUsage.unitsUsed(db, {slug: 'other', accountId: 'a', period: '2026-10'})).toBe(200)
    // November starts from nothing.
    expect(appUsage.unitsUsed(db, {slug: 'other', accountId: 'a', period: '2026-11'})).toBe(0)
  })
})
