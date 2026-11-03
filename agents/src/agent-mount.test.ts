import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import {serialize} from 'superjson'
import * as sqlite from './sqlite'
import * as mount from './agent-mount'
import * as api from '@seed-hypermedia/agents-protocol'
import * as cbor from '@/cbor'

describe('mount server addresses', () => {
  test.each(['file:///agents', 'https://user:password@agents.example', 'not a URL'])(
    'rejects invalid address %s',
    (url) => {
      expect(api.isMountableAgentServerUrl(url)).toBe(false)
    },
  )
  test.each([
    'http://localhost:3051',
    'https://LOCALHOST.:3051',
    'http://agent.localhost',
    'http://127.0.0.1:3051',
    'http://127.5.4.3',
    'http://2130706433',
    'http://0x7f000001',
    'http://0.0.0.0',
    'http://10.0.0.2',
    'http://172.16.0.2',
    'http://172.31.255.254',
    'http://192.168.1.2',
    'http://169.254.1.2',
    'http://100.64.0.1',
    'http://[::1]:3051',
    'http://[::]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:192.168.1.1]',
    'http://[fd12::1]',
    'http://[fe80::1]',
    'http://yacht.local',
    'http://agents.internal',
    'http://yacht.home.arpa',
    'http://agents',
    'https://agents.example',
    'https://site.example/hm/api/agents',
    'http://8.8.8.8:3050',
    'http://172.32.0.1',
    'http://100.128.0.1',
    'https://[2606:4700:4700::1111]',
    'https://[::ffff:8.8.8.8]',
  ])('allows a local or hosted server address %s', (url) => {
    expect(api.isMountableAgentServerUrl(url)).toBe(true)
  })
})

function storedName(db: Database, agentId: string): string | undefined {
  const row = db.query('SELECT definition_cbor FROM agents WHERE id = ?').get(agentId) as {definition_cbor: Uint8Array}
  return cbor.decode<api.AgentDefinition>(row.definition_cbor).name
}

describe('mounted agent names', () => {
  test('follow the document name attribute, skipping unreadable or unnamed documents', async () => {
    const db = new Database(':memory:', {strict: true})
    sqlite.openWithDatabase(db)
    db.run("INSERT INTO accounts (id, created_at, updated_at) VALUES ('owner', 1, 1)")
    const definition = (name: string) => cbor.encode({name, systemPrompt: '', modelProvider: 'p', model: 'm'})
    const insert = db.prepare(
      "INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, 'owner', ?, ?, 'idle', 1, 1)",
    )
    insert.run('hm://owner/renamed', definition('Old name'), '/a')
    insert.run('hm://owner/same', definition('Same'), '/b')
    insert.run('hm://owner/unnamed', definition('Kept'), '/c')
    insert.run('hm://owner/missing', definition('Also kept'), '/d')
    insert.run('orphan', definition('Orphan'), '/e')
    const names: Record<string, string | undefined> = {renamed: 'New name', same: 'Same', unnamed: ''}
    let requests = 0
    const hm = Bun.serve({
      port: 0,
      fetch: (request) => {
        requests += 1
        const key = (new URL(request.url).searchParams.get('id') ?? '').split('/').pop() ?? ''
        if (key === 'missing') return new Response('gone', {status: 500})
        return Response.json(
          serialize({
            type: 'document',
            id: unpackHmId(`hm://owner/${key}`),
            document: {
              authors: ['owner'],
              genesis: 'genesis',
              visibility: 'PUBLIC',
              metadata: {type: 'hm://hyper.media/agent', agentServerUrl: 'http://localhost:3051', name: names[key]},
            },
          }),
        )
      },
    })
    try {
      const client = createSeedClient(hm.url.origin)
      const synced = await mount.syncMountedAgentNames(db, client)
      expect(synced).toEqual([{agentId: 'hm://owner/renamed', accountId: 'owner', name: 'New name'}])
      expect(storedName(db, 'hm://owner/renamed')).toBe('New name')
      expect(storedName(db, 'hm://owner/same')).toBe('Same')
      expect(storedName(db, 'hm://owner/unnamed')).toBe('Kept')
      expect(storedName(db, 'hm://owner/missing')).toBe('Also kept')
      expect(storedName(db, 'orphan')).toBe('Orphan')
      // Only mounted agents are looked up; the orphan never reaches the server.
      expect(requests).toBe(4)
      // A second pass finds nothing to change.
      expect(await mount.syncMountedAgentNames(db, client)).toEqual([])
      // A targeted pass only reads the agents it was given.
      requests = 0
      names.same = 'Changed'
      expect(await mount.syncMountedAgentNames(db, client, {agentIds: ['hm://owner/same', 'orphan']})).toEqual([
        {agentId: 'hm://owner/same', accountId: 'owner', name: 'Changed'},
      ])
      expect(requests).toBe(1)
    } finally {
      hm.stop(true)
      sqlite.closeDatabase(db)
    }
  })
})

