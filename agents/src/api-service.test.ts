import {Database} from 'bun:sqlite'
import {describe, expect, mock, test} from 'bun:test'
import * as apisvc from '@/api-service'
import * as cbor from '@/cbor'
import * as sqlite from '@/sqlite'
import {ProviderOAuthManager} from '@/provider-oauth'
import * as blobs from '@shm/shared/blobs'
import {unpackHmId} from '@seed-hypermedia/client'
import {serialize} from 'superjson'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('api service', () => {
  test('read tool returns only metadata for :attributes URLs', async () => {
    // Mirrors the desktop's attributes tab: `<doc>/:attributes` is a view term, not a path
    // segment. The regression this guards: the term being sent to the HM server as part of the
    // document path (a not-found), or the full document content coming back when only the
    // metadata was asked for.
    const originalFetch = globalThis.fetch
    const resourceRequests: string[] = []
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      if (href.includes('/api/Resource')) {
        resourceRequests.push(href)
        return Response.json(
          serialize({
            type: 'document',
            id: unpackHmId('hm://z6MkDoc/employees'),
            document: {
              content: [{block: {id: 'b1', type: 'Paragraph', text: 'Secret roster body'}, children: []}],
              version: 'v7',
              account: 'z6MkDoc',
              authors: [],
              path: '/employees',
              createTime: '',
              updateTime: '',
              metadata: {name: 'Employees', summary: 'Team roster'},
              genesis: 'genesis',
              visibility: 'PUBLIC',
            },
          }),
        )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch

    try {
      const result = await apisvc.readHypermedia({
        id: 'https://hyper.media/hm/z6MkDoc/employees/:attributes',
      })

      // The view term was stripped before hitting the resolver.
      expect(resourceRequests).toHaveLength(1)
      expect(resourceRequests[0]).not.toContain(':attributes')
      expect(resourceRequests[0]).toContain('hm://z6MkDoc/employees')

      // Metadata only: no document content in any form.
      expect(result.view).toBe('attributes')
      expect(result.metadata).toEqual({name: 'Employees', summary: 'Team roster'})
      expect(result.title).toBe('Employees')
      expect(result.version).toBe('v7')
      expect(result.markdown).toBeUndefined()
      expect(result.resource).toBeUndefined()
      expect(JSON.stringify(result)).not.toContain('Secret roster body')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

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

  test('reads and writes agent memory through signed actions', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const events: apisvc.ServiceEvent[] = []
      const svc = new apisvc.Service(db, dataDir, {onEvent: (event) => events.push(event)})
      await setDefaultProvider(svc, account)
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Memory Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const agentId = create.agentId

      const emptyList = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentMemory', agentId}}),
      )
      expect(emptyList).toMatchObject({_: 'ListAgentMemoryResponse', agentId, entries: [], totalBytes: 0})

      const write = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'WriteAgentMemoryFile', agentId, path: 'notes/first.md', content: 'remember me'},
        }),
      )
      expect(write).toMatchObject({
        _: 'WriteAgentMemoryFileResponse',
        agentId,
        entry: {path: 'notes/first.md', type: 'file'},
      })
      expect(events.some((event) => event.type === 'account-change' && event.reason === 'agent-memory-changed')).toBe(
        true,
      )

      const read = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ReadAgentMemoryFile', agentId, path: 'notes/first.md'},
        }),
      )
      expect(read).toMatchObject({
        _: 'ReadAgentMemoryFileResponse',
        file: {path: 'notes/first.md', content: 'remember me'},
      })

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentMemory', agentId}}),
      )
      if (listed._ !== 'ListAgentMemoryResponse') throw new Error('unexpected response')
      expect(listed.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual(['dir:notes', 'file:notes/first.md'])

      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'WriteAgentMemoryFile', agentId, path: '../escape.txt', content: 'nope'},
          }),
        ),
      ).rejects.toThrow('Memory path cannot contain ".."')
      expect(fs.existsSync(path.join(dataDir, 'agents', 'escape.txt'))).toBe(false)

      // Another account cannot touch this agent's memory.
      const stranger = blobs.generateNobleKeyPair()
      await expect(
        svc.message(await apisvc.createSignedEnvelope(stranger, {action: {_: 'ListAgentMemory', agentId}})),
      ).rejects.toThrow('Agent not found')

      const remove = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteAgentMemoryFile', agentId, path: 'notes'}}),
      )
      expect(remove).toMatchObject({_: 'DeleteAgentMemoryFileResponse', path: 'notes', deleted: true})
    } finally {
      db.close()
      cleanup()
    }
  })

  test('handles binary memory files, web downloads, and IPFS uploads via signed actions', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const realFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.example'})
      await setDefaultProvider(svc, account)
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: 'Media Agent',
              systemPrompt: 'ok',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const agentId = create.agentId

      // Binary write + read round trip through the signed actions.
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9])
      const write = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'WriteAgentMemoryFile', agentId, path: 'media/pic.png', content: pngBytes},
        }),
      )
      expect(write).toMatchObject({
        _: 'WriteAgentMemoryFileResponse',
        entry: {path: 'media/pic.png', size: 10, mimeType: 'image/png'},
      })
      const read = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ReadAgentMemoryFile', agentId, path: 'media/pic.png'},
        }),
      )
      if (read._ !== 'ReadAgentMemoryFileResponse') throw new Error('unexpected response')
      expect(read.file.encoding).toBe('binary')
      expect(Array.from(read.file.data ?? [])).toEqual(Array.from(pngBytes))

      // Web download into memory.
      globalThis.fetch = (async (url: string | URL | Request) => {
        if (String(url).includes('cdn.example')) {
          return new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'image/jpeg'}})
        }
        throw new Error(`unexpected fetch: ${String(url)}`)
      }) as unknown as typeof fetch
      const download = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'DownloadAgentMemoryFile', agentId, url: 'https://cdn.example/photo.jpg'},
        }),
      )
      expect(download).toMatchObject({
        _: 'DownloadAgentMemoryFileResponse',
        entry: {path: 'downloads/photo.jpg', size: 3, mimeType: 'image/jpeg'},
      })

      // IPFS upload via the HM server endpoint.
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://hm.example/ipfs/file-upload')
        expect(init?.method).toBe('POST')
        return new Response('bafkTestCid123\n')
      }) as unknown as typeof fetch
      const upload = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'UploadAgentMemoryFileToIpfs', agentId, path: 'media/pic.png'},
        }),
      )
      expect(upload).toMatchObject({
        _: 'UploadAgentMemoryFileToIpfsResponse',
        path: 'media/pic.png',
        cid: 'bafkTestCid123',
        url: 'ipfs://bafkTestCid123',
        mimeType: 'image/png',
      })

      // The session system prompt carries the Space index: memory top level without expanding
      // folders, plus the callable tool lines.
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId}}),
      )
      if (session._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const loaded = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: session.sessionId}}),
      )
      if (loaded._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(loaded.systemPromptMarkdown).toContain('<space>')
      expect(loaded.systemPromptMarkdown).toContain('media/(1)')
      expect(loaded.systemPromptMarkdown).toContain('downloads/(1)')
      expect(loaded.systemPromptMarkdown).not.toContain('media/pic.png')
    } finally {
      globalThis.fetch = realFetch
      db.close()
      cleanup()
    }
  })

  test('uploads large files in chunks into memory via Begin/Append/Commit', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.example'})
      await setDefaultProvider(svc, account)
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: 'Big',
              systemPrompt: 'ok',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const agentId = create.agentId

      const data = new Uint8Array(1000)
      for (let i = 0; i < data.length; i++) data[i] = i % 251

      const begin = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'BeginFileUpload', target: {kind: 'memory', agentId, path: 'big/data.bin'}, size: data.length},
        }),
      )
      if (begin._ !== 'BeginFileUploadResponse') throw new Error('unexpected response')
      expect(begin.maxChunkBytes).toBeGreaterThan(0)

      // Wrong offset is rejected; correct sequential chunks accumulate.
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'AppendFileUploadChunk', uploadId: begin.uploadId, offset: 5, content: data.slice(0, 400)},
          }),
        ),
      ).rejects.toThrow('does not match')
      for (let offset = 0; offset < data.length; offset += 400) {
        const appended = await svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'AppendFileUploadChunk',
              uploadId: begin.uploadId,
              offset,
              content: data.slice(offset, offset + 400),
            },
          }),
        )
        expect(appended).toMatchObject({
          _: 'AppendFileUploadChunkResponse',
          received: Math.min(offset + 400, data.length),
        })
      }

      const commit = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CommitFileUpload', uploadId: begin.uploadId}}),
      )
      expect(commit).toMatchObject({_: 'CommitFileUploadResponse', entry: {path: 'big/data.bin', size: data.length}})

      const read = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ReadAgentMemoryFile', agentId, path: 'big/data.bin'},
        }),
      )
      if (read._ !== 'ReadAgentMemoryFileResponse') throw new Error('unexpected response')
      expect(Array.from(read.file.data ?? [])).toEqual(Array.from(data))

      // Committing an incomplete upload fails, and abort cleans up.
      const begin2 = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'BeginFileUpload', target: {kind: 'memory', agentId, path: 'big/partial.bin'}, size: 10},
        }),
      )
      if (begin2._ !== 'BeginFileUploadResponse') throw new Error('unexpected response')
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'CommitFileUpload', uploadId: begin2.uploadId}}),
        ),
      ).rejects.toThrow('cannot commit')
      const aborted = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'AbortFileUpload', uploadId: begin2.uploadId}}),
      )
      expect(aborted).toMatchObject({_: 'AbortFileUploadResponse'})
    } finally {
      db.close()
      cleanup()
    }
  })

  test('chunked uploads can target session attachments', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.example'})
      await setDefaultProvider(svc, account)
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'A', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: create.agentId}}),
      )
      if (session._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const bytes = new TextEncoder().encode('chunked attachment payload')
      const begin = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'BeginFileUpload',
            target: {
              kind: 'session-attachment',
              sessionId: session.sessionId,
              name: 'notes.txt',
              mimeType: 'text/plain',
            },
            size: bytes.length,
          },
        }),
      )
      if (begin._ !== 'BeginFileUploadResponse') throw new Error('unexpected response')
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'AppendFileUploadChunk', uploadId: begin.uploadId, offset: 0, content: bytes},
        }),
      )
      const commit = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CommitFileUpload', uploadId: begin.uploadId}}),
      )
      if (commit._ !== 'CommitFileUploadResponse') throw new Error('unexpected response')
      expect(commit.attachment).toMatchObject({name: 'notes.txt', mimeType: 'text/plain', size: bytes.length})

      const readBack = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ReadSessionAttachment', sessionId: session.sessionId, attachmentId: commit.attachment!.id},
        }),
      )
      if (readBack._ !== 'ReadSessionAttachmentResponse') throw new Error('unexpected response')
      expect(new TextDecoder().decode(readBack.data)).toBe('chunked attachment payload')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('reports the code-execution capability from injected executors', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const enabled = new apisvc.Service(db, dataDir, {
        codeExecutor: {
          enabled: true,
          runtimes: ['python', 'shell'],
          availability: async () => ({available: true, runtimes: ['python', 'shell']}),
          execute: async () => {
            throw new Error('unused')
          },
        },
      })
      expect((await enabled.codeExecAvailability()).available).toBe(true)
      const disabled = new apisvc.Service(db, dataDir, {
        codeExecutor: {
          enabled: false,
          runtimes: [],
          availability: async () => ({available: false, reason: 'disabled', runtimes: []}),
          execute: async () => {
            throw new Error('disabled')
          },
        },
      })
      const unavailable = await disabled.codeExecAvailability()
      expect(unavailable.available).toBe(false)
      expect(unavailable.reason).toBe('disabled')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('creates a default user-mention trigger for the agent signing identity', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetSecret',
            name: 'agent-account-key',
            value: new TextEncoder().encode('mnemonic words'),
            metadata: {kind: 'hm-account-key', accountId: 'z6MkAgentAccountUid', label: 'Agent account'},
          },
        }),
      )
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: 'Mentionable Agent',
              systemPrompt: 'ok',
              modelProvider: 'openai',
              model: 'gpt',
              signingKey: 'agent-account-key',
            },
          },
        }),
      )
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTriggers', agentId: create.agentId}}),
      )
      expect(listed._).toBe('ListAgentTriggersResponse')
      if (listed._ !== 'ListAgentTriggersResponse') throw new Error('unexpected response')
      expect(listed.triggers).toHaveLength(1)
      const trigger = listed.triggers[0]
      expect(trigger?.enabled).toBe(true)
      expect(trigger?.source).toEqual({type: 'user-mention', mentionedAccounts: ['z6MkAgentAccountUid']})
      expect(agentPromptText(trigger?.prompt)).toBe('Respond to the mention, performing the action requested.')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('does not create a default trigger when the agent has no signing identity', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const create = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'No Account Agent', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (create._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      const listed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgentTriggers', agentId: create.agentId}}),
      )
      if (listed._ !== 'ListAgentTriggersResponse') throw new Error('unexpected response')
      expect(listed.triggers).toHaveLength(0)
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

  test('lists models for an OpenAI-compatible named provider (DeepSeek) at its default base URL', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'deepseek-key', value: new TextEncoder().encode('sk-deepseek')},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'deepseek',
            provider: {type: 'deepseek', secretRefs: {apiKey: 'deepseek-key'}},
          },
        }),
      )
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.deepseek.com/models')
        expect(init?.headers).toMatchObject({Authorization: 'Bearer sk-deepseek'})
        return Response.json({data: [{id: 'deepseek-chat'}, {id: 'deepseek-reasoner'}]})
      }) as unknown as typeof fetch

      const models = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListProviderModels', provider: 'deepseek'}}),
      )
      if (models._ !== 'ListProviderModelsResponse') throw new Error('unexpected response')
      expect(models.models).toEqual([
        {id: 'deepseek-chat', name: 'deepseek-chat'},
        {id: 'deepseek-reasoner', name: 'deepseek-reasoner'},
      ])
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('lists models for a keyless local provider (Ollama) without an Authorization header', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      // No secret stored: Ollama runs locally without an API key.
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetModelProvider', name: 'ollama', provider: {type: 'ollama'}},
        }),
      )
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('http://localhost:11434/v1/models')
        expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined()
        return Response.json({data: [{id: 'llama3.2'}]})
      }) as unknown as typeof fetch

      const models = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListProviderModels', provider: 'ollama'}}),
      )
      if (models._ !== 'ListProviderModelsResponse') throw new Error('unexpected response')
      expect(models.models).toEqual([{id: 'llama3.2', name: 'llama3.2'}])
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('subscription sign-in flow: start, submit code, poll completion, save provider', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {
        subscriptionAuth: true,
        providerOAuth: new ProviderOAuthManager({
          openai: async ({onAuth, onManualCodeInput}) => {
            onAuth({url: 'https://auth.openai.com/oauth/authorize?client_id=test'})
            const code = await onManualCodeInput()
            expect(code).toBe('pasted-code')
            return {access: 'access-1', refresh: 'refresh-1', expires: Date.now() + 3600_000, accountId: 'acct_1'}
          },
        }),
      })

      const started = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'StartProviderOAuth', providerType: 'openai'}}),
      )
      if (started._ !== 'StartProviderOAuthResponse') throw new Error('unexpected response')
      expect(started.authUrl).toContain('https://auth.openai.com/oauth/authorize')

      const submitted = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SubmitProviderOAuthCode', loginId: started.loginId, code: 'pasted-code'},
        }),
      )
      expect(submitted._).toBe('SubmitProviderOAuthCodeResponse')
      await Bun.sleep(5)

      const status = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetProviderOAuthStatus', loginId: started.loginId},
        }),
      )
      if (status._ !== 'ProviderOAuthStatusResponse') throw new Error('unexpected response')
      expect(status.status).toBe('completed')
      expect(status.secretName).toBe('openai-subscription-oauth')

      const saved = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'ChatGPT',
            provider: {type: 'openai', authMode: 'subscription', secretRefs: {oauth: status.secretName!}},
          },
        }),
      )
      if (saved._ !== 'SetModelProviderResponse') throw new Error('unexpected response')
      expect(saved.provider.authMode).toBe('subscription')
      expect(saved.provider.authStatus).toBe('ok')
      expect(saved.provider.hasSecrets).toBe(true)

      const listed = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListModelProviders'}}))
      if (listed._ !== 'ListModelProvidersResponse') throw new Error('unexpected response')
      expect(listed.providers).toHaveLength(1)
      expect(listed.providers[0]).toMatchObject({name: 'ChatGPT', authMode: 'subscription', authStatus: 'ok'})
    } finally {
      db.close()
      cleanup()
    }
  })

  test('subscription provider lists the static Codex model catalog without a network call', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetSecret',
            name: 'openai-subscription-oauth',
            value: new TextEncoder().encode(
              JSON.stringify({access: 'a', refresh: 'r', expires: Date.now() + 3600_000, accountId: 'acct_1'}),
            ),
            metadata: {provider: 'openai', kind: 'provider-oauth'},
          },
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'ChatGPT',
            provider: {type: 'openai', authMode: 'subscription', secretRefs: {oauth: 'openai-subscription-oauth'}},
          },
        }),
      )
      globalThis.fetch = mock(async () => {
        throw new Error('subscription model listing must not hit the network')
      }) as unknown as typeof fetch

      const models = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListProviderModels', provider: 'ChatGPT'}}),
      )
      if (models._ !== 'ListProviderModelsResponse') throw new Error('unexpected response')
      expect(models.models.length).toBeGreaterThan(0)
      for (const model of models.models) expect(model.id.startsWith('gpt-')).toBe(true)
      // Current Codex generation is offered; retired ids the backend rejects are not.
      expect(models.models.map((model) => model.id)).toContain('gpt-5.6-sol')
      expect(models.models.map((model) => model.id)).not.toContain('gpt-5.1')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('rejects subscription auth for provider types without OAuth support and without an oauth secret ref', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {subscriptionAuth: true})
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'SetModelProvider',
              name: 'claude',
              provider: {type: 'anthropic', authMode: 'subscription', secretRefs: {oauth: 'x'}},
            },
          }),
        ),
      ).rejects.toThrow('does not support subscription auth')
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'SetModelProvider',
              name: 'ChatGPT',
              provider: {type: 'openai', authMode: 'subscription'},
            },
          }),
        ),
      ).rejects.toThrow('secretRefs.oauth')
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'StartProviderOAuth', providerType: 'anthropic'},
          }),
        ),
      ).rejects.toThrow('does not support subscription sign-in')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('subscription sign-in is rejected unless the server explicitly enables it', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'StartProviderOAuth', providerType: 'openai'},
          }),
        ),
      ).rejects.toThrow('not enabled on this server')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('subscription provider health: needs-login when the OAuth secret is missing or flagged', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      // Provider referencing a secret that was never stored (abandoned sign-in).
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'ChatGPT',
            provider: {type: 'openai', authMode: 'subscription', secretRefs: {oauth: 'openai-subscription-oauth'}},
          },
        }),
      )
      const missing = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListModelProviders'}}))
      if (missing._ !== 'ListModelProvidersResponse') throw new Error('unexpected response')
      expect(missing.providers[0]?.authStatus).toBe('needs-login')

      // Store credentials: healthy again.
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetSecret',
            name: 'openai-subscription-oauth',
            value: new TextEncoder().encode(JSON.stringify({access: 'a', refresh: 'r', expires: 1, accountId: 'x'})),
            metadata: {provider: 'openai', kind: 'provider-oauth'},
          },
        }),
      )
      const healthy = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListModelProviders'}}))
      if (healthy._ !== 'ListModelProvidersResponse') throw new Error('unexpected response')
      expect(healthy.providers[0]?.authStatus).toBe('ok')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('deleting a subscription provider removes its OAuth secret unless still referenced', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      const secretValue = new TextEncoder().encode(
        JSON.stringify({access: 'a', refresh: 'r', expires: 1, accountId: 'x'}),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-subscription-oauth', value: secretValue},
        }),
      )
      for (const name of ['ChatGPT A', 'ChatGPT B']) {
        await svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'SetModelProvider',
              name,
              provider: {type: 'openai', authMode: 'subscription', secretRefs: {oauth: 'openai-subscription-oauth'}},
            },
          }),
        )
      }
      const secretExists = () =>
        db.query(`SELECT id FROM secrets WHERE name = 'openai-subscription-oauth'`).get() !== null

      await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteModelProvider', name: 'ChatGPT A'}}),
      )
      expect(secretExists()).toBe(true) // ChatGPT B still references it

      await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteModelProvider', name: 'ChatGPT B'}}),
      )
      expect(secretExists()).toBe(false)
    } finally {
      db.close()
      cleanup()
    }
  })

  test('lists models for a custom OpenAI-compatible provider using its configured base URL', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'local',
            provider: {type: 'custom', baseUrl: 'http://localhost:1234/v1'},
          },
        }),
      )
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        expect(String(url)).toBe('http://localhost:1234/v1/models')
        return Response.json({data: [{id: 'local-model'}]})
      }) as unknown as typeof fetch

      const models = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListProviderModels', provider: 'local'}}),
      )
      if (models._ !== 'ListProviderModelsResponse') throw new Error('unexpected response')
      expect(models.models).toEqual([{id: 'local-model', name: 'local-model'}])
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('ignores a stored base URL override for a pinned provider type', async () => {
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
      // A non-self-hosted provider may not redirect its endpoint: the spec default wins,
      // so a stored key can't be exfiltrated to an attacker host.
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', baseUrl: 'https://evil.example.com', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        expect(String(url)).toBe('https://api.openai.com/v1/models')
        return Response.json({data: [{id: 'gpt-4.1'}]})
      }) as unknown as typeof fetch

      const models = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListProviderModels', provider: 'openai'}}),
      )
      if (models._ !== 'ListProviderModelsResponse') throw new Error('unexpected response')
      expect(models.models).toEqual([{id: 'gpt-4.1', name: 'gpt-4.1'}])
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

  test('lists sessions across every agent for the signed account', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const otherAccount = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      await setDefaultProvider(svc, otherAccount)

      const createAgent = async (keyPair: typeof account, name: string) => {
        const created = await svc.message(
          await apisvc.createSignedEnvelope(keyPair, {
            action: {
              _: 'CreateAgent',
              definition: {name, systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
            },
          }),
        )
        if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
        return created.agentId
      }
      const createSession = async (keyPair: typeof account, agentId: string, title: string) => {
        const created = await svc.message(
          await apisvc.createSignedEnvelope(keyPair, {action: {_: 'CreateSession', agentId, title}}),
        )
        if (created._ !== 'CreateSessionResponse') throw new Error('unexpected response')
        return created.sessionId
      }

      const researchAgent = await createAgent(account, 'Research')
      const writingAgent = await createAgent(account, 'Writing')
      const foreignAgent = await createAgent(otherAccount, 'Someone else')

      const first = await createSession(account, researchAgent, 'First')
      const second = await createSession(account, writingAgent, 'Second')
      const third = await createSession(account, researchAgent, 'Third')
      await createSession(otherAccount, foreignAgent, 'Not mine')

      const all = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions'}}))
      expect(all._).toBe('ListSessionsResponse')
      if (all._ !== 'ListSessionsResponse') throw new Error('unexpected response')

      // Spans agents, excludes other accounts, and carries the agents needed to label each row.
      expect(all.sessions.map((session) => session.id).sort()).toEqual([first, second, third].sort())
      expect(all.sessions.every((session) => session.account === all.sessions[0]!.account)).toBe(true)
      expect(all.agents.map((agent) => agent.definition.name).sort()).toEqual(['Research', 'Writing'])
      expect(all.nextCursor).toBeUndefined()

      // Newest first.
      const updatedAts = all.sessions.map((session) => session.updatedAt)
      expect([...updatedAts].sort((a, b) => b - a)).toEqual(updatedAts)

      const scoped = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions', agentId: writingAgent}}),
      )
      if (scoped._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(scoped.sessions.map((session) => session.id)).toEqual([second])
      expect(scoped.agents.map((agent) => agent.id)).toEqual([writingAgent])

      // A short page reports a cursor; following it returns the remainder without duplicates.
      const page = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions', limit: 2}}),
      )
      if (page._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(page.sessions).toHaveLength(2)
      expect(page.nextCursor).toBeDefined()

      const rest = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions', cursor: page.nextCursor}}),
      )
      if (rest._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      const pagedIds = [...page.sessions, ...rest.sessions].map((session) => session.id)
      expect(new Set(pagedIds).size).toBe(pagedIds.length)
      expect(pagedIds.sort()).toEqual([first, second, third].sort())
    } finally {
      db.close()
      cleanup()
    }
  })

  test('paginates sessions that share an updated_at millisecond without losing rows', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const created = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Burst', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      for (const title of ['a', 'b', 'c', 'd', 'e']) {
        await svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'CreateSession', agentId: created.agentId, title},
          }),
        )
      }
      // Force the exact collision a trigger burst produces: every session updated in the same ms.
      db.run(`UPDATE sessions SET updated_at = ?`, [1_700_000_000_000])

      const seen: string[] = []
      let cursor: {updatedBefore: number; idBefore: string} | undefined
      for (let requests = 0; requests < 10; requests += 1) {
        const response = await svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: cursor ? {_: 'ListSessions', limit: 2, cursor} : {_: 'ListSessions', limit: 2},
          }),
        )
        if (response._ !== 'ListSessionsResponse') throw new Error('unexpected response')
        seen.push(...response.sessions.map((session) => session.id))
        if (!response.nextCursor) break
        cursor = response.nextCursor
      }

      // Every session is reachable exactly once even though all timestamps are identical.
      expect(seen).toHaveLength(5)
      expect(new Set(seen).size).toBe(5)
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

      // Run rows reference the agent, its session, AND its trigger firing — the real post-execution
      // state (FKs are enforced, so DeleteAgent must detach them or it 500s forever).
      db.run(
        `INSERT INTO runs (id, account_id, root_run_id, depth, kind, agent_id, session_id, trigger_firing_id,
           origin, input_cbor, status, attempt, max_attempts, queue, created_at, updated_at)
         VALUES ('run-1', ?, 'run-1', 0, 'agent', ?, ?, 'firing-1', 'trigger', ?, 'succeeded', 1, 1, 'background', ?, ?)`,
        [
          blobs.principalToString(account.principal),
          createdAgent.agentId,
          createdSession.sessionId,
          cbor.encode({}),
          Date.now(),
          Date.now(),
        ],
      )

      const deleted = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'DeleteAgent', agentId: createdAgent.agentId}}),
      )

      expect(deleted).toEqual({_: 'DeleteAgentResponse', agentId: createdAgent.agentId})
      // Run history survives, fully detached.
      const runRow = db
        .query<{agent_id: string | null; session_id: string | null; trigger_firing_id: string | null}, [string]>(
          `SELECT agent_id, session_id, trigger_firing_id FROM runs WHERE id = ?`,
        )
        .get('run-1')
      expect(runRow).toEqual({agent_id: null, session_id: null, trigger_firing_id: null})
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
              source: {
                type: 'user-mention',
                mentionedAccounts: [' z6Mkmentioned ', 'z6Mksecond', ' z6Mkmentioned '],
                resourcePrefix: ' hm://z6Mksite ',
              },
            },
          },
        }),
      )
      expect(updated._).toBe('UpdateAgentTriggerResponse')
      if (updated._ !== 'UpdateAgentTriggerResponse') throw new Error('unexpected response')
      expect(updated.trigger).toMatchObject({
        enabled: false,
        source: {
          type: 'user-mention',
          mentionedAccounts: ['z6Mkmentioned', 'z6Mksecond'],
          resourcePrefix: 'hm://z6Mksite',
        },
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
      await svc.drainTriggerSessions() // the agent run is dispatched in the background; await it before asserting
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
        expect(JSON.stringify(body.messages)).toContain('replyTo')
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
      await expect(svc.processActivityEvent(blobs.principalToString(account.principal), event)).resolves.toMatchObject({
        checked: 1,
        matched: 1,
        fired: 0,
        skipped: 1,
        errors: 0,
      })
      await svc.drainTriggerSessions() // the agent run is dispatched in the background; await it before asserting
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

  test('resolves message block embeds into the model-facing content', async () => {
    // A rich message can embed a hypermedia document. The model must read the embedded
    // content inline, not a `> [Embed: …]` placeholder link, while the transcript keeps
    // the original blocks and raw markdown for display.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
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
      const createdAgent = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {name: 'Agent', systemPrompt: 'You reply.', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const embeddedId = unpackHmId('hm://z6Mkdoc/embedded')
      if (!embeddedId) throw new Error('bad test id')
      let modelSawEmbeddedBody = false
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : String(url)
        if (href.includes('/api/Resource')) {
          return Response.json(
            serialize({
              type: 'document',
              id: embeddedId,
              document: {
                content: [
                  {
                    block: {id: 'embedded-paragraph', type: 'Paragraph', text: 'Embedded doc body', attributes: {}},
                    children: [],
                  },
                ],
                version: 'v1',
                account: 'z6Mkdoc',
                authors: [],
                path: '/embedded',
                createTime: '',
                updateTime: '',
                metadata: {name: 'Embedded Doc'},
                genesis: 'genesis',
                visibility: 'PUBLIC',
              },
            }),
          )
        }
        const body = JSON.parse(String(init?.body))
        modelSawEmbeddedBody = JSON.stringify(body.messages).includes('Embedded doc body')
        return openAIStreamResponse([
          {id: 'chat-1', choices: [{delta: {content: 'Read it'}}]},
          {id: 'chat-1', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const messageBlocks = [
        {block: {id: 'message-paragraph', type: 'Paragraph', text: 'Summarize this:', attributes: {}}, children: []},
        {block: {id: 'message-embed', type: 'Embed', link: 'hm://z6Mkdoc/embedded', attributes: {}}, children: []},
      ]
      const message = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [
              {
                type: 'text',
                text: 'Summarize this:\n\n> [Embed: hm://z6Mkdoc/embedded](hm://z6Mkdoc/embedded)',
                blocks: messageBlocks,
              },
            ],
          },
        }),
      )
      expect(message._).toBe('MessageSessionResponse')
      expect(modelSawEmbeddedBody).toBe(true)

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const userEvent = session.events[0]?.event as {content?: string; rawMarkdown?: string; blocks?: unknown}
      expect(userEvent.content).toContain('Embedded doc body')
      expect(userEvent.content).not.toContain('[Embed:')
      expect(userEvent.rawMarkdown).toContain('[Embed: hm://z6Mkdoc/embedded]')
      expect(userEvent.blocks).toEqual(messageBlocks)
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('feeds context content parts to the model but keeps them out of the transcript', async () => {
    // The desktop sidebar attaches the current window (document URL, view, focused block) as a
    // `context` part so "this document" means something to the model. The regression this guards:
    // context either leaking into the visible transcript, or being dropped before the model call —
    // both defeat the point of a typed part.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {onEvent: () => {}})
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

      const modelRequestBodies: string[] = []
      globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
        modelRequestBodies.push(String(init?.body))
        return openAIStreamResponse([
          {id: 'chat-1', choices: [{delta: {content: 'It is the plan document'}}]},
          {id: 'chat-1', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const message = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [
              {type: 'context', lines: ['## Current window', 'URL: hm://z6MkDoc/plan', 'View: document']},
              {type: 'text', text: 'What is this document?'},
            ],
          },
        }),
      )
      expect(message._).toBe('MessageSessionResponse')

      // The model saw the user text with the tagged context block appended.
      expect(modelRequestBodies.length).toBeGreaterThan(0)
      expect(modelRequestBodies[0]).toContain('What is this document?')
      expect(modelRequestBodies[0]).toContain('<window_context>')
      expect(modelRequestBodies[0]).toContain('URL: hm://z6MkDoc/plan')

      // The transcript shows only the user's words; context rides in a separate field.
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const userEvent = session.events[0]?.event as {content: string; contextLines?: string[]}
      expect(userEvent.content).toBe('What is this document?')
      expect(userEvent.content).not.toContain('window_context')
      expect(userEvent.contextLines).toEqual(['## Current window', 'URL: hm://z6MkDoc/plan', 'View: document'])

      // Context-only content is not a message.
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'MessageSession',
              sessionId: createdSession.sessionId,
              content: [{type: 'context', lines: ['## Current window']}],
            },
          }),
        ),
      ).rejects.toThrow('Message content is required')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('manual session titles stick across turns and turns persist only message events', async () => {
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

      let openAICallCount = 0
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        openAICallCount += 1
        // The deleted set_session_title tool must never reappear; the verbs are the whole surface.
        const toolNames = body.tools?.map((tool: {function?: {name?: string}}) => tool.function?.name) ?? []
        expect(toolNames).not.toContain('set_session_title')
        expect(toolNames).toContain('read')
        return openAIStreamResponse([
          {
            id: `chat-${openAICallCount}-final`,
            choices: [{delta: {content: openAICallCount === 1 ? 'Done.' : 'Still done.'}}],
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
      // No title tool and titleGeneration is off: the session stays untitled until the user names it.
      expect(session.session.title ?? null).toBeNull()
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
            'write',
            'call',
            'delegate',
            'plan',
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
                          arguments: JSON.stringify({address: 'https://example.com/docs/example'}),
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

  test('runs web_search tool calls against SearXNG and persists tool events', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      const events: apisvc.ServiceEvent[] = []
      const svc = new apisvc.Service(db, dataDir, {
        onEvent: (event) => events.push(event),
        web: {searxngUrl: 'http://searxng:8080'},
      })
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
            definition: {
              name: 'Agent',
              systemPrompt: 'prompt',
              modelProvider: 'openai',
              model: 'gpt-test',
              tools: ['web_search'],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      let searxngCalls = 0
      let searxngHref = ''
      let openAICallCount = 0
      const openAIBodies: Array<Record<string, unknown>> = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : String(url)
        if (href.includes('searxng:8080/search')) {
          searxngCalls += 1
          searxngHref = href
          return Response.json({
            results: [{url: 'https://hyper.media/', title: 'Hypermedia', content: 'snippet', engine: 'google'}],
            unresponsive_engines: [],
          })
        }

        openAICallCount += 1
        const body = JSON.parse(await fetchBodyText(url, init))
        openAIBodies.push(body)
        if (openAICallCount === 1) {
          return openAIStreamResponse([
            {id: 'chat-1', choices: [{delta: {content: 'Searching.\n'}}]},
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
                          name: 'call',
                          arguments: JSON.stringify({tool: 'web_search', input: {query: 'hypermedia'}}),
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
        return openAIStreamResponse([
          {id: 'chat-2', choices: [{delta: {content: 'Found it.'}}]},
          {id: 'chat-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Search the web'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      expect(searxngCalls).toBe(1)
      expect(searxngHref).toContain('format=json')
      expect(openAICallCount).toBeGreaterThanOrEqual(2)
      // First provider request advertises exactly the five-verb surface (delegate is run-backed).
      expect(
        (openAIBodies[0]?.tools as Array<{function?: {name?: string}}>)?.map((tool) => tool.function?.name),
      ).toEqual(['read', 'write', 'call', 'delegate', 'plan'])
      // The follow-up request carries the tool result (with the SearXNG URL) after its tool call.
      const followUpMessages = openAIBodies[1]?.messages as Array<Record<string, unknown>>
      expect(followUpMessages.some((message) => message.role === 'tool')).toBe(true)
      expect(JSON.stringify(followUpMessages)).toContain('hyper.media')
      expect(JSON.stringify(followUpMessages)).toContain('web_search')
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const toolEvents = session.events
        .map((event) => event.event as {type?: string; name?: string})
        .filter((event) => event.type === 'tool_call' || event.type === 'tool_result')
      expect(toolEvents.map((event) => `${event.type}:${event.name}`)).toEqual(['tool_call:call', 'tool_result:call'])
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
            'call',
            'delegate',
            'plan',
          ])
          expect(JSON.stringify(body.tools)).toContain('hm://<account>/<path>')
          expect(JSON.stringify(body.messages)).toContain('Writer Bot')
          expect(JSON.stringify(body.messages)).toContain('sets the visible document title')
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
                            address: `hm://${signerPublicKey}`,
                            options: {
                              action: 'profile.update',
                              signer: {profileName: 'Writer Bot'},
                              input: {name: 'Writer Bot Renamed', description: 'Publishes Seed content'},
                            },
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
                            address: `hm://${signerPublicKey}/draft-title`,
                            content:
                              '---\ntitle: Draft Title\nsummary: Draft summary\n---\n# Draft Title\n\nHello draft.',
                            options: {action: 'draft.create'},
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
                            address: `hm://${signerPublicKey}/docs`,
                            options: {
                              action: 'capability.create',
                              signer: {publicKey: signerPublicKey},
                              input: {delegate: signerPublicKey, role: 'WRITER', label: 'Docs writer'},
                            },
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
                            address: `hm://${signerPublicKey}`,
                            options: {
                              action: 'contact.create',
                              signer: {publicKey: signerPublicKey},
                              input: {subject: signerPublicKey, name: 'Self contact'},
                            },
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
                            address: `hm://${signerPublicKey}/manual-doc`,
                            content: '# Manual Doc\n\nCreated from the write verb.',
                            options: {title: 'Manual Doc', signer: {publicKey: signerPublicKey}},
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
                            address: `hm://${signerPublicKey}/manual-doc`,
                            content: 'Comment through the write verb works.',
                            options: {
                              action: 'comment',
                              signer: {publicKey: signerPublicKey},
                              replyTo: `hm://${signerPublicKey}/parent-tsid`,
                            },
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
                            address: `hm://${signerPublicKey}/manual-doc`,
                            options: {action: 'move', signer: {publicKey: signerPublicKey}, toPath: '/'},
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
                            address: `hm://${signerPublicKey}/`,
                            content: '# Home\n\nRoot document.',
                            options: {title: 'Home', signer: {publicKey: signerPublicKey}, dryRun: true},
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

  test('refuses document.create under a parent path that does not exist', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      let openAICallCount = 0
      let signerPublicKey = ''
      let publishCount = 0
      const resourceRequestUrls: string[] = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : String(url)
        if (href.includes('/api/PublishBlobs')) {
          publishCount += 1
          return Response.json(serialize({cids: [`published-${publishCount}`]}))
        }
        if (href.includes('/api/Resource')) {
          resourceRequestUrls.push(href)
          // The parent document /parent does not exist on the server.
          const resolvedId = unpackHmId(`hm://${signerPublicKey}/parent`)
          if (!resolvedId) throw new Error('bad parent id')
          return Response.json(serialize({type: 'not-found', id: resolvedId}))
        }
        if (!href.includes('/chat/completions') && !href.includes('/responses')) {
          throw new Error(`Unexpected fetch: ${href}`)
        }
        openAICallCount += 1
        if (openAICallCount === 1) {
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
                            address: `hm://${signerPublicKey}/parent/child`,
                            content: '# Child',
                            options: {title: 'Child', signer: {publicKey: signerPublicKey}},
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
        return openAIStreamResponse([
          {id: 'chat-2', choices: [{delta: {content: 'Parent is missing.'}}]},
          {id: 'chat-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
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

      const publishCountBeforeMessage = publishCount
      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Create a nested doc'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      expect(resourceRequestUrls.length).toBeGreaterThan(0)
      // The guard rejects before publishing, so the message turn must not publish any blobs.
      expect(publishCount).toBe(publishCountBeforeMessage)

      const loadedSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'GetSession', sessionId: createdSession.sessionId},
        }),
      )
      if (loadedSession._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const writeResult = loadedSession.events
        .map((event) => event.event as {type?: string; name?: string; error?: string})
        .find((event) => event.type === 'tool_result' && event.name === 'write')
      expect(writeResult?.error).toBeTruthy()
      expect(writeResult?.error).toContain('parent path /parent does not exist')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('publishes a markdown memory file as a seed document, uploading memory images and updating in place', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      let openAICallCount = 0
      let signerPublicKey = ''
      let existingVersion = ''
      const publishedBodies: Uint8Array[] = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const href = url instanceof Request ? url.url : String(url)
        if (href.includes('/api/PublishBlobs')) {
          publishedBodies.push(new Uint8Array(init?.body as ArrayBuffer))
          return Response.json(serialize({cids: [`published-${publishedBodies.length}`]}))
        }
        if (href.includes('/api/ListChanges')) {
          return Response.json(serialize({changes: [{id: existingVersion, deps: [], author: signerPublicKey}]}))
        }
        if (href.includes('/api/Resource')) {
          const resolvedId = unpackHmId(`hm://${signerPublicKey}/weekly-report`)
          if (!resolvedId) throw new Error('bad target id')
          if (!existingVersion) return Response.json(serialize({type: 'not-found', id: resolvedId}))
          return Response.json(
            serialize({
              type: 'document',
              id: resolvedId,
              document: {
                content: [{block: {id: 'b1', type: 'Paragraph', text: 'Old body'}, children: []}],
                version: existingVersion,
                account: signerPublicKey,
                authors: [signerPublicKey],
                path: '/weekly-report',
                createTime: '',
                updateTime: '',
                metadata: {name: 'Weekly Report'},
                genesis: existingVersion,
                visibility: 'PUBLIC',
              },
            }),
          )
        }
        if (!href.includes('/chat/completions') && !href.includes('/responses')) {
          throw new Error(`Unexpected fetch: ${href}`)
        }
        openAICallCount += 1
        if (openAICallCount === 1 || openAICallCount === 3) {
          return openAIStreamResponse([
            {
              id: `chat-${openAICallCount}`,
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call-${openAICallCount}`,
                        type: 'function',
                        function: {
                          name: 'write',
                          arguments: JSON.stringify({
                            address: `hm://${signerPublicKey}`,
                            options: {fromPath: '~/memory/reports/weekly.md'},
                          }),
                        },
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
          {id: `chat-${openAICallCount}`, choices: [{delta: {content: 'Published.'}}]},
          {id: `chat-${openAICallCount}`, choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
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
          action: {_: 'CreateSigningIdentity', label: 'Publisher', clientRequestId: 'publisher'},
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
              name: 'Publisher',
              systemPrompt: 'Publish memory docs.',
              modelProvider: 'openai',
              model: 'gpt-test',
              tools: ['publish'],
              signingKeys: [identity.identity.name],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      // Seed the agent's memory: a markdown file with frontmatter plus a relative image link,
      // and the binary image it points at (invalid UTF-8 so it reads back as binary).
      const memoryRoot = path.join(dataDir, 'agents', createdAgent.agentId, 'memory')
      fs.mkdirSync(path.join(memoryRoot, 'reports', 'images'), {recursive: true})
      fs.writeFileSync(
        path.join(memoryRoot, 'reports', 'weekly.md'),
        '---\nname: Weekly Report\nsummary: Week in review\n---\n# Weekly Report\n\nHello world from memory.\n\n![chart](images/chart.png)\n',
      )
      fs.writeFileSync(
        path.join(memoryRoot, 'reports', 'images', 'chart.png'),
        new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0x01, 0xfe]),
      )

      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const publishesBeforeMessage = publishedBodies.length
      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Publish the weekly report'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      expect(publishedBodies.length).toBe(publishesBeforeMessage + 1)

      const loadPublishResult = async () => {
        const loadedSession = await svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'GetSession', sessionId: createdSession.sessionId},
          }),
        )
        if (loadedSession._ !== 'GetSessionResponse') throw new Error('unexpected response')
        return loadedSession.events
          .map(
            (event) =>
              event.event as {
                type?: string
                name?: string
                output?: {command?: string; id?: string; version?: string; imagesUploaded?: number; summary?: string}
              },
          )
          .filter((event) => event.type === 'tool_result' && event.name === 'write')
      }

      const [createResult] = await loadPublishResult()
      expect(createResult?.output?.command).toBe('document.create')
      expect(createResult?.output?.id).toBe(`hm://${signerPublicKey}/weekly-report`)
      expect(createResult?.output?.imagesUploaded).toBe(1)
      expect(createResult?.output?.summary).toContain('Published reports/weekly.md')
      expect(createResult?.output?.version).toBeTruthy()

      // Published blobs hold genesis + change + ref + the image's UnixFS blob, with the
      // image link rewritten from file:// to ipfs://.
      const createBody = publishedBodies.at(-1)!
      expect(cbor.decode<{blobs: unknown[]}>(createBody).blobs.length).toBeGreaterThanOrEqual(4)
      const createBodyText = new TextDecoder('utf-8', {fatal: false}).decode(createBody)
      expect(createBodyText).toContain('Hello world from memory.')
      expect(createBodyText).toContain('ipfs://')
      expect(createBodyText).not.toContain('file://')

      // Second publish of the same file: the document now exists, so it updates in place.
      existingVersion = createResult!.output!.version!
      const followUp = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Publish it again'}],
          },
        }),
      )
      expect(followUp._).toBe('MessageSessionResponse')
      const results = await loadPublishResult()
      expect(results).toHaveLength(2)
      expect(results[1]?.output?.command).toBe('document.update')
      expect(results[1]?.output?.id).toBe(`hm://${signerPublicKey}/weekly-report`)
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('a provider outage on a delegated child retries itself and succeeds without human action', async () => {
    // Live incident: a child's turn died on a Codex 503 and the parent was left parked. Retryable
    // failures on background runs must ride out the outage on the queue's backoff.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let childCalls = 0
    try {
      const account = blobs.generateNobleKeyPair()
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        if (messagesJSON.includes('You are the worker.')) {
          childCalls += 1
          // First attempt hits an overloaded provider; the queue must try again by itself.
          // The outage must outlast the provider client's OWN retries, so the run itself fails and
          // only the queue's attempt budget can rescue it. A single 503 proves nothing here:
          // pi-ai already absorbs one of those without the run ever noticing.
          if (childCalls <= 4) return new Response('overloaded', {status: 503})
          return openAIStreamResponse([
            {id: 'child', choices: [{delta: {content: 'Worker finished the task.'}}]},
            {id: 'child', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        if (body.messages.some((message: {role?: string}) => message.role === 'tool')) {
          return openAIStreamResponse([
            {id: 'parent-2', choices: [{delta: {content: 'Worker done.'}}]},
            {id: 'parent-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {
            id: 'parent-1',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'spawn-a',
                      type: 'function',
                      function: {
                        name: 'delegate',
                        arguments: JSON.stringify({
                          title: 'Worker',
                          brief: 'Do the thing',
                          prompt: 'You are the worker.',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
          {id: 'parent-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const svc = new apisvc.Service(db, dataDir)
      const sessionId = await seedAgentSession(svc, account, 'You are the coordinator.')
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId, content: [{type: 'text', text: 'Delegate it'}]},
        }),
      )
      await svc.awaitQueueIdle()

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const result = session.events
        .map((event) => event.event as {type?: string; name?: string; output?: {status?: string}})
        .find((event) => event.type === 'tool_result' && event.name === 'delegate')
      // Nobody intervened: the child rode out the outage and answered the parent.
      expect(childCalls).toBeGreaterThan(4)
      expect(result?.output?.status).toBe('succeeded')
      const runs = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', sessionId}}))
      if (runs._ !== 'ListRunsResponse') throw new Error('unexpected response')
      const tree = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', rootRunId: runs.runs[0]!.rootRunId}}),
      )
      if (tree._ !== 'ListRunsResponse') throw new Error('unexpected response')
      const child = tree.runs.find((run) => run.depth === 1)
      expect(child?.status).toBe('succeeded')
      // The proof it was the QUEUE's doing: the same run row was claimed more than once.
      const attempts = db.query<{attempt: number}, [string]>(`SELECT attempt FROM runs WHERE id = ?`).get(child!.id)
        ?.attempt
      expect(attempts).toBeGreaterThan(1)
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  }, 30_000)

  test('a later run on a typed child session still holds the contract: return_result, its schema, its parent', async () => {
    // The spec rides the SPAWNING run's input. A retry or a new message creates a run without it,
    // and before this the child lost the schema, the tool, and the way to answer its parent — it
    // could never fulfil the contract, and said so ("No return_result tool is available").
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const schema = {
      type: 'object',
      required: ['notes'],
      properties: {notes: {type: 'string'}},
      additionalProperties: false,
    }
    let sawReturnResultTool = false
    let rejectedOnce = false
    try {
      const account = blobs.generateNobleKeyPair()
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        const toolNames: string[] = (body.tools ?? []).map((tool: any) => tool?.function?.name)
        if (messagesJSON.includes('You are the researcher.')) {
          if (toolNames.includes('return_result')) sawReturnResultTool = true
          // The later run is asked to deliver. First try a payload that violates the ORIGINAL
          // schema — proving the schema came back with the tool — then a valid one.
          if (messagesJSON.includes('deliver your result')) {
            if (!rejectedOnce) {
              rejectedOnce = true
              return openAIStreamResponse([
                {
                  id: 'late-1',
                  choices: [
                    {
                      delta: {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'rr-bad',
                            type: 'function',
                            function: {name: 'return_result', arguments: JSON.stringify({wrong: 1})},
                          },
                        ],
                      },
                    },
                  ],
                },
                {id: 'late-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
              ])
            }
            return openAIStreamResponse([
              {
                id: 'late-2',
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'rr-good',
                          type: 'function',
                          function: {
                            name: 'return_result',
                            arguments: JSON.stringify({notes: 'SQLite began in 2000.'}),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {id: 'late-2', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
            ])
          }
          // The original run: answer as prose and never call return_result, exactly as it happened.
          return openAIStreamResponse([
            {id: 'child', choices: [{delta: {content: 'Here are my notes as text.'}}]},
            {id: 'child', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        if (body.messages.some((message: {role?: string}) => message.role === 'tool')) {
          return openAIStreamResponse([
            {id: 'parent-2', choices: [{delta: {content: 'Understood.'}}]},
            {id: 'parent-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {
            id: 'parent-1',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'spawn-typed',
                      type: 'function',
                      function: {
                        name: 'delegate',
                        arguments: JSON.stringify({
                          title: 'Research SQLite history',
                          brief: 'Research SQLite history',
                          prompt: 'You are the researcher.',
                          output: schema,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
          {id: 'parent-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const svc = new apisvc.Service(db, dataDir)
      const parentSessionId = await seedAgentSession(svc, account, 'You are the coordinator.')
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId: parentSessionId, content: [{type: 'text', text: 'Research it'}]},
        }),
      )
      await svc.awaitQueueIdle()

      // The child ended without delivering: its run failed and the parent already has that answer.
      const children = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ListSessions', parentSessionId},
        }),
      )
      if (children._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      const childSessionId = children.sessions[0]!.id
      const parentBefore = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: parentSessionId}}),
      )
      if (parentBefore._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const failedResults = parentBefore.events
        .map((event) => event.event as {type?: string; name?: string; output?: {status?: string}})
        .filter((event) => event.type === 'tool_result' && event.name === 'delegate')
      expect(failedResults).toHaveLength(1)
      expect(failedResults[0]?.output?.status).toBe('failed')

      // A new run on that child session — the recovery a human would reach for.
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: childSessionId,
            content: [{type: 'text', text: 'Please deliver your result now'}],
          },
        }),
      )
      await svc.awaitQueueIdle()

      // The contract came back: the tool was offered, and the ORIGINAL schema rejected a bad payload.
      expect(sawReturnResultTool).toBe(true)
      expect(rejectedOnce).toBe(true)
      const childRuns = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', sessionId: childSessionId}}),
      )
      if (childRuns._ !== 'ListRunsResponse') throw new Error('unexpected response')
      const latest = childRuns.runs.find((run) => run.status === 'succeeded')
      expect(latest).toBeTruthy()
      const child = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: childSessionId}}),
      )
      if (child._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const delivered = child.events
        .map((event) => event.event as {type?: string; name?: string; input?: {notes?: string}})
        .filter((event) => event.type === 'tool_call' && event.name === 'return_result')
      expect(delivered.at(-1)?.input?.notes).toBe('SQLite began in 2000.')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  }, 30_000)

  test('a late result whose parent already moved on is logged honestly, not forced onto the parent', async () => {
    // Same construction as above; here the assertion is the PARENT side. Its call was answered by
    // the child's failure, so a late success must not rewrite history — and must not vanish either.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        if (messagesJSON.includes('You are the researcher.')) {
          if (messagesJSON.includes('deliver your result')) {
            return openAIStreamResponse([
              {
                id: 'late',
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'rr',
                          type: 'function',
                          function: {name: 'return_result', arguments: JSON.stringify({notes: 'late but valid'})},
                        },
                      ],
                    },
                  },
                ],
              },
              {id: 'late', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
            ])
          }
          return openAIStreamResponse([
            {id: 'child', choices: [{delta: {content: 'Prose, not a result.'}}]},
            {id: 'child', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        if (body.messages.some((message: {role?: string}) => message.role === 'tool')) {
          return openAIStreamResponse([
            {id: 'parent-2', choices: [{delta: {content: 'Noted.'}}]},
            {id: 'parent-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {
            id: 'parent-1',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'spawn-typed',
                      type: 'function',
                      function: {
                        name: 'delegate',
                        arguments: JSON.stringify({
                          title: 'Researcher',
                          brief: 'Research',
                          prompt: 'You are the researcher.',
                          output: {
                            type: 'object',
                            required: ['notes'],
                            properties: {notes: {type: 'string'}},
                            additionalProperties: false,
                          },
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
          {id: 'parent-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const svc = new apisvc.Service(db, dataDir)
      const parentSessionId = await seedAgentSession(svc, account, 'You are the coordinator.')
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId: parentSessionId, content: [{type: 'text', text: 'Research it'}]},
        }),
      )
      await svc.awaitQueueIdle()
      const children = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions', parentSessionId}}),
      )
      if (children._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      const childSessionId = children.sessions[0]!.id

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: childSessionId,
            content: [{type: 'text', text: 'Please deliver your result now'}],
          },
        }),
      )
      await svc.awaitQueueIdle()

      // The parent keeps exactly one delegate result, still the original failure — no duplicate,
      // no rewrite, and no exception thrown on the delivery path.
      const parent = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: parentSessionId}}),
      )
      if (parent._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const results = parent.events
        .map((event) => event.event as {type?: string; name?: string; output?: {status?: string}})
        .filter((event) => event.type === 'tool_result' && event.name === 'delegate')
      expect(results).toHaveLength(1)
      expect(results[0]?.output?.status).toBe('failed')

      // And the child's log says plainly that the valid result went nowhere.
      const child = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: childSessionId}}),
      )
      if (child._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const notes = child.events
        .map((event) => event.event as {type?: string; message?: string})
        .filter((event) => event.type === 'error' && event.message?.includes('already stopped waiting'))
      expect(notes).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  }, 30_000)

  test('a parallel batch stamps every child with the running step id, stable across a rename', async () => {
    // The model's plan verb writes the SESSION plan, not the run plan. Stamping used to read only
    // the run plan, so model children were never labeled and the UI attached them by the accident
    // of a child's title matching a step label — which fails exactly when one step names a batch.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    const BATCH_STEP = 'Research both databases'
    const RENAMED_STEP = 'Research SQLite and PostgreSQL in parallel'
    let renamedPlan = false
    try {
      const account = blobs.generateNobleKeyPair()
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        if (!messagesJSON.includes('You are the batcher.')) {
          return openAIStreamResponse([
            {id: 'child', choices: [{delta: {content: 'Child finished the task.'}}]},
            {id: 'child', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        if (body.messages.some((message: {role?: string}) => message.role === 'tool')) {
          // Resuming: rewrite the step's LABEL while keeping its id. Agents rephrase their plans
          // constantly, which is exactly what makes a stamped label useless as a join key.
          if (!renamedPlan) {
            renamedPlan = true
            return openAIStreamResponse([
              {
                id: 'parent-2',
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'plan-2',
                          type: 'function',
                          function: {
                            name: 'plan',
                            arguments: JSON.stringify({
                              steps: [
                                {id: 's1', label: RENAMED_STEP, status: 'done'},
                                {id: 's2', label: 'Combine findings', status: 'running'},
                              ],
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {id: 'parent-2', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
            ])
          }
          return openAIStreamResponse([
            {id: 'parent-3', choices: [{delta: {content: 'Both done.'}}]},
            {id: 'parent-3', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        // One reply: name the batch step running, then fan out two children under it.
        return openAIStreamResponse([
          {
            id: 'parent-1',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'plan-1',
                      type: 'function',
                      function: {
                        name: 'plan',
                        arguments: JSON.stringify({
                          steps: [
                            {id: 's1', label: BATCH_STEP, status: 'running'},
                            {id: 's2', label: 'Combine findings', status: 'pending'},
                          ],
                        }),
                      },
                    },
                    {
                      index: 1,
                      id: 'spawn-a',
                      type: 'function',
                      function: {
                        name: 'delegate',
                        arguments: JSON.stringify({
                          title: 'SQLite strengths',
                          brief: 'List SQLite strengths',
                          prompt: 'You are a worker.',
                        }),
                      },
                    },
                    {
                      index: 2,
                      id: 'spawn-b',
                      type: 'function',
                      function: {
                        name: 'delegate',
                        arguments: JSON.stringify({
                          title: 'Postgres strengths',
                          brief: 'List Postgres strengths',
                          prompt: 'You are a worker.',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
          {id: 'parent-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

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
            definition: {
              name: 'Batcher',
              systemPrompt: 'You are the batcher.',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Research both in parallel'}],
          },
        }),
      )
      await svc.awaitQueueIdle()

      const rootRuns = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', sessionId: createdSession.sessionId}}),
      )
      if (rootRuns._ !== 'ListRunsResponse') throw new Error('unexpected response')
      const tree = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', rootRunId: rootRuns.runs[0]!.rootRunId}}),
      )
      if (tree._ !== 'ListRunsResponse') throw new Error('unexpected response')
      const children = tree.runs.filter((run) => run.depth === 1)
      expect(children).toHaveLength(2)
      // Both children belong to the one running step — a step owns a whole batch, not one child.
      expect(children.map((run) => run.stepLabel)).toEqual([BATCH_STEP, BATCH_STEP])
      // And the labels are real step labels, not echoes of the child titles (ListRuns order is not
      // part of this contract, so compare the set).
      expect(children.map((run) => run.title).sort()).toEqual(['Postgres strengths', 'SQLite strengths'])

      // The id is the durable join. The agent renamed the step on its resume turn, so the stamped
      // LABEL is now stale — it names no step in the plan — while the stamped ID still resolves.
      expect(renamedPlan).toBe(true)
      expect(children.map((run) => run.planStepId)).toEqual(['s1', 's1'])
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const steps = session.session.plan?.steps ?? []
      expect(steps.map((step) => step.label)).toEqual([RENAMED_STEP, 'Combine findings'])
      for (const child of children) {
        expect(steps.some((step) => step.id === child.planStepId)).toBe(true)
        expect(steps.some((step) => step.label === child.stepLabel)).toBe(false)
      }
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })

  test('delegate {await: false} starts a detached session of the same agent that auto-runs the brief', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    try {
      const account = blobs.generateNobleKeyPair()
      let openAICallCount = 0
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        const href = url instanceof Request ? url.url : String(url)
        if (!href.includes('/chat/completions') && !href.includes('/responses')) {
          throw new Error(`Unexpected fetch: ${href}`)
        }
        openAICallCount += 1
        if (openAICallCount === 1) {
          // Parent turn: delegate twice — default title from the prompt's first line, and explicit title.
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
                          name: 'delegate',
                          arguments: JSON.stringify({
                            brief: 'Research the flux capacitor and write notes.\nCover the 1985 archives.',
                            await: false,
                          }),
                        },
                      },
                      {
                        index: 1,
                        id: 'call-2',
                        type: 'function',
                        function: {
                          name: 'delegate',
                          arguments: JSON.stringify({
                            brief: 'Summarize the archives.',
                            title: 'Archive summary',
                            await: false,
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
        return openAIStreamResponse([
          {id: `chat-${openAICallCount}`, choices: [{delta: {content: 'Done.'}}]},
          {id: `chat-${openAICallCount}`, choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

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
            definition: {
              name: 'Delegator',
              systemPrompt: 'Delegate work.',
              modelProvider: 'openai',
              model: 'gpt-test',
              tools: ['read'],
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
            content: [{type: 'text', text: 'Delegate the research'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')

      // Both tool results carry the new session ids before the background runs finish.
      const parentSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (parentSession._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const startResults = parentSession.events
        .map((event) => event.event as {type?: string; name?: string; output?: {sessionId?: string; title?: string}})
        .filter((event) => event.type === 'tool_result' && event.name === 'delegate')
      expect(startResults).toHaveLength(2)
      expect(startResults[0]?.output?.title).toBe('Research the flux capacitor and write notes.')
      expect(startResults[1]?.output?.title).toBe('Archive summary')
      const childIds = startResults.map((result) => result.output?.sessionId)
      expect(childIds[0]).toBeTruthy()
      expect(childIds[1]).toBeTruthy()
      expect(childIds[0]).not.toBe(childIds[1])

      // The spawned sessions auto-run: after draining background runs, each child holds the
      // provided prompt as its first user message plus a completed assistant reply.
      await svc.drainTriggerSessions()
      expect(openAICallCount).toBe(4)
      for (const [index, childId] of childIds.entries()) {
        const child = await svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: childId!}}),
        )
        if (child._ !== 'GetSessionResponse') throw new Error('unexpected response')
        expect(child.session.agentId).toBe(createdAgent.agentId)
        expect(child.session.status).toBe('idle')
        const events = child.events.map((event) => event.event as {type?: string; role?: string; content?: string})
        expect(events[0]).toMatchObject({
          type: 'message',
          role: 'user',
          content:
            index === 0
              ? 'Research the flux capacitor and write notes.\nCover the 1985 archives.'
              : 'Summarize the archives.',
        })
        expect(events.some((event) => event.type === 'message' && event.role === 'assistant')).toBe(true)
      }

      // Agent-started sessions carry durable lineage now: the top-level list shows only the parent
      // (with a child count); children list under it or via includeChildren.
      // Default (legacy clients): every session, so older desktops keep seeing agent-started work.
      const listed = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions'}}))
      if (listed._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(listed.sessions).toHaveLength(3)
      // Lineage-aware clients exclude children explicitly and nest them via childSessionCount.
      const topOnly = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions', includeChildren: false}}),
      )
      if (topOnly._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(topOnly.sessions).toHaveLength(1)
      expect(topOnly.sessions[0]?.childSessionCount).toBe(2)
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

  test('accepts a reasoning level the model supports and persists it', async () => {
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
              name: 'Reasoner',
              systemPrompt: 'ok',
              modelProvider: 'openai',
              model: 'gpt-5.6-terra',
              reasoningLevel: 'xhigh',
            },
          },
        }),
      )
      expect(create._).toBe('CreateAgentResponse')
      const list = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'ListAgents'}}))
      if (list._ !== 'ListAgentsResponse') throw new Error('unexpected response')
      expect(list.agents[0]?.definition.reasoningLevel).toBe('xhigh')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('rejects reasoning levels the model does not accept', async () => {
    const {db, dataDir, cleanup} = createTestState()
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir)
      await setDefaultProvider(svc, account)
      const createAgent = async (model: string, reasoningLevel: string) =>
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'CreateAgent',
              definition: {
                name: 'Reasoner',
                systemPrompt: 'ok',
                modelProvider: 'openai',
                model,
                reasoningLevel,
              } as never,
            },
          }),
        )
      // gpt-5-mini accepts minimal..high but not xhigh.
      await expect(createAgent('gpt-5-mini', 'xhigh')).rejects.toThrow('does not support reasoning level')
      // gpt-5.6 dropped minimal.
      await expect(createAgent('gpt-5.6-terra', 'minimal')).rejects.toThrow('does not support reasoning level')
      // Non-reasoning models take no level at all.
      await expect(createAgent('gpt-4.1', 'high')).rejects.toThrow('does not support a reasoning level')
      // Unknown enum values are rejected before the model check.
      await expect(createAgent('gpt-5.6-terra', 'maximum')).rejects.toThrow('Reasoning level is invalid')
    } finally {
      db.close()
      cleanup()
    }
  })

  test('restoreReasoningEffort reasserts the validated level on clamped payloads', () => {
    const definition = {
      name: 'a',
      systemPrompt: 'ok',
      modelProvider: 'openai',
      model: 'gpt-5.6-terra',
      reasoningLevel: 'xhigh',
    } as never
    expect(
      apisvc.restoreReasoningEffort({model: 'gpt-5.6-terra', reasoning: {effort: 'high', summary: 'auto'}}, definition),
    ).toEqual({model: 'gpt-5.6-terra', reasoning: {effort: 'xhigh', summary: 'auto'}})
    // Payloads without a reasoning object (level off, non-OpenAI providers) pass through untouched.
    const plain = {model: 'gpt-5.6-terra'}
    expect(apisvc.restoreReasoningEffort(plain, {...(definition as object), reasoningLevel: undefined} as never)).toBe(
      plain,
    )
    expect(apisvc.restoreReasoningEffort(plain, definition)).toBe(plain)
  })

  test('delegate fan-out parks the parent and child results resume it', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      svc = new apisvc.Service(db, dataDir, {})
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
            definition: {
              name: 'Coordinator',
              systemPrompt: 'You are the coordinator.',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const parentRequests: string[] = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        const isParent = messagesJSON.includes('You are the coordinator.')
        if (isParent) {
          parentRequests.push(messagesJSON)
          expect(messagesJSON).not.toContain('"status":"spawned"')
          const hasResults = body.messages.some((message: {role?: string}) => message.role === 'tool')
          if (!hasResults) {
            return openAIStreamResponse([
              {
                id: 'parent-1',
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'spawn-a',
                          type: 'function',
                          function: {
                            name: 'delegate',
                            arguments: JSON.stringify({
                              title: 'Worker A',
                              prompt: 'You are worker Alpha.',
                              brief: 'Summarize topic A',
                            }),
                          },
                        },
                        {
                          index: 1,
                          id: 'spawn-b',
                          type: 'function',
                          function: {
                            name: 'delegate',
                            arguments: JSON.stringify({
                              title: 'Worker B',
                              prompt: 'You are worker Beta.',
                              input: {topic: 'B'},
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {id: 'parent-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
            ])
          }
          expectToolResultHasPrecedingToolCall(body.messages, 'delegate')
          expect(messagesJSON).toContain('Alpha finished')
          expect(messagesJSON).toContain('Beta finished')
          return openAIStreamResponse([
            {id: 'parent-2', choices: [{delta: {content: 'All workers finished.'}}]},
            {id: 'parent-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        const worker = messagesJSON.includes('worker Alpha') ? 'Alpha' : 'Beta'
        return openAIStreamResponse([
          {id: `child-${worker}`, choices: [{delta: {content: `${worker} finished the task.`}}]},
          {id: `child-${worker}`, choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Fan out workers A and B'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      await svc.awaitQueueIdle()

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      const types = session.events.map((event) => (event.event as {type?: string}).type)
      expect(types.filter((type) => type === 'tool_call')).toHaveLength(2)
      expect(types.filter((type) => type === 'tool_result')).toHaveLength(2)
      expect(session.events.at(-1)?.event).toEqual({
        type: 'message',
        role: 'assistant',
        content: 'All workers finished.',
      })
      const resultEvents = session.events
        .map((event) => event.event as {type?: string; output?: {status?: string; output?: {text?: string}}})
        .filter((event) => event.type === 'tool_result')
      for (const result of resultEvents) {
        expect(result.output?.status).toBe('succeeded')
        expect(result.output?.output?.text).toContain('finished the task')
      }
      expect(parentRequests).toHaveLength(2)

      // Lineage: children exist, are excluded from the top-level list, and list under their parent.
      const topLevel = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListSessions', includeChildren: false}}),
      )
      if (topLevel._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(topLevel.sessions).toHaveLength(1)
      expect(topLevel.sessions[0]?.childSessionCount).toBe(2)
      // Title generation is a server opt-in (off here), and the model never called
      // any title tool (there is none) — the session legitimately stays untitled in this configuration.
      expect(topLevel.sessions[0]?.title).toBeUndefined()
      const children = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ListSessions', parentSessionId: createdSession.sessionId},
        }),
      )
      if (children._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(children.sessions).toHaveLength(2)
      for (const child of children.sessions) {
        expect(child.parentSessionId).toBe(createdSession.sessionId)
        expect(child.runId).toBeDefined()
      }
      // The child transcript opens with the parent's briefing VERBATIM — reviewing a sub-agent's
      // context must show exactly what the parent wrote (markdown strings), never a reworded
      // envelope; non-string inputs degrade to a bare fenced JSON block.
      const childFirstMessages = new Map<string, string>()
      for (const child of children.sessions) {
        const childSession = await svc.message(
          await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: child.id}}),
        )
        if (childSession._ !== 'GetSessionResponse') throw new Error('unexpected response')
        const first = childSession.events[0]?.event as {role?: string; content?: string}
        expect(first?.role).toBe('user')
        childFirstMessages.set(child.title ?? '', first?.content ?? '')
      }
      expect(childFirstMessages.get('Worker A')).toBe('Summarize topic A')
      expect(childFirstMessages.get('Worker B')).toBe('```json\n{\n  "topic": "B"\n}\n```')

      // Run tree: one root (succeeded) with two succeeded children.
      const rootRuns = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ListRuns', sessionId: createdSession.sessionId},
        }),
      )
      if (rootRuns._ !== 'ListRunsResponse') throw new Error('unexpected response')
      expect(rootRuns.runs).toHaveLength(1)
      const root = rootRuns.runs[0]!
      expect(root.status).toBe('succeeded')
      const tree = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', rootRunId: root.id}}),
      )
      if (tree._ !== 'ListRunsResponse') throw new Error('unexpected response')
      expect(tree.runs).toHaveLength(3)
      expect(tree.runs.filter((run) => run.depth === 1)).toHaveLength(2)
      // Each child names the delegate call that spawned it, which is what lets that call's row in
      // the transcript find its child — including while the child is still working.
      const spawnCallIds = session.events
        .map((event) => event.event as {type?: string; id?: string; name?: string})
        .filter((event) => event.type === 'tool_call' && event.name === 'delegate')
        .map((event) => event.id)
      expect(spawnCallIds).toHaveLength(2)
      expect(
        tree.runs
          .filter((run) => run.depth === 1)
          .map((run) => run.parentToolCallId)
          .sort(),
      ).toEqual([...spawnCallIds].sort())
      expect(tree.runs.find((run) => run.depth === 0)?.parentToolCallId).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('typed delegate: return_result validation bounces back, then the payload resolves the parent', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      svc = new apisvc.Service(db, dataDir, {})
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
            definition: {
              name: 'Typed',
              systemPrompt: 'You are the coordinator.',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      let childCalls = 0
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        if (messagesJSON.includes('You are the coordinator.')) {
          const hasResults = body.messages.some((message: {role?: string}) => message.role === 'tool')
          if (!hasResults) {
            return openAIStreamResponse([
              {
                id: 'parent-1',
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: 'spawn-typed',
                          type: 'function',
                          function: {
                            name: 'delegate',
                            arguments: JSON.stringify({
                              title: 'Scorer',
                              prompt: 'You are a scorer.',
                              input: 'Score this',
                              output: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['answer', 'confidence'],
                                properties: {answer: {type: 'string'}, confidence: {type: 'number'}},
                              },
                            }),
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              {id: 'parent-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
            ])
          }
          // The tool_result rides as stringified JSON inside a message string, so quotes are escaped.
          expect(messagesJSON).toContain('forty-two')
          return openAIStreamResponse([
            {id: 'parent-2', choices: [{delta: {content: 'Score received.'}}]},
            {id: 'parent-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        // Child (scorer): the return_result tool must be exposed; deliver invalid then valid.
        childCalls += 1
        const toolNames = body.tools?.map((tool: {function?: {name?: string}}) => tool.function?.name) ?? []
        expect(toolNames).toContain('return_result')
        const payload = childCalls === 1 ? {answer: 42} : {answer: 'forty-two', confidence: 0.9}
        return openAIStreamResponse([
          {
            id: `child-${childCalls}`,
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `deliver-${childCalls}`,
                      type: 'function',
                      function: {name: 'return_result', arguments: JSON.stringify(payload)},
                    },
                  ],
                },
              },
            ],
          },
          {id: `child-${childCalls}`, choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Get me a typed score'}],
          },
        }),
      )
      await svc.awaitQueueIdle()

      expect(childCalls).toBe(2)
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const result = session.events
        .map((event) => event.event as {type?: string; output?: {status?: string; output?: unknown}})
        .find((event) => event.type === 'tool_result')
      expect(result?.output?.status).toBe('succeeded')
      expect(result?.output?.output).toEqual({answer: 'forty-two', confidence: 0.9})
      expect(session.events.at(-1)?.event).toEqual({type: 'message', role: 'assistant', content: 'Score received.'})
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('a parked parent still converses: new messages answer immediately, the resume queues behind them', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      svc = new apisvc.Service(db, dataDir, {})
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
            definition: {
              name: 'Conversant',
              systemPrompt: 'You are the coordinator.',
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
      const sessionId = createdSession.sessionId

      let releaseChild: () => void = () => {}
      const childGate = new Promise<void>((resolve) => {
        releaseChild = resolve
      })
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const system = String((body.messages?.[0] as {content?: string} | undefined)?.content ?? '')
        const messagesJSON = JSON.stringify(body.messages)
        if (system.includes('worker Alpha')) {
          await childGate // the sub-session runs "for a long time"
          return openAIStreamResponse([
            {id: 'child', choices: [{delta: {content: 'Alpha done: report attached.'}}]},
            {id: 'child', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        if (messagesJSON.includes('Alpha done')) {
          // The resume, after the real result landed — sees the interleaved chat too.
          expectToolResultHasPrecedingToolCall(body.messages, 'delegate')
          expect(messagesJSON).toContain('Quick answer')
          return openAIStreamResponse([
            {id: 'resume', choices: [{delta: {content: 'The background research is finished.'}}]},
            {id: 'resume', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        if (messagesJSON.includes('are you still there')) {
          // The mid-park turn: provider-legal transcript with a synthetic pending result adjacent
          // to the spawn call, telling the model to answer now rather than wait.
          expectToolResultHasPrecedingToolCall(body.messages, 'delegate')
          expect(messagesJSON).toContain('Still running in the background')
          return openAIStreamResponse([
            {id: 'mid', choices: [{delta: {content: 'Quick answer: yes, the research is still running.'}}]},
            {id: 'mid', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {
            id: 'spawn',
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'spawn-alpha',
                      type: 'function',
                      function: {
                        name: 'delegate',
                        arguments: JSON.stringify({
                          title: 'Research',
                          prompt: 'REPRO you are worker Alpha.',
                          input: 'research the thing',
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
          {id: 'spawn', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      // Turn 1 parks on the slow sub-session.
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId, content: [{type: 'text', text: 'go research the thing'}]},
        }),
      )
      let session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      // Parked is NOT stalled: the mirror reports idle so the composer stays open.
      expect(session.session.status).toBe('idle')

      // A new message while parked answers immediately — no 409, no queueing behind the workflow.
      const midResponse = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId, content: [{type: 'text', text: 'hey, are you still there?'}]},
        }),
      )
      expect(midResponse._).toBe('MessageSessionResponse')
      session = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}))
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect((session.events.at(-1)?.event as {content?: string}).content).toContain('Quick answer')

      // The workflow finishes: its resume queues and then delivers the final word.
      releaseChild()
      await svc.awaitQueueIdle()
      session = await svc.message(await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}))
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      const contents = session.events.map((event) => {
        const value = event.event as {type?: string; role?: string; content?: string; toolCallId?: string}
        return value.type === 'message' ? `${value.role}:${(value.content ?? '').slice(0, 24)}` : value.type
      })
      expect(contents).toEqual([
        'user:go research the thing',
        'tool_call',
        'user:hey, are you still there',
        'assistant:Quick answer: yes, the r',
        'tool_result',
        'assistant:The background research ',
      ])
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('restart while parked: a queued child executes after reboot and resumes the waiting parent', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      const boot = new apisvc.Service(db, dataDir, {})
      await boot.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')},
        }),
      )
      await boot.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'SetModelProvider',
            name: 'openai',
            provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}},
          },
        }),
      )
      const createdAgent = await boot.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'CreateAgent',
            definition: {
              name: 'Parker',
              systemPrompt: 'You are the coordinator.',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdParent = await boot.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdParent._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const createdChild = await boot.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdChild._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      boot.stopRunQueue()
      const accountId = blobs.principalToString(account.principal)

      // Forge the parked state a crash could leave behind: parent waiting on one child that never ran.
      const now = Date.now()
      const putEvent = (sessionId: string, seq: number, event: unknown) =>
        db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
          crypto.randomUUID(),
          sessionId,
          seq,
          cbor.encode(event),
          now,
        ])
      putEvent(createdParent.sessionId, 1, {type: 'message', role: 'user', content: 'Delegate the work'})
      putEvent(createdParent.sessionId, 2, {
        type: 'tool_call',
        id: 'spawn-1',
        name: 'delegate',
        input: {title: 'Worker', prompt: 'You are worker Alpha.', input: 'Do the thing'},
      })
      putEvent(createdChild.sessionId, 1, {type: 'message', role: 'user', content: 'Do the thing'})
      db.run(
        `INSERT INTO runs (id, account_id, root_run_id, depth, kind, agent_id, session_id, origin, input_cbor,
           status, wait_cbor, attempt, max_attempts, queue, created_at, started_at, updated_at)
         VALUES ('parent-run', ?, 'parent-run', 0, 'agent', ?, ?, 'user', ?, 'waiting', ?, 1, 1, 'interactive', ?, ?, ?)`,
        [
          accountId,
          createdAgent.agentId,
          createdParent.sessionId,
          cbor.encode({}),
          cbor.encode({reason: 'children', toolCallIds: ['spawn-1']}),
          now,
          now,
          now,
        ],
      )
      db.run(
        `INSERT INTO runs (id, account_id, root_run_id, parent_run_id, depth, kind, agent_id, session_id, origin,
           input_cbor, status, attempt, max_attempts, queue, created_at, updated_at)
         VALUES ('child-run', ?, 'parent-run', 'parent-run', 1, 'agent', ?, ?, 'agent', ?, 'queued', 0, 2, 'background', ?, ?)`,
        [
          accountId,
          createdAgent.agentId,
          createdChild.sessionId,
          cbor.encode({
            spec: {title: 'Worker', prompt: 'You are worker Alpha.', input: 'Do the thing'},
            parentToolCallId: 'spawn-1',
          }),
          now,
          now,
        ],
      )
      db.run(`UPDATE sessions SET parent_session_id = ?, run_id = 'child-run' WHERE id = ?`, [
        createdParent.sessionId,
        createdChild.sessionId,
      ])

      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const messagesJSON = JSON.stringify(body.messages)
        // Route on the system message: the parent transcript also mentions the child prompt
        // (inside the delegate tool_call arguments), so a substring match anywhere is wrong.
        const system = String((body.messages?.[0] as {content?: string} | undefined)?.content ?? '')
        if (system.includes('worker Alpha')) {
          return openAIStreamResponse([
            {id: 'child', choices: [{delta: {content: 'Alpha finished after reboot.'}}]},
            {id: 'child', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        expectToolResultHasPrecedingToolCall(body.messages, 'delegate')
        expect(messagesJSON).toContain('Alpha finished after reboot')
        return openAIStreamResponse([
          {id: 'parent', choices: [{delta: {content: 'Resumed and done.'}}]},
          {id: 'parent', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      // "Restart": the queued child dispatches at boot; its result wakes the waiting parent.
      svc = new apisvc.Service(db, dataDir, {})
      await svc.awaitQueueIdle()

      const parentRun = db.query<{status: string}, [string]>(`SELECT status FROM runs WHERE id = ?`).get('parent-run')
      expect(parentRun?.status).toBe('succeeded')
      const childRun = db.query<{status: string}, [string]>(`SELECT status FROM runs WHERE id = ?`).get('child-run')
      expect(childRun?.status).toBe('succeeded')
      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdParent.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      expect(session.events.at(-1)?.event).toEqual({type: 'message', role: 'assistant', content: 'Resumed and done.'})
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('delegate {script}: a model-authored script calls verbs, spawns a sub-agent, and resolves the parent', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      svc = new apisvc.Service(db, dataDir, {})
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
            definition: {
              name: 'Orchestrator',
              systemPrompt: 'You are the orchestrator.',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      const workflowSource = [
        'export default async function (input, ctx) {',
        "  await ctx.plan({title: 'Demo', steps: [{id: 'write', label: 'Write note', status: 'pending'}]})",
        "  await ctx.step('Write note', function () {",
        "    return ctx.call('write', {address: '~/memory/notes/wf.txt', content: input.note})",
        '  })',
        "  const worker = await ctx.agent({title: 'Worker', prompt: 'You are worker Gamma.', input: 'Say hi'})",
        "  await ctx.log('info', 'worker replied')",
        '  return {note: input.note, worker: worker.text}',
        '}',
      ].join('\n')

      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const system = String((body.messages?.[0] as {content?: string} | undefined)?.content ?? '')
        if (system.includes('worker Gamma')) {
          return openAIStreamResponse([
            {id: 'gamma', choices: [{delta: {content: 'Gamma says hi.'}}]},
            {id: 'gamma', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        const hasResults = body.messages.some((message: {role?: string}) => message.role === 'tool')
        if (!hasResults) {
          return openAIStreamResponse([
            {
              id: 'orc-1',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'wf-call',
                        type: 'function',
                        function: {
                          name: 'delegate',
                          arguments: JSON.stringify({
                            title: 'Demo workflow',
                            script: workflowSource,
                            input: {note: 'hello from the workflow'},
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {id: 'orc-1', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
          ])
        }
        const messagesJSON = JSON.stringify(body.messages)
        expect(messagesJSON).toContain('Gamma says hi')
        expect(messagesJSON).toContain('hello from the workflow')
        return openAIStreamResponse([
          {id: 'orc-2', choices: [{delta: {content: 'Workflow complete.'}}]},
          {id: 'orc-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Run the demo workflow'}],
          },
        }),
      )
      await svc.awaitQueueIdle()

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      expect(session.events.at(-1)?.event).toEqual({type: 'message', role: 'assistant', content: 'Workflow complete.'})
      const workflowResult = session.events
        .map(
          (event) =>
            event.event as {type?: string; output?: {status?: string; output?: {note?: string; worker?: string}}},
        )
        .find((event) => event.type === 'tool_result')
      expect(workflowResult?.output?.status).toBe('succeeded')
      expect(workflowResult?.output?.output?.note).toBe('hello from the workflow')
      expect(workflowResult?.output?.output?.worker).toBe('Gamma says hi.')

      // The run tree: chat root → workflow child → worker grandchild; the workflow has a journal and plan.
      const rootRuns = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', sessionId: createdSession.sessionId}}),
      )
      if (rootRuns._ !== 'ListRunsResponse') throw new Error('unexpected response')
      const tree = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'ListRuns', rootRunId: rootRuns.runs[0]!.id}}),
      )
      if (tree._ !== 'ListRunsResponse') throw new Error('unexpected response')
      expect(tree.runs).toHaveLength(3)
      const workflowRun = tree.runs.find((run) => run.kind === 'workflow')
      expect(workflowRun?.status).toBe('succeeded')
      expect(workflowRun?.plan?.steps).toEqual([{id: 'write', label: 'Write note', status: 'done'}])
      const journal = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetRunJournal', runId: workflowRun!.id}}),
      )
      if (journal._ !== 'GetRunJournalResponse') throw new Error('unexpected response')
      const kinds = journal.entries.map((entry) => entry.entry.kind)
      expect(kinds).toContain('plan')
      expect(kinds).toContain('step')
      expect(kinds).toContain('call')
      expect(kinds).toContain('result')
      expect(kinds).toContain('log')
      // The worker session nests under the chat session.
      const children = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'ListSessions', parentSessionId: createdSession.sessionId},
        }),
      )
      if (children._ !== 'ListSessionsResponse') throw new Error('unexpected response')
      expect(children.sessions).toHaveLength(1)
      expect(children.sessions[0]?.title).toBe('Worker')
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('sessions never stay "Untitled session": placeholder titles normalize away and heal', async () => {
    // Eric's live repro: the desktop created sessions with the literal display placeholder as a
    // stored title, so the DB was never "untitled" — and a model that parks or just skips
    // set_session_title left it that way forever. The agent names its sessions: when a turn ends
    // untitled, a dedicated model call generates the title (never an echo of the user's words).
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      svc = new apisvc.Service(db, dataDir, {titleGeneration: true})
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
            definition: {name: 'Namer', systemPrompt: 'be terse', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')

      // The chat model answers but never calls set_session_title; the dedicated titling call
      // (identified by its system prompt) is answered by "the model" with a proper title.
      let titleRequests = 0
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        const system = String((body.messages?.[0] as {content?: string} | undefined)?.content ?? '')
        if (system.includes('session-titling assistant')) {
          titleRequests += 1
          const digest = JSON.stringify(body.messages)
          const title = digest.includes('summarize my week') ? 'Weekly Summary' : 'Feelings Check-In'
          return openAIStreamResponse([
            {id: 'title', choices: [{delta: {content: title}}]},
            {id: 'title', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {id: 'chat', choices: [{delta: {content: 'Doing well, thanks!'}}]},
          {id: 'chat', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      // Case 1: a client sends the display placeholder at creation (the old desktop behavior).
      const created = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'CreateSession', agentId: createdAgent.agentId, title: 'Untitled session'},
        }),
      )
      if (created._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const stored = db
        .query<{title: string | null}, [string]>(`SELECT title FROM sessions WHERE id = ?`)
        .get(created.sessionId)
      expect(stored?.title).toBeNull() // the placeholder is not a title
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: created.sessionId,
            content: [{type: 'text', text: 'hey, how are you feeling today?'}],
          },
        }),
      )
      await svc.awaitQueueIdle()
      const named = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: created.sessionId}}),
      )
      if (named._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(named.session.title).toBe('Feelings Check-In')
      expect(titleRequests).toBe(1)

      // Case 2: a pre-existing poisoned row (literal placeholder stored, source 'system') heals on
      // its next run.
      const legacy = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (legacy._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      db.run(`UPDATE sessions SET title = 'Untitled session' WHERE id = ?`, [legacy.sessionId])
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: legacy.sessionId,
            content: [{type: 'text', text: 'summarize my week'}],
          },
        }),
      )
      await svc.awaitQueueIdle()
      const healed = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: legacy.sessionId}}),
      )
      if (healed._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(healed.session.title).toBe('Weekly Summary')

      // A user-authored title is never overwritten by the fallback.
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'UpdateSession', sessionId: legacy.sessionId, title: 'My week'},
        }),
      )
      await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId: legacy.sessionId, content: [{type: 'text', text: 'more please'}]},
        }),
      )
      await svc.awaitQueueIdle()
      const kept = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: legacy.sessionId}}),
      )
      if (kept._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(kept.session.title).toBe('My week')
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('RetrySession re-runs a failed turn without a new user message', async () => {
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      svc = new apisvc.Service(db, dataDir, {})
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
            definition: {name: 'Retrier', systemPrompt: 'be terse', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      // Nothing to retry on a fresh session.
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'RetrySession', sessionId: createdSession.sessionId},
          }),
        ),
      ).rejects.toThrow('Nothing to retry')

      // First attempt: the provider hard-fails, the run fails, an error event lands.
      globalThis.fetch = mock(async () => new Response('boom', {status: 500})) as unknown as typeof fetch
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {
              _: 'MessageSession',
              sessionId: createdSession.sessionId,
              content: [{type: 'text', text: 'What is the capital of France?'}],
            },
          }),
        ),
      ).rejects.toThrow()
      let session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('error')
      expect((session.events.at(-1)?.event as {type?: string}).type).toBe('error')

      // Retry with a healthy provider: the turn re-enters from the transcript, no duplicate user message.
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(url, init))
        // The provider request must not include the error event and has exactly one user message.
        expect(JSON.stringify(body.messages)).not.toContain('boom')
        expect(body.messages.filter((message: {role?: string}) => message.role === 'user')).toHaveLength(1)
        return openAIStreamResponse([
          {id: 'retry', choices: [{delta: {content: 'Paris.'}}]},
          {id: 'retry', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch
      const retried = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'RetrySession', sessionId: createdSession.sessionId},
        }),
      )
      expect(retried._).toBe('RetrySessionResponse')
      session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      expect(session.events.at(-1)?.event).toEqual({type: 'message', role: 'assistant', content: 'Paris.'})
      const userMessages = session.events.filter(
        (event) => (event.event as {type?: string; role?: string}).role === 'user',
      )
      expect(userMessages).toHaveLength(1)
    } finally {
      globalThis.fetch = originalFetch
      svc?.stopRunQueue()
      db.close()
      cleanup()
    }
  })

  test('crash recovery: a run interrupted mid-tool resumes after restart with a repaired transcript', async () => {
    // Simulates the old wedged-`streaming` failure: a process died after persisting a tool_call but
    // before its tool_result, leaving the run row `running` and the session column `streaming`. A
    // fresh Service must requeue the run, synthesize an interrupted tool_result so the provider
    // request is well-formed, finish the turn, and leave the session idle.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
    let svc2: apisvc.Service | undefined
    try {
      const account = blobs.generateNobleKeyPair()
      const svc = new apisvc.Service(db, dataDir, {})
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
            definition: {name: 'Recovery', systemPrompt: 'be terse', modelProvider: 'openai', model: 'gpt'},
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const sessionId = createdSession.sessionId
      const accountId = blobs.principalToString(account.principal)
      svc.stopRunQueue()

      // Forge the crash state directly: user message + dangling tool_call, run row left `running`.
      const now = Date.now()
      const putEvent = (seq: number, event: unknown) =>
        db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
          crypto.randomUUID(),
          sessionId,
          seq,
          cbor.encode(event),
          now,
        ])
      putEvent(1, {type: 'message', role: 'user', content: 'What is in the doc?'})
      putEvent(2, {type: 'tool_call', id: 'call-lost', name: 'read', input: {id: 'hm://z6MkDoc/x'}})
      db.run(
        `INSERT INTO runs (id, account_id, root_run_id, depth, kind, agent_id, session_id, origin, input_cbor,
           status, attempt, max_attempts, queue, lease_owner, created_at, started_at, updated_at)
         VALUES ('crashed-run', ?, 'crashed-run', 0, 'agent', ?, ?, 'user', ?, 'running', 1, 1, 'interactive',
           'dead-process', ?, ?, ?)`,
        [accountId, createdAgent.agentId, sessionId, cbor.encode({}), now, now, now],
      )
      db.run(`UPDATE sessions SET status = 'streaming' WHERE id = ?`, [sessionId])

      const providerBodies: unknown[] = []
      globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
        const body = JSON.parse(await fetchBodyText(_url, init))
        providerBodies.push(body.messages)
        expectToolResultHasPrecedingToolCall(body.messages)
        return openAIStreamResponse([
          {id: 'chat-r', choices: [{delta: {content: 'Recovered.'}}]},
          {id: 'chat-r', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      // "Restart": a fresh Service over the same DB sweeps and re-executes the run.
      svc2 = new apisvc.Service(db, dataDir, {})
      await svc2.awaitQueueIdle()

      const session = await svc2.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(session.session.status).toBe('idle')
      const eventTypes = session.events.map((event) => event.event)
      const synthesized = eventTypes.find(
        (event) => event.type === 'tool_result' && (event as {toolCallId?: string}).toolCallId === 'call-lost',
      ) as {error?: string} | undefined
      expect(synthesized?.error).toContain('Interrupted by a service restart')
      expect(eventTypes.at(-1)).toEqual({type: 'message', role: 'assistant', content: 'Recovered.'})
      expect(providerBodies.length).toBe(1)

      const runRow = db
        .query<{status: string; usage_cbor: Uint8Array | null}, [string]>(
          `SELECT status, usage_cbor FROM runs WHERE id = ?`,
        )
        .get('crashed-run')
      expect(runRow?.status).toBe('succeeded')
      expect(runRow?.usage_cbor).not.toBeNull()
    } finally {
      globalThis.fetch = originalFetch
      svc2?.stopRunQueue()
      db.close()
      cleanup()
    }
  })
})

