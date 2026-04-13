import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {cleanup, getInboxRegisteredAccounts, initDatabase, insertNotification} from './db'
import {applyNotificationActionsForAccount, getNotificationStateSnapshot} from './notification-state'

const {sendEmailMock} = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => undefined),
}))

vi.mock('./mailer', () => ({
  sendEmail: sendEmailMock,
}))

function insertTestNotification(accountId: string, feedEventId: string, eventAtMs: number, siteUid: string) {
  insertNotification(accountId, feedEventId, eventAtMs, {
    feedEventId,
    eventAtMs,
    reason: 'reply',
    eventType: 'comment',
    author: {uid: 'author-a', name: 'Author', icon: null},
    target: {uid: siteUid, path: ['post'], name: 'Post'},
    commentId: `${feedEventId}-comment`,
    sourceId: null,
    citationType: null,
  })
}

describe('notification state service', () => {
  let dataDir: string

  beforeEach(async () => {
    dataDir = mkdtempSync(`${tmpdir()}/seed-notification-state-`)
    process.env.DATA_DIR = dataDir
    sendEmailMock.mockClear()
    await initDatabase()
  })

  afterEach(() => {
    cleanup()
    rmSync(dataDir, {recursive: true, force: true})
  })

  it('applies shared actions to canonical notify-service state', async () => {
    const accountId = 'account-state-1'

    insertTestNotification(accountId, 'event-1', 2000, 'site-a')

    const nextState = await applyNotificationActionsForAccount(accountId, [
      {
        type: 'mark-event-read',
        eventId: 'event-1',
        eventAtMs: 2000,
      },
      {
        type: 'set-config',
        email: 'User@Example.com',
        createdAtMs: 1_700_000_000_000,
      },
    ])

    expect(nextState.inbox.notifications).toHaveLength(1)
    expect(nextState.readState.readEvents).toEqual([{eventId: 'event-1', eventAtMs: 2000}])
    expect(nextState.config.email).toBe('user@example.com')
    expect(nextState.config.verifiedTime).toBeNull()
    expect(nextState.config.verificationSendTime).toBe(new Date(1_700_000_000_000).toISOString())
    expect(sendEmailMock).toHaveBeenCalledTimes(1)

    const persistedState = getNotificationStateSnapshot(accountId)
    expect(persistedState.inbox.notifications).toHaveLength(1)
    expect(persistedState.readState.readEvents).toEqual([{eventId: 'event-1', eventAtMs: 2000}])
    expect(persistedState.config.email).toBe('user@example.com')
  })

  it('registers inbox delivery when notification state is fetched', () => {
    const accountId = 'account-state-register'

    expect(getInboxRegisteredAccounts()).toEqual([])

    const snapshot = getNotificationStateSnapshot(accountId)

    expect(snapshot.accountId).toBe(accountId)
    expect(getInboxRegisteredAccounts()).toEqual([accountId])
  })

  it('filters site-scoped inbox pages on the notify service', () => {
    const accountId = 'account-state-site-filter'

    insertTestNotification(accountId, 'event-1', 4000, 'site-a')
    insertTestNotification(accountId, 'event-2', 3000, 'site-b')
    insertTestNotification(accountId, 'event-3', 2000, 'site-a')

    const firstPage = getNotificationStateSnapshot(accountId, {
      siteUid: 'site-a',
      limit: 1,
    })

    expect(firstPage.inbox.notifications.map((notification) => notification.feedEventId)).toEqual(['event-1'])
    expect(firstPage.inbox.hasMore).toBe(true)
    expect(firstPage.inbox.oldestEventAtMs).toBe(4000)

    const secondPage = getNotificationStateSnapshot(accountId, {
      siteUid: 'site-a',
      limit: 1,
      beforeMs: firstPage.inbox.oldestEventAtMs ?? undefined,
    })

    expect(secondPage.inbox.notifications.map((notification) => notification.feedEventId)).toEqual(['event-3'])
    expect(secondPage.inbox.hasMore).toBe(false)
  })

  it('marks all notifications for the requested site as read and advances the global watermark conservatively', async () => {
    const accountId = 'account-state-site-read'

    insertTestNotification(accountId, 'event-1', 1000, 'site-a')
    insertTestNotification(accountId, 'event-2', 2000, 'site-a')
    insertTestNotification(accountId, 'event-3', 3000, 'site-b')

    const nextState = await applyNotificationActionsForAccount(
      accountId,
      [{type: 'mark-site-read', siteUid: 'site-a'}],
      {siteUid: 'site-a'},
    )

    expect(nextState.inbox.notifications.map((notification) => notification.feedEventId)).toEqual([
      'event-2',
      'event-1',
    ])
    expect(nextState.readState.markAllReadAtMs).toBe(2000)
    expect(nextState.readState.readEvents).toEqual([])

    const globalState = getNotificationStateSnapshot(accountId)
    expect(globalState.readState.markAllReadAtMs).toBe(2000)
    expect(globalState.readState.readEvents).toEqual([])
  })

  it('does not advance the watermark through mixed timestamps when other-site notifications remain unread', async () => {
    const accountId = 'account-state-mixed-bucket'

    insertTestNotification(accountId, 'event-1', 2000, 'site-a')
    insertTestNotification(accountId, 'event-2', 2000, 'site-b')
    insertTestNotification(accountId, 'event-3', 3000, 'site-a')

    const nextState = await applyNotificationActionsForAccount(
      accountId,
      [{type: 'mark-site-read', siteUid: 'site-a'}],
      {siteUid: 'site-a'},
    )

    expect(nextState.readState.markAllReadAtMs).toBeNull()
    expect(nextState.readState.readEvents).toEqual([
      {eventId: 'event-3', eventAtMs: 3000},
      {eventId: 'event-1', eventAtMs: 2000},
    ])
  })
})
