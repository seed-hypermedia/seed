import {Timestamp} from '@bufbuild/protobuf'
import type {Event} from '@shm/shared'
import {afterEach, beforeEach, expect, it, mock} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {cleanup, getAllNotifications, initDatabase, registerInboxAccount} from './db'

const owner = 'z6MkOwnerFixture'
const writer = 'z6MkWriterFixture'
const space = 'z6MkSpaceFixture'
const cid = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'
mock.module('./notify-request', () => ({
  grpcClient: {},
  requestAPI: async (kind: string, uid: string) => {
    if (kind === 'Resource') return {type: 'document', document: {metadata: {name: 'Issue'}, content: []}}
    if (kind === 'ResourceMetadata') return {metadata: {name: 'Issue'}}
    if (kind === 'Account') return {type: 'account', id: {uid}, metadata: {name: uid}}
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
  ['Owner', owner, 0],
  ['Owner', writer, 1],
  ['Reviewer', owner, 1],
] as const)('routes %s metadata set by %s (%i inbox rows)', async (sourceContext, author, count) => {
  const stamp = new Timestamp({seconds: BigInt(Math.floor(Date.now() / 1000))})
  const value = {
    source: `hm://${space}/tasks/example`,
    sourceType: 'metadata/Link',
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