async function setDefaultProvider(svc: apisvc.Service, account: blobs.Signer): Promise<void> {
  await svc.message(
    await apisvc.createSignedEnvelope(account, {
      action: {_: 'SetModelProvider', name: 'openai', provider: {type: 'openai'}},
    }),
  )
}

/** Provider + agent + session in one step, for tests whose subject is what happens after that. */
async function seedAgentSession(svc: apisvc.Service, account: blobs.Signer, systemPrompt: string): Promise<string> {
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
  const agent = await svc.message(
    await apisvc.createSignedEnvelope(account, {
      action: {
        _: 'CreateAgent',
        definition: {name: 'Agent', systemPrompt, modelProvider: 'openai', model: 'gpt-test', tools: []},
      },
    }),
  )
  if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  const session = await svc.message(
    await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: agent.agentId}}),
  )
  if (session._ !== 'CreateSessionResponse') throw new Error('unexpected response')
  return session.sessionId
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

function expectToolResultHasPrecedingToolCall(messages: unknown, toolName = 'read'): void {
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
        function: expect.objectContaining({name: toolName}),
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

describe('normalizeSubSessionSpec', () => {
  test('reads a lone prompt as the task brief instead of bouncing the call', () => {
    // Live gpt-5-mini wrote the briefing into `prompt` and omitted `input`; a bare system prompt
    // with no input is meaningless, so the natural reading is the right one.
    const spec = apisvc.normalizeSubSessionSpec({title: 'Research', prompt: 'Go research supplements.'})
    expect(spec.input).toBe('Go research supplements.')
    expect(spec.prompt).toBeUndefined()
  })

  test('keeps prompt as a system prompt when input is present', () => {
    const spec = apisvc.normalizeSubSessionSpec({prompt: 'You are a researcher.', input: 'Find sources.'})
    expect(spec.prompt).toBe('You are a researcher.')
    expect(spec.input).toBe('Find sources.')
  })

  test('still requires some form of brief', () => {
    expect(() => apisvc.normalizeSubSessionSpec({title: 'Nothing'})).toThrow(/brief/)
  })

  test('brief is the canonical field and wins alongside a system prompt', () => {
    const spec = apisvc.normalizeSubSessionSpec({prompt: 'You are a researcher.', brief: 'Find sources.'})
    expect(spec.prompt).toBe('You are a researcher.')
    expect(spec.input).toBe('Find sources.')
  })

  test('brief accepts non-string payloads like input did', () => {
    const spec = apisvc.normalizeSubSessionSpec({brief: {topic: 'B'}})
    expect(spec.input).toEqual({topic: 'B'})
  })
})

describe('session plan settling', () => {
  test('a step left running settles to done when its turn succeeds', async () => {
    // Live gap: the model marked "Summarize findings" running, did the work, and ended the turn
    // without the final update_plan — the checklist showed unfinished work forever.
    const {db, dataDir, cleanup} = createTestState()
    const originalFetch = globalThis.fetch
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
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')

      let openAICallCount = 0
      globalThis.fetch = mock(async () => {
        openAICallCount += 1
        if (openAICallCount === 1) {
          return openAIStreamResponse([
            {
              id: 'chat-plan',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'plan-call-1',
                        type: 'function',
                        function: {
                          name: 'plan',
                          arguments: JSON.stringify({
                            title: 'Review knowledge base',
                            steps: [
                              {id: 's1', label: 'Review memory files', status: 'done'},
                              {id: 's2', label: 'Summarize findings', status: 'running'},
                            ],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            },
            {id: 'chat-plan', choices: [{delta: {}, finish_reason: 'tool_calls'}], usage: openAIUsage()},
          ])
        }
        return openAIStreamResponse([
          {id: 'chat-final', choices: [{delta: {content: 'Here is the summary.'}}]},
          {id: 'chat-final', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
        ])
      }) as unknown as typeof fetch

      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'MessageSession',
            sessionId: createdSession.sessionId,
            content: [{type: 'text', text: 'Review the knowledge base'}],
          },
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      await svc.awaitQueueIdle()

      const session = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId: createdSession.sessionId}}),
      )
      if (session._ !== 'GetSessionResponse') throw new Error('unexpected response')
      expect(openAICallCount).toBe(2)
      expect(session.session.plan?.steps.map((step) => `${step.label}:${step.status}`)).toEqual([
        'Review memory files:done',
        'Summarize findings:done',
      ])
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })
})

