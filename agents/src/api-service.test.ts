import {Database} from 'bun:sqlite'
import {describe, expect, mock, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as cbor from '@/cbor'
import * as sqlite from '@/sqlite'
import * as blobs from '@shm/shared/blobs'
import {unpackHmId} from '@seed-hypermedia/client'
import {serialize} from 'superjson'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('api service', () => {
  test('creates and lists agents for the signed account', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: ' Test Agent ',
              systemPrompt: ' You are helpful. ',
              modelProvider: ' openai ',
              model: ' gpt-4.1 ',
              metadata: {purpose: 'test'},
            },
          },
        }),
      )

      expect(create._).toBe('CreateAgentResponse')
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      expect(fs.existsSync(path.join(dataDir, 'agents', create.agentId))).toBe(true)

      const list = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}}))
      expect(list._).toBe('ListAgentsResponse')
      if (list._ !== 'ListAgentsResponse') throw new Error('unexpected response')
      expect(list.agents).toHaveLength(1)
      expect(list.agents[0]?.definition).toMatchObject({
        name: 'Test Agent',
        modelProvider: 'openai',
        model: 'gpt-4.1',
      })
      expect(agentPromptText(list.agents[0]?.definition.systemPrompt)).toBe('You are helpful.')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('rejects invalid definitions before writing', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'CreateAgent',
              definition: {name: ' ', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'} as never,
            },
          }),
        ),
      ).rejects.toThrow('Agent name is required')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('rejects oversized tools before writing', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'CreateAgent',
              definition: {
                name: 'Tool Agent',
                systemPrompt: 'ok',
                modelProvider: 'openai',
                model: 'gpt',
                tools: ['x'.repeat(129)],
              },
            },
          }),
        ),
      ).rejects.toThrow('Tool name is too large')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('lists remote models for a configured provider', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.openai.com/v1/models')
        expect(init?.headers).toMatchObject({Authorization: 'Bearer sk-test'})
        return Response.json({data: [{id: 'gpt-4.1'}, {id: 'gpt-4o-mini'}]})
      }) as unknown as typeof fetch

      const models = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListProviderModels', provider: ' openai '}}),
      )

      expect(models._).toBe('ListProviderModelsResponse')
      if (models._ !== 'ListProviderModelsResponse') throw new Error('unexpected response')
      expect(models.models).toEqual([
        {id: 'gpt-4.1', name: 'gpt-4.1'},
        {id: 'gpt-4o-mini', name: 'gpt-4o-mini'},
      ])
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('sets provider and secret with redacted responses and encrypted secret storage', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)

      const provider = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: ' OpenAI ',
            provider: {type: ' openai ', secretRefs: {apiKey: 'openai-key'}, modelDefaults: {temperature: 0}},
          },
        }),
      )
      expect(provider._).toBe('SetModelProviderResponse')
      if (provider._ !== 'SetModelProviderResponse') throw new Error('unexpected response')
      expect(provider.provider).toMatchObject({name: 'OpenAI', type: 'openai', hasSecrets: true})
      expect(JSON.stringify(provider)).not.toContain('openai-key')

      const secretValue = new TextEncoder().encode('super-secret')
      const secret = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: ' openai-key ', value: secretValue, metadata: {kind: 'api-key'}},
        }),
      )
      expect(secret._).toBe('SetSecretResponse')
      if (secret._ !== 'SetSecretResponse') throw new Error('unexpected response')
      expect(secret.secret).toMatchObject({name: 'openai-key', hasValue: true, metadata: {kind: 'api-key'}})
      expect(JSON.stringify(secret)).not.toContain('super-secret')

      const row = db.query<{ciphertext: Uint8Array}, []>(`SELECT ciphertext FROM secrets LIMIT 1`).get()
      expect(row?.ciphertext).toBeInstanceOf(Uint8Array)
      expect(new TextDecoder().decode(row?.ciphertext ?? new Uint8Array())).not.toContain('super-secret')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('creates a server-side signing identity, publishes its profile and home document, and redacts the generated seed', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const publishedBodies: Uint8Array[] = []
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        publishedBodies.push(new Uint8Array(init?.body as ArrayBuffer))
        return Response.json(serialize({cids: ['profile-cid']}))
      }) as never
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test'})

      const created = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'CreateSigningIdentity', label: 'Agent publisher', clientRequestId: 'create-key-1'},
        }),
      )
      expect(created._).toBe('CreateSigningIdentityResponse')
      if (created._ !== 'CreateSigningIdentityResponse') throw new Error('unexpected response')
      expect(created.identity).toMatchObject({label: 'Agent publisher', serverUrl: 'https://hm.test'})
      expect(created.identity.accountId).toMatch(/^z/)
      expect(publishedBodies).toHaveLength(1)
      expect(cbor.decode<{blobs: unknown[]}>(publishedBodies[0]!).blobs.length).toBeGreaterThan(1)
      expect(new TextDecoder().decode(publishedBodies[0])).toContain('This is an agentic account.')

      const replayed = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'CreateSigningIdentity', label: 'Agent publisher', clientRequestId: 'create-key-1'},
        }),
      )
      expect(replayed).toEqual(created)

      const list = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListSigningIdentities'}}))
      expect(list._).toBe('ListSigningIdentitiesResponse')
      if (list._ !== 'ListSigningIdentitiesResponse') throw new Error('unexpected response')
      expect(list.identities).toEqual([created.identity])
      expect(JSON.stringify(list)).not.toContain('seed')

      const updated = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'UpdateSigningIdentity', name: created.identity.name, label: 'Renamed publisher'},
        }),
      )
      expect(updated._).toBe('UpdateSigningIdentityResponse')
      if (updated._ !== 'UpdateSigningIdentityResponse') throw new Error('unexpected response')
      expect(updated.identity).toMatchObject({name: created.identity.name, label: 'Renamed publisher'})
      expect(publishedBodies).toHaveLength(2)

      const row = db.query<{ciphertext: Uint8Array}, []>(`SELECT ciphertext FROM secrets LIMIT 1`).get()
      expect(row?.ciphertext.byteLength).toBeGreaterThan(32)

      const deleted = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteSigningIdentity', name: created.identity.name}}),
      )
      expect(deleted).toEqual({_: 'DeleteSigningIdentityResponse', name: created.identity.name})
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('lists only uploaded signing identities for the signed account', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const otherAccount = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetSecret',
            name: 'site-key',
            value: new TextEncoder().encode('mnemonic words'),
            metadata: {kind: 'hm-account-key', accountId: 'hm-account', label: 'Main site', dev: false},
          },
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetSecret',
            name: 'api-key',
            value: new TextEncoder().encode('sk-test'),
            metadata: {kind: 'api-key'},
          },
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(otherAccount, {
          action: {
            _: 'SetSecret',
            name: 'other-site-key',
            value: new TextEncoder().encode('other mnemonic'),
            metadata: {kind: 'hm-account-key', accountId: 'other-account'},
          },
        }),
      )

      const list = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListSigningIdentities'}}))
      expect(list._).toBe('ListSigningIdentitiesResponse')
      if (list._ !== 'ListSigningIdentitiesResponse') throw new Error('unexpected response')
      expect(list.identities).toHaveLength(1)
      expect(list.identities[0]).toMatchObject({name: 'site-key', accountId: 'hm-account', label: 'Main site'})
      expect(JSON.stringify(list)).not.toContain('mnemonic words')
      expect(JSON.stringify(list)).not.toContain('other-site-key')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('deletes an agent and its dependent server data', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const agentDir = path.join(dataDir, 'agents', createdAgent.agentId)
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const createdTrigger = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgentTrigger',
            agentId: createdAgent.agentId,
            trigger: {name: 'Trigger', source: {type: 'site-update', resourcePrefix: 'hm://site'}, prompt: 'go'},
          },
        }),
      )
      if (createdTrigger._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')
      db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
        'event-1',
        createdSession.sessionId,
        1,
        cbor.encode({type: 'message', role: 'user', content: 'hi'}),
        Date.now(),
      ])
      db.run(
        `INSERT INTO trigger_firings (id, account_id, agent_id, trigger_id, activity_key, session_id, activity_cbor, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'firing-1',
          blobs.principalToString(account.principal),
          createdAgent.agentId,
          createdTrigger.trigger.id,
          'activity-1',
          createdSession.sessionId,
          cbor.encode({summary: 'activity'}),
          'completed',
          Date.now(),
        ],
      )
      db.run(
        `INSERT INTO agent_drafts (id, account_id, agent_id, title, content_format, content_cbor, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'draft-1',
          blobs.principalToString(account.principal),
          createdAgent.agentId,
          'Draft',
          'markdown',
          cbor.encode({content: 'draft'}),
          'draft',
          Date.now(),
          Date.now(),
        ],
      )

      const deleted = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteAgent', agentId: createdAgent.agentId}}),
      )

      expect(deleted).toEqual({_: 'DeleteAgentResponse', agentId: createdAgent.agentId})
      expect(fs.existsSync(agentDir)).toBe(false)
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM agents`).get()?.count).toBe(0)
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM sessions`).get()?.count).toBe(0)
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM session_events`).get()?.count).toBe(0)
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM agent_triggers`).get()?.count).toBe(0)
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM trigger_firings`).get()?.count).toBe(0)
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM agent_drafts`).get()?.count).toBe(0)
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'GetAgent', agentId: createdAgent.agentId}}),
        ),
      ).rejects.toThrow('Agent not found')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('gets an agent with sessions and gets a session with event replay filtering', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'CreateSession', agentId: createdAgent.agentId, title: ' First chat '},
        }),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const updatedSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'UpdateSession', sessionId: createdSession.sessionId, title: ' Renamed chat '},
        }),
      )
      expect(updatedSession._).toBe('UpdateSessionResponse')
      if (updatedSession._ !== 'UpdateSessionResponse') throw new Error('unexpected response')
      expect(updatedSession.session.title).toBe('Renamed chat')

      db.run(
        `INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`,
        [
          'event-1',
          createdSession.sessionId,
          1,
          cbor.encode({role: 'user', text: 'hello'}),
          100,
          'event-2',
          createdSession.sessionId,
          2,
          cbor.encode({role: 'assistant', text: 'hi'}),
          101,
        ],
      )

      const agent = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetAgent', agentId: createdAgent.agentId}}),
      )
      expect(agent._).toBe('GetAgentResponse')
      if (agent._ !== 'GetAgentResponse') throw new Error('unexpected response')
      expect(agent.sessions).toHaveLength(1)
      expect(agent.sessions[0]?.title).toBe('Renamed chat')

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetSession', sessionId: createdSession.sessionId, afterSeq: 1},
        }),
      )
      expect(session._).toBe('GetSessionResponse')
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.events).toEqual([
        {
          id: 'event-2',
          sessionId: createdSession.sessionId,
          seq: 2,
          event: {role: 'assistant', text: 'hi'},
          createdAt: 101,
        },
      ])

      const deletedSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'DeleteSession', sessionId: createdSession.sessionId},
        }),
      )
      expect(deletedSession).toEqual({
        _: 'DeleteSessionResponse',
        sessionId: createdSession.sessionId,
        agentId: createdAgent.agentId,
      })
      expect(db.query<{count: number}, []>(`SELECT count(*) AS count FROM session_events`).get()?.count).toBe(0)
      const agentAfterDelete = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetAgent', agentId: createdAgent.agentId}}),
      )
      expect(agentAfterDelete._).toBe('GetAgentResponse')
      if (agentAfterDelete._ !== 'GetAgentResponse') throw new Error('unexpected response')
      expect(agentAfterDelete.sessions).toHaveLength(0)
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
        ),
      ).rejects.toThrow('Session not found')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('resolves system prompt embeds in session prompt markdown', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test'})
      await setDefaultProvider(svc, account)
      const embeddedId = unpackHmId('hm://z6Mkdoc/embedded')
      if (!embeddedId) throw new Error('bad test id')
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: 'Agent',
              systemPrompt: [{block: {id: 'embed-1', type: 'Embed', link: 'hm://z6Mkdoc/embedded', attributes: {}}}],
              modelProvider: 'openai',
              model: 'gpt',
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const href = url instanceof Request ? url.url : String(url)
        if (href.includes('/api/Resource')) {
          return Response.json(
            serialize({
              type: 'document',
              id: embeddedId,
              document: {
                content: [
                  {
                    block: {id: 'embedded-paragraph', type: 'Paragraph', text: 'Resolved prompt body', attributes: {}},
                    children: [],
                  },
                ],
                version: 'v1',
                account: 'z6Mkdoc',
                authors: [],
                path: '/embedded',
                createTime: '',
                updateTime: '',
                metadata: {name: 'Embedded Prompt'},
                genesis: 'genesis',
                visibility: 'PUBLIC',
              },
            }),
          )
        }
        return new Response('not found', {status: 404})
      }) as unknown as typeof fetch

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      expect(session._).toBe('GetSessionResponse')
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.systemPromptMarkdown).toContain('Resolved prompt body')
      expect(session.systemPromptMarkdown).not.toContain('[Embed:')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('creates, updates, lists, gets, and deletes agent triggers', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const otherAccount = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      const createdTrigger = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgentTrigger',
            agentId: createdAgent.agentId,
            clientRequestId: 'trigger-create-1',
            trigger: {
              name: ' Comments on spec ',
              prompt: ' Please triage this comment. ',
              cooldownMs: 60000,
              source: {type: 'document-comment', resource: ' hm://z6Mkdoc/spec ', author: ' z6Mkauthor '},
            },
          },
        }),
      )
      expect(createdTrigger._).toBe('CreateAgentTriggerResponse')
      if (createdTrigger._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')
      expect(createdTrigger.trigger).toMatchObject({
        agentId: createdAgent.agentId,
        name: 'Comments on spec',
        enabled: true,
        cooldownMs: 60000,
        source: {type: 'document-comment', resource: 'hm://z6Mkdoc/spec', author: 'z6Mkauthor'},
      })
      expect(agentPromptText(createdTrigger.trigger.prompt)).toBe('Please triage this comment.')

      const repeatedCreate = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgentTrigger',
            agentId: createdAgent.agentId,
            clientRequestId: 'trigger-create-1',
            trigger: {
              name: ' Comments on spec ',
              prompt: ' Please triage this comment. ',
              cooldownMs: 60000,
              source: {type: 'document-comment', resource: ' hm://z6Mkdoc/spec ', author: ' z6Mkauthor '},
            },
          },
        }),
      )
      expect(repeatedCreate).toEqual(createdTrigger)

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTriggers', agentId: createdAgent.agentId}}),
      )
      expect(listed._).toBe('ListAgentTriggersResponse')
      if (listed._ !== 'ListAgentTriggersResponse') throw new Error('unexpected response')
      expect(listed.triggers.map((trigger) => trigger.id)).toEqual([createdTrigger.trigger.id])

      const updated = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'UpdateAgentTrigger',
            triggerId: createdTrigger.trigger.id,
            patch: {
              enabled: false,
              cooldownMs: null,
              source: {type: 'user-mention', mentionedAccount: ' z6Mkmentioned ', resourcePrefix: ' hm://z6Mksite '},
            },
          },
        }),
      )
      expect(updated._).toBe('UpdateAgentTriggerResponse')
      if (updated._ !== 'UpdateAgentTriggerResponse') throw new Error('unexpected response')
      expect(updated.trigger).toMatchObject({
        enabled: false,
        source: {type: 'user-mention', mentionedAccount: 'z6Mkmentioned', resourcePrefix: 'hm://z6Mksite'},
      })

      const updatedPrompt = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'UpdateAgentTrigger',
            triggerId: createdTrigger.trigger.id,
            patch: {
              prompt: [
                {
                  block: {
                    id: 'updated-trigger-prompt',
                    type: 'Paragraph',
                    text: 'Updated triage prompt.',
                    attributes: {},
                  },
                  children: [],
                },
              ],
            },
          },
        }),
      )
      expect(updatedPrompt._).toBe('UpdateAgentTriggerResponse')
      if (updatedPrompt._ !== 'UpdateAgentTriggerResponse') throw new Error('unexpected response')
      expect(agentPromptText(updatedPrompt.trigger.prompt)).toBe('Updated triage prompt.')

      const loaded = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetAgentTrigger', triggerId: createdTrigger.trigger.id},
        }),
      )
      expect(loaded._).toBe('GetAgentTriggerResponse')
      if (loaded._ !== 'GetAgentTriggerResponse') throw new Error('unexpected response')
      expect(agentPromptText(loaded.trigger.prompt)).toBe('Updated triage prompt.')
      expect(loaded.sessions).toEqual([])
      await expect(
        svc.processActivityEvent(blobs.principalToString(account.principal), {
          newMention: {sourceBlob: {cid: 'bafymention'}, target: 'hm://z6Mkmentioned'},
        }),
      ).resolves.toMatchObject({checked: 0, matched: 0, fired: 0, skipped: 0, errors: 0})
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(otherAccount, {
            action: {_: 'GetAgentTrigger', triggerId: createdTrigger.trigger.id},
          }),
        ),
      ).rejects.toThrow('Agent trigger not found')

      const deleted = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'DeleteAgentTrigger', triggerId: createdTrigger.trigger.id},
        }),
      )
      expect(deleted).toEqual({_: 'DeleteAgentTriggerResponse', triggerId: createdTrigger.trigger.id})
      const empty = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTriggers', agentId: createdAgent.agentId}}),
      )
      expect(empty._).toBe('ListAgentTriggersResponse')
      if (empty._ !== 'ListAgentTriggersResponse') throw new Error('unexpected response')
      expect(empty.triggers).toEqual([])
    } finally {
      db.close()
      cleanup()
    }
  })

  test('processes due schedule triggers idempotently into a session', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let openAICallCount = 0
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-api-key', value: new TextEncoder().encode('test-key')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-api-key'}},
          },
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdTrigger = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgentTrigger',
            agentId: createdAgent.agentId,
            trigger: {
              name: 'Every hour',
              prompt: 'Run the scheduled task.',
              source: {type: 'schedule', schedule: {kind: 'interval', every: 1, unit: 'hours'}},
            },
          },
        }),
      )
      if (createdTrigger._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')

      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        openAICallCount += 1
        const body = JSON.parse(String(init?.body))
        expect(JSON.stringify(body.messages)).toContain('Run the scheduled task.')
        expect(JSON.stringify(body.messages)).toContain('schedule')
        return openAIStreamResponse([
          {id: 'chat-schedule', choices: [{delta: {content: 'Scheduled task handled.'}}]},
          {id: 'chat-schedule', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const beforeDue = await svc.processScheduledTriggers(createdTrigger.trigger.createdAt + 30 * 60 * 1000)
      expect(beforeDue).toMatchObject({matched: 0, fired: 0, skipped: 0, errors: 0})
      const due = await svc.processScheduledTriggers(createdTrigger.trigger.createdAt + 60 * 60 * 1000)
      expect(due).toMatchObject({matched: 1, fired: 1, skipped: 0, errors: 0})
      const repeated = await svc.processScheduledTriggers(createdTrigger.trigger.createdAt + 60 * 60 * 1000)
      expect(repeated).toMatchObject({matched: 0, fired: 0, skipped: 0, errors: 0})
      expect(openAICallCount).toBe(1)

      const loaded = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetAgentTrigger', triggerId: createdTrigger.trigger.id},
        }),
      )
      expect(loaded._).toBe('GetAgentTriggerResponse')
      if (loaded._ !== 'GetAgentTriggerResponse') throw new Error('unexpected response')
      expect(loaded.sessions).toHaveLength(1)
      expect(loaded.sessions[0]?.startedByTrigger?.activityKey).toBe(
        `schedule:${createdTrigger.trigger.id}:${createdTrigger.trigger.createdAt + 60 * 60 * 1000}`,
      )

      const deleted = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'DeleteAgentTrigger', triggerId: createdTrigger.trigger.id},
        }),
      )
      expect(deleted).toEqual({_: 'DeleteAgentTriggerResponse', triggerId: createdTrigger.trigger.id})
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('processes matching trigger activity idempotently into a session', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let openAICallCount = 0
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-api-key', value: new TextEncoder().encode('test-key')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-api-key'}},
          },
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdTrigger = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgentTrigger',
            agentId: createdAgent.agentId,
            trigger: {
              name: 'Spec comments',
              prompt: [
                {
                  block: {id: 'trigger-prompt', type: 'Paragraph', text: 'Summarize the comment.', attributes: {}},
                  children: [],
                },
              ],
              cooldownMs: 60000,
              source: {type: 'document-comment', resource: 'hm://z6Mkdoc/spec'},
            },
          },
        }),
      )
      if (createdTrigger._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')

      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        openAICallCount += 1
        const body = JSON.parse(String(init?.body))
        expect(JSON.stringify(body.messages)).toContain('Summarize the comment.')
        expect(JSON.stringify(body.messages)).toContain('bafycomment')
        expect(JSON.stringify(body.messages)).toContain('replyCommentId')
        return openAIStreamResponse([
          {id: 'chat-trigger', choices: [{delta: {content: 'Handled trigger.'}}]},
          {id: 'chat-trigger', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const event = {
        account: 'z6Mkauthor',
        newBlob: {cid: 'bafycomment', blobType: 'Comment', author: 'z6Mkauthor', resource: 'hm://z6Mkdoc/spec'},
      }
      const processed = await svc.processActivityEvent(blobs.principalToString(account.principal), event)
      if (processed.errors) {
        const firing = db.query<{error: string | null}, []>(`SELECT error FROM trigger_firings LIMIT 1`).get()
        throw new Error(firing?.error || 'unknown trigger processing error')
      }
      expect(processed).toMatchObject({checked: 1, matched: 1, fired: 1, skipped: 0, errors: 0})
      await expect(
        svc.processActivityEvent(blobs.principalToString(account.principal), {
          ...event,
          newBlob: {...event.newBlob, cid: 'bafycomment2'},
        }),
      ).resolves.toMatchObject({
        checked: 1,
        matched: 1,
        fired: 0,
        skipped: 1,
        errors: 0,
      })
      expect(openAICallCount).toBe(1)

      const loaded = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetAgentTrigger', triggerId: createdTrigger.trigger.id},
        }),
      )
      expect(loaded._).toBe('GetAgentTriggerResponse')
      if (loaded._ !== 'GetAgentTriggerResponse') throw new Error('unexpected response')
      expect(loaded.sessions).toHaveLength(1)
      expect(loaded.sessions[0]?.title).toContain('Spec comments')
      expect(loaded.sessions[0]?.startedByTrigger).toMatchObject({
        triggerId: createdTrigger.trigger.id,
        triggerName: 'Spec comments',
        activityKey: 'blob-bafycomment',
        activitySummary: 'Comment on hm://z6Mkdoc/spec',
      })

      const loadedAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetAgent', agentId: createdAgent.agentId}}),
      )
      expect(loadedAgent._).toBe('GetAgentResponse')
      if (loadedAgent._ !== 'GetAgentResponse') throw new Error('unexpected response')
      expect(loadedAgent.sessions[0]?.startedByTrigger?.triggerId).toBe(createdTrigger.trigger.id)

      const loadedSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetSession', sessionId: loaded.sessions[0]!.id},
        }),
      )
      expect(loadedSession._).toBe('GetSessionResponse')
      if (loadedSession._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(loadedSession.session.startedByTrigger?.triggerId).toBe(createdTrigger.trigger.id)
      expect(loadedSession.triggerContext).toMatchObject({
        triggerId: createdTrigger.trigger.id,
        triggerName: 'Spec comments',
        prompt: 'Summarize the comment.',
        promptBlocks: [
          expect.objectContaining({
            block: expect.objectContaining({id: 'trigger-prompt', text: 'Summarize the comment.'}),
          }),
        ],
        activityKey: 'blob-bafycomment',
        activitySummary: 'Comment on hm://z6Mkdoc/spec',
        source: {type: 'document-comment', resource: 'hm://z6Mkdoc/spec'},
        activity: event,
      })
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('clientRequestId makes create actions idempotent per account and action', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const action = {
        _: 'CreateAgent' as const,
        clientRequestId: 'agent-create-1',
        definition: {name: 'Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
      }
      const firstAgent = await svc.message(await apisvc.createSignedEnvelope(account, {action}))
      const secondAgent = await svc.message(await apisvc.createSignedEnvelope(account, {action}))
      expect(firstAgent).toEqual(secondAgent)
      expect(db.query<{count: number}, []>(`SELECT count(*) as count FROM agents`).get()?.count).toBe(1)
      if (firstAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      const sessionAction = {
        _: 'CreateSession' as const,
        agentId: firstAgent.agentId,
        title: 'Chat',
        clientRequestId: 'session-create-1',
      }
      const firstSession = await svc.message(await apisvc.createSignedEnvelope(account, {action: sessionAction}))
      const secondSession = await svc.message(await apisvc.createSignedEnvelope(account, {action: sessionAction}))
      expect(firstSession).toEqual(secondSession)
      expect(db.query<{count: number}, []>(`SELECT count(*) as count FROM sessions`).get()?.count).toBe(1)

      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {...sessionAction, title: 'Different title'},
          }),
        ),
      ).rejects.toThrow('Client request ID payload mismatch')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('updates agent definition and messages a session through Pi-backed OpenAI', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const events: apisvc.ServiceEvent[] = []
      const svc = new apisvc.Service(db, dataDir, {onEvent: (event) => events.push(event)})
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}, modelDefaults: {temperature: 0}},
          },
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'old prompt', modelProvider: 'openai', model: 'gpt-old'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      const updated = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'UpdateAgent',
            agentId: createdAgent.agentId,
            definition: {name: 'Agent', systemPrompt: 'new prompt', modelProvider: 'openai', model: 'gpt-new'},
          },
        }),
      )
      expect(updated._).toBe('GetAgentResponse')
      if (updated._ !== 'GetAgentResponse') throw new Error('unexpected response')
      expect(agentPromptText(updated.agent.definition.systemPrompt)).toBe('new prompt')
      expect(updated.agent.definition.model).toBe('gpt-new')

      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const fetchMock = mock(async (_url: string, init?: RequestInit) => {
        const auth = new Headers(init?.headers).get('authorization')
        expect(auth).toBe('Bearer sk-test')
        const body = JSON.parse(String(init?.body))
        expect(body.model).toBe('gpt-new')
        expect(body.temperature).toBe(0)
        expect(JSON.stringify(body.messages)).toContain('Hello agent')
        expect(JSON.stringify(body.messages)).toContain('new prompt')
        return openAIStreamResponse([
          {id: 'chat-1', choices: [{delta: {content: 'Hello human'}}]},
          {id: 'chat-1', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch
      globalThis.fetch = fetchMock

      const message = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [
              {
                type: 'text',
                text: 'Hello agent',
                blocks: [{block: {id: 'message-block-1', type: 'paragraph', text: 'Hello agent'}, children: []}],
              },
            ],
            clientMessageId: 'message-1',
          },
        }),
      )
      expect(message._).toBe('MessageSessionResponse')

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      expect(session._).toBe('GetSessionResponse')
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      expect(session.events.map((event) => event.event)).toEqual([
        {
          type: 'message',
          role: 'user',
          content: 'Hello agent',
          rawMarkdown: 'Hello agent',
          blocks: [{block: {id: 'message-block-1', type: 'paragraph', text: 'Hello agent'}, children: []}],
        },
        {type: 'message', role: 'assistant', content: 'Hello human'},
      ])
      expect(events.some((event) => event.type === 'session-partial' && event.textDelta === 'Hello human')).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('runs hidden session title tool without persisting tool events and respects manual title overrides', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'prompt', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const titleCalls = ['Purpose Discovery', 'Agent Override']
      let openAICallCount = 0
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        openAICallCount += 1
        expect(body.tools?.map((tool: {function?: {name?: string}}) => tool.function?.name)).toContain(
          'set_session_title',
        )
        if (openAICallCount % 2 === 1) {
          const title = titleCalls.shift() || 'Extra Title'
          return openAIStreamResponse([
            {
              id: `chat-${openAICallCount}`,
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `title-call-${openAICallCount}`,
                        type: 'function',
                        function: {name: 'set_session_title', arguments: JSON.stringify({title})},
                      },
                    ],
                  },
                },
              ],
            },
            {id: `chat-${openAICallCount}`, choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {
            id: `chat-${openAICallCount}-final`,
            choices: [{delta: {content: openAICallCount === 2 ? 'Done.' : 'Still done.'}}],
          },
          {
            id: `chat-${openAICallCount}-final`,
            choices: [{delta: {}, finish_reason: 'stop'}],
            usage: openAIUsage(),
          },
        ])
      }) as unknown as typeof fetch

      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'What are we doing?'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      let session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.title).toBe('Purpose Discovery')
      expect(session.events.map((event) => (event.event as {type?: string}).type)).toEqual(['message', 'message'])

      const manual = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'UpdateSession', sessionId: createdSession.sessionId, title: 'Manual Name'},
        }),
      )
      expect(manual._).toBe('UpdateSessionResponse')
      const followUp = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Try to rename'}],
          },
        }),
      )
      expect(followUp._).toBe('MessageSessionResponse')
      session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.title).toBe('Manual Name')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('runs read tool calls and persists tool events', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const events: apisvc.ServiceEvent[] = []
      const svc = new apisvc.Service(db, dataDir, {onEvent: (event) => events.push(event)})
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'prompt', modelProvider: 'openai', model: 'gpt-test'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const resolvedId = unpackHmId('hm://z6Mkdoc/docs/example')
      if (!resolvedId) throw new Error('bad test id')

      let openAICallCount = 0
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : String(url)
        const method = init?.method ?? (url instanceof Request ? url.method : undefined)
        if (href.includes('/api/GetDomain')) {
          return Response.json(serialize({registeredAccountUid: null}))
        }
        if (method === 'OPTIONS' || href.startsWith('https://example.com/')) {
          return new Response(null, {status: 200, headers: {'x-hypermedia-id': 'hm://z6Mkdoc/docs/example'}})
        }
        if (href.includes('/api/Resource')) {
          return Response.json(
            serialize({
              type: 'document',
              id: resolvedId,
              document: {
                content: [
                  {block: {id: 'block-1', type: 'Heading', text: 'Example', attributes: {level: 1}}, children: []},
                ],
                version: 'v1',
                account: 'z6Mkdoc',
                authors: [],
                path: '/docs/example',
                createTime: '',
                updateTime: '',
                metadata: {name: 'Example'},
                genesis: 'genesis',
                visibility: 'PUBLIC',
              },
            }),
          )
        }

        openAICallCount += 1
        const body = JSON.parse(await fetchBodyText(url, init))
        if (openAICallCount === 1) {
          expect(body.tools?.map((tool: {function?: {name?: string}}) => tool.function?.name)).toEqual([
            'read',
            'set_session_title',
          ])
          return openAIStreamResponse([
            {id: 'chat-1', choices: [{delta: {content: "I'll read it first.\n"}}]},
            {
              id: 'chat-1',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-1',
                        type: 'function',
                        function: {
                          name: 'read',
                          arguments: JSON.stringify({id: 'https://example.com/docs/example'}),
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {id: 'chat-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
          ])
        }
        if (openAICallCount === 2) {
          expectToolResultHasPrecedingToolCall(body.messages)
          expect(JSON.stringify(body.messages)).toContain('hm://z6Mkdoc/docs/example')
          return openAIStreamResponse([
            {id: 'chat-2', choices: [{delta: {content: 'I read it.'}}]},
            {id: 'chat-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        const assistantWithTool = body.messages?.find(
          (message: {role?: string; content?: string; tool_calls?: unknown}) =>
            message.role === 'assistant' &&
            typeof message.content === 'string' &&
            message.content.includes("I'll read it first.") &&
            Array.isArray(message.tool_calls),
        )
        expect(assistantWithTool).toBeTruthy()
        return openAIStreamResponse([
          {id: 'chat-3', choices: [{delta: {content: 'Done.'}}]},
          {id: 'chat-3', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Read it'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      expect(openAICallCount).toBeGreaterThanOrEqual(2)
      expect(
        events.flatMap((event) => {
          if (event.type === 'session-partial') {
            if (event.done) return ['partial_done']
            // Ignore progress-only partials (activity/token-usage updates carry no text delta).
            if (typeof event.textDelta !== 'string') return []
            return [`partial:${event.textDelta}`]
          }
          if (event.type !== 'session-event') return []
          const payload = event.event.event as {type?: string; role?: string}
          if (!['message', 'tool_call', 'tool_result'].includes(payload.type || '')) return []
          return [payload.type === 'message' ? `message:${payload.role}` : payload.type]
        }),
      ).toEqual([
        'message:user',
        "partial:I'll read it first.\n",
        'partial_done',
        'message:assistant',
        'tool_call',
        'tool_result',
        'partial:Done.',
        'partial_done',
        'message:assistant',
      ])
      const countAfterFirstMessage = openAICallCount
      const followUp = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Thanks'}],
          },
        }),
      )
      expect(followUp._).toBe('MessageSessionResponse')
      expect(openAICallCount).toBeGreaterThan(countAfterFirstMessage)
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.events.map((event) => (event.event as {type?: string}).type)).toEqual([
        'message',
        'message',
        'tool_call',
        'tool_result',
        'message',
        'message',
        'message',
      ])
      expect(session.events[1]?.event).toEqual({type: 'message', role: 'assistant', content: "I'll read it first.\n"})
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('runs write profile and draft tool calls with selected signing identities', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const publishedBodies: Uint8Array[] = []
      let openAICallCount = 0
      let signerPublicKey = ''
      const commentRequestUrls: string[] = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : String(url)
        if (href.includes('/api/PublishBlobs')) {
          publishedBodies.push(new Uint8Array(init?.body as ArrayBuffer))
          return Response.json(serialize({cids: [`published-${publishedBodies.length}`]}))
        }
        if (href.includes('/api/Comment')) {
          commentRequestUrls.push(href)
          return Response.json(
            serialize({
              id: `${signerPublicKey}/parent-tsid`,
              version: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
              author: signerPublicKey,
              targetAccount: signerPublicKey,
              targetPath: '/manual-doc',
              targetVersion: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
              replyParent: '',
              replyParentVersion: '',
              threadRoot: '',
              threadRootVersion: '',
              capability: '',
              content: [],
              createTime: '',
              updateTime: '',
              visibility: 'PUBLIC',
            }),
          )
        }
        if (href.includes('/api/Resource')) {
          const resolvedId = unpackHmId(`hm://${signerPublicKey}/manual-doc`)
          if (!resolvedId) throw new Error('bad comment target id')
          return Response.json(
            serialize({
              type: 'document',
              id: resolvedId,
              document: {
                content: [],
                version: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
                account: signerPublicKey,
                authors: [],
                path: '/manual-doc',
                createTime: '',
                updateTime: '',
                metadata: {name: 'Manual Doc'},
                genesis: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
                generationInfo: {
                  generation: 1,
                  genesis: 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
                },
                visibility: 'PUBLIC',
              },
            }),
          )
        }

        if (!href.includes('/chat/completions') && !href.includes('/responses')) {
          throw new Error(`Unexpected fetch: ${href}`)
        }
        openAICallCount += 1
        const body = JSON.parse(await fetchBodyText(url, init))
        if (openAICallCount === 1) {
          expect(body.tools?.map((tool: {function?: {name?: string}}) => tool.function?.name)).toEqual([
            'read',
            'write',
            'set_session_title',
          ])
          expect(JSON.stringify(body.tools)).toContain('replyCommentId')
          expect(JSON.stringify(body.tools)).toContain('document title metadata')
          expect(JSON.stringify(body.tools)).toContain('For document.move')
          expect(JSON.stringify(body.messages)).toContain('Writer Bot')
          expect(JSON.stringify(body.messages)).toContain('set the visible Seed document title explicitly')
          return openAIStreamResponse([
            {
              id: 'chat-1',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-1',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'profile.update',
                            signer: {profileName: 'Writer Bot'},
                            input: {name: 'Writer Bot Renamed', description: 'Publishes Seed content'},
                          }),
                        },
                      },
                      {
                        index: 1,
                        id: 'call-2',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'draft.create',
                            input: {
                              body: '---\ntitle: Draft Title\nsummary: Draft summary\n---\n# Draft Title\n\nHello draft.',
                              path: '/draft-title',
                            },
                          }),
                        },
                      },
                      {
                        index: 2,
                        id: 'call-3',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'capability.create',
                            signer: {publicKey: signerPublicKey},
                            input: {delegate: signerPublicKey, role: 'WRITER', path: '/docs', label: 'Docs writer'},
                          }),
                        },
                      },
                      {
                        index: 3,
                        id: 'call-4',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'contact.create',
                            signer: {publicKey: signerPublicKey},
                            input: {subject: signerPublicKey, name: 'Self contact'},
                          }),
                        },
                      },
                      {
                        index: 4,
                        id: 'call-5',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'document.create',
                            signer: {publicKey: signerPublicKey},
                            path: '/manual-doc',
                            title: 'Manual Doc',
                            body: '# Manual Doc\n\nCreated from root-level tool arguments.',
                          }),
                        },
                      },
                      {
                        index: 5,
                        id: 'call-6',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'comment.create',
                            signer: {publicKey: signerPublicKey},
                            id: `hm://${signerPublicKey}/manual-doc`,
                            server: 'https://hm.test',
                            dev: false,
                            text: 'Root-level comment text works.',
                            replyCommentId: `hm://${signerPublicKey}/parent-tsid`,
                          }),
                        },
                      },
                      {
                        index: 6,
                        id: 'call-7',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'document.move',
                            signer: {publicKey: signerPublicKey},
                            id: `hm://${signerPublicKey}/manual-doc`,
                            path: '/',
                          }),
                        },
                      },
                      {
                        index: 7,
                        id: 'call-8',
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            command: 'document.create',
                            signer: {publicKey: signerPublicKey},
                            input: {
                              path: '/',
                              name: 'Home',
                              body: '# Home\n\nRoot document.',
                            },
                            dryRun: true,
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {id: 'chat-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
          ])
        }
        if (openAICallCount === 2) {
          expectToolResultHasPrecedingToolCall(body.messages)
          expect(JSON.stringify(body.messages)).toContain('hypermedia_write_result')
          expect(JSON.stringify(body.messages)).toContain('draftId')
        }
        if (openAICallCount === 3) {
          const toolAssistant = body.messages?.find(
            (message: {role?: string; tool_calls?: unknown[]}) =>
              message.role === 'assistant' && Array.isArray(message.tool_calls) && message.tool_calls.length === 8,
          )
          expect(toolAssistant).toBeTruthy()
        }
        return openAIStreamResponse([
          {id: 'chat-3', choices: [{delta: {content: 'Profile updated and draft created.'}}]},
          {id: 'chat-3', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test'})
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      const identity = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'CreateSigningIdentity', label: 'Writer Bot', clientRequestId: 'writer-bot'},
        }),
      )
      if (identity._ !== 'CreateSigningIdentityResponse') throw new Error('unexpected response')
      if (!identity.identity.accountId) throw new Error('missing signing account id')
      signerPublicKey = identity.identity.accountId
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: 'Writer',
              systemPrompt: 'Write Seed content.',
              modelProvider: 'openai',
              model: 'gpt-test',
              tools: ['read', 'write'],
              signingKeys: [identity.identity.name],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Update profile and draft a doc'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      expect(openAICallCount).toBeGreaterThanOrEqual(2)
      const countAfterWrite = openAICallCount
      const followUp = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'What did you change?'}],
          },
        }),
      )
      expect(followUp._).toBe('MessageSessionResponse')
      expect(openAICallCount).toBeGreaterThan(countAfterWrite)
      expect(publishedBodies).toHaveLength(7)
      const loadedSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetSession', sessionId: createdSession.sessionId},
        }),
      )
      if (loadedSession._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const rootDryRunResult = loadedSession.events
        .map((event) => event.event as {type?: string; name?: string; output?: {id?: string; dryRun?: boolean}})
        .find((event) => event.type === 'tool_result' && event.name === 'write' && event.output?.dryRun)
      expect(rootDryRunResult?.output?.id).toBe(`hm://${signerPublicKey}`)
      expect(
        commentRequestUrls.some((url) =>
          url.includes(`__value=${encodeURIComponent(`${signerPublicKey}/parent-tsid`)}`),
        ),
      ).toBe(true)
      expect(commentRequestUrls.some((url) => url.includes('hm%3A'))).toBe(false)
      const commentCreateResult = loadedSession.events
        .map((event) => event.event as {type?: string; name?: string; output?: {command?: string; commentId?: string}})
        .find(
          (event) =>
            event.type === 'tool_result' && event.name === 'write' && event.output?.command === 'comment.create',
        )
      expect(commentCreateResult?.output?.commentId).toMatch(new RegExp(`^${signerPublicKey}/z`))
      expect(commentCreateResult?.output?.commentId).not.toMatch(/^published-\d+$/)
      const draft = db
        .query<{title: string; metadata_cbor: Uint8Array}, []>(`SELECT title, metadata_cbor FROM agent_drafts LIMIT 1`)
        .get()
      expect(draft?.title).toBe('Draft Title')
      expect(cbor.decode<Record<string, unknown>>(draft?.metadata_cbor ?? new Uint8Array()).summary).toBe(
        'Draft summary',
      )
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('emits events and verifies signed subscriptions for live clients', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const events: apisvc.ServiceEvent[] = []
      const svc = new apisvc.Service(db, dataDir, {onEvent: (event) => events.push(event)})
      await setDefaultProvider(svc, account)
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'prompt', modelProvider: 'openai', model: 'gpt-test'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      expect(events.some((event) => event.type === 'agent-change' && event.agent.id === createdAgent.agentId)).toBe(
        true,
      )
      expect(
        events.some((event) => event.type === 'session-change' && event.session.id === createdSession.sessionId),
      ).toBe(true)

      const sub = await svc.verifySubscription(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'Subscribe', key: `sessions/${createdSession.sessionId}`, afterSeq: 0},
        }),
      )
      expect(sub.accountId).toBe(blobs.principalToString(account.principal))
      expect(sub.key).toBe(`sessions/${createdSession.sessionId}`)
      expect(sub.replay?._).toBe('GetSessionResponse')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('stop session unlocks a stale streaming session with no active runner', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'prompt', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      db.run(`UPDATE sessions SET status = ? WHERE id = ?`, ['streaming', createdSession.sessionId])

      const stopped = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'StopSession', sessionId: createdSession.sessionId}}),
      )
      expect(stopped).toEqual({_: 'StopSessionResponse', sessionId: createdSession.sessionId, stopped: true})

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('message session failure persists user message and error event', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'prompt', modelProvider: 'openai', model: 'gpt-test'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      globalThis.fetch = mock(async () => new Response('nope', {status: 500})) as unknown as typeof fetch
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'MessageSession',
              sessionId: createdSession.sessionId,
              content: [{type: 'text', text: 'Will this persist?'}],
            },
          }),
        ),
      ).rejects.toThrow('500 nope')

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      expect(session._).toBe('GetSessionResponse')
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('error')
      expect(session.events.map((event) => event.event)).toEqual([
        {
          type: 'message',
          role: 'user',
          content: 'Will this persist?',
          rawMarkdown: 'Will this persist?',
        },
        {type: 'error', message: '500 nope'},
      ])
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('CBOR round-trips typed arrays used by signed envelopes', () => {
    const account = blobs.generateNobleKeyPair()
    const encoded = cbor.encode({account: account.principal, nested: {bytes: new Uint8Array([1, 2, 3])}})
    const decoded = cbor.decode<{account: Uint8Array; nested: {bytes: Uint8Array}}>(encoded)
    expect(decoded.account).toEqual(account.principal)
    expect(decoded.nested.bytes).toEqual(new Uint8Array([1, 2, 3]))
  })
})

