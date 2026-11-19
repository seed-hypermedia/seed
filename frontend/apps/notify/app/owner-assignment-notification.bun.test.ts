import {Timestamp} from '@bufbuild/protobuf'
import type {Event} from '@shm/shared'
import {afterEach, beforeEach, expect, it, mock} from 'bun:test'
import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {
  cleanup,
  createSubscription,
  getAllNotifications,
  initDatabase,
  markNotificationConfigVerified,
  setNotificationConfig,
} from './db'

const assignee = 'z6MkAssigneeFixture'
const author = 'z6MkAuthorFixture'
const cid = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'
const email = 'assignee@example.test'
const sent = mock(async (..._args: unknown[]) => ({messageId: 'observed'}))

mock.module('./mailer', () => ({sendEmail: sent}))
mock.module('./notify-request', () => ({
  grpcClient: {comments: {getComment: async () => null}},
  requestAPI: async (kind: string, input: any) => {
    if (kind === 'Resource') return {type: 'document', document: {metadata: {name: 'Task'}, content: []}}
    if (kind === 'ResourceMetadata') return {metadata: {name: 'Task'}}
    if (kind === 'Account')
      return {type: 'account', id: {uid: input}, metadata: {name: input === author ? 'Bea' : 'Alberti'}}
    throw new Error('unexpected API: ' + kind)
  },
}))
const {processImmediateNotifications} = await import('./email-notifier')

/** A metadata/Link citation: the author's document names the assignee under the given attribute key. */
function metadataLink(key: string): Event {
  const stamp = new Timestamp({seconds: BigInt(Math.floor(Date.now() / 1000))})
  return {
    account: author,
    eventTime: stamp,
    observeTime: stamp,
    data: {
      case: 'newMention',
      value: {
        source: 'hm://' + author + '/tasks/task',
        sourceType: 'metadata/Link',
        sourceContext: key,
        target: 'hm://' + assignee,
        sourceBlob: {author, cid},
        mentionType: '',
      },
    },
  } as Event
}

let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'seed-owner-assignment-'))
  process.env.DATA_DIR = dir
  sent.mockClear()
  await initDatabase()
  createSubscription({id: assignee, email})
  setNotificationConfig(assignee, email)
  expect(markNotificationConfigVerified(assignee, email)).toBe(true)
})
afterEach(() => {
  cleanup()
  rmSync(dir, {recursive: true, force: true})
})

it('setting an account as owner notifies it as an assignment, not a mention', async () => {
  await processImmediateNotifications([metadataLink('owner')])
  expect(getAllNotifications(assignee)).toMatchObject([
    {
      reason: 'assignment',
      eventType: 'citation',
      author: {uid: author},
      target: {uid: author, path: ['tasks', 'task']},
    },
  ])
  expect(sent).toHaveBeenCalledTimes(1)
  expect(sent.mock.calls[0]?.[1]).toBe('Bea assigned you to Task')
  expect(sent.mock.calls[0]?.[4]).toMatchObject({feedbackId: 'assignment'})
})

it('other account-valued attributes remain mentions', async () => {
  await processImmediateNotifications([metadataLink('reviewer')])
  expect(getAllNotifications(assignee).map((row) => row.reason)).toEqual(['mention'])
  expect(sent.mock.calls[0]?.[4]).toMatchObject({feedbackId: 'mention'})
})
