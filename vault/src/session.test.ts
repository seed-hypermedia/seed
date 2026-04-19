import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import {Store} from '@/session'

describe('session store', () => {
  test('createSession cleans up expired sessions before inserting a new one', () => {
    const db = new Database(':memory:', {create: true, strict: true})
    try {
      db.run(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          expire_time INTEGER NOT NULL,
          create_time INTEGER NOT NULL
        ) WITHOUT ROWID
      `)
      db.run(`CREATE INDEX sessions_by_expire_time ON sessions (expire_time)`)

      const now = Date.now()
      db.run(`INSERT INTO sessions (id, user_id, expire_time, create_time) VALUES (?, ?, ?, ?)`, [
        'expired-session',
        'user-expired',
        now - 1_000,
        now - 2_000,
      ])
      db.run(`INSERT INTO sessions (id, user_id, expire_time, create_time) VALUES (?, ?, ?, ?)`, [
        'active-session',
        'user-active',
        now + 60_000,
        now - 500,
      ])

      const store = new Store(db)
      const session = store.createSession('user-new')

      const ids = db
        .query<{id: string}, []>(`SELECT id FROM sessions ORDER BY id ASC`)
        .all()
        .map((row) => row.id)

      expect(ids).toHaveLength(2)
      expect(new Set(ids)).toEqual(new Set(['active-session', session.id]))
    } finally {
      db.close()
    }
  })
})
