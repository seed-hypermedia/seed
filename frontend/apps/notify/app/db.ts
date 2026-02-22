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

type DBNotificationReadStateRow = {
  accountId: string
  markAllReadAtMs: number | null
  updatedAt: string
}

type DBNotificationReadEventRow = {
  eventId: string
  eventAtMs: number
}

let db: Database.Database

// Prepared statements - initialized after db is ready
let stmtInsertEmail: Database.Statement
let stmtInsertSubscription: Database.Statement
let stmtGetSubscription: Database.Statement
let stmtGetSubscriptionsForAccount: Database.Statement
let stmtSetNotifierStatus: Database.Statement
let stmtGetNotifierStatus: Database.Statement
let stmtUpdateSubscription: Database.Statement
let stmtGetEmail: Database.Statement
let stmtGetEmailWithToken: Database.Statement
let stmtGetSubscriptionsForEmail: Database.Statement
let stmtSetEmailUnsubscribed: Database.Statement
let stmtGetAllEmails: Database.Statement
let stmtEnsureEmail: Database.Statement
let stmtUpsertSubscription: Database.Statement
let stmtGetNotificationConfig: Database.Statement
let stmtGetAllNotificationConfigs: Database.Statement
let stmtUpsertNotificationConfig: Database.Statement
let stmtGetNotificationReadState: Database.Statement
let stmtUpsertNotificationReadState: Database.Statement
let stmtGetNotificationReadEvents: Database.Statement
let stmtUpsertNotificationReadEvent: Database.Statement
let stmtPruneNotificationReadEvents: Database.Statement

