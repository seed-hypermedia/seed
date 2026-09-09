import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {Database} from 'bun:sqlite'
import {cachedStatementCount, finalizeStatements, stmt} from './statements'

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
})
