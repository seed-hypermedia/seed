import Database from 'better-sqlite3'
import crypto from 'crypto'
import {join} from 'path'

export type BaseSubscription = {
  id: string
  email: string
  createdAt: string
  notifyOwnedDocChange: boolean
  notifySiteDiscussions: boolean
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
  notifyOwnedDocChange: number
  notifySiteDiscussions: number
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
  stateUpdatedAtMs: number
  updatedAt: string
}

type DBNotificationReadEventRow = {
  eventId: string
  eventAtMs: number
}

type DBNotificationEmailVerificationRow = {
  accountId: string
  email: string
  token: string
  sendTime: string
  createdAt: string
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
let stmtGetNotificationConfigsForEmail: Database.Statement
let stmtUpsertNotificationConfig: Database.Statement
let stmtDeleteNotificationConfigForAccountEmail: Database.Statement
let stmtDeleteNotificationConfigForAccount: Database.Statement
let stmtGetNotificationEmailVerificationForAccount: Database.Statement
let stmtGetNotificationEmailVerificationByToken: Database.Statement
let stmtUpsertNotificationEmailVerification: Database.Statement
let stmtDeleteNotificationEmailVerificationForAccount: Database.Statement
let stmtMarkNotificationConfigVerified: Database.Statement
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

  if (version === 6) {
    db.exec(`
    BEGIN;
    ALTER TABLE notification_read_state ADD COLUMN stateUpdatedAtMs INTEGER NOT NULL DEFAULT 0;
    PRAGMA user_version = 7;
    COMMIT;
  `)
    version = 7
  }

  if (version === 7) {
    db.exec(`
    BEGIN;
    ALTER TABLE email_subscriptions RENAME TO email_subscriptions_old;

    CREATE TABLE email_subscriptions (
      id TEXT NOT NULL,
      email TEXT NOT NULL REFERENCES emails(email),
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      notifyOwnedDocChange BOOLEAN NOT NULL DEFAULT FALSE,
      notifySiteDiscussions BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (id, email)
    ) WITHOUT ROWID;

    INSERT INTO email_subscriptions (
      id,
      email,
      createdAt,
      notifyOwnedDocChange,
      notifySiteDiscussions
    )
    SELECT
      id,
      email,
      createdAt,
      notifyOwnedDocChange,
      notifySiteDiscussions
    FROM email_subscriptions_old;

    DROP TABLE email_subscriptions_old;
    PRAGMA user_version = 8;
    COMMIT;
  `)
    version = 8
  }

  if (version === 8) {
    db.exec(`
    BEGIN;
    ALTER TABLE notification_config ADD COLUMN verifiedTime DATETIME NULL;
    CREATE TABLE notification_email_verifications (
      accountId TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      sendTime DATETIME NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    PRAGMA user_version = 9;
    COMMIT;
  `)
    version = 9
  }

  // Initialize all prepared statements
  stmtInsertEmail = db.prepare('INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)')
  stmtInsertSubscription = db.prepare(
    'INSERT INTO email_subscriptions (id, email, notifyOwnedDocChange, notifySiteDiscussions) VALUES (?, ?, ?, ?)',
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
    UPDATE email_subscriptions SET notifyOwnedDocChange = ?, notifySiteDiscussions = ? WHERE id = ?
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
      id, email, notifyOwnedDocChange, notifySiteDiscussions
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(id, email) DO UPDATE SET
      notifyOwnedDocChange  = excluded.notifyOwnedDocChange,
      notifySiteDiscussions = excluded.notifySiteDiscussions
  `)
  stmtGetNotificationConfig = db.prepare('SELECT * FROM notification_config WHERE accountId = ?')
  stmtGetAllNotificationConfigs = db.prepare('SELECT * FROM notification_config')
  stmtGetNotificationConfigsForEmail = db.prepare(
    'SELECT * FROM notification_config WHERE email = ? ORDER BY updatedAt DESC, accountId ASC',
  )
  stmtUpsertNotificationConfig = db.prepare(`
    INSERT INTO notification_config (accountId, email, verifiedTime, updatedAt)
    VALUES (?, ?, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(accountId) DO UPDATE SET
      email = excluded.email,
      verifiedTime = CASE
        WHEN notification_config.email = excluded.email THEN notification_config.verifiedTime
        ELSE NULL
      END,
      updatedAt = CURRENT_TIMESTAMP
  `)
  stmtDeleteNotificationConfigForAccountEmail = db.prepare(
    'DELETE FROM notification_config WHERE accountId = ? AND email = ?',
  )
  stmtDeleteNotificationConfigForAccount = db.prepare('DELETE FROM notification_config WHERE accountId = ?')
  stmtGetNotificationEmailVerificationForAccount = db.prepare(
    'SELECT * FROM notification_email_verifications WHERE accountId = ?',
  )
  stmtGetNotificationEmailVerificationByToken = db.prepare(
    'SELECT * FROM notification_email_verifications WHERE token = ?',
  )
  stmtUpsertNotificationEmailVerification = db.prepare(`
    INSERT INTO notification_email_verifications (accountId, email, token, sendTime)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(accountId) DO UPDATE SET
      email = excluded.email,
      token = excluded.token,
      sendTime = excluded.sendTime
  `)
  stmtDeleteNotificationEmailVerificationForAccount = db.prepare(
    'DELETE FROM notification_email_verifications WHERE accountId = ?',
  )
  stmtMarkNotificationConfigVerified = db.prepare(`
    UPDATE notification_config
    SET verifiedTime = CURRENT_TIMESTAMP,
        updatedAt = CURRENT_TIMESTAMP
    WHERE accountId = ? AND email = ?
  `)
  stmtGetNotificationReadState = db.prepare('SELECT * FROM notification_read_state WHERE accountId = ?')
  stmtUpsertNotificationReadState = db.prepare(`
    INSERT INTO notification_read_state (accountId, markAllReadAtMs, stateUpdatedAtMs, updatedAt)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(accountId) DO UPDATE SET
      markAllReadAtMs = CASE
        WHEN excluded.stateUpdatedAtMs > notification_read_state.stateUpdatedAtMs THEN excluded.markAllReadAtMs
        WHEN excluded.stateUpdatedAtMs < notification_read_state.stateUpdatedAtMs THEN notification_read_state.markAllReadAtMs
        ELSE CASE
          WHEN excluded.markAllReadAtMs IS NULL THEN notification_read_state.markAllReadAtMs
          WHEN notification_read_state.markAllReadAtMs IS NULL THEN excluded.markAllReadAtMs
          WHEN excluded.markAllReadAtMs > notification_read_state.markAllReadAtMs THEN excluded.markAllReadAtMs
          ELSE notification_read_state.markAllReadAtMs
        END
      END,
      stateUpdatedAtMs = MAX(excluded.stateUpdatedAtMs, notification_read_state.stateUpdatedAtMs),
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
  notifyOwnedDocChange = false,
  notifySiteDiscussions = false,
}: {
  id: string
  email: string
  notifyOwnedDocChange?: boolean
  notifySiteDiscussions?: boolean
}): void {
  stmtInsertEmail.run(email, crypto.randomBytes(32).toString('hex'))
  stmtInsertSubscription.run(id, email, notifyOwnedDocChange ? 1 : 0, notifySiteDiscussions ? 1 : 0)
}

export function getSubscription(id: string, email: string): BaseSubscription | null {
  const result = stmtGetSubscription.get(id, email) as Subscription | undefined
  if (!result) return null

  return {
    ...result,
    notifyOwnedDocChange: Boolean(result.notifyOwnedDocChange),
    notifySiteDiscussions: Boolean(result.notifySiteDiscussions),
  }
}

export function getSubscriptionsForAccount(id: string): BaseSubscription[] {
  const rows = stmtGetSubscriptionsForAccount.all(id) as DBSubscription[]

  return rows.map((r) => ({
    ...r,
    notifyOwnedDocChange: Boolean(r.notifyOwnedDocChange),
    notifySiteDiscussions: Boolean(r.notifySiteDiscussions),
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
    notifyOwnedDocChange,
    notifySiteDiscussions,
  }: {
    notifyOwnedDocChange?: boolean
    notifySiteDiscussions?: boolean
  },
): void {
  stmtUpdateSubscription.run(notifyOwnedDocChange ? 1 : 0, notifySiteDiscussions ? 1 : 0, id)
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
      notifyOwnedDocChange: Boolean(sub.notifyOwnedDocChange),
      notifySiteDiscussions: Boolean(sub.notifySiteDiscussions),
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
        notifyOwnedDocChange: Boolean(sub.notifyOwnedDocChange),
        notifySiteDiscussions: Boolean(sub.notifySiteDiscussions),
      })),
    }
  })
}

