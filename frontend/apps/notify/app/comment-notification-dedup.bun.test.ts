import {Database} from 'bun:sqlite'
import type {Notification} from '@shm/emails/notifier'
import {persistNotificationsForInboxAccounts} from './notification-persistence'
import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'bun:test'
import {
  claimBatchCommentNotifications,
  cleanup,
  getAllNotifications,
  initDatabase,
  insertNotification,
  insertNotificationsBatch,
} from './db'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'

const comment = 'author/stable-tsid'
function payload(event: string, reason: 'discussion' | 'mention' | 'reply', id = comment): NotificationPayload {
  return {
    feedEventId: event,
    eventAtMs: Number(event.replace(/\D/g, '')) || 1000,
    reason,
    eventType: 'comment',
    author: {uid: 'author', name: 'Author', icon: null},
    target: {uid: 'site', path: ['post'], name: 'Post'},
    commentId: id,
    sourceId: null,
    citationType: null,
  }
}
function insert(account: string, event: string, reason: 'discussion' | 'mention' | 'reply', id = comment) {
  return insertNotification(account, event, payload(event, reason, id).eventAtMs, payload(event, reason, id))
}

describe('logical comment notification claims', () => {
  let dir: string
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'seed-comment-claims-'))
    process.env.DATA_DIR = dir
    await initDatabase()
  })
  afterEach(() => {
    cleanup()
    rmSync(dir, {recursive: true, force: true})
  })

  it('keeps one mention across blob edits and separate mention events while permitting new recipients', () => {
    expect(insert('owner', 'event1000', 'mention')).toBe(true)
    expect(insert('owner', 'event2000', 'discussion')).toBe(false)
    expect(insert('owner', 'mention3000', 'mention')).toBe(false)
    expect(insert('new-recipient', 'mention3000', 'mention')).toBe(true)
    expect(getAllNotifications('owner')).toHaveLength(1)
    expect(getAllNotifications('new-recipient')[0]?.reason).toBe('mention')
  })

  it('keeps reply ahead of a later mention for the same recipient and comment', () => {
    expect(insert('owner', 'reply1000', 'reply')).toBe(true)
    // A duplicate claim is not a second email-eligible notification.
    expect(insert('owner', 'mention2000', 'mention')).toBe(false)
    const rows = getAllNotifications('owner')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('reply')
    expect(rows[0]?.feedEventId).toBe('reply1000')
  })

  it('promotes an earlier mention to reply in place without a second email-eligible row', () => {
    expect(insert('owner', 'mention1000', 'mention')).toBe(true)
    expect(insert('owner', 'reply2000', 'reply')).toBe(false)
    expect(insert('owner', 'mention3000', 'mention')).toBe(false)
    const rows = getAllNotifications('owner')
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reason).toBe('reply')
    expect(rows[0]?.feedEventId).toBe('mention1000')
  })

  it('keeps only the first claim email-eligible in both batch event orders', () => {
    for (const [accountId, first, second] of [
      ['reply-first', 'reply', 'mention'],
      ['mention-first', 'mention', 'reply'],
    ] as const) {
      const event1 = accountId + '1000'
      const event2 = accountId + '2000'
      expect(
        insertNotificationsBatch([
          {accountId, feedEventId: event1, eventAtMs: 1000, data: payload(event1, first)},
          {accountId, feedEventId: event2, eventAtMs: 2000, data: payload(event2, second)},
        ]),
      ).toEqual([true, false])
      const rows = getAllNotifications(accountId)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.reason).toBe('reply')
      expect(rows[0]?.feedEventId).toBe(event1)
    }
  })

  it('upgrades late mention in place, preserving event and read cursor identity', () => {
    expect(insert('owner', 'event1000', 'discussion')).toBe(true)
    const db = new Database(join(dir, 'web-db.sqlite'))
    db.query('INSERT INTO notification_read_events (accountId,eventId,eventAtMs) VALUES (?,?,?)').run(
      'owner',
      'event1000',
      1000,
    )
    expect(insert('owner', 'mention2000', 'mention')).toBe(false)
    const [row] = getAllNotifications('owner')
    expect(row?.reason).toBe('mention')
    expect(row?.feedEventId).toBe('event1000')
    expect(db.query('SELECT eventId FROM notification_read_events WHERE accountId = ?').get('owner')).toEqual({
      eventId: 'event1000',
    })
    db.close()
  })

  it('atomically filters a batch and exposes only accepted entries to email dispatch', () => {
    const items = [
      {accountId: 'owner', feedEventId: 'event1000', eventAtMs: 1000, data: payload('event1000', 'discussion')},
      {accountId: 'owner', feedEventId: 'event2000', eventAtMs: 2000, data: payload('event2000', 'mention')},
      {accountId: 'other', feedEventId: 'event2000', eventAtMs: 2000, data: payload('event2000', 'mention')},
    ]
    expect(insertNotificationsBatch(items)).toEqual([true, false, true])
    expect(insertNotificationsBatch(items)).toEqual([false, false, false])
    expect(getAllNotifications('owner')[0]?.reason).toBe('mention')
  })

  it('allows a first mention on edit after an unnotified original comment', () => {
    expect(getAllNotifications('third')).toHaveLength(0)
    expect(insert('owner', 'event1000', 'discussion')).toBe(true)
    expect(insert('third', 'event2000', 'mention')).toBe(true)
    expect(insert('third', 'event3000', 'mention')).toBe(false)
    expect(getAllNotifications('third')).toHaveLength(1)
  })

  it('returns accepted flags at the persistence boundary used to gate immediate email', () => {
    const notification = (reason: 'discussion' | 'mention') =>
      ({
        reason,
        source: 'comment',
        comment: {id: comment, author: 'author'},
        targetId: {uid: 'site', path: ['post']},
        targetMeta: null,
        authorMeta: null,
      }) as unknown as Notification
    const items = [
      {accountId: 'owner', eventId: 'event1000', eventAtMs: 1000, notif: notification('discussion')},
      {accountId: 'owner', eventId: 'mention2000', eventAtMs: 2000, notif: notification('mention')},
      {accountId: 'other', eventId: 'mention2000', eventAtMs: 2000, notif: notification('mention')},
    ]
    expect(persistNotificationsForInboxAccounts(items)).toEqual([true, false, true])
    expect(persistNotificationsForInboxAccounts(items)).toEqual([false, false, false])
    expect(getAllNotifications('owner')[0]?.reason).toBe('mention')
  })

  it('backfills old rows without deleting duplicates or changing historical event IDs', async () => {
    cleanup()
    const db = new Database(join(dir, 'web-db.sqlite'))
    db.exec(
      'DROP TABLE notification_comment_claims; DROP TABLE notification_batch_comment_claims; PRAGMA user_version = 10;',
    )
    for (const [event, reason] of [
      ['event1000', 'discussion'],
      ['event2000', 'mention'],
    ] as const) {
      db.query('INSERT INTO notification_inbox (accountId, feedEventId, eventAtMs, data) VALUES (?, ?, ?, ?)').run(
        'owner',
        event,
        payload(event, reason).eventAtMs,
        JSON.stringify(payload(event, reason)),
      )
    }
    db.close()
    await initDatabase()
    expect(getAllNotifications('owner')).toHaveLength(2)
    expect(insert('owner', 'event3000', 'mention')).toBe(false)
    expect(getAllNotifications('owner')).toHaveLength(2)
  })

  it('reserves batch discussions once per email/account/comment but allows distinct comments', () => {
    const entries = [{accountId: 'owner', email: 'a@example.test', commentId: comment}]
    expect(claimBatchCommentNotifications([...entries, ...entries])).toEqual([true, false])
    expect(claimBatchCommentNotifications(entries)).toEqual([false])
    expect(claimBatchCommentNotifications([{...entries[0]!, commentId: 'author/new'}])).toEqual([true])
  })
})
