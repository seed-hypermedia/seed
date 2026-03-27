import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {cleanup, initDatabase, insertNotification} from './db'
import {applyNotificationActionsForAccount, getNotificationStateSnapshot} from './notification-state'

const {sendEmailMock} = vi.hoisted(() => ({
  sendEmailMock: vi.fn(async () => undefined),
}))

vi.mock('./mailer', () => ({
  sendEmail: sendEmailMock,
}))

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

    insertNotification(accountId, 'event-1', 2000, {
      feedEventId: 'event-1',
      eventAtMs: 2000,
      reason: 'reply',
      eventType: 'comment',
      author: {uid: 'author-a', name: 'Author', icon: null},
      target: {uid: 'site-a', path: ['post'], name: 'Post'},
      commentId: 'comment-1',
      sourceId: null,
      citationType: null,
    })

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
})