describe('mount document authorization', () => {
  test('requires a mount document and a covering write grant in another space', async () => {
    const db = new Database(':memory:', {strict: true})
    sqlite.openWithDatabase(db)
    db.run("INSERT INTO accounts (id, created_at, updated_at) VALUES ('owner', 1, 1)")
    db.run(
      "INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES ('legacy', 'owner', X'A0', '/original', 'idle', 1, 1)",
    )
    let metadata: Record<string, unknown> = {}
    let capabilities: Record<string, unknown>[] = []
    let content: unknown[] = []
    const documentId = 'hm://shared/team/helper'
    const hm = Bun.serve({
      port: 0,
      fetch: (request) =>
        Response.json(
          serialize(
            new URL(request.url).pathname.endsWith('/ListCapabilities')
              ? {capabilities}
              : {
                  type: 'document',
                  id: unpackHmId(documentId),
                  document: {authors: ['owner'], genesis: 'genesis', visibility: 'PUBLIC', metadata, content},
                },
          ),
        ),
    })
    const client = createSeedClient(hm.url.origin)
    const action = {_: 'MountAgent' as const, agentId: 'legacy', documentId}
    try {
      for (const invalid of ['hm://shared', `${documentId}/:settings`, `${documentId}?v=old`, `${documentId}#block`]) {
        await expect(mount.mountAgent(db, client, 'owner', {...action, documentId: invalid})).rejects.toThrow(
          'document path',
        )
      }
      await expect(mount.mountAgent(db, client, 'owner', action)).rejects.toThrow('mount document')
      for (const type of [undefined, 'hm://hyper.media/page']) {
        metadata = {type, agentServerUrl: 'http://localhost:3051'}
        await expect(mount.mountAgent(db, client, 'owner', action)).rejects.toThrow('mount document')
      }
      metadata = {type: 'hm://hyper.media/agent', agentServerUrl: 'http://localhost:3051'}
      content = [{block: {id: 'body', type: 'Paragraph', text: 'Not the agent home', attributes: {}}}]
      await expect(mount.mountAgent(db, client, 'owner', action)).rejects.toThrow('must have no content')
      content = []
      for (const grant of [
        {delegate: 'stranger', path: '/team', role: 'WRITER'},
        {delegate: 'owner', path: '/team', role: 'READER'},
        {delegate: 'owner', path: '/tea', role: 'WRITER'},
        {delegate: 'owner', path: '/team', role: 'WRITER', isExact: true},
      ]) {
        capabilities = [grant]
        await expect(mount.mountAgent(db, client, 'owner', action)).rejects.toThrow('write access')
        expect(db.query('SELECT id FROM agents').get()).toEqual({id: 'legacy'})
      }
      capabilities = [{delegate: 'owner', path: '/team', role: 'WRITER'}]
      await expect(
        mount.mountAgent(db, client, 'owner', action, () => {
          throw new Error('Upload started')
        }),
      ).rejects.toThrow('Upload started')
      // A trigger watching this agent's runs names it inside its source; that follows the id too.
      db.query(
        `INSERT INTO agent_triggers (id, account_id, agent_id, name, enabled, source_cbor, prompt, created_at, updated_at)
         VALUES ('watch', 'owner', 'legacy', 'Watch', 1, ?, '', 1, 1)`,
      ).run(cbor.encode({type: 'run-completed', agentId: 'legacy', status: 'succeeded'}))
      const watchedAgent = () =>
        cbor.decode<api.AgentTriggerSource & {agentId?: string}>(
          (db.query('SELECT source_cbor FROM agent_triggers WHERE id = ?').get('watch') as {source_cbor: Uint8Array})
            .source_cbor,
        ).agentId
      metadata = {...metadata, name: '  Team helper '}
      await mount.mountAgent(db, client, 'owner', action)
      expect(mount.resolveAgentId(db, 'legacy')).toBe(documentId)
      expect(watchedAgent()).toBe(documentId)
      // The document's name attribute names the agent from the mount on.
      expect(storedName(db, documentId)).toBe('Team helper')
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
      await expect(
        mount.mountAgent(db, client, 'owner', {...action, agentId: documentId, documentId: 'hm://shared/team/other'}),
      ).rejects.toThrow('already mounted')

      // Orphaning reverses the mount: the pre-mount id comes back as the agent's own, every
      // reference follows, and the document id resolves to nothing.
      const unmount = {_: 'UnmountAgent' as const, agentId: documentId}
      expect(() => mount.unmountAgent(db, 'stranger', unmount)).toThrow('owner')
      expect(() =>
        mount.unmountAgent(db, 'owner', unmount, () => {
          throw new Error('Upload started')
        }),
      ).toThrow('Upload started')
      expect(mount.unmountAgent(db, 'owner', unmount)).toBe('legacy')
      expect(db.query('SELECT id FROM agents').get()).toEqual({id: 'legacy'})
      expect(watchedAgent()).toBe('legacy')
      expect(mount.resolveAgentId(db, 'legacy')).toBe('legacy')
      expect(mount.resolveAgentId(db, documentId)).toBe(documentId)
      expect(db.query('SELECT COUNT(*) AS n FROM agent_id_aliases').get()).toEqual({n: 0})
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
      expect(() => mount.unmountAgent(db, 'owner', {...unmount, agentId: 'legacy'})).toThrow('not adopted')
      // Mounting again works, and orphaning an agent created mounted (no prior id) mints one.
      await mount.mountAgent(db, client, 'owner', action)
      expect(mount.resolveAgentId(db, 'legacy')).toBe(documentId)
      db.query('DELETE FROM agent_id_aliases').run()
      const minted = mount.unmountAgent(db, 'owner', unmount)
      expect(minted).not.toBe(documentId)
      expect(minted.startsWith('hm://')).toBe(false)
      expect(db.query('SELECT id FROM agents').get()).toEqual({id: minted})
    } finally {
      hm.stop(true)
      sqlite.closeDatabase(db)
    }
  })
})
