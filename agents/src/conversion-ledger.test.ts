import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import * as ledger from '@/conversion-ledger'
import * as sqlite from '@/sqlite'

function openDb(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const opened = sqlite.openWithDatabase(db)
  if (!opened.ok) throw new Error('schema failed')
  const now = Date.now()
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES ('acc-a', ?, ?), ('acc-b', ?, ?)`, [
    now,
    now,
    now,
    now,
  ])
  return db
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
const base = {accountAllowance: 1000, globalCeiling: 20000, now: NOW, sourceName: 'paper.pdf'}

describe('conversion ledger', () => {
  test('periodOf is the UTC month', () => {
    expect(ledger.periodOf(NOW)).toBe('2026-10')
    expect(ledger.periodOf(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12')
  })

  test('the reservation is the smallest of request, call cap, account and server remaining', () => {
    const db = openDb()
    try {
      expect(ledger.reservePages(db, {...base, accountId: 'acc-a'})).toMatchObject({
        pages: ledger.CONVERT_PAGES_PER_CALL_CAP,
        boundBy: 'call_cap',
      })
      expect(ledger.reservePages(db, {...base, accountId: 'acc-a', requested: 12})).toMatchObject({
        pages: 12,
        boundBy: 'requested',
      })
      expect(ledger.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 250})).toMatchObject({
        pages: 38,
        boundBy: 'account_allowance',
        accountRemaining: 0,
      })
      expect(ledger.reservePages(db, {...base, accountId: 'acc-b', globalCeiling: 300})).toMatchObject({
        pages: 50,
        boundBy: 'server_ceiling',
      })
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('refuses when the account or the server has nothing left', () => {
    const db = openDb()
    try {
      ledger.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})
      expect(() => ledger.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})).toThrow(
        ledger.ConversionQuotaError,
      )
      try {
        ledger.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})
      } catch (error) {
        expect((error as ledger.ConversionQuotaError).scope).toBe('account')
        expect((error as ledger.ConversionQuotaError).used).toBe(200)
      }
      try {
        ledger.reservePages(db, {...base, accountId: 'acc-b', globalCeiling: 200})
      } catch (error) {
        expect((error as ledger.ConversionQuotaError).scope).toBe('server')
        expect((error as Error).message).toContain('200 of its 200')
      }
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('settle charges at most the reservation and release frees it', () => {
    const db = openDb()
    try {
      const a = ledger.reservePages(db, {...base, accountId: 'acc-a', requested: 50})
      const b = ledger.reservePages(db, {...base, accountId: 'acc-a', requested: 50})
      expect(ledger.pagesUsed(db, {accountId: 'acc-a', period: '2026-10'})).toBe(100)
      ledger.settleReservation(db, a.id, {pageCount: 120, requestId: 'req-1', now: NOW + 1})
      ledger.releaseReservation(db, b.id, NOW + 1)
      expect(ledger.pagesUsed(db, {accountId: 'acc-a', period: '2026-10'})).toBe(50)
      // Settling or releasing twice is a no-op.
      ledger.settleReservation(db, a.id, {pageCount: 1, now: NOW + 2})
      ledger.releaseReservation(db, a.id, NOW + 2)
      expect(ledger.pagesUsed(db, {accountId: 'acc-a', period: '2026-10'})).toBe(50)
      const row = db
        .query<{request_id: string; state: string}, [string]>(
          `SELECT request_id, state FROM conversion_usage WHERE id = ?`,
        )
        .get(a.id)
      expect(row).toEqual({request_id: 'req-1', state: 'settled'})
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('a stale reservation is released by the next reserve', () => {
    const db = openDb()
    try {
      ledger.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})
      const later = NOW + 31 * 60_000
      const next = ledger.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200, now: later})
      expect(next.pages).toBe(200)
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('usage is isolated per month and per account', () => {
    const db = openDb()
    try {
      const a = ledger.reservePages(db, {...base, accountId: 'acc-a', requested: 70})
      ledger.settleReservation(db, a.id, {pageCount: 70, now: NOW})
      expect(ledger.pagesUsed(db, {accountId: 'acc-a', period: '2026-11'})).toBe(0)
      expect(ledger.pagesUsed(db, {accountId: 'acc-b', period: '2026-10'})).toBe(0)
      expect(ledger.pagesUsed(db, {period: '2026-10'})).toBe(70)
      const next = ledger.reservePages(db, {...base, accountId: 'acc-a', now: Date.UTC(2026, 10, 1)})
      expect(next.accountRemaining).toBe(1000 - ledger.CONVERT_PAGES_PER_CALL_CAP)
    } finally {
      sqlite.closeDatabase(db)
    }
  })
})
