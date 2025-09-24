import Database from 'better-sqlite3'
import crypto from 'crypto'
import {join} from 'path'

export type BaseSubscription = {
  id: string
  email: string
  createdAt: string
  notifyAllMentions: boolean
  notifyAllReplies: boolean
  notifyOwnedDocChange: boolean
  notifySiteDiscussions: boolean
  notifyAllComments: boolean
}

type BaseEmail = {
  email: string
  adminToken: string
  createdAt: string
  isUnsubscribed: boolean
}

type Subscription = BaseSubscription
export type Email = BaseEmail & {
  subscriptions: BaseSubscription[]
}

type DBSubscription = {
  id: string
  email: string
  createdAt: string
  notifyAllMentions: number
  notifyAllReplies: number
  notifyOwnedDocChange: number
  notifySiteDiscussions: number
  notifyAllComments: number
}

type DBEmail = {
  email: string
  adminToken: string
  createdAt: string
  isUnsubscribed: number
}

let db: Database.Database

export async function initDatabase(): Promise<void> {
  const dbFilePath = join(
    process.env.DATA_DIR || process.cwd(),
    'web-db.sqlite',
  )
  db = new Database(dbFilePath)
  let version: number = db.pragma('user_version', {simple: true}) as number
  console.log('init db', dbFilePath, version)
  if (version === 0) {
    // Initial migration.
    db.exec(`
      BEGIN;
      CREATE TABLE emails (
        email TEXT UNIQUE NOT NULL,
        adminToken TEXT NOT NULL,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        isUnsubscribed BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE accounts (
        id TEXT UNIQUE NOT NULL,
        email TEXT REFERENCES emails(email),
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notifyAllMentions BOOLEAN NOT NULL DEFAULT FALSE,
        notifyAllReplies BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE notifier_status (
        field TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL
      );
      PRAGMA user_version = 1;
      COMMIT;
    `)

    version = 1
  }

  if (version === 1) {
    db.exec(`
      BEGIN;
      ALTER TABLE accounts ADD COLUMN notifyOwnedDocChange BOOLEAN NOT NULL DEFAULT FALSE;
      PRAGMA user_version = 2;
      COMMIT;
    `)
    version = 2
  }

  if (version === 2) {
    db.exec(`
      BEGIN;
      ALTER TABLE accounts ADD COLUMN notifySiteDiscussions BOOLEAN NOT NULL DEFAULT FALSE;
      PRAGMA user_version = 3;
      COMMIT;
    `)
    version = 3
  }

  if (version === 3) {
    db.exec(`
    BEGIN;
    ALTER TABLE accounts RENAME TO accounts_old;

    CREATE TABLE email_subscriptions (
      id TEXT NOT NULL,
      email TEXT NOT NULL REFERENCES emails(email),
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notifyAllMentions BOOLEAN NOT NULL DEFAULT FALSE,
      notifyAllReplies BOOLEAN NOT NULL DEFAULT FALSE,
      notifyOwnedDocChange BOOLEAN NOT NULL DEFAULT FALSE,
      notifySiteDiscussions BOOLEAN NOT NULL DEFAULT FALSE,
      notifyAllComments BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (id, email)
    ) WITHOUT ROWID;

    INSERT INTO email_subscriptions (
      id,
      email,
      createdAt,
      notifyAllMentions,
      notifyAllReplies,
      notifyOwnedDocChange,
      notifySiteDiscussions,
      notifyAllComments
    )
    SELECT
      id,
      email,
      createdAt,
      notifyAllMentions,
      notifyAllReplies,
      notifyOwnedDocChange,
      notifySiteDiscussions,
      FALSE
    FROM accounts_old;

    DROP TABLE accounts_old;

    PRAGMA user_version = 4;
    COMMIT;
  `)
    version = 4
  }
}

export function cleanup(): void {
  if (db) {
    db.close()
  }
}

export function createSubscription({
  id,
  email,
  notifyAllMentions = false,
  notifyAllReplies = false,
  notifyOwnedDocChange = false,
  notifySiteDiscussions = false,
}: {
  id: string
  email?: string
  notifyAllMentions?: boolean
  notifyAllReplies?: boolean
  notifyOwnedDocChange?: boolean
  notifySiteDiscussions?: boolean
}): void {
  if (email) {
    const emailStmt = db.prepare(
      'INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)',
    )
    emailStmt.run(email, crypto.randomBytes(32).toString('hex'))
  }
  const stmt = db.prepare(
    'INSERT INTO email_subscriptions (id, email, notifyAllMentions, notifyAllReplies, notifyOwnedDocChange, notifySiteDiscussions) VALUES (?, ?, ?, ?, ?, ?)',
  )
  stmt.run(
    id,
    email,
    notifyAllMentions ? 1 : 0,
    notifyAllReplies ? 1 : 0,
    notifyOwnedDocChange ? 1 : 0,
    notifySiteDiscussions ? 1 : 0,
  )
}

