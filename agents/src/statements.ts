import type {Database, SQLQueryBindings, Statement} from 'bun:sqlite'

// bun:sqlite runs on the server's only thread, so statement compilation is paid on the event loop.
// `Database.query()` looks cached but only remembers the first ~20 distinct SQL strings per
// Database; the codebase has several hundred, so nearly every call recompiled its statement (37%
// of main-thread samples in a 2026-09-09 production profile). `Database.prepare()` has no such
// cap, so this module memoizes prepared statements per Database keyed on the exact SQL string:
// each distinct statement is compiled once and reused for the life of the Database.
//
// Statements are not re-entrant: never iterate one (`.iterate()`) while running the same SQL
// inside the loop. `.get()`/`.all()`/`.run()` complete before returning, so those are safe.
// Bindings are sticky on a reused statement, so always pass every parameter on every call.

const caches = new WeakMap<Database, Map<string, Statement<unknown, any[]>>>()

/** Returns the prepared statement for `sql` on `db`, compiling it on first use only. */
export function stmt<ReturnType = unknown, ParamsType extends SQLQueryBindings | SQLQueryBindings[] = any[]>(
  db: Database,
  sql: string,
): Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]> {
  let cache = caches.get(db)
  if (!cache) {
    cache = new Map()
    caches.set(db, cache)
  }
  let statement = cache.get(sql)
  if (!statement) {
    statement = db.prepare(sql)
    cache.set(sql, statement)
  }
  return statement as Statement<ReturnType, ParamsType extends any[] ? ParamsType : [ParamsType]>
}

/** Number of statements currently cached for `db` (diagnostics and tests). */
export function cachedStatementCount(db: Database): number {
  return caches.get(db)?.size ?? 0
}

/** Finalizes every cached statement for `db`. Call before `db.close()`. */
export function finalizeStatements(db: Database): void {
  const cache = caches.get(db)
  if (!cache) return
  caches.delete(db)
  for (const statement of cache.values()) {
    try {
      statement.finalize()
    } catch {
      // Already finalized (or the database is gone); nothing left to release.
    }
  }
}
