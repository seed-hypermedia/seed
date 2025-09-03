import Database from 'better-sqlite3'
import {mkdtempSync, rmSync} from 'fs'
import {join} from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  cleanup,
  createAccount,
  getAccount,
  getAllEmails,
  getEmailWithToken,
  getNotifierLastProcessedBlobCid,
  initDatabase,
  setAccount,
  setEmailUnsubscribed,
  setNotifierLastProcessedBlobCid,
  updateAccount,
} from './db'

interface TableInfo {
  name: string
  type: string
}

interface ColumnInfo {
  name: string
  type: string
}

interface ForeignKeyInfo {
  from: string
  to: string
  table: string
}

describe('Database', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = mkdtempSync('seed-web-test-')
    process.env.DATA_DIR = tmpDir
    await initDatabase()
  })

  afterEach(() => {
    cleanup()
    rmSync(tmpDir, {recursive: true, force: true})
  })

  describe('initialization', () => {
    it('should initialize database with correct schema', async () => {
      const db = new Database(join(tmpDir, 'web-db.sqlite'))

      // Check if tables exist
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as TableInfo[]
      expect(tables).toHaveLength(3)
      expect(tables.map((t) => t.name)).toContain('emails')
      expect(tables.map((t) => t.name)).toContain('accounts')
      expect(tables.map((t) => t.name)).toContain('notifier_status')

      // Check emails table schema
      const emailsSchema = db
        .prepare('PRAGMA table_info(emails)')
        .all() as ColumnInfo[]
      expect(emailsSchema).toHaveLength(4)
      expect(emailsSchema.find((c) => c.name === 'email')).toBeDefined()
      expect(emailsSchema.find((c) => c.name === 'adminToken')).toBeDefined()
      expect(emailsSchema.find((c) => c.name === 'createdAt')).toBeDefined()
      expect(
        emailsSchema.find((c) => c.name === 'isUnsubscribed'),
      ).toBeDefined()

      // Check accounts table schema
      const accountsSchema = db
        .prepare('PRAGMA table_info(accounts)')
        .all() as ColumnInfo[]
      expect(accountsSchema).toHaveLength(7)
      expect(accountsSchema.find((c) => c.name === 'id')).toBeDefined()
      expect(accountsSchema.find((c) => c.name === 'email')).toBeDefined()
      expect(accountsSchema.find((c) => c.name === 'createdAt')).toBeDefined()
      expect(
        accountsSchema.find((c) => c.name === 'notifyAllMentions'),
      ).toBeDefined()
      expect(
        accountsSchema.find((c) => c.name === 'notifyAllReplies'),
      ).toBeDefined()
      expect(
        accountsSchema.find((c) => c.name === 'notifyOwnedDocChange'),
      ).toBeDefined()
      expect(
        accountsSchema.find((c) => c.name === 'notifySiteDiscussions'),
      ).toBeDefined()

      // Check foreign key constraint
      const foreignKeys = db
        .prepare('PRAGMA foreign_key_list(accounts)')
        .all() as ForeignKeyInfo[]
      expect(foreignKeys).toHaveLength(1)
      // @ts-expect-error
      expect(foreignKeys[0].from).toBe('email')
      // @ts-expect-error
      expect(foreignKeys[0].to).toBe('email')
      // @ts-expect-error
      expect(foreignKeys[0].table).toBe('emails')

      db.close()
    })

    it('should handle database version correctly', async () => {
      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const version = db.pragma('user_version', {simple: true})
      expect(version).toBe(3)
      db.close()
    })
  })

  describe('account operations', () => {
    it('should create account without email', () => {
      const accountData = {
        id: 'test-id',
        notifyAllMentions: true,
        notifyAllReplies: false,
      }
      createAccount(accountData)

      const account = getAccount(accountData.id)
      expect(account).toMatchObject({
        id: accountData.id,
        email: null,
        notifyAllMentions: accountData.notifyAllMentions,
        notifyAllReplies: accountData.notifyAllReplies,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      })
      expect(account?.createdAt).toBeDefined()
    })

    it('should create account with email', () => {
      const accountData = {
        id: 'test-id',
        email: 'test@example.com',
        notifyAllMentions: true,
        notifyAllReplies: false,
      }
      createAccount(accountData)

      const account = getAccount(accountData.id)
      expect(account).toMatchObject({
        id: accountData.id,
        email: accountData.email,
        notifyAllMentions: accountData.notifyAllMentions,
        notifyAllReplies: accountData.notifyAllReplies,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      })
      expect(account?.createdAt).toBeDefined()
    })

    it('should update account notification settings', () => {
      const accountData = {
        id: 'test-id',
        notifyAllMentions: false,
        notifyAllReplies: false,
      }
      createAccount(accountData)

      updateAccount(accountData.id, {
        notifyAllMentions: true,
        notifyAllReplies: true,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
      })

      const account = getAccount(accountData.id)
      expect(account).toMatchObject({
        id: accountData.id,
        notifyAllMentions: true,
        notifyAllReplies: true,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
      })
    })

    it('should return null for non-existent account', () => {
      const account = getAccount('non-existent-id')
      expect(account).toBeNull()
    })

    it('should set account - create new if not exists', () => {
      const accountData = {
        id: 'test-id',
        email: 'test@example.com',
        notifyAllMentions: true,
        notifyAllReplies: false,
      }
      setAccount(accountData)

      const account = getAccount(accountData.id)
      expect(account).toMatchObject({
        id: accountData.id,
        email: accountData.email,
        notifyAllMentions: accountData.notifyAllMentions,
        notifyAllReplies: accountData.notifyAllReplies,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      })
    })

    it('should set account - update existing', () => {
      const initialData = {
        id: 'test-id',
        email: 'test1@example.com',
        notifyAllMentions: false,
        notifyAllReplies: false,
      }
      createAccount(initialData)

      const updateData = {
        id: 'test-id',
        email: 'test2@example.com',
        notifyAllMentions: true,
        notifyAllReplies: true,
      }
      setAccount(updateData)

      const account = getAccount(updateData.id)
      expect(account).toMatchObject({
        id: updateData.id,
        email: updateData.email,
        notifyAllMentions: updateData.notifyAllMentions,
        notifyAllReplies: updateData.notifyAllReplies,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      })

      // Verify new email was created
      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const emails = db.prepare('SELECT email FROM emails').all() as {
        email: string
      }[]
      db.close()
      expect(emails.map((e) => e.email)).toContain(updateData.email)
    })

    it('should set account - partial update', () => {
      const initialData = {
        id: 'test-id',
        email: 'test@example.com',
        notifyAllMentions: false,
        notifyAllReplies: false,
      }
      createAccount(initialData)

      setAccount({
        id: 'test-id',
        notifyAllMentions: true,
      })

      const account = getAccount(initialData.id)
      expect(account).toMatchObject({
        id: initialData.id,
        email: initialData.email,
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      })
    })
  })

  describe('email operations', () => {
    it('should create and retrieve email with accounts', () => {
      const email = 'test@example.com'
      const account1 = {
        id: 'test-id-1',
        email,
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      }
      const account2 = {
        id: 'test-id-2',
        email,
        notifyAllMentions: false,
        notifyAllReplies: true,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      }

      createAccount(account1)
      createAccount(account2)

      // Get the adminToken from the database directly
      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const adminToken = db
        .prepare('SELECT adminToken FROM emails WHERE email = ?')
        .get(email) as {adminToken: string}
      db.close()

      const emailData = getEmailWithToken(adminToken.adminToken)
      expect(emailData).toBeDefined()
      expect(emailData?.email).toBe(email)
      expect(emailData?.adminToken).toBe(adminToken.adminToken)
      expect(emailData?.isUnsubscribed).toBe(false)
      expect(emailData?.accounts).toHaveLength(2)
      expect(emailData?.accounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: account1.id,
            email: account1.email,
            notifyAllMentions: account1.notifyAllMentions,
            notifyAllReplies: account1.notifyAllReplies,
            notifyOwnedDocChange: account1.notifyOwnedDocChange,
            notifySiteDiscussions: account1.notifySiteDiscussions,
          }),
          expect.objectContaining({
            id: account2.id,
            email: account2.email,
            notifyAllMentions: account2.notifyAllMentions,
            notifyAllReplies: account2.notifyAllReplies,
            notifyOwnedDocChange: account2.notifyOwnedDocChange,
            notifySiteDiscussions: account2.notifySiteDiscussions,
          }),
        ]),
      )
    })

    it('should unsubscribe and subscribe email', () => {
      const email = 'test@example.com'
      createAccount({
        id: 'test-id',
        email,
      })

      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const adminToken = db
        .prepare('SELECT adminToken FROM emails WHERE email = ?')
        .get(email) as {adminToken: string}
      db.close()

      setEmailUnsubscribed(adminToken.adminToken, true)

      const emailData = getEmailWithToken(adminToken.adminToken)
      expect(emailData?.isUnsubscribed).toBe(true)

      setEmailUnsubscribed(adminToken.adminToken, false)

      const emailData2 = getEmailWithToken(adminToken.adminToken)
      expect(emailData2?.isUnsubscribed).toBe(false)
    })

    it('should return null for non-existent email', () => {
      const emailData = getEmailWithToken('non-existent-token')
      expect(emailData).toBeNull()
    })

    it('should get all emails with their accounts', () => {
      const email1 = 'test1@example.com'
      const email2 = 'test2@example.com'

      createAccount({
        id: 'test-id-1',
        email: email1,
      })
      createAccount({
        id: 'test-id-2',
        email: email1,
      })
      createAccount({
        id: 'test-id-3',
        email: email2,
      })

      const emails = getAllEmails()
      expect(emails).toHaveLength(2)

      const email1Data = emails.find((e) => e.email === email1)
      expect(email1Data?.accounts).toHaveLength(2)

      const email2Data = emails.find((e) => e.email === email2)
      expect(email2Data?.accounts).toHaveLength(1)
    })
  })

  describe('notifier operations', () => {
    it('should get and set last processed blob CID', () => {
      const testCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

      // Initially should be undefined
      expect(getNotifierLastProcessedBlobCid()).toBeUndefined()

      // Set the CID
      setNotifierLastProcessedBlobCid(testCid)

      // Should now return the set CID
      expect(getNotifierLastProcessedBlobCid()).toBe(testCid)

      // Setting a new CID should update the value
      const newCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdj'
      setNotifierLastProcessedBlobCid(newCid)
      expect(getNotifierLastProcessedBlobCid()).toBe(newCid)
    })
  })
})