async function setDefaultProvider(svc: apisvc.Service, account: blobs.Signer): Promise<void> {
  await svc.message(
    await apisvc.createSignedEnvelope(account, {
      action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
    }),
  )
}

function agentPromptText(prompt: unknown): string {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return ''
  return prompt
    .map((node) =>
      isRecord(node) && isRecord(node.block) && typeof node.block.text === 'string' ? node.block.text : '',
    )
    .join('\n')
}

function expectToolResultHasPrecedingToolCall(messages: unknown): void {
  expect(Array.isArray(messages)).toBe(true)
  if (!Array.isArray(messages)) return
  const toolResultIndex = messages.findIndex((message) => isRecord(message) && message.role === 'tool')
  expect(toolResultIndex).toBeGreaterThan(0)
  const toolResult = messages[toolResultIndex]
  const previous = messages[toolResultIndex - 1]
  expect(isRecord(toolResult) && isRecord(previous)).toBe(true)
  if (!isRecord(toolResult) || !isRecord(previous)) return
  expect(previous.role).toBe('assistant')
  expect(Array.isArray(previous.tool_calls)).toBe(true)
  expect(previous.tool_calls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: toolResult.tool_call_id,
        type: 'function',
        function: expect.objectContaining({name: 'read'}),
      }),
    ]),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function openAIStreamResponse(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: {'content-type': 'text/event-stream'},
  })
}

async function fetchBodyText(url: string | URL | Request, init?: RequestInit): Promise<string> {
  if (init?.body !== undefined) return String(init.body)
  if (url instanceof Request) return url.clone().text()
  return ''
}

function openAIUsage(): Record<string, number> {
  return {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2}
}

function createTestState(): {db: Database; dataDir: string; cleanup: () => void} {
  const db = new Database(':memory:', {create: true, strict: true})
  const result = sqlite.openWithDatabase(db)
  if (!result.ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-test-'))
  return {
    db,
    dataDir,
    cleanup: () => fs.rmSync(dataDir, {recursive: true, force: true}),
  }
}