export function getSubscription(
  id: string,
  email: string,
): BaseSubscription | null {
  const stmt = db.prepare(`
    SELECT * FROM email_subscriptions WHERE id = ? AND email = ?
  `)
  const result = stmt.get(id, email) as Subscription | undefined
  if (!result) return null

  return {
    ...result,
    notifyAllMentions: Boolean(result.notifyAllMentions),
    notifyAllReplies: Boolean(result.notifyAllReplies),
    notifyOwnedDocChange: Boolean(result.notifyOwnedDocChange),
    notifySiteDiscussions: Boolean(result.notifySiteDiscussions),
    notifyAllComments: Boolean(result.notifyAllComments),
  }
}

export function getSubscriptionsForAccount(id: string): BaseSubscription[] {
  const stmt = db.prepare(`
    SELECT es.*
    FROM email_subscriptions es
    WHERE es.id = ?
  `)
  const rows = stmt.all(id) as DBSubscription[]

  return rows.map((r) => ({
    ...r,
    notifyAllMentions: Boolean(r.notifyAllMentions),
    notifyAllReplies: Boolean(r.notifyAllReplies),
    notifyOwnedDocChange: Boolean(r.notifyOwnedDocChange),
    notifySiteDiscussions: Boolean(r.notifySiteDiscussions),
    notifyAllComments: Boolean(r.notifyAllComments),
  }))
}

export function getNotifierLastProcessedBlobCid(): string | undefined {
  const stmt = db.prepare(`
    SELECT value FROM notifier_status WHERE field = 'last_processed_blob_cid'
  `)
  const result = stmt.get() as {value: string} | undefined
  return result?.value
}

