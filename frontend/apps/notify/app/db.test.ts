import Database from 'better-sqlite3'
import {mkdtempSync, rmSync} from 'fs'
import {join} from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {
  cleanup,
  createSubscription,
  getAllEmails,
  getEmailWithToken,
  getNotificationConfig,
  getNotificationConfigsForEmail,
  getNotificationReadState,
  getNotifierLastProcessedEventId,
  getSubscription,
  initDatabase,
  mergeNotificationReadState,
  setEmailUnsubscribed,
  setNotificationConfig,
  setNotifierLastProcessedEventId,
  setSubscription,
  unsetNotificationConfig,
  updateSubscription,
} from './db'

interface TableInfo {
  name: string
}

interface ColumnInfo {
  name: string
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

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as TableInfo[]
      expect(tables.map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'emails',
          'email_subscriptions',
          'notifier_status',
          'notification_config',
          'notification_read_state',
          'notification_read_events',
        ]),
      )

      const emailsSchema = db.prepare('PRAGMA table_info(emails)').all() as ColumnInfo[]
      expect(emailsSchema.map((c) => c.name)).toEqual(
        expect.arrayContaining(['email', 'adminToken', 'createdAt', 'isUnsubscribed']),
      )

      const subscriptionsSchema = db.prepare('PRAGMA table_info(email_subscriptions)').all() as ColumnInfo[]
      expect(subscriptionsSchema.map((c) => c.name)).toEqual(
        expect.arrayContaining(['id', 'email', 'createdAt', 'notifyOwnedDocChange', 'notifySiteDiscussions']),
      )
      expect(subscriptionsSchema.find((c) => c.name === 'notifyAllMentions')).toBeUndefined()
      expect(subscriptionsSchema.find((c) => c.name === 'notifyAllReplies')).toBeUndefined()
      expect(subscriptionsSchema.find((c) => c.name === 'notifyAllComments')).toBeUndefined()

      const foreignKeys = db.prepare('PRAGMA foreign_key_list(email_subscriptions)').all() as ForeignKeyInfo[]
      expect(foreignKeys).toHaveLength(1)
      expect(foreignKeys[0]!.from).toBe('email')
      expect(foreignKeys[0]!.to).toBe('email')
      expect(foreignKeys[0]!.table).toBe('emails')

      db.close()
    })

    it('should handle database version correctly', async () => {
      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const version = db.pragma('user_version', {simple: true})
      expect(version).toBe(8)
      db.close()
    })
  })

  describe('subscription operations', () => {
    it('should create and read a site subscription', () => {
      const subscriptionData = {
        id: 'test-id',
        email: 'test@example.com',
        notifyOwnedDocChange: true,
        notifySiteDiscussions: false,
      }
      createSubscription(subscriptionData)

      const subscription = getSubscription(subscriptionData.id, subscriptionData.email)
      expect(subscription).toMatchObject(subscriptionData)
      expect(subscription?.createdAt).toBeDefined()
    })

    it('should update subscription notification settings', () => {
      const subscriptionData = {
        id: 'test-id-2',
        email: 'test2@example.com',
        notifyOwnedDocChange: false,
        notifySiteDiscussions: false,
      }
      createSubscription(subscriptionData)

      updateSubscription(subscriptionData.id, {
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
      })

      const subscription = getSubscription(subscriptionData.id, subscriptionData.email)
      expect(subscription).toMatchObject({
        id: subscriptionData.id,
        email: subscriptionData.email,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
      })
    })

    it('should set subscription and preserve missing fields from current value', () => {
      setSubscription({
        id: 'test-id-3',
        email: 'test3@example.com',
        notifyOwnedDocChange: true,
      })

      setSubscription({
        id: 'test-id-3',
        email: 'test3@example.com',
        notifySiteDiscussions: true,
      })

      const subscription = getSubscription('test-id-3', 'test3@example.com')
      expect(subscription).toMatchObject({
        id: 'test-id-3',
        email: 'test3@example.com',
        notifyOwnedDocChange: true,
        notifySiteDiscussions: true,
      })
    })

    it('should return null for non-existent subscription', () => {
      expect(getSubscription('non-existent-id', 'non-existent@example.com')).toBeNull()
    })
  })

  describe('email operations', () => {
    it('should create and retrieve email with subscriptions', () => {
      const email = 'test@example.com'
      const subscription1 = {
        id: 'test-id-1',
        email,
        notifyOwnedDocChange: true,
        notifySiteDiscussions: false,
      }
      const subscription2 = {
        id: 'test-id-2',
        email,
        notifyOwnedDocChange: false,
        notifySiteDiscussions: true,
      }

      createSubscription(subscription1)
      createSubscription(subscription2)

      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const adminToken = db.prepare('SELECT adminToken FROM emails WHERE email = ?').get(email) as {adminToken: string}
      db.close()

      const emailData = getEmailWithToken(adminToken.adminToken)
      expect(emailData).toBeDefined()
      expect(emailData?.email).toBe(email)
      expect(emailData?.isUnsubscribed).toBe(false)
      expect(emailData?.subscriptions).toHaveLength(2)
      expect(emailData?.subscriptions).toEqual(
        expect.arrayContaining([expect.objectContaining(subscription1), expect.objectContaining(subscription2)]),
      )
    })

    it('should unsubscribe and resubscribe email', () => {
      const email = 'toggle@example.com'
      createSubscription({
        id: 'toggle-id',
        email,
      })

      const db = new Database(join(tmpDir, 'web-db.sqlite'))
      const adminToken = db.prepare('SELECT adminToken FROM emails WHERE email = ?').get(email) as {adminToken: string}
      db.close()

      setEmailUnsubscribed(adminToken.adminToken, true)
      expect(getEmailWithToken(adminToken.adminToken)?.isUnsubscribed).toBe(true)

      setEmailUnsubscribed(adminToken.adminToken, false)
      expect(getEmailWithToken(adminToken.adminToken)?.isUnsubscribed).toBe(false)
    })

    it('should return all emails with their subscriptions', () => {
      createSubscription({
        id: 'email-list-1',
        email: 'test1@example.com',
      })
      createSubscription({
        id: 'email-list-2',
        email: 'test1@example.com',
      })
      createSubscription({
        id: 'email-list-3',
        email: 'test2@example.com',
      })

      const emails = getAllEmails()
      expect(emails).toHaveLength(2)
      expect(emails.find((e) => e.email === 'test1@example.com')?.subscriptions).toHaveLength(2)
      expect(emails.find((e) => e.email === 'test2@example.com')?.subscriptions).toHaveLength(1)
    })
  })

  describe('notification config operations', () => {
    it('should set and get notification config', () => {
      setNotificationConfig('account-1', 'user@example.com')
      const config = getNotificationConfig('account-1')
      expect(config).not.toBeNull()
      expect(config!.accountId).toBe('account-1')
      expect(config!.email).toBe('user@example.com')
      expect(config!.createdAt).toBeDefined()
      expect(config!.updatedAt).toBeDefined()
    })

    it('should list notification configs by email', () => {
      setNotificationConfig('account-a', 'shared@example.com')
      setNotificationConfig('account-b', 'shared@example.com')
      setNotificationConfig('account-c', 'other@example.com')

      const configs = getNotificationConfigsForEmail('shared@example.com')
      expect(configs.map((cfg) => cfg.accountId).sort()).toEqual(['account-a', 'account-b'])
    })

    it('should ensure email row exists for notification config email', () => {
      setNotificationConfig('account-config-email', 'config@example.com')
      const allEmails = getAllEmails()
      expect(allEmails.find((email) => email.email === 'config@example.com')).toBeDefined()
    })

    it('should remove notification config only for matching account + email', () => {
      setNotificationConfig('account-a', 'shared@example.com')
      setNotificationConfig('account-b', 'shared@example.com')

      expect(unsetNotificationConfig('account-a', 'other@example.com')).toBe(false)
      expect(getNotificationConfig('account-a')?.email).toBe('shared@example.com')

      expect(unsetNotificationConfig('account-a', 'shared@example.com')).toBe(true)
      expect(getNotificationConfig('account-a')).toBeNull()
      expect(getNotificationConfig('account-b')?.email).toBe('shared@example.com')
    })
  })

  describe('notifier operations', () => {
    it('should get and set last processed event ID', () => {
      const testId = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

      expect(getNotifierLastProcessedEventId()).toBeUndefined()
      setNotifierLastProcessedEventId(testId)
      expect(getNotifierLastProcessedEventId()).toBe(testId)

      const newCid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdj'
      setNotifierLastProcessedEventId(newCid)
      expect(getNotifierLastProcessedEventId()).toBe(newCid)
    })
  })

  describe('notification read state operations', () => {
    it('should return default read state when account has no state', () => {
      const state = getNotificationReadState('account-empty')
      expect(state).toMatchObject({
        accountId: 'account-empty',
        markAllReadAtMs: null,
        readEvents: [],
      })
      expect(state.updatedAt).toBeDefined()
    })

    it('should merge mark-all watermark monotonically at same stateUpdatedAtMs', () => {
      const accountId = 'account-read-1'
      mergeNotificationReadState(accountId, {
        markAllReadAtMs: 1000,
        stateUpdatedAtMs: 0,
        readEvents: [],
      })
      mergeNotificationReadState(accountId, {
        markAllReadAtMs: 500,
        stateUpdatedAtMs: 0,
        readEvents: [],
      })

      const state = getNotificationReadState(accountId)
      expect(state.markAllReadAtMs).toBe(1000)
    })

    it('should accept lower watermark when stateUpdatedAtMs is newer', () => {
      const accountId = 'account-read-lww'
      mergeNotificationReadState(accountId, {
        markAllReadAtMs: 1000,
        stateUpdatedAtMs: 100,
        readEvents: [],
      })
      mergeNotificationReadState(accountId, {
        markAllReadAtMs: 500,
        stateUpdatedAtMs: 200,
        readEvents: [],
      })

      const state = getNotificationReadState(accountId)
      expect(state.markAllReadAtMs).toBe(500)
      expect(state.stateUpdatedAtMs).toBe(200)
    })

    it('should union read events and keep max timestamp per event id', () => {
      const accountId = 'account-read-2'
      mergeNotificationReadState(accountId, {
        markAllReadAtMs: null,
        stateUpdatedAtMs: 0,
        readEvents: [
          {eventId: 'event-a', eventAtMs: 100},
          {eventId: 'event-b', eventAtMs: 200},
        ],
      })
      mergeNotificationReadState(accountId, {
        markAllReadAtMs: null,
        stateUpdatedAtMs: 0,
        readEvents: [
          {eventId: 'event-a', eventAtMs: 300},
          {eventId: 'event-c', eventAtMs: 250},
        ],
      })

      const state = getNotificationReadState(accountId)
      expect(state.readEvents).toEqual([
        {eventId: 'event-a', eventAtMs: 300},
        {eventId: 'event-c', eventAtMs: 250},
        {eventId: 'event-b', eventAtMs: 200},
      ])
    })
  })
})
