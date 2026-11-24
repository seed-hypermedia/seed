import {Database} from 'bun:sqlite'
import {describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import * as apisvc from '@/api-service'
import * as cbor from '@/cbor'
import * as hostConfig from '@/host-config'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import {unpackHmId} from '@seed-hypermedia/client'

const SERVER = 'http://this-server.test/hm/api/apps'

function createTestState() {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-host-config-test-'))
  return {db, dataDir, cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true})}
}

describe('host config', () => {
  test('a change replaces the fields it names, a null removes one, the rest keep their values', () => {
    expect(hostConfig.mergePrivateConfig({a: 1, b: 2}, {b: 3, c: 4})).toEqual({a: 1, b: 3, c: 4})
    expect(hostConfig.mergePrivateConfig({a: 1, b: 2}, {a: null, d: undefined})).toEqual({b: 2})
  })

  test('a signing-key field takes only a key the signer holds on this server; any writer may detach it', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const owner = blobs.generateNobleKeyPair()
    const writer = blobs.generateNobleKeyPair()
    const space = blobs.principalToString(owner.principal)
    const writerUid = blobs.principalToString(writer.principal)
    const agentUrl = `hm://${space}/helper-agent`
    const schemaCid = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const ownerKey = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const writerKey = blobs.principalToString(blobs.generateNobleKeyPair().principal)
    const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test', runQueue: {maxConcurrentModelRuns: 0}})
    // Each account holds one key among its server accounts.
    const now = Date.now()
    for (const [account, key] of [
      [space, ownerKey],
      [writerUid, writerKey],
    ] as const) {
      db.query('INSERT OR IGNORE INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)').run(account, now, now)
      db.query(
        'INSERT INTO secrets (id, account_id, name, ciphertext, metadata_cbor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        crypto.randomUUID(),
        account,
        `hm-account-${key.slice(0, 16)}`,
        new Uint8Array([0]),
        cbor.encode({kind: 'hm-account-key', accountId: key}),
        now,
        now,
      )
    }
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.startsWith('http://this-server.test/hm/api/apps/health')) return Response.json({serverId: svc.serverId})
      // The writer may write the space; nobody else holds a capability.
      if (href.includes('/api/ListCapabilities'))
        return Response.json(
          serialize({
            capabilities: [{id: 'cap', issuer: space, delegate: writerUid, account: space, path: '', role: 'WRITER'}],
          }),
        )
      if (href.includes('/api/GetCID'))
        return Response.json(
          serialize({
            value: {
              type: 'hm://hyper.media/struct',
              properties: {
                publisher: {value: {type: 'hm://hyper.media/signing-key'}},
                apiKey: {value: {type: 'hm://hyper.media/string'}},
              },
            },
          }),
        )
      if (href.includes('/api/Resource'))
        return Response.json(
          serialize({
            type: 'document',
            id: unpackHmId(agentUrl),
            document: {
              content: [],
              metadata: {
                name: 'Helper',
                type: 'hm://hyper.media/agent',
                agentServerUrl: SERVER,
                privateConfigSchema: `ipfs://${schemaCid}`,
              },
              version: schemaCid,
              genesis: schemaCid,
              account: space,
              authors: [space],
              path: '',
              createTime: '',
              updateTime: '',
              visibility: 'PUBLIC',
            },
          }),
        )
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const send = async (key: blobs.NobleKeyPair, action: Record<string, unknown>) => {
      try {
        return (await svc.message(await apisvc.createSignedEnvelope(key, {action: action as never}))) as any
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)}
      }
    }
    const set = (key: blobs.NobleKeyPair, privateConfig: Record<string, unknown>) =>
      send(key, {_: 'SetHostPrivateConfig', hostId: agentUrl, privateConfig})
    try {
      // Not a key the owner holds here (the writer's, or one nobody holds): refused.
      expect(await set(owner, {publisher: writerKey})).toMatchObject({
        error: expect.stringContaining('signing key your account holds on this server'),
      })
      const stray = blobs.principalToString(blobs.generateNobleKeyPair().principal)
      expect(await set(owner, {publisher: stray})).toMatchObject({
        error: expect.stringContaining('holds on this server'),
      })
      // The owner's own key: attached, and named in the config (the key itself never is).
      expect(await set(owner, {publisher: ownerKey, apiKey: 'secret'})).toMatchObject({
        config: {privateConfigKeys: ['apiKey', 'publisher'], signingKeys: {publisher: ownerKey}},
      })
      expect(await send(writer, {_: 'GetHostConfig', hostId: agentUrl})).toMatchObject({
        config: {signingKeys: {publisher: ownerKey}},
      })
      // A writer changing other fields keeps the owner's key attached; it cannot swap in a key it
      // does not hold, but may attach its own, and may detach.
      expect(await set(writer, {apiKey: 'rotated'})).toMatchObject({config: {signingKeys: {publisher: ownerKey}}})
      expect(await set(writer, {publisher: ownerKey})).toMatchObject({config: {signingKeys: {publisher: ownerKey}}})
      expect(await set(writer, {publisher: writerKey})).toMatchObject({config: {signingKeys: {publisher: writerKey}}})
      const detached = await set(writer, {publisher: null})
      expect(detached.config.privateConfigKeys).toEqual(['apiKey'])
      expect(detached.config.signingKeys).toBeUndefined()
      // Someone who cannot write the space changes nothing.
      expect(await set(blobs.generateNobleKeyPair(), {apiKey: null})).toMatchObject({
        error: expect.stringContaining('write to the app’s space'),
      })
    } finally {
      globalThis.fetch = originalFetch
      cleanup()
    }
  })

  test('an agent’s signing keys are its built-in signing field: the owner picks them from the keys it holds', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const owner = blobs.generateNobleKeyPair()
    const writer = blobs.generateNobleKeyPair()
    const space = blobs.principalToString(owner.principal)
    const writerUid = blobs.principalToString(writer.principal)
    const agentUrl = `hm://${space}/maple`
    const version = 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test', runQueue: {maxConcurrentModelRuns: 0}})
    const now = Date.now()
    db.query('INSERT OR IGNORE INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)').run(space, now, now)
    const keys = ['Maple', 'Newsletter'].map((label) => {
      const account = blobs.principalToString(blobs.generateNobleKeyPair().principal)
      const name = `hm-account-${account.slice(0, 16)}`
      db.query(
        'INSERT INTO secrets (id, account_id, name, ciphertext, metadata_cbor, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        crypto.randomUUID(),
        space,
        name,
        new Uint8Array([0]),
        cbor.encode({kind: 'hm-account-key', accountId: account, label}),
        now,
        now,
      )
      return {account, name, label}
    })
    const [maple, newsletter] = keys as [(typeof keys)[0], (typeof keys)[0]]
    db.query(
      `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      agentUrl,
      space,
      cbor.encode({name: 'Maple', systemPrompt: [{block: {id: 'p1', type: 'Paragraph', text: 'Hi', annotations: [], attributes: {}}, children: []}], modelProvider: 'p', model: 'm', signingKeys: [maple.name], signingKey: maple.name}),
      dataDir,
      'ready',
      now,
      now,
    )
    const definition = () =>
      cbor.decode<Record<string, unknown>>(
        (db.query('SELECT definition_cbor AS d FROM agents WHERE id = ?').get(agentUrl) as {d: Uint8Array}).d,
      )
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      const href = decodeURIComponent(url instanceof Request ? url.url : String(url))
      if (href.startsWith('http://this-server.test/hm/api/apps/health')) return Response.json({serverId: svc.serverId})
      if (href.includes('/api/ListCapabilities'))
        return Response.json(
          serialize({
            capabilities: [{id: 'c', issuer: space, delegate: writerUid, account: space, path: '', role: 'WRITER'}],
          }),
        )
      if (href.includes('/api/Resource'))
        return Response.json(
          serialize({
            type: 'document',
            id: unpackHmId(agentUrl),
            document: {
              content: [],
              metadata: {name: 'Maple', type: 'hm://hyper.media/agent', agentServerUrl: SERVER},
              version,
              genesis: version,
              account: space,
              authors: [space],
              path: '',
              createTime: '',
              updateTime: '',
              visibility: 'PUBLIC',
            },
          }),
        )
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const send = async (key: blobs.NobleKeyPair, action: Record<string, unknown>) => {
      try {
        return (await svc.message(await apisvc.createSignedEnvelope(key, {action: action as never}))) as any
      } catch (error) {
        return {error: error instanceof Error ? error.message : String(error)}
      }
    }
    const setSigning = (key: blobs.NobleKeyPair, signing: unknown) =>
      send(key, {_: 'SetHostPrivateConfig', hostId: agentUrl, privateConfig: {signing}})
    try {
      // What the agent publishes as is part of its private config.
      expect(await send(writer, {_: 'GetHostConfig', hostId: agentUrl})).toMatchObject({
        config: {
          privateConfigKeys: ['signing'],
          agentSigning: {keys: [{account: maple.account, label: 'Maple'}], primary: maple.account},
        },
      })
      // A writer of the agent cannot change it: the keys are the owner's.
      expect(await setSigning(writer, {keys: {[newsletter.account]: true}})).toMatchObject({
        error: expect.stringContaining("Only the agent's owner"),
      })
      // Not a key the owner holds: refused.
      const stray = blobs.principalToString(blobs.generateNobleKeyPair().principal)
      expect(await setSigning(owner, {keys: {[stray]: true}})).toMatchObject({
        error: expect.stringContaining('holds on this server'),
      })
      // Both keys, newsletter first: the definition follows (the primary leads).
      expect(
        await setSigning(owner, {
          keys: {[maple.account]: true, [newsletter.account]: true},
          primary: newsletter.account,
        }),
      ).toMatchObject({config: {agentSigning: {primary: newsletter.account}}})
      expect(definition()).toMatchObject({signingKeys: [newsletter.name, maple.name], signingKey: newsletter.name})
      // None: the agent publishes as no one.
      const cleared = await setSigning(owner, null)
      expect(cleared.config.agentSigning).toBeUndefined()
      expect(definition().signingKeys).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
      cleanup()
    }
  })
})