export function setSubscription({
  id,
  email,
  notifyOwnedDocChange,
  notifySiteDiscussions,
}: {
  id: string
  email: string
  notifyOwnedDocChange?: boolean
  notifySiteDiscussions?: boolean
}): void {
  if (!email) {
    throw new Error('setSubscription requires an email for the (id,email) key')
  }

  stmtEnsureEmail.run(email, crypto.randomBytes(32).toString('hex'))

  const current = getSubscription(id, email)

  const toInt = (next: boolean | undefined, curr: boolean | undefined) => (next ?? curr ?? false ? 1 : 0)

  const nextNotifyOwnedDocChange = toInt(notifyOwnedDocChange, current?.notifyOwnedDocChange)
  const nextNotifySiteDiscussions = toInt(notifySiteDiscussions, current?.notifySiteDiscussions)
  stmtUpsertSubscription.run(id, email, nextNotifyOwnedDocChange, nextNotifySiteDiscussions)
}

export type NotificationConfigRow = {
  accountId: string
  email: string
  verifiedTime: string | null
  createdAt: string
  updatedAt: string
}

export type NotificationEmailVerificationRow = {
  accountId: string
  email: string
  token: string
  sendTime: string
  createdAt: string
}

export type NotificationReadEvent = {
  eventId: string
  eventAtMs: number
}

