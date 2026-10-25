import {describe, expect, test} from 'bun:test'
import * as hm from '@seed-hypermedia/client'
import * as cbor from '@seed-hypermedia/client/cbor'
import {CID} from 'multiformats/cid'
import {base58btc} from 'multiformats/bases/base58'
import {HMPrepareDocumentChangeInputSchema} from '@seed-hypermedia/client/hm-types'
import {HM_SCHEMAS} from '@seed-hypermedia/client/schema-registry.generated'
import * as schema from '@seed-hypermedia/client/schema-engine'
import {createDocumentPageAccess, documentPageContent} from '@shm/shared/document-page-content'
import {writeGuideRegistry} from '../protocol/src/write-guides'

// The documented code runs through the real bridge and signing SDK. Only the
// daemon is replaced with an in-memory document service; this does not test sync.
describe('Seed-backed page authoring recipe', () => {
  test('creates typed records, preserves edit history, reloads from resources and propagates denied saves', async () => {
    const guide = writeGuideRegistry.pages.markdown
    const taskSchema = JSON.parse(guide.match(/```json\n([\s\S]*?)\n```/)![1]!)
    expect(schema.validate(HM_SCHEMAS.schema!, taskSchema)).toEqual([])
    const code = guide.match(/```js\n([\s\S]*?)\n```/)![1]!
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
    const createTaskData = await new AsyncFunction(`${code}; return createTaskData`)()
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const principal = new Uint8Array([0xed, 1, ...new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))])
    const account = base58btc.encode(principal)
    const dataRoot = `hm://${account}/tasks`
    const taskType = `hm://${account}/types/task`
    const records = new Map<string, any>([
      [
        dataRoot,
        {
          type: 'document',
          id: hm.unpackHmId(dataRoot),
          document: {path: '/tasks', visibility: 'PRIVATE', metadata: {name: 'Tasks', childAttributesSchema: taskType}},
        },
      ],
    ])
    const prepared: any[] = []
    let denyWrites = false
    const client: any = {
      getSigner: () => ({
        getPublicKey: async () => principal,
        sign: async (data: Uint8Array) =>
          new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, new Uint8Array(data))),
      }),
      request: async (key: string, input: any) => {
        if (key === 'Resource') return structuredClone(records.get(input.id) || {type: 'not-found', id: input})
        if (key === 'Query')
          return {
            results: [...records.values()]
              .filter((value) => value.document.path.startsWith('/tasks/'))
              .map((value) => ({...value, metadata: value.document.metadata})),
          }
        if (key !== 'PrepareDocumentChange') throw new Error(`Unexpected API: ${key}`)
        const change = HMPrepareDocumentChangeInputSchema.parse(input)
        prepared.push(change)
        const current = records.get(`hm://${account}${change.path}`)?.document
        if (current) expect(change.baseVersion).toBe(current.version)
        const {unsignedBytes} = hm.createChangeOps({
          ops: change.changes.map(({op}) => {
            if (op.case !== 'setMetadata') throw new Error('This recipe uses metadata changes')
            return {type: 'SetAttributes', attrs: [{key: [op.value.key], value: op.value.value}]}
          }),
          ...(current ? {genesisCid: CID.parse(current.genesis), deps: [CID.parse(current.version)], depth: 1} : {}),
        })
        return {unsignedChange: unsignedBytes}
      },
      publish: async (input: any) => {
        const decoded = input.blobs.map((blob: any) => cbor.decode(blob.data))
        for (const body of decoded)
          expect(
            await crypto.subtle.verify(
              'Ed25519',
              keys.publicKey,
              body.sig,
              new Uint8Array(cbor.encode({...body, sig: new Uint8Array(64)})),
            ),
          ).toBe(true)
        const change = decoded.find((body: any) => body.type === 'Change')
        const ref = decoded.find((body: any) => body.type === 'Ref')
        expect(base58btc.encode(ref.space || principal)).toBe(account)
        const url = `hm://${account}${ref.path}`
        const metadata = {...records.get(url)?.document.metadata}
        for (const op of change.body.ops) for (const attr of op.attrs) metadata[attr.key[0]] = attr.value
        expect(schema.validate(taskSchema, metadata)).toEqual([])
        records.set(url, {
          type: 'document',
          id: hm.unpackHmId(url),
          document: {
            account,
            path: ref.path,
            metadata,
            version: ref.heads.map(String).join('.'),
            genesis: String(ref.genesisBlob),
            generationInfo: {generation: BigInt(ref.generation)},
            visibility: ref.visibility === 'Private' ? 'PRIVATE' : 'PUBLIC',
          },
        })
        return {cids: input.blobs.map((blob: any) => blob.cid)}
      },
    }
    const seed = () => {
      const access = createDocumentPageAccess(async (request) =>
        denyWrites && request.kind !== 'read' ? 'deny' : 'once',
      )
      const call = (method: string, params: unknown) =>
        documentPageContent({
          method,
          params,
          client,
          access,
          context: {protocol: 1, account, document: `hm://${account}/pages/tasks`, version: null, page: 'test-bundle'},
          visibility: 'PRIVATE',
          signal: new AbortController().signal,
        })
      return {
        resource: (url: string) => call('resource', {url}),
        directory: (url: string) => call('directory', {url}),
        publishDocument: (input: unknown) => call('publishDocument', {input}),
      }
    }
    const page = await createTaskData(seed(), {dataRoot, taskType})
    const created = await page.create('Plan the garden')
    expect(created.document.metadata).toEqual({name: 'Plan the garden', status: 'todo', attributesSchema: taskType})
    expect(created.document.visibility).toBe('PRIVATE')
    expect((await page.list()).map((row: any) => row.metadata.name)).toEqual(['Plan the garden'])
    const changed = await page.setStatus(created.id.id, 'done')
    expect(changed.document.genesis).toBe(created.document.genesis)
    expect(changed.document.generationInfo).toEqual(created.document.generationInfo)
    expect(changed.document.version).not.toBe(created.document.version)
    expect(changed.document.metadata.name).toBe('Plan the garden')
    expect(prepared.at(-1)).toMatchObject({baseVersion: created.document.version, visibility: 2})
    const reopened = await createTaskData(seed(), {dataRoot, taskType})
    expect((await reopened.list())[0].metadata.status).toBe('done')
    await reopened.setStatus(created.id.id, 'archived')
    expect((await reopened.list())[0].metadata.status).toBe('archived')
    denyWrites = true
    await expect(reopened.create('Must not be saved locally')).rejects.toThrow('denied')
    expect(await reopened.list()).toHaveLength(1)
    await expect(reopened.setStatus(created.id.id, 'not-a-status')).rejects.toThrow('Invalid task status')
  })
})