export function setNotifierLastProcessedBlobCid(cid: string): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO notifier_status (field, value) VALUES (?, ?)
  `)
  stmt.run('last_processed_blob_cid', cid)
}

export function updateSubscription(
  id: string,
  {
    notifyAllMentions,
    notifyAllReplies,
    notifyOwnedDocChange,
    notifySiteDiscussions,
    notifyAllComments,
  }: {
    notifyAllMentions?: boolean
    notifyAllReplies?: boolean
    notifyOwnedDocChange?: boolean
    notifySiteDiscussions?: boolean
    notifyAllComments?: boolean
  },
): void {
  const stmt = db.prepare(`
    UPDATE email_subscriptions SET notifyAllMentions = ?, notifyAllReplies = ?, notifyOwnedDocChange = ?, notifySiteDiscussions = ?, notifyAllComments = ? WHERE id = ?
  `)
  stmt.run(
    notifyAllMentions ? 1 : 0,
    notifyAllReplies ? 1 : 0,
    notifyOwnedDocChange ? 1 : 0,
    notifySiteDiscussions ? 1 : 0,
    notifyAllComments ? 1 : 0,
    id,
  )
}

export function getEmail(email: string): BaseEmail | null {
  const stmt = db.prepare(`
    SELECT emails.*
    FROM emails 
    WHERE emails.email = ?
  `)
  const emailValue = stmt.get(email) as DBEmail | undefined
  if (!emailValue) return null

  return {
    ...emailValue,
    email,
    isUnsubscribed: Boolean(emailValue.isUnsubscribed),
  }
}

export function getEmailWithToken(emailAdminToken: string): Email | null {
  const stmt = db.prepare(`
    SELECT emails.*
    FROM emails
    WHERE emails.adminToken = ?
  `)
  const email = stmt.get(emailAdminToken) as DBEmail | undefined
  if (!email) return null

  const subsStmt = db.prepare(`
    SELECT es.*
    FROM email_subscriptions es
    WHERE es.email = ?
  `)
  const subs = subsStmt.all(email.email) as DBSubscription[]

  return {
    ...email,
    isUnsubscribed: Boolean(email.isUnsubscribed),
    subscriptions: subs.map((sub) => ({
      ...sub,
      notifyAllMentions: Boolean(sub.notifyAllMentions),
      notifyAllReplies: Boolean(sub.notifyAllReplies),
      notifyOwnedDocChange: Boolean(sub.notifyOwnedDocChange),
      notifySiteDiscussions: Boolean(sub.notifySiteDiscussions),
      notifyAllComments: Boolean(sub.notifyAllComments),
    })),
  }
}

export function setEmailUnsubscribed(
  emailAdminToken: string,
  isUnsubscribed: boolean,
): void {
  const stmt = db.prepare(`
    UPDATE emails SET isUnsubscribed = ? WHERE adminToken = ?
  `)
  stmt.run(isUnsubscribed ? 1 : 0, emailAdminToken)
}

export function getAllEmails(): Email[] {
  const stmt = db.prepare(`
    SELECT emails.*
    FROM emails 
  `)
  const emails = stmt.all() as DBEmail[]

  return emails.map((email) => {
    const subsStmt = db.prepare(`
    SELECT es.*
    FROM email_subscriptions es
    WHERE es.email = ?
  `)
    const subs = subsStmt.all(email.email) as DBSubscription[]

    return {
      ...email,
      isUnsubscribed: Boolean(email.isUnsubscribed),
      subscriptions: subs.map((sub) => ({
        ...sub,
        notifyAllMentions: Boolean(sub.notifyAllMentions),
        notifyAllReplies: Boolean(sub.notifyAllReplies),
        notifyOwnedDocChange: Boolean(sub.notifyOwnedDocChange),
        notifySiteDiscussions: Boolean(sub.notifySiteDiscussions),
        notifyAllComments: Boolean(sub.notifyAllComments),
      })),
    }
  })
}

export function setSubscription({
  id,
  email,
  notifyAllMentions,
  notifyAllReplies,
  notifyOwnedDocChange,
  notifySiteDiscussions,
  notifyAllComments,
}: {
  id: string
  email: string
  notifyAllMentions?: boolean
  notifyAllReplies?: boolean
  notifyOwnedDocChange?: boolean
  notifySiteDiscussions?: boolean
  notifyAllComments?: boolean
}): void {
  if (!email) {
    throw new Error('setSubscription requires an email for the (id,email) key')
  }

  const ensureEmailStmt = db.prepare(
    'INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)',
  )
  ensureEmailStmt.run(email, crypto.randomBytes(32).toString('hex'))

  const current = getSubscription(id, email)

  const toInt = (next: boolean | undefined, curr: boolean | undefined) =>
    next ?? curr ?? false ? 1 : 0

  const nextNotifyAllMentions = toInt(
    notifyAllMentions,
    current?.notifyAllMentions,
  )
  const nextNotifyAllReplies = toInt(
    notifyAllReplies,
    current?.notifyAllReplies,
  )
  const nextNotifyOwnedDocChange = toInt(
    notifyOwnedDocChange,
    current?.notifyOwnedDocChange,
  )
  const nextNotifySiteDiscussions = toInt(
    notifySiteDiscussions,
    current?.notifySiteDiscussions,
  )
  const nextNotifyAllComments = toInt(
    notifyAllComments,
    current?.notifyAllComments,
  )

  const upsert = db.prepare(`
    INSERT INTO email_subscriptions (
      id, email, notifyAllMentions, notifyAllReplies, notifyOwnedDocChange, notifySiteDiscussions, notifyAllComments
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, email) DO UPDATE SET
      notifyAllMentions     = excluded.notifyAllMentions,
      notifyAllReplies      = excluded.notifyAllReplies,
      notifyOwnedDocChange  = excluded.notifyOwnedDocChange,
      notifySiteDiscussions = excluded.notifySiteDiscussions,
      notifyAllComments     = excluded.notifyAllComments
  `)

  upsert.run(
    id,
    email,
    nextNotifyAllMentions,
    nextNotifyAllReplies,
    nextNotifyOwnedDocChange,
    nextNotifySiteDiscussions,
    nextNotifyAllComments,
  )
}

// export function setAccount({
//   id,
//   email,
//   notifyAllMentions,
//   notifyAllReplies,
//   notifyOwnedDocChange,
//   notifySiteDiscussions,
// }: {
//   id: string
//   email?: string
//   notifyAllMentions?: boolean
//   notifyAllReplies?: boolean
//   notifyOwnedDocChange?: boolean
//   notifySiteDiscussions?: boolean
// }): void {
//   const existingAccount = getAccount(id)

//   if (!existingAccount) {
//     createAccount({
//       id,
//       email,
//       notifyAllMentions,
//       notifyAllReplies,
//       notifyOwnedDocChange,
//       notifySiteDiscussions,
//     })
//     return
//   }

//   // If email is being changed, create new email entry
//   if (email && email !== existingAccount.email) {
//     const emailStmt = db.prepare(
//       'INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)',
//     )
//     emailStmt.run(email, crypto.randomBytes(32).toString('hex'))
//   }

//   // Update account with new values
//   const stmt = db.prepare(`
//     UPDATE accounts
//     SET email = ?,
//         notifyAllMentions = ?,
//         notifyAllReplies = ?,
//         notifyOwnedDocChange = ?,
//         notifySiteDiscussions = ?
//     WHERE id = ?
//   `)

//   const getBooleanValue = (
//     newValue: boolean | undefined,
//     currentValue: boolean,
//   ) => (newValue !== undefined ? (newValue ? 1 : 0) : currentValue ? 1 : 0)

//   stmt.run(
//     email ?? existingAccount.email,
//     getBooleanValue(notifyAllMentions, existingAccount.notifyAllMentions),
//     getBooleanValue(notifyAllReplies, existingAccount.notifyAllReplies),
//     getBooleanValue(notifyOwnedDocChange, existingAccount.notifyOwnedDocChange),
//     getBooleanValue(
//       notifySiteDiscussions,
//       existingAccount.notifySiteDiscussions,
//     ),
//     id,
//   )
// }
