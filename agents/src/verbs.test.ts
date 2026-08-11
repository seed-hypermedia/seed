import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import {unpackHmId} from '@seed-hypermedia/client'
import {executeCallVerb, executeReadVerb, executeWriteVerb, type AgentServicePiToolContext} from '@/api-service'
import * as sqlite from '@/sqlite'
import type {CodeExecutor} from '@/code-exec'

/**
 * Unit tests for the verb dispatchers with hand-built mocks: a fake context (temp memory dir,
 * in-memory db, spy callbacks, fake code executor) and per-test fetch mocks. No model in the loop.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeContext(overrides: Partial<AgentServicePiToolContext> = {}): AgentServicePiToolContext {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verbs-test-'))
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  cleanups.push(() => {
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  const fakeExec: CodeExecutor = {
    availability: async () => ({available: true}),
    execute: async () => ({
      exitCode: 0,
      success: true,
      stdout: 'fake stdout',
      stderr: '',
      truncated: false,
      durationMs: 1,
      changedFiles: [],
    }),
  } as unknown as CodeExecutor
  return {
    db,
    accountId: 'test-account',
    agentId: 'test-agent',
    definition: {name: 'Test', systemPrompt: '', modelProvider: 'p', model: 'm'} as never,
    hmServerUrl: 'https://hm.example',
    web: {},
    stateDir: dataDir,
    sessionId: 'session-1',
    modelAcceptsImages: false,
    onMemoryChange: mock(() => {}),
    onToolProgress: mock(() => {}),
    codeExec: fakeExec,
    callableTools: ['search', 'web_search', 'execute'],
    startSession: mock(() => ({sessionId: 'child-session', title: 'Child'})),
    setSessionPlan: mock(() => ({plan: {steps: []}}) as never),
    spawnSubSession: mock(() => ({status: 'spawned', sessionId: 'sub-1', title: 'Sub'})),
    spawnWorkflow: mock(() => ({status: 'spawned', runId: 'wf-1'})),
    ...overrides,
  }
}

describe('read verb', () => {
  test('reads and lists memory addresses, including dir fallback without trailing slash', async () => {
    const context = makeContext()
    await executeWriteVerb(context, {address: '~/memory/notes/a.md', content: 'hello world'})
    const file = await executeReadVerb(context, {address: '~/memory/notes/a.md'})
    expect(file.content).toBe('hello world')

    const listed = await executeReadVerb(context, {address: '~/memory/notes/'})
    expect(Array.isArray(listed.entries)).toBe(true)
    expect((listed.entries as Array<{path: string}>).some((entry) => entry.path.endsWith('a.md'))).toBe(true)

    // Dir address without a trailing slash answers with the listing instead of erroring.
    const fallback = await executeReadVerb(context, {address: '~/memory/notes'})
    expect(Array.isArray(fallback.entries)).toBe(true)

    const root = await executeReadVerb(context, {address: '~/memory/'})
    expect(Array.isArray(root.entries)).toBe(true)
  })

  test('~/tools lists verbs and callables; ~/tools/<name> returns the contract', async () => {
    const context = makeContext()
    const listing = await executeReadVerb(context, {address: '~/tools/'})
    expect(String(listing.markdown)).toContain('read —')
    expect(String(listing.markdown)).toContain('web_search —')
    expect(listing.tools).toEqual(['search', 'web_search', 'execute'])

    const contract = await executeReadVerb(context, {address: '~/tools/web_search'})
    expect(String(contract.markdown)).toContain('## Input schema')
    expect(String(contract.markdown)).toContain('web_search')

    // Unknown tool answers with the listing, not an error.
    const unknown = await executeReadVerb(context, {address: '~/tools/nope'})
    expect(String(unknown.summary)).toContain('No tool named nope')
    expect(unknown.tools).toEqual(['search', 'web_search', 'execute'])
  })

  test('hm:// addresses resolve through the hypermedia reader', async () => {
    const context = makeContext()
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      if (href.includes('/api/Resource')) {
        return Response.json(
          serialize({
            type: 'document',
            id: unpackHmId('hm://z6MkDoc/notes'),
            document: {
              content: [{block: {id: 'b1', type: 'Paragraph', text: 'Doc body'}, children: []}],
              version: 'v1',
              account: 'z6MkDoc',
              authors: [],
              path: '/notes',
              createTime: '',
              updateTime: '',
              metadata: {name: 'Notes'},
              genesis: 'genesis',
              visibility: 'PUBLIC',
            },
          }),
        )
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch

    const result = await executeReadVerb(context, {address: 'hm://z6MkDoc/notes'})
    expect(String(result.markdown)).toContain('Doc body')
  })

  test('activity: hits ListEvents with mapped filters', async () => {
    const context = makeContext()
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    const requests: string[] = []
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      requests.push(href)
      if (href.includes('ListEvents')) return Response.json(serialize({events: [{id: 'e1'}], nextPageToken: ''}))
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch

    const result = await executeReadVerb(context, {address: 'activity:', options: {pageSize: 5}})
    expect(String(result.summary)).toContain('1 activity feed event')
    expect(requests.some((href) => href.includes('ListEvents'))).toBe(true)
  })

  test('unknown addresses fail with the supported-forms message', async () => {
    const context = makeContext()
    await expect(executeReadVerb(context, {address: 'gopher://old'})).rejects.toThrow('Unrecognized address')
    await expect(executeReadVerb(context, {})).rejects.toThrow('read requires an address')
  })

  test('thread: renders a transcript for an owned session and 404s otherwise', async () => {
    const context = makeContext()
    const now = Date.now()
    context.db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, ['test-account', now, now])
    context.db.run(
      `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['test-agent', 'test-account', new Uint8Array([160]), 'x', 'ready', now, now],
    )
    context.db.run(
      `INSERT INTO sessions (id, account_id, agent_id, title, title_source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['thread-1', 'test-account', 'test-agent', 'My thread', 'system', 'idle', now, now],
    )
    await expect(executeReadVerb(context, {address: 'thread:none'})).rejects.toThrow('No thread')
    const result = await executeReadVerb(context, {address: 'thread:thread-1'})
    expect(String(result.summary)).toContain('My thread')
  })
})

describe('write verb', () => {
  test('memory writes, deletes, and rejects contentless writes', async () => {
    const context = makeContext()
    const written = await executeWriteVerb(context, {address: '~/memory/a.txt', content: 'abc'})
    expect(String(written.summary)).toContain('Wrote')
    expect(context.onMemoryChange).toHaveBeenCalled()

    await expect(executeWriteVerb(context, {address: '~/memory/b.txt'})).rejects.toThrow('requires content')

    const deleted = await executeWriteVerb(context, {address: '~/memory/a.txt', options: {delete: true}})
    expect(String(deleted.summary)).toContain('Deleted')
  })

  test('memory fromUrl downloads through fetch', async () => {
    const context = makeContext()
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    globalThis.fetch = mock(
      async () => new Response('downloaded bytes', {headers: {'content-type': 'text/plain'}}),
    ) as unknown as typeof fetch

    const result = await executeWriteVerb(context, {
      address: '~/memory/dl.txt',
      options: {fromUrl: 'https://files.example/x.txt'},
    })
    expect(String(result.summary)).toContain('Downloaded')
    const back = await executeReadVerb(context, {address: '~/memory/dl.txt'})
    expect(back.content).toBe('downloaded bytes')
  })

  test('unknown write addresses and unknown hm actions fail clearly', async () => {
    const context = makeContext()
    await expect(executeWriteVerb(context, {address: 'ftp://x', content: 'x'})).rejects.toThrow(
      'Unrecognized write address',
    )
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', options: {action: 'explode'}}),
    ).rejects.toThrow('Unknown write action')
  })

  test('write ipfs:// requires a source', async () => {
    const context = makeContext()
    await expect(executeWriteVerb(context, {address: 'ipfs://'})).rejects.toThrow('requires options.fromPath')
  })
})

describe('call verb', () => {
  test('unknown or missing tool answers with the callable listing', async () => {
    const context = makeContext()
    const missing = await executeCallVerb(context, {}, undefined)
    expect(String(missing.summary)).toContain('call requires a tool name')
    expect(missing.tools).toEqual(['search', 'web_search', 'execute'])

    const unknown = await executeCallVerb(context, {tool: 'navigate'}, undefined)
    expect(String(unknown.summary)).toContain('No callable tool named navigate')
  })

  test('invalid input returns the contract instead of failing (touch-expand)', async () => {
    const context = makeContext()
    const result = await executeCallVerb(context, {tool: 'web_search', input: {}}, undefined)
    expect(String(result.summary)).toContain('did not match its contract')
    expect(String(result.contract)).toContain('## Input schema')
    expect(Array.isArray(result.validationErrors)).toBe(true)
  })

  test('execute dispatches to the code executor with runtime mapped', async () => {
    const executeSpy = mock(async () => ({
      exitCode: 0,
      success: true,
      stdout: 'ran',
      stderr: '',
      truncated: false,
      durationMs: 3,
      changedFiles: [{path: 'x', change: 'added'}],
    }))
    const context = makeContext({
      codeExec: {availability: async () => ({available: true}), execute: executeSpy} as never,
    })
    const result = await executeCallVerb(
      context,
      {tool: 'execute', input: {runtime: 'python', code: 'print(1)'}},
      'tc1',
    )
    expect(String(result.summary)).toContain('Ran python code')
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(context.onMemoryChange).toHaveBeenCalled()
  })

  test('search dispatches through the Search API', async () => {
    const context = makeContext()
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      if (href.includes('/api/Search')) return Response.json(serialize({entities: [], nextPageToken: '', searchQuery: 'hello'}))
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const result = await executeCallVerb(context, {tool: 'search', input: {query: 'hello'}}, undefined)
    expect(String(result.summary)).toContain('No results')
  })
})