export type NotificationReadStateRow = {
  accountId: string
  markAllReadAtMs: number | null
  stateUpdatedAtMs: number
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

export function getNotificationConfigsForEmail(email: string): NotificationConfigRow[] {
  return stmtGetNotificationConfigsForEmail.all(email) as NotificationConfigRow[]
}

export function setNotificationConfig(accountId: string, email: string): void {
  stmtEnsureEmail.run(email, crypto.randomBytes(32).toString('hex'))
  stmtUpsertNotificationConfig.run(accountId, email)
}

export function unsetNotificationConfig(accountId: string, email: string): boolean {
  const result = stmtDeleteNotificationConfigForAccountEmail.run(accountId, email) as {changes?: number}
  if ((result.changes || 0) > 0) {
    stmtDeleteNotificationEmailVerificationForAccount.run(accountId)
  }
  return (result.changes || 0) > 0
}

export function removeNotificationConfig(accountId: string): boolean {
  const result = stmtDeleteNotificationConfigForAccount.run(accountId) as {changes?: number}
  if ((result.changes || 0) > 0) {
    stmtDeleteNotificationEmailVerificationForAccount.run(accountId)
  }
  return (result.changes || 0) > 0
}

export function getNotificationEmailVerificationForAccount(accountId: string): NotificationEmailVerificationRow | null {
  const row = stmtGetNotificationEmailVerificationForAccount.get(accountId) as
    | DBNotificationEmailVerificationRow
    | undefined
  return row ?? null
}

export function getNotificationEmailVerificationByToken(token: string): NotificationEmailVerificationRow | null {
  const row = stmtGetNotificationEmailVerificationByToken.get(token) as DBNotificationEmailVerificationRow | undefined
  return row ?? null
}

export function setNotificationEmailVerification({
  accountId,
  email,
  sendTime = new Date().toISOString(),
  token = crypto.randomBytes(32).toString('hex'),
}: {
  accountId: string
  email: string
  sendTime?: string
  token?: string
}): NotificationEmailVerificationRow {
  stmtUpsertNotificationEmailVerification.run(accountId, email, token, sendTime)
  const stored = getNotificationEmailVerificationForAccount(accountId)
  if (!stored) {
    throw new Error('Failed to save notification email verification')
  }
  return stored
}

export function clearNotificationEmailVerificationForAccount(accountId: string): boolean {
  const result = stmtDeleteNotificationEmailVerificationForAccount.run(accountId) as {changes?: number}
  return (result.changes || 0) > 0
}

export function markNotificationConfigVerified(accountId: string, email: string): boolean {
  const result = stmtMarkNotificationConfigVerified.run(accountId, email) as {changes?: number}
  return (result.changes || 0) > 0
}

export function getNotificationReadState(accountId: string): NotificationReadStateRow {
  const row = stmtGetNotificationReadState.get(accountId) as DBNotificationReadStateRow | undefined
  const readEvents = stmtGetNotificationReadEvents.all(accountId) as DBNotificationReadEventRow[]

  return {
    accountId,
    markAllReadAtMs: row?.markAllReadAtMs ?? null,
    stateUpdatedAtMs: row?.stateUpdatedAtMs ?? 0,
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
    stateUpdatedAtMs: number
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
    stmtUpsertNotificationReadState.run(accountId, snapshot.markAllReadAtMs, snapshot.stateUpdatedAtMs)

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
