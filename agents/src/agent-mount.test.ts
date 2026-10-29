import {Database} from 'bun:sqlite'
import {describe, expect, test} from 'bun:test'
import {createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import {serialize} from 'superjson'
import * as sqlite from './sqlite'
import * as mount from './agent-mount'
import * as api from '@seed-hypermedia/agents-protocol'

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
      await mount.mountAgent(db, client, 'owner', action)
      expect(mount.resolveAgentId(db, 'legacy')).toBe(documentId)
      expect(db.query('PRAGMA foreign_key_check').all()).toEqual([])
      await expect(
        mount.mountAgent(db, client, 'owner', {...action, agentId: documentId, documentId: 'hm://shared/team/other'}),
      ).rejects.toThrow('already mounted')
    } finally {
      hm.stop(true)
      sqlite.closeDatabase(db)
    }
  })
})
