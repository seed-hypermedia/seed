import {afterEach, beforeEach, describe, expect, spyOn, test} from 'bun:test'
import {Database} from 'bun:sqlite'
import {perfSnapshot, resetPerfForTests} from '@/perf'
import {
  SLOW_LOG_LINES_PER_WINDOW,
  SLOW_STATEMENT_MS,
  cachedStatementCount,
  finalizeStatements,
  setSlowStatementThresholdForTests,
  stmt,
} from './statements'

describe('statements', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:', {strict: true})
    db.run('CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)')
    db.run('INSERT INTO t (n) VALUES (1), (2), (3)')
  })

  afterEach(() => {
    finalizeStatements(db)
    db.close()
    setSlowStatementThresholdForTests(undefined)
    resetPerfForTests()
  })

  test('returns the same Statement for the same SQL across 40 distinct statements', () => {
    // Database.query() only caches ~20 distinct strings; this is exactly the case it fails.
    const sqls = Array.from({length: 40}, (_, i) => `SELECT n + ${i} AS v FROM t WHERE id = ?`)
    const first = sqls.map((sql) => stmt<{v: number}, [number]>(db, sql))
    const second = sqls.map((sql) => stmt<{v: number}, [number]>(db, sql))
    for (let i = 0; i < sqls.length; i++) {
      expect(second[i]).toBe(first[i]!)
      expect(second[i]!.get(2)).toEqual({v: 2 + i})
    }
    expect(cachedStatementCount(db)).toBe(40)

    // Database.query() does not hold all 40 (documenting the behavior this module exists for).
    const viaQuery = sqls.map((sql) => db.query(sql))
    const sameViaQuery = sqls.filter((sql, i) => db.query(sql) === viaQuery[i]).length
    expect(sameViaQuery).toBeLessThan(40)
  })

  test('caches per Database instance', () => {
    const other = new Database(':memory:')
    try {
      expect(stmt(db, 'SELECT 1')).not.toBe(stmt(other, 'SELECT 1'))
      expect(stmt(db, 'SELECT 1')).toBe(stmt(db, 'SELECT 1'))
    } finally {
      finalizeStatements(other)
      other.close()
    }
  })

  test('get/all/run/values work with array and spread bindings', () => {
    expect(stmt<{n: number}, [number]>(db, 'SELECT n FROM t WHERE id = ?').get(1)).toEqual({n: 1})
    expect(stmt<{n: number}>(db, 'SELECT n FROM t WHERE id = ?').get([3])).toEqual({n: 3})
    expect(stmt<{n: number}, [number]>(db, 'SELECT n FROM t WHERE n > ? ORDER BY n').all(1)).toEqual([{n: 2}, {n: 3}])
    expect(stmt<{n: number}>(db, 'SELECT n FROM t WHERE n > ? ORDER BY n').values([1])).toEqual([[2], [3]])
    expect(stmt(db, 'UPDATE t SET n = n + 10 WHERE id = ?').run(1).changes).toBe(1)
    expect(stmt(db, 'UPDATE t SET n = n + 10 WHERE id = ?').run([2]).changes).toBe(1)
    expect(stmt<{n: number}, []>(db, 'SELECT n FROM t WHERE id = 1').get()).toEqual({n: 11})
  })

  test('finalizeStatements empties the cache and later calls prepare fresh statements', () => {
    const before = stmt(db, 'SELECT 1 AS one')
    finalizeStatements(db)
    expect(cachedStatementCount(db)).toBe(0)
    const after = stmt<{one: number}, []>(db, 'SELECT 1 AS one')
    expect(after).not.toBe(before)
    expect(after.get()).toEqual({one: 1})
    finalizeStatements(db)
    finalizeStatements(db) // idempotent
  })

  describe('timing', () => {
    test('every verb records sql.<keyword>; nothing is slow below the threshold', () => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {})
      try {
        expect(SLOW_STATEMENT_MS).toBe(20)
        stmt<{n: number}, [number]>(db, 'SELECT n FROM t WHERE id = ?').get(1)
        stmt<{n: number}, [number]>(db, '  select n FROM t WHERE n > ?').all(1)
        stmt(db, 'UPDATE t SET n = n + 1 WHERE id = ?').run(1)
        stmt<{n: number}, [number]>(db, 'SELECT n FROM t WHERE n > ?').values(1)
        stmt(db, 'WITH c AS (SELECT 1 AS x) INSERT INTO t (n) SELECT x FROM c').run()
        const snapshot = perfSnapshot()
        expect(snapshot.metrics['sql.select']!.count).toBe(3)
        expect(snapshot.metrics['sql.update']!.count).toBe(1)
        expect(snapshot.metrics['sql.with']!.count).toBe(1)
        expect(snapshot.counters['sql.slow']).toBeUndefined()
        expect(warn).not.toHaveBeenCalled()
      } finally {
        warn.mockRestore()
      }
    })

    test('a statement over the threshold warns with truncated SQL and counts sql.slow', () => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {})
      try {
        setSlowStatementThresholdForTests(0)
        const padding = ' '.repeat(300)
        const sql = `SELECT n FROM t WHERE id = ?${padding}-- long`
        stmt<{n: number}, [number]>(db, sql).get(1)
        expect(perfSnapshot().counters['sql.slow']!.count).toBe(1)
        expect(warn).toHaveBeenCalledTimes(1)
        const [line, detail] = warn.mock.calls[0] as [string, {ms: number; keyword: string; sql: string}]
        expect(line).toBe('[agents/sql] slow statement')
        expect(detail.keyword).toBe('select')
        expect(detail.ms).toBeGreaterThanOrEqual(0)
        expect(detail.sql).toBe(`${sql.slice(0, 200)}…`)
        expect(detail.sql).not.toContain('long')
      } finally {
        warn.mockRestore()
      }
    })

    test('a thrown statement is still timed', () => {
      setSlowStatementThresholdForTests(0)
      const warn = spyOn(console, 'warn').mockImplementation(() => {})
      try {
        expect(() => stmt(db, 'INSERT INTO t (id, n) VALUES (1, 1)').run()).toThrow()
        expect(perfSnapshot().metrics['sql.insert']!.count).toBe(1)
        expect(perfSnapshot().counters['sql.slow']!.count).toBe(1)
      } finally {
        warn.mockRestore()
      }
    })

    test('slow lines are rate-limited per statement, and the suppressed count rides on the next line', () => {
      const warn = spyOn(console, 'warn').mockImplementation(() => {})
      try {
        setSlowStatementThresholdForTests(0)
        for (let index = 0; index < SLOW_LOG_LINES_PER_WINDOW + 5; index += 1) {
          stmt<{n: number}, [number]>(db, 'SELECT n FROM t WHERE id = ?').get(1)
        }
        // A different statement has its own budget.
        stmt<{n: number}, [number]>(db, 'SELECT n FROM t WHERE n = ?').get(1)
        expect(warn).toHaveBeenCalledTimes(SLOW_LOG_LINES_PER_WINDOW + 1)
        // Every call still counts, logged or not.
        expect(perfSnapshot().counters['sql.slow']!.count).toBe(SLOW_LOG_LINES_PER_WINDOW + 6)
        for (const call of warn.mock.calls) {
          expect((call[1] as {suppressedSinceLastLine?: number}).suppressedSinceLastLine).toBeUndefined()
        }
      } finally {
        warn.mockRestore()
      }
    })
  })
})
