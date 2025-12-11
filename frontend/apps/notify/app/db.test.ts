import Database from 'better-sqlite3'
import {mkdtempSync, rmSync} from 'fs'
import {join} from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  cleanup,
  createSubscription,
  getAllEmails,
  getEmailWithToken,
  getNotifierLastProcessedEventId,
  getSubscription,
  initDatabase,
  setEmailUnsubscribed,
  setNotifierLastProcessedEventId,
  setSubscription,
  updateSubscription,
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
      expect(tables.map((t) => t.name)).toContain('email_subscriptions')
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

      // Check email_subscriptions table schema
      const subscriptionsSchema = db
        .prepare('PRAGMA table_info(email_subscriptions)')
        .all() as ColumnInfo[]
      expect(subscriptionsSchema).toHaveLength(8)
      expect(subscriptionsSchema.find((c) => c.name === 'id')).toBeDefined()
      expect(subscriptionsSchema.find((c) => c.name === 'email')).toBeDefined()
      expect(
        subscriptionsSchema.find((c) => c.name === 'createdAt'),
      ).toBeDefined()
      expect(
        subscriptionsSchema.find((c) => c.name === 'notifyAllMentions'),
      ).toBeDefined()
      expect(
        subscriptionsSchema.find((c) => c.name === 'notifyAllReplies'),
      ).toBeDefined()
      expect(
        subscriptionsSchema.find((c) => c.name === 'notifyOwnedDocChange'),
      ).toBeDefined()
      expect(
        subscriptionsSchema.find((c) => c.name === 'notifySiteDiscussions'),
      ).toBeDefined()
      expect(
        subscriptionsSchema.find((c) => c.name === 'notifyAllComments'),
      ).toBeDefined()

      // Check foreign key constraint
      const foreignKeys = db
        .prepare('PRAGMA foreign_key_list(email_subscriptions)')
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
      expect(version).toBe(4)
      db.close()
    })
  })

  describe('subscription operations', () => {
    // TODO: Update tests to match new subscription-based schema
    it('should create subscription without email', () => {
      const subscriptionData = {
        id: 'test-id',
        email: 'test@example.com',
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      createSubscription(subscriptionData)

      const subscription = getSubscription(
        subscriptionData.id,
        subscriptionData.email,
      )
      expect(subscription).toMatchObject({
        id: subscriptionData.id,
        email: subscriptionData.email,
        notifyAllMentions: subscriptionData.notifyAllMentions,
        notifyAllReplies: subscriptionData.notifyAllReplies,
        notifyOwnedDocChange: subscriptionData.notifyOwnedDocChange,
        notifySiteDiscussions: subscriptionData.notifySiteDiscussions,
        notifyAllComments: subscriptionData.notifyAllComments,
      })
      expect(subscription?.createdAt).toBeDefined()
    })

    it('should create subscription with email', () => {
      const subscriptionData = {
        id: 'test-id-2',
        email: 'test2@example.com',
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      createSubscription(subscriptionData)

      const subscription = getSubscription(
        subscriptionData.id,
        subscriptionData.email,
      )
      expect(subscription).toMatchObject({
        id: subscriptionData.id,
        email: subscriptionData.email,
        notifyAllMentions: subscriptionData.notifyAllMentions,
        notifyAllReplies: subscriptionData.notifyAllReplies,
        notifyOwnedDocChange: subscriptionData.notifyOwnedDocChange,
        notifySiteDiscussions: subscriptionData.notifySiteDiscussions,
        notifyAllComments: subscriptionData.notifyAllComments,
      })
      expect(subscription?.createdAt).toBeDefined()
    })

    it('should update subscription notification settings', () => {
      const subscriptionData = {
        id: 'test-id-3',
        email: 'test3@example.com',
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      createSubscription(subscriptionData)

      updateSubscription(subscriptionData.id, {
        notifyAllMentions: true,
        notifyAllReplies: true,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
        notifyAllComments: false,
      })

      const subscription = getSubscription(
        subscriptionData.id,
        subscriptionData.email,
      )
      expect(subscription).toMatchObject({
        id: subscriptionData.id,
        notifyAllMentions: true,
        notifyAllReplies: true,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
        notifyAllComments: false,
      })
    })

    it('should return null for non-existent subscription', () => {
      const subscription = getSubscription(
        'non-existent-id',
        'non-existent@example.com',
      )
      expect(subscription).toBeNull()
    })

    it('should set subscription - create new if not exists', () => {
      const subscriptionData = {
        id: 'test-id-4',
        email: 'test4@example.com',
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      setSubscription(subscriptionData)

      const subscription = getSubscription(
        subscriptionData.id,
        subscriptionData.email,
      )
      expect(subscription).toMatchObject({
        id: subscriptionData.id,
        email: subscriptionData.email,
        notifyAllMentions: subscriptionData.notifyAllMentions,
        notifyAllReplies: subscriptionData.notifyAllReplies,
        notifyOwnedDocChange: subscriptionData.notifyOwnedDocChange,
        notifySiteDiscussions: subscriptionData.notifySiteDiscussions,
        notifyAllComments: subscriptionData.notifyAllComments,
      })
    })

    it('should set subscription - update existing', () => {
      const initialData = {
        id: 'test-id-5',
        email: 'test5@example.com',
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      createSubscription(initialData)

      const updateData = {
        id: 'test-id-5',
        email: 'test5-updated@example.com',
        notifyAllMentions: true,
        notifyAllReplies: true,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
        notifyAllComments: false,
      }
      setSubscription(updateData)

      const subscription = getSubscription(updateData.id, updateData.email)
      expect(subscription).toMatchObject({
        id: updateData.id,
        email: updateData.email,
        notifyAllMentions: updateData.notifyAllMentions,
        notifyAllReplies: updateData.notifyAllReplies,
        notifyOwnedDocChange: updateData.notifyOwnedDocChange,
        notifySiteDiscussions: updateData.notifySiteDiscussions,
        notifyAllComments: updateData.notifyAllComments,
      })

      // Verify new email was created
      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const emails = db.prepare('SELECT email FROM emails').all() as {
        email: string
      }[]
      db.close()
      expect(emails.map((e) => e.email)).toContain(updateData.email)
    })

    it('should set subscription - partial update', () => {
      const initialData = {
        id: 'test-id-6',
        email: 'test6@example.com',
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      createSubscription(initialData)

      setSubscription({
        id: 'test-id-6',
        email: 'test6@example.com',
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      })

      const subscription = getSubscription(initialData.id, initialData.email)
      expect(subscription).toMatchObject({
        id: initialData.id,
        email: initialData.email,
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      })
    })
  })

  describe('email operations', () => {
    it('should create and retrieve email with subscriptions', () => {
      const email = 'test@example.com'
      const subscription1 = {
        id: 'test-id-1',
        email,
        notifyAllMentions: true,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }
      const subscription2 = {
        id: 'test-id-2',
        email,
        notifyAllMentions: false,
        notifyAllReplies: true,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      }

      createSubscription(subscription1)
      createSubscription(subscription2)

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
      expect(emailData?.subscriptions).toHaveLength(2)
      expect(emailData?.subscriptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: subscription1.id,
            email: subscription1.email,
            notifyAllMentions: subscription1.notifyAllMentions,
            notifyAllReplies: subscription1.notifyAllReplies,
            notifyOwnedDocChange: subscription1.notifyOwnedDocChange,
            notifySiteDiscussions: subscription1.notifySiteDiscussions,
            notifyAllComments: subscription1.notifyAllComments,
          }),
          expect.objectContaining({
            id: subscription2.id,
            email: subscription2.email,
            notifyAllMentions: subscription2.notifyAllMentions,
            notifyAllReplies: subscription2.notifyAllReplies,
            notifyOwnedDocChange: subscription2.notifyOwnedDocChange,
            notifySiteDiscussions: subscription2.notifySiteDiscussions,
            notifyAllComments: subscription2.notifyAllComments,
          }),
        ]),
      )
    })

    it('should unsubscribe and subscribe email', () => {
      const email = 'test@example.com'
      createSubscription({
        id: 'test-id-7',
        email,
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
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

    it('should get all emails with their subscriptions', () => {
      const email1 = 'test1@example.com'
      const email2 = 'test2@example.com'

      createSubscription({
        id: 'test-id-1',
        email: email1,
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      })
      createSubscription({
        id: 'test-id-2',
        email: email1,
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      })
      createSubscription({
        id: 'test-id-3',
        email: email2,
        notifyAllMentions: false,
        notifyAllReplies: false,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
        notifyAllComments: true,
      })

      const emails = getAllEmails()
      expect(emails).toHaveLength(2)

      const email1Data = emails.find((e) => e.email === email1)
      expect(email1Data?.subscriptions).toHaveLength(2)

      const email2Data = emails.find((e) => e.email === email2)
      expect(email2Data?.subscriptions).toHaveLength(1)
    })
  })

  describe('notifier operations', () => {
    it('should get and set last processed blob CID', () => {
      const testId =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

      // Initially should be undefined
      expect(getNotifierLastProcessedEventId()).toBeUndefined()

      // Set the CID
      setNotifierLastProcessedEventId(testId)

      // Should now return the set CID
      expect(getNotifierLastProcessedEventId()).toBe(testId)

      // Setting a new CID should update the value
      const newCid =
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdj'
      setNotifierLastProcessedEventId(newCid)
      expect(getNotifierLastProcessedEventId()).toBe(newCid)
    })
  })
})
