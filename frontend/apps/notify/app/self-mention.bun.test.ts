import {Timestamp} from '@bufbuild/protobuf'
import type {Event} from '@shm/shared'
import {afterEach, beforeEach, expect, it, mock} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {cleanup, getAllNotifications, initDatabase, registerInboxAccount} from './db'

const owner = 'z6MkOwnerFixture'
const writer = 'z6MkWriterFixture'
const ownerSession = 'z6MkOwnerSessionFixture'
const writerSession = 'z6MkWriterSessionFixture'
const space = 'z6MkSpaceFixture'
const cid = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'
mock.module('./notify-request', () => ({
  grpcClient: {},
  requestAPI: async (kind: string, uid: string) => {
    if (kind === 'Resource') return {type: 'document', document: {metadata: {name: 'Issue'}, content: []}}
    if (kind === 'ResourceMetadata') return {metadata: {name: 'Issue'}}
    if (kind === 'Account') {
      const accountUid = uid === ownerSession ? owner : uid === writerSession ? writer : uid
      return {type: 'account', id: {uid: accountUid}, metadata: {name: accountUid}}
    }
    throw new Error(`Unexpected request: ${kind}`)
  },
}))
const {processImmediateNotifications} = await import('./email-notifier')
const originalDataDir = process.env.DATA_DIR
let dir: string
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'seed-owner-'))
  process.env.DATA_DIR = dir
  await initDatabase()
  registerInboxAccount(owner)
})
afterEach(() => {
  cleanup()
  rmSync(dir, {recursive: true, force: true})
  if (originalDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = originalDataDir
})

it.each([
  ['metadata/Link', 'Owner', owner, 0],
  ['metadata/Link', 'Owner', writer, 1],
  ['metadata/Link', 'Owner', ownerSession, 0],
  ['metadata/Link', 'Owner', writerSession, 1],
  ['metadata/Link', 'Reviewer', owner, 0],
  ['metadata/Link', 'Reviewer', writer, 1],
  ['metadata/Link', 'Assignee', owner, 0],
  ['metadata/Link', 'Assignee', writer, 1],
  ['doc/Embed', 'block-1', owner, 0],
  ['doc/Embed', 'block-1', writer, 1],
  ['doc/Embed', 'block-1', ownerSession, 0],
  ['doc/Embed', 'block-1', writerSession, 1],
] as const)('routes %s at %s by %s (%i inbox rows)', async (sourceType, sourceContext, author, count) => {
  const stamp = new Timestamp({seconds: BigInt(Math.floor(Date.now() / 1000))})
  const value = {
    source: `hm://${space}/tasks/example`,
    sourceType,
    sourceContext,
    target: `hm://${owner}`,
    sourceBlob: {author, cid, createTime: stamp},
  }
  await processImmediateNotifications([
    {account: space, data: {case: 'newMention', value}, eventTime: stamp, observeTime: stamp} as Event,
  ])
  const rows = getAllNotifications(owner)
  expect(rows).toHaveLength(count)
  if (count) expect(rows[0]).toMatchObject({reason: 'mention', author: {uid: author}})
})
