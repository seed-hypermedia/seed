import Database from 'better-sqlite3'
import crypto from 'crypto'
import {join} from 'path'

type BaseAccount = {
  id: string
  email: string | null
  createdAt: string
  notifyAllMentions: boolean
  notifyAllReplies: boolean
}

type BaseEmail = {
  email: string
  adminToken: string
  createdAt: string
  isUnsubscribed: boolean
}

type Account = BaseAccount
export type Email = BaseEmail & {
  accounts: BaseAccount[]
}

type DBAccount = {
  id: string
  email: string | null
  createdAt: string
  notifyAllMentions: number
  notifyAllReplies: number
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
  const version: number = db.pragma('user_version', {simple: true}) as number

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
  }

  // Example second migration (commented out)
  // if (version === 1) {
  //   db.exec(`
  //     BEGIN;
  //     ALTER TABLE users ADD COLUMN email TEXT;
  //     PRAGMA user_version = 2;
  //     COMMIT;
  //   `);
  // }
}

export function cleanup(): void {
  if (db) {
    db.close()
  }
}

export function createAccount({
  id,
  email,
  notifyAllMentions = false,
  notifyAllReplies = false,
}: {
  id: string
  email?: string
  notifyAllMentions?: boolean
  notifyAllReplies?: boolean
}): void {
  if (email) {
    const emailStmt = db.prepare(
      'INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)',
    )
    emailStmt.run(email, crypto.randomBytes(32).toString('hex'))
  }
  const stmt = db.prepare(
    'INSERT INTO accounts (id, email, notifyAllMentions, notifyAllReplies) VALUES (?, ?, ?, ?)',
  )
  stmt.run(id, email, notifyAllMentions ? 1 : 0, notifyAllReplies ? 1 : 0)
}

export function getAccount(id: string): Account | null {
  const stmt = db.prepare(`
    SELECT accounts.*
    FROM accounts 
    WHERE accounts.id = ?
  `)
  const result = stmt.get(id) as DBAccount | undefined
  if (!result) return null

  return {
    ...result,
    notifyAllMentions: Boolean(result.notifyAllMentions),
    notifyAllReplies: Boolean(result.notifyAllReplies),
  }
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

export function updateAccount(
  id: string,
  {
    notifyAllMentions,
    notifyAllReplies,
  }: {
    notifyAllMentions?: boolean
    notifyAllReplies?: boolean
  },
): void {
  const stmt = db.prepare(`
    UPDATE accounts SET notifyAllMentions = ?, notifyAllReplies = ? WHERE id = ?
  `)
  stmt.run(notifyAllMentions ? 1 : 0, notifyAllReplies ? 1 : 0, id)
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

  const accountsStmt = db.prepare(`
    SELECT accounts.*
    FROM accounts
    WHERE accounts.email = ?
  `)
  const accounts = accountsStmt.all(email.email) as DBAccount[]

  return {
    ...email,
    isUnsubscribed: Boolean(email.isUnsubscribed),
    accounts: accounts.map((account) => ({
      ...account,
      notifyAllMentions: Boolean(account.notifyAllMentions),
      notifyAllReplies: Boolean(account.notifyAllReplies),
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
    const accountsStmt = db.prepare(`
      SELECT accounts.*
      FROM accounts
      WHERE accounts.email = ?
    `)
    const accounts = accountsStmt.all(email.email) as DBAccount[]

    return {
      ...email,
      isUnsubscribed: Boolean(email.isUnsubscribed),
      accounts: accounts.map((account) => ({
        ...account,
        notifyAllMentions: Boolean(account.notifyAllMentions),
        notifyAllReplies: Boolean(account.notifyAllReplies),
      })),
    }
  })
}

export function setAccount({
  id,
  email,
  notifyAllMentions,
  notifyAllReplies,
}: {
  id: string
  email?: string
  notifyAllMentions?: boolean
  notifyAllReplies?: boolean
}): void {
  const existingAccount = getAccount(id)

  if (!existingAccount) {
    createAccount({
      id,
      email,
      notifyAllMentions,
      notifyAllReplies,
    })
    return
  }

  // If email is being changed, create new email entry
  if (email && email !== existingAccount.email) {
    const emailStmt = db.prepare(
      'INSERT OR IGNORE INTO emails (email, adminToken) VALUES (?, ?)',
    )
    emailStmt.run(email, crypto.randomBytes(32).toString('hex'))
  }

  // Update account with new values
  const stmt = db.prepare(`
    UPDATE accounts 
    SET email = ?,
        notifyAllMentions = ?,
        notifyAllReplies = ?
    WHERE id = ?
  `)

  const getBooleanValue = (
    newValue: boolean | undefined,
    currentValue: boolean,
  ) => (newValue !== undefined ? (newValue ? 1 : 0) : currentValue ? 1 : 0)

  stmt.run(
    email ?? existingAccount.email,
    getBooleanValue(notifyAllMentions, existingAccount.notifyAllMentions),
    getBooleanValue(notifyAllReplies, existingAccount.notifyAllReplies),
    id,
  )
}