describe('symmetric log: user tool calls', () => {
  test('InvokeSessionTool runs verbs as the user, logs actor-stamped events, and the agent reads them', async () => {
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
            definition: {
              name: 'Logger',
              systemPrompt: 'You are terse.',
              modelProvider: 'openai',
              model: 'gpt',
              tools: [],
            },
          },
        }),
      )
      if (createdAgent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
      const createdSession = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'CreateSession', agentId: createdAgent.agentId}}),
      )
      if (createdSession._ !== 'CreateSessionResponse') throw new Error('unexpected response')
      const sessionId = createdSession.sessionId

      // The user writes a memory file through their own write verb.
      const written = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {
            _: 'InvokeSessionTool',
            sessionId,
            verb: 'write',
            input: {address: '~/memory/from-user.md', content: 'the user wrote this'},
          },
        }),
      )
      if (written._ !== 'InvokeSessionToolResponse') throw new Error(`unexpected: ${written._}`)
      expect(written.error).toBeUndefined()
      expect((written.output as {summary?: string})?.summary).toContain('Wrote')

      // A failing verb still logs, and reports the error in the response instead of throwing.
      const failed = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'InvokeSessionTool', sessionId, verb: 'read', input: {address: 'gopher://x'}},
        }),
      )
      if (failed._ !== 'InvokeSessionToolResponse') throw new Error('unexpected response')
      expect(failed.error).toContain('Unrecognized address')

      // Both actions are durable actor-'user' events on the log.
      const loaded = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}),
      )
      if (loaded._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const toolEvents = loaded.events.filter((event) => {
        const value = event.event as {type?: string; actor?: string}
        return (value.type === 'tool_call' || value.type === 'tool_result') && value.actor === 'user'
      })
      expect(toolEvents.length).toBe(4)

      // The agent's next turn sees the user's actions as tagged ground truth.
      let sawUserAction = false
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)
        if (href.includes('chat/completions')) {
          const body = JSON.parse(String(init?.body))
          const rendered = JSON.stringify(body.messages)
          if (rendered.includes('<user_action') && rendered.includes('from-user.md')) sawUserAction = true
          return openAIStreamResponse([
            {id: 'chat-1', choices: [{delta: {content: 'I see your note.'}}]},
            {id: 'chat-1', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        throw new Error(`Unexpected fetch: ${href}`)
      }) as unknown as typeof fetch
      const response = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId, content: [{type: 'text', text: 'What did I just do?'}]},
        }),
      )
      expect(response._).toBe('MessageSessionResponse')
      expect(sawUserAction).toBe(true)

      // Crash-shaped history: a user tool_call whose result never landed must not brick the
      // session — no synthetic 'Interrupted' result is fabricated for it, and the next turn's
      // provider request contains no orphan tool message for its call id.
      const now = Date.now()
      const danglingId = 'user-dangling-1'
      const maxSeq =
        db.query<{m: number}, [string]>(`SELECT MAX(seq) AS m FROM session_events WHERE session_id = ?`).get(sessionId)
          ?.m ?? 0
      db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
        'ev-dangling',
        sessionId,
        maxSeq + 1,
        cbor.encode({type: 'tool_call', id: danglingId, name: 'read', input: {address: '~/memory/'}, actor: 'user'}),
        now,
      ])
      let orphanToolMessage = false
      globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url)
        if (href.includes('chat/completions')) {
          const body = JSON.parse(String(init?.body))
          for (const message of body.messages) {
            if (message.role === 'tool' && String(message.tool_call_id ?? '').startsWith('user-')) {
              orphanToolMessage = true
            }
          }
          return openAIStreamResponse([
            {id: 'chat-2', choices: [{delta: {content: 'Still fine.'}}]},
            {id: 'chat-2', choices: [{delta: {}, finish_reason: 'stop'}], usage: openAIUsage()},
          ])
        }
        throw new Error(`Unexpected fetch: ${href}`)
      }) as unknown as typeof fetch
      const afterDangling = await svc.message(
        await apisvc.createSignedEnvelope(account, {
          action: {_: 'MessageSession', sessionId, content: [{type: 'text', text: 'Still with me?'}]},
        }),
      )
      expect(afterDangling._).toBe('MessageSessionResponse')
      expect(orphanToolMessage).toBe(false)
      const reloaded = await svc.message(
        await apisvc.createSignedEnvelope(account, {action: {_: 'GetSession', sessionId}}),
      )
      if (reloaded._ !== 'GetSessionResponse') throw new Error('unexpected response')
      const syntheticForUser = reloaded.events.some((event) => {
        const value = event.event as {type?: string; toolCallId?: string; error?: string}
        return value.type === 'tool_result' && value.toolCallId === danglingId
      })
      expect(syntheticForUser).toBe(false)

      // Invalid verbs are rejected outright, before anything is logged.
      await expect(
        svc.message(
          await apisvc.createSignedEnvelope(account, {
            action: {_: 'InvokeSessionTool', sessionId, verb: 'delegate' as never, input: {}},
          }),
        ),
      ).rejects.toThrow('verb must be read, write, or call')
    } finally {
      globalThis.fetch = originalFetch
      db.close()
      cleanup()
    }
  })
})
