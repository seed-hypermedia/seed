import {Timestamp} from '@bufbuild/protobuf'
import type {Event} from '@shm/shared'
import {Comment} from '@shm/shared/client/.generated/documents/v3alpha/comments_pb'
import {Annotation, Block, BlockNode} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
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
  removeNotificationConfig,
  setNotificationConfig,
  updateSubscription,
} from './db'

const owner = 'z6MkOwnerFixture'
const author = 'z6MkAuthorFixture'
const cid = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'
const id = author + '/stable-tsid'
const email = 'owner@example.test'
const sent = mock(async (..._args: unknown[]) => ({messageId: 'observed'}))
const comment = new Comment({
  id,
  version: cid,
  targetAccount: owner,
  targetPath: 'post',
  targetVersion: 'v1',
  author,
  createTime: new Timestamp({seconds: BigInt(Math.floor(Date.now() / 1000))}),
  updateTime: new Timestamp({seconds: BigInt(Math.floor(Date.now() / 1000))}),
  content: [
    new BlockNode({
      block: new Block({
        id: 'block-1',
        type: 'Paragraph',
        text: '@owner',
        annotations: [new Annotation({type: 'Embed', link: 'hm://' + owner + '/:profile', starts: [0], ends: [6]})],
      }),
    }),
  ],
})
mock.module('./mailer', () => ({sendEmail: sent}))
mock.module('./notify-request', () => ({
  grpcClient: {comments: {getComment: async () => comment}},
  requestAPI: async (kind: string, input: any) => {
    if (kind === 'Resource') return {type: 'document', document: {metadata: {name: 'Post'}, authors: [owner]}}
    if (kind === 'ResourceMetadata') return {metadata: {name: 'Post'}}
    if (kind === 'Account')
      return {type: 'account', id: {uid: input}, metadata: {name: input === author ? 'Author' : 'Owner'}}
    throw new Error('unexpected API: ' + kind)
  },
}))
const {processImmediateNotifications, processBatchNotifications} = await import('./email-notifier')

function event(data: any): Event {
  const stamp = new Timestamp({seconds: BigInt(Math.floor(Date.now() / 1000))})
  return {account: author, data, eventTime: stamp, observeTime: stamp} as Event
}
const blob = () => event({case: 'newBlob', value: {blobType: 'Comment', cid, author, resource: 'hm://' + id}})
const mention = () =>
  event({
    case: 'newMention',
    value: {
      source: 'hm://' + id,
      sourceDocument: 'hm://' + owner + '/post',
      sourceType: 'comment/Embed',
      sourceContext: 'block-1',
      target: 'hm://' + owner + '/:profile',
      sourceBlob: {author, cid},
      mentionType: '',
    },
  })
let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'seed-comment-email-priority-'))
  process.env.DATA_DIR = dir
  sent.mockClear()
  await initDatabase()
  createSubscription({id: owner, email})
  setNotificationConfig(owner, email)
  expect(markNotificationConfigVerified(owner, email)).toBe(true)
})
afterEach(() => {
  cleanup()
  rmSync(dir, {recursive: true, force: true})
})

it('blob before separate mention event/pages sends one mention email and no discussion email', async () => {
  await processImmediateNotifications([blob()])
  expect(getAllNotifications(owner).map((row) => row.reason)).toEqual(['mention'])
  expect(sent).toHaveBeenCalledTimes(1)
  expect(sent.mock.calls[0]?.[4]).toMatchObject({feedbackId: 'mention'})
  await processImmediateNotifications([mention()])
  expect(getAllNotifications(owner).map((row) => row.reason)).toEqual(['mention'])
  expect(sent).toHaveBeenCalledTimes(1)
})

it('legacy batch discussion remains eligible when account mentions are not enabled', async () => {
  expect(removeNotificationConfig(owner)).toBe(true)
  updateSubscription(owner, {notifySiteDiscussions: true})
  await processBatchNotifications([blob()])
  expect(sent).toHaveBeenCalledTimes(1)
  expect(sent.mock.calls[0]?.[4]).toMatchObject({feedbackId: 'batch'})
  expect(getAllNotifications(owner)).toHaveLength(0)
})