export async function initDatabase(): Promise<void> {
  const dbFilePath = join(process.env.DATA_DIR || process.cwd(), 'web-db.sqlite')
  console.log('Init DB data file:', dbFilePath)
  db = new Database(dbFilePath)
  let version: number = db.pragma('user_version', {simple: true}) as number
  console.log('Init DB at version:', version)
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

  if (version === 4) {
    db.exec(`
    BEGIN;
    CREATE TABLE notification_config (
      accountId TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    PRAGMA user_version = 5;
    COMMIT;
  `)
    version = 5
  }

  if (version === 5) {
    db.exec(`
    BEGIN;
    CREATE TABLE notification_read_state (
      accountId TEXT PRIMARY KEY NOT NULL,
      markAllReadAtMs INTEGER NULL,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notification_read_events (
      accountId TEXT NOT NULL,
      eventId TEXT NOT NULL,
      eventAtMs INTEGER NOT NULL,
      PRIMARY KEY (accountId, eventId)
    ) WITHOUT ROWID;
    PRAGMA user_version = 6;
    COMMIT;
  `)
    version = 6
  }

  // Initialize all prepared statements
  stmtInsertEmail = db.prepare('INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)')
  stmtInsertSubscription = db.prepare(
    'INSERT INTO email_subscriptions (id, email, notifyAllMentions, notifyAllReplies, notifyOwnedDocChange, notifySiteDiscussions, notifyAllComments) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  stmtGetSubscription = db.prepare(`
    SELECT * FROM email_subscriptions WHERE id = ? AND email = ?
  `)
  stmtGetSubscriptionsForAccount = db.prepare(`
    SELECT es.*
    FROM email_subscriptions es
    WHERE es.id = ?
  `)
  stmtSetNotifierStatus = db.prepare(`
    INSERT OR REPLACE INTO notifier_status (field, value) VALUES (?, ?)
  `)
  stmtGetNotifierStatus = db.prepare(`
    SELECT value FROM notifier_status WHERE field = ?
  `)
  stmtUpdateSubscription = db.prepare(`
    UPDATE email_subscriptions SET notifyAllMentions = ?, notifyAllReplies = ?, notifyOwnedDocChange = ?, notifySiteDiscussions = ?, notifyAllComments = ? WHERE id = ?
  `)
  stmtGetEmail = db.prepare(`
    SELECT emails.*
    FROM emails 
    WHERE emails.email = ?
  `)
  stmtGetEmailWithToken = db.prepare(`
    SELECT emails.*
    FROM emails
    WHERE emails.adminToken = ?
  `)
  stmtGetSubscriptionsForEmail = db.prepare(`
    SELECT es.*
    FROM email_subscriptions es
    WHERE es.email = ?
  `)
  stmtSetEmailUnsubscribed = db.prepare(`
    UPDATE emails SET isUnsubscribed = ? WHERE adminToken = ?
  `)
  stmtGetAllEmails = db.prepare(`
    SELECT emails.*
    FROM emails 
  `)
  stmtEnsureEmail = db.prepare('INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)')
  stmtUpsertSubscription = db.prepare(`
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
  stmtGetNotificationConfig = db.prepare('SELECT * FROM notification_config WHERE accountId = ?')
  stmtGetAllNotificationConfigs = db.prepare('SELECT * FROM notification_config')
  stmtUpsertNotificationConfig = db.prepare(`
    INSERT INTO notification_config (accountId, email, updatedAt)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(accountId) DO UPDATE SET
      email = excluded.email,
      updatedAt = CURRENT_TIMESTAMP
  `)
  stmtGetNotificationReadState = db.prepare('SELECT * FROM notification_read_state WHERE accountId = ?')
  stmtUpsertNotificationReadState = db.prepare(`
    INSERT INTO notification_read_state (accountId, markAllReadAtMs, updatedAt)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(accountId) DO UPDATE SET
      markAllReadAtMs = CASE
        WHEN excluded.markAllReadAtMs IS NULL THEN notification_read_state.markAllReadAtMs
        WHEN notification_read_state.markAllReadAtMs IS NULL THEN excluded.markAllReadAtMs
        WHEN excluded.markAllReadAtMs > notification_read_state.markAllReadAtMs THEN excluded.markAllReadAtMs
        ELSE notification_read_state.markAllReadAtMs
      END,
      updatedAt = CURRENT_TIMESTAMP
  `)
  stmtGetNotificationReadEvents = db.prepare(`
    SELECT eventId, eventAtMs
    FROM notification_read_events
    WHERE accountId = ?
    ORDER BY eventAtMs DESC, eventId ASC
  `)
  stmtUpsertNotificationReadEvent = db.prepare(`
    INSERT INTO notification_read_events (accountId, eventId, eventAtMs)
    VALUES (?, ?, ?)
    ON CONFLICT(accountId, eventId) DO UPDATE SET
      eventAtMs = CASE
        WHEN excluded.eventAtMs > notification_read_events.eventAtMs THEN excluded.eventAtMs
        ELSE notification_read_events.eventAtMs
      END
  `)
  stmtPruneNotificationReadEvents = db.prepare(`
    DELETE FROM notification_read_events
    WHERE accountId = ? AND eventAtMs <= ?
  `)

  // Ensure email rows exist for notification_config entries from previous runs.
  const existingNotificationConfigs = stmtGetAllNotificationConfigs.all() as {
    email: string
  }[]
  for (const cfg of existingNotificationConfigs) {
    stmtEnsureEmail.run(cfg.email, crypto.randomBytes(32).toString('hex'))
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
  notifyAllComments = false,
}: {
  id: string
  email?: string
  notifyAllMentions?: boolean
  notifyAllReplies?: boolean
  notifyOwnedDocChange?: boolean
  notifySiteDiscussions?: boolean
  notifyAllComments?: boolean
}): void {
  if (email) {
    stmtInsertEmail.run(email, crypto.randomBytes(32).toString('hex'))
  }
  stmtInsertSubscription.run(
    id,
    email,
    notifyAllMentions ? 1 : 0,
    notifyAllReplies ? 1 : 0,
    notifyOwnedDocChange ? 1 : 0,
    notifySiteDiscussions ? 1 : 0,
    notifyAllComments ? 1 : 0,
  )
}

export function getSubscription(id: string, email: string): BaseSubscription | null {
  const result = stmtGetSubscription.get(id, email) as Subscription | undefined
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
  const rows = stmtGetSubscriptionsForAccount.all(id) as DBSubscription[]

  return rows.map((r) => ({
    ...r,
    notifyAllMentions: Boolean(r.notifyAllMentions),
    notifyAllReplies: Boolean(r.notifyAllReplies),
    notifyOwnedDocChange: Boolean(r.notifyOwnedDocChange),
    notifySiteDiscussions: Boolean(r.notifySiteDiscussions),
    notifyAllComments: Boolean(r.notifyAllComments),
  }))
}

export function getNotifierLastProcessedEventId(): string | undefined {
  const result = stmtGetNotifierStatus.get('last_processed_event_id') as {value: string} | undefined
  return result?.value
}

export function setNotifierLastProcessedEventId(eventId: string): void {
  stmtSetNotifierStatus.run('last_processed_event_id', eventId)
}

export function getBatchNotifierLastProcessedEventId(): string | undefined {
  const result = stmtGetNotifierStatus.get('last_processed_batch_event_id') as {value: string} | undefined
  return result?.value
}

export function setBatchNotifierLastProcessedEventId(eventId: string): void {
  stmtSetNotifierStatus.run('last_processed_batch_event_id', eventId)
}

export function getBatchNotifierLastSendTime(): Date | undefined {
  const result = stmtGetNotifierStatus.get('batch_notifier_last_send_time') as {value: string} | undefined
  if (!result?.value) return undefined
  return new Date(result.value)
}

export function setBatchNotifierLastSendTime(time: Date): void {
  stmtSetNotifierStatus.run('batch_notifier_last_send_time', time.toISOString())
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
  stmtUpdateSubscription.run(
    notifyAllMentions ? 1 : 0,
    notifyAllReplies ? 1 : 0,
    notifyOwnedDocChange ? 1 : 0,
    notifySiteDiscussions ? 1 : 0,
    notifyAllComments ? 1 : 0,
    id,
  )
}

export function getEmail(email: string): BaseEmail | null {
  const emailValue = stmtGetEmail.get(email) as DBEmail | undefined
  if (!emailValue) return null

  return {
    ...emailValue,
    email,
    isUnsubscribed: Boolean(emailValue.isUnsubscribed),
  }
}

export function getEmailWithToken(emailAdminToken: string): Email | null {
  const email = stmtGetEmailWithToken.get(emailAdminToken) as DBEmail | undefined
  if (!email) return null

  const subs = stmtGetSubscriptionsForEmail.all(email.email) as DBSubscription[]

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

export function setEmailUnsubscribed(emailAdminToken: string, isUnsubscribed: boolean): void {
  stmtSetEmailUnsubscribed.run(isUnsubscribed ? 1 : 0, emailAdminToken)
}

export function getAllEmails(): Email[] {
  const emails = stmtGetAllEmails.all() as DBEmail[]

  return emails.map((email) => {
    const subs = stmtGetSubscriptionsForEmail.all(email.email) as DBSubscription[]

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

  stmtEnsureEmail.run(email, crypto.randomBytes(32).toString('hex'))

  const current = getSubscription(id, email)

  const toInt = (next: boolean | undefined, curr: boolean | undefined) => (next ?? curr ?? false ? 1 : 0)

  const nextNotifyAllMentions = toInt(notifyAllMentions, current?.notifyAllMentions)
  const nextNotifyAllReplies = toInt(notifyAllReplies, current?.notifyAllReplies)
  const nextNotifyOwnedDocChange = toInt(notifyOwnedDocChange, current?.notifyOwnedDocChange)
  const nextNotifySiteDiscussions = toInt(notifySiteDiscussions, current?.notifySiteDiscussions)
  const nextNotifyAllComments = toInt(notifyAllComments, current?.notifyAllComments)

  stmtUpsertSubscription.run(
    id,
    email,
    nextNotifyAllMentions,
    nextNotifyAllReplies,
    nextNotifyOwnedDocChange,
    nextNotifySiteDiscussions,
    nextNotifyAllComments,
  )
}

export type NotificationConfigRow = {
  accountId: string
  email: string
  createdAt: string
  updatedAt: string
}

export type NotificationReadEvent = {
  eventId: string
  eventAtMs: number
}

export type NotificationReadStateRow = {
  accountId: string
  markAllReadAtMs: number | null
  readEvents: NotificationReadEvent[]
  updatedAt: string
}

export function getNotificationConfig(accountId: string): NotificationConfigRow | null {
  const row = stmtGetNotificationConfig.get(accountId) as NotificationConfigRow | undefined
  return row ?? null
}

export function getAllNotificationConfigs(): NotificationConfigRow[] {
  return stmtGetAllNotificationConfigs.all() as NotificationConfigRow[]
}

export function setNotificationConfig(accountId: string, email: string): void {
  stmtEnsureEmail.run(email, crypto.randomBytes(32).toString('hex'))
  stmtUpsertNotificationConfig.run(accountId, email)
}

export function getNotificationReadState(accountId: string): NotificationReadStateRow {
  const row = stmtGetNotificationReadState.get(accountId) as DBNotificationReadStateRow | undefined
  const readEvents = stmtGetNotificationReadEvents.all(accountId) as DBNotificationReadEventRow[]

  return {
    accountId,
    markAllReadAtMs: row?.markAllReadAtMs ?? null,
    readEvents: readEvents.map((evt) => ({
      eventId: evt.eventId,
      eventAtMs: evt.eventAtMs,
    })),
    updatedAt: row?.updatedAt ?? new Date(0).toISOString(),
  }
}

export function mergeNotificationReadState(
  accountId: string,
  snapshot: {
    markAllReadAtMs: number | null
    readEvents: NotificationReadEvent[]
  },
): NotificationReadStateRow {
  const normalizedReadEvents = snapshot.readEvents
    .filter((evt) => evt?.eventId && Number.isFinite(evt.eventAtMs))
    .map((evt) => ({
      eventId: evt.eventId,
      eventAtMs: Math.max(0, Math.floor(evt.eventAtMs)),
    }))

  const transaction = db.transaction(() => {
    stmtUpsertNotificationReadState.run(accountId, snapshot.markAllReadAtMs)

    for (const evt of normalizedReadEvents) {
      stmtUpsertNotificationReadEvent.run(accountId, evt.eventId, evt.eventAtMs)
    }

    const merged = stmtGetNotificationReadState.get(accountId) as DBNotificationReadStateRow | undefined
    const mergedMarkAllReadAtMs = merged?.markAllReadAtMs ?? null
    if (mergedMarkAllReadAtMs !== null) {
      stmtPruneNotificationReadEvents.run(accountId, mergedMarkAllReadAtMs)
    }

    return getNotificationReadState(accountId)
  })

  return transaction()
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
