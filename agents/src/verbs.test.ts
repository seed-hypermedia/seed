import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import {unpackHmId} from '@seed-hypermedia/client'
import * as apisvc from '@/api-service'
import {executeCallVerb, executeReadVerb, executeWriteVerb, type AgentServicePiToolContext} from '@/api-service'
import {encode as cborEncode} from '@/cbor'
import {LAMBDA_RESULT_PREFIX} from '@/code-exec'
import * as toolDocs from '@/tool-documents'
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
  const now = Date.now()
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, ['test-account', now, now])
  db.run(
    `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['test-agent', 'test-account', new Uint8Array([160]), 'x', 'ready', now, now],
  )
  cleanups.push(() => {
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  const fakeExec: CodeExecutor = {
    runtimes: ['ts', 'python', 'shell'],
    availability: async () => ({available: true, runtimes: ['ts', 'python', 'shell']}),
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
    ipfsServerUrl: 'https://hm.example',
    web: {},
    stateDir: dataDir,
    sessionId: 'session-1',
    modelAcceptsImages: false,
    onMemoryChange: mock(() => {}),
    onTriggersChange: mock(() => {}),
    onToolProgress: mock(() => {}),
    codeExec: fakeExec,
    callableTools: ['search', 'web_search', 'execute'],
    publishEnabled: true,
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
    expect(listing.tools).toEqual(['execute', 'search', 'web_search'])

    const contract = await executeReadVerb(context, {address: '~/tools/web_search'})
    expect(String(contract.markdown)).toContain('## Input schema')
    expect(String(contract.markdown)).toContain('web_search')

    const writeIndex = await executeReadVerb(context, {address: '~/tools/write'})
    expect(String(writeIndex.markdown)).toContain('~/tools/write/capabilities')
    expect(String(writeIndex.markdown)).toContain('grant WRITER or AGENT access')
    expect(String(writeIndex.markdown)).not.toContain('capability.grant')

    for (const guideName of [
      'memory',
      'tools',
      'triggers',
      'ipfs',
      'documents',
      'comments',
      'capabilities',
      'contacts',
      'profiles',
      'drafts',
    ]) {
      const guide = await executeReadVerb(context, {address: `~/tools/write/${guideName}`})
      expect(guide.name).toBe(`write/${guideName}`)
      expect(guide.kind).toBe('guide')
    }
    const capabilityGuide = await executeReadVerb(context, {address: '~/tools/write/capabilities'})
    expect(String(capabilityGuide.markdown)).toContain('capability.grant')
    expect(String(capabilityGuide.markdown)).toContain('delegate')
    expect(String(capabilityGuide.markdown)).not.toContain('contact.create')

    const unknownGuide = await executeReadVerb(context, {address: '~/tools/write/unknown'})
    expect(String(unknownGuide.summary)).toContain('No write guide named unknown')
    expect(String(unknownGuide.markdown)).toContain('~/tools/write/documents')

    // The execute contract is the one a server can honor only partly, so reading it shows the
    // runtimes THIS server offers rather than everything the shipped document lists.
    const narrowed = await executeReadVerb(makeContext({codeExec: {runtimes: ['python', 'shell']} as never}), {
      address: '~/tools/execute',
    })
    expect(String(narrowed.markdown)).toContain('"python"')
    expect(String(narrowed.markdown)).not.toContain('"ts"')
    expect(String(narrowed.markdown)).toContain('narrowed to what it can actually run')

    // Unknown tool answers with the listing, not an error.
    const unknown = await executeReadVerb(context, {address: '~/tools/nope'})
    expect(String(unknown.summary)).toContain('No tool named nope')
    expect(unknown.tools).toEqual(['execute', 'search', 'web_search'])
  })

  test('hm:// addresses resolve through the hypermedia reader on the configured HM server', async () => {
    const context = makeContext()
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    const requests: string[] = []
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      requests.push(href)
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
    // hm:// reads must hit the server this agent service is configured with — the local node in
    // desktop environments — never a hardcoded public gateway.
    expect(requests.length).toBeGreaterThan(0)
    for (const href of requests) expect(href.startsWith('https://hm.example/')).toBe(true)
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

  // The real incident behind these: a model passed {metadata} on an hm:// document write, the
  // envelope did not know the key, and it was silently dropped — the doc published "successfully"
  // with no metadata. Unknown option keys must refuse loudly so the model can self-correct.
  test('unknown write option keys are refused with the supported set, never silently dropped', async () => {
    const context = makeContext()
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', options: {metdata: {a: 1}}}),
    ).rejects.toThrow(/does not understand option "metdata".*name, metadata/)
    await expect(
      executeWriteVerb(context, {
        address: 'hm://z6MkDoc/notes',
        content: 'x',
        options: {action: 'comment', name: 'X'},
      }),
    ).rejects.toThrow(/does not understand option "name".*target, replyTo/)
    await expect(
      executeWriteVerb(context, {address: '~/memory/a.txt', content: 'x', options: {metadata: {a: 1}}}),
    ).rejects.toThrow(/does not understand option "metadata"/)
    await expect(
      executeWriteVerb(context, {address: 'ipfs://', options: {fromPths: '~/memory/a.txt'}}),
    ).rejects.toThrow(/does not understand option "fromPths"/)
    await expect(
      executeWriteVerb(context, {address: '~/tools/thing', content: '{}', options: {overwrite: true}}),
    ).rejects.toThrow(/does not understand option "overwrite"/)
  })

  // title and dryRun used to be loose option keys; the refusal points at where each concept
  // lives now so a model trained on the old contract self-corrects in one round trip.
  test('retired option spellings are refused with a pointer to the new home', async () => {
    const context = makeContext()
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', options: {title: 'X'}}),
    ).rejects.toThrow(/name lives in metadata\.name/)
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', options: {dryRun: true}}),
    ).rejects.toThrow(/dryRun is a top-level field/)
  })

  test('write dryRun is strict: boolean only, hm:// only', async () => {
    const context = makeContext()
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', dryRun: 'true'}),
    ).rejects.toThrow('write dryRun must be a boolean')
    await expect(executeWriteVerb(context, {address: '~/memory/a.txt', content: 'x', dryRun: true})).rejects.toThrow(
      'dryRun applies only to hm:// writes',
    )
  })

  test('write hm:// options.metadata must be an object', async () => {
    const context = makeContext()
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', options: {metadata: 'draft'}}),
    ).rejects.toThrow('options.metadata must be an object')
  })
})

describe('call verb', () => {
  test('unknown or missing tool answers with the callable listing', async () => {
    const context = makeContext()
    const missing = await executeCallVerb(context, {}, undefined)
    expect(String(missing.summary)).toContain('call requires a tool name')
    expect(missing.tools).toEqual(['execute', 'search', 'web_search'])

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
      codeExec: {
        runtimes: ['python', 'shell'],
        availability: async () => ({available: true, runtimes: ['python', 'shell']}),
        execute: executeSpy,
      } as never,
    })
    // No description: the contract comes back and nothing runs — the row the user reads is the
    // description, so a run without one is a run the user cannot follow.
    const undescribed = await executeCallVerb(
      context,
      {tool: 'execute', input: {runtime: 'python', code: 'print(1)'}},
      'tc0',
    )
    expect(String(undescribed.summary)).toContain('did not match its contract')
    expect(undescribed.validationErrors).toEqual(['$.description: required property is missing'])
    expect(executeSpy).not.toHaveBeenCalled()

    const result = await executeCallVerb(
      context,
      {tool: 'execute', input: {description: 'Count the words in notes', runtime: 'python', code: 'print(1)'}},
      'tc1',
    )
    // The summary leads with the agent's own account of the run, then only what changed the picture.
    expect(result.summary).toBe('Count the words in notes · 1 memory file changed')
    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(context.onMemoryChange).toHaveBeenCalled()
  })

  test('a failed execute keeps the description and adds the exit code', async () => {
    const context = makeContext({
      codeExec: {
        runtimes: ['python', 'shell'],
        availability: async () => ({available: true, runtimes: ['python', 'shell']}),
        execute: async () => ({
          exitCode: 2,
          success: false,
          stdout: '',
          stderr: 'boom',
          truncated: false,
          durationMs: 5,
          changedFiles: [],
        }),
      } as never,
    })
    const result = await executeCallVerb(
      context,
      {tool: 'execute', input: {description: 'Validate the CSV', runtime: 'python', code: 'raise SystemExit(2)'}},
      'tc2',
    )
    expect(result.summary).toBe('Validate the CSV · exit 2')
  })

  test('the execute contract offers only the runtimes this server can actually run', async () => {
    const context = makeContext({
      codeExec: {
        runtimes: ['python', 'shell'],
        availability: async () => ({available: true, runtimes: ['python', 'shell']}),
        execute: async () => {
          throw new Error('unused')
        },
      } as never,
    })
    // A model asking for TypeScript on a server with no bun image gets the contract back — with ts
    // absent from the enum — instead of a sandbox failure it cannot diagnose.
    const result = await executeCallVerb(
      context,
      {tool: 'execute', input: {description: 'Try TypeScript', runtime: 'ts', code: 'x'}},
      undefined,
    )
    expect(String(result.summary)).toContain('did not match its contract')
    expect(String(result.contract)).toContain('"python"')
    expect(String(result.contract)).not.toContain('"ts"')
  })

  test('an authored lambda runs its source, and its return value is the result', async () => {
    const context = makeContext()
    const programs: string[] = []
    ;(context.codeExec as {execute: unknown}).execute = mock(async (request: {code: string; runtime: string}) => {
      programs.push(request.code)
      return {
        exitCode: 0,
        success: true,
        stdout: `working\n${LAMBDA_RESULT_PREFIX}{"tempC":21}\n`,
        stderr: '',
        truncated: false,
        durationMs: 7,
        changedFiles: [{path: 'weather.json', change: 'added'}],
      }
    })
    toolDocs.saveLambdaToolDocument(context.db, context.accountId, context.agentId, {
      name: 'weather',
      description: 'Look up the temperature for a city.',
      input: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']},
      output: {type: 'object', properties: {tempC: {type: 'number'}}, required: ['tempC']},
      source: 'export default (input) => ({tempC: 21})',
    })

    const result = await executeCallVerb(context, {tool: 'weather', input: {city: 'Lisbon'}}, 'tc-lambda')
    expect(result.result).toEqual({tempC: 21})
    // What it printed comes back as logs, kept apart from what it returned.
    expect(result.logs).toBe('working')
    expect(String(result.summary)).toContain('Ran weather')
    // The validated input reached the program, and memory changes were announced.
    expect(programs[0]).toContain('{\\"city\\":\\"Lisbon\\"}')
    expect(context.onMemoryChange).toHaveBeenCalled()
  })

  test('a lambda call validates both edges and surfaces its failures', async () => {
    const context = makeContext()
    const behavior = {stdout: `${LAMBDA_RESULT_PREFIX}{"tempC":"warm"}\n`, success: true, exitCode: 0}
    ;(context.codeExec as {execute: unknown}).execute = mock(async () => ({
      exitCode: behavior.exitCode,
      success: behavior.success,
      stdout: behavior.stdout,
      stderr: behavior.success ? '' : 'Traceback: boom',
      truncated: false,
      durationMs: 3,
      changedFiles: [],
    }))
    toolDocs.saveLambdaToolDocument(context.db, context.accountId, context.agentId, {
      name: 'weather',
      description: 'Look up the temperature for a city.',
      input: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']},
      output: {type: 'object', properties: {tempC: {type: 'number'}}, required: ['tempC']},
      source: 'export default (input) => ({tempC: "warm"})',
    })

    // Bad input answers with the tool's own contract, exactly like a builtin does.
    const miss = await executeCallVerb(context, {tool: 'weather', input: {}}, undefined)
    expect(String(miss.summary)).toContain('did not match its contract')
    expect(String(miss.contract)).toContain('# weather')

    // A return value the tool's own output schema rejects is the tool's bug, and it says so.
    await expect(executeCallVerb(context, {tool: 'weather', input: {city: 'Lisbon'}}, undefined)).rejects.toThrow(
      'output schema rejects',
    )

    // A crash surfaces with the tail of what the runtime said.
    behavior.success = false
    behavior.exitCode = 1
    behavior.stdout = ''
    await expect(executeCallVerb(context, {tool: 'weather', input: {city: 'Lisbon'}}, undefined)).rejects.toThrow(
      'Traceback: boom',
    )

    // A tool that finishes without returning anything is broken, not empty.
    behavior.success = true
    behavior.exitCode = 0
    behavior.stdout = 'printed but never returned\n'
    await expect(executeCallVerb(context, {tool: 'weather', input: {city: 'Lisbon'}}, undefined)).rejects.toThrow(
      'without returning a value',
    )
  })

  test('an authored lambda cannot run code the owner did not grant', async () => {
    // Authoring a tool must not be a way around an owner who turned code execution off.
    const context = makeContext({callableTools: ['search', 'web_search']})
    toolDocs.saveLambdaToolDocument(context.db, context.accountId, context.agentId, {
      name: 'weather',
      description: 'Look up the temperature for a city.',
      input: {type: 'object'},
      source: 'export default () => ({})',
    })
    await expect(executeCallVerb(context, {tool: 'weather', input: {}}, undefined)).rejects.toThrow(
      'not enabled for this agent',
    )
  })

  test('a python lambda cannot run where code execution is unavailable', async () => {
    const context = makeContext({
      codeExec: {
        runtimes: [],
        availability: async () => ({available: false, runtimes: [], reason: 'no virtualization'}),
        execute: async () => {
          throw new Error('unused')
        },
      } as never,
    })
    toolDocs.saveLambdaToolDocument(context.db, context.accountId, context.agentId, {
      name: 'weather',
      description: 'Look up the temperature for a city.',
      input: {type: 'object'},
      source: 'def main(input):\n    return {}',
      runtime: 'python',
    })
    await expect(executeCallVerb(context, {tool: 'weather', input: {}}, undefined)).rejects.toThrow(
      'this server cannot run',
    )
  })

  test('search dispatches through the Search API', async () => {
    const context = makeContext()
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      if (href.includes('/api/Search'))
        return Response.json(serialize({entities: [], nextPageToken: '', searchQuery: 'hello'}))
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch
    const result = await executeCallVerb(context, {tool: 'search', input: {query: 'hello'}}, undefined)
    expect(String(result.summary)).toContain('No results')
  })
})

describe('space index and touch-expand pins', () => {
  test('index stays under budget, lists tools and memory, and caches until invalidated', async () => {
    const context = makeContext()
    await executeWriteVerb(context, {address: '~/memory/notes/a.md', content: 'x'})
    const index = apisvc.buildSpaceIndex({
      db: context.db,
      accountId: 'test-account',
      agentId: 'test-agent',
      stateDir: context.stateDir,
      callableTools: context.callableTools,
    })
    expect(index.length).toBeLessThanOrEqual(2048)
    expect(index).toContain('<space>')
    expect(index).toContain('search —')
    expect(index).toContain('notes/(1)')

    // Cached: a memory write without invalidation returns the same bytes; invalidation refreshes.
    await executeWriteVerb(context, {address: '~/memory/notes/b.md', content: 'y'})
    const stale = apisvc.buildSpaceIndex({
      db: context.db,
      accountId: 'test-account',
      agentId: 'test-agent',
      stateDir: context.stateDir,
      callableTools: context.callableTools,
    })
    expect(stale).toBe(index)
    apisvc.invalidateSpaceIndex('test-account', 'test-agent')
    const fresh = apisvc.buildSpaceIndex({
      db: context.db,
      accountId: 'test-account',
      agentId: 'test-agent',
      stateDir: context.stateDir,
      callableTools: context.callableTools,
    })
    expect(fresh).toContain('notes/(2)')
  })

  test('authored lambda appears in the index and the listing', async () => {
    const context = makeContext()
    await executeWriteVerb(context, {
      address: '~/tools/word_count',
      content: JSON.stringify({
        description: 'Count words in a text.',
        input: {type: 'object', properties: {text: {type: 'string'}}, required: ['text']},
        source: 'export default async ({text}) => ({words: text.split(/\\s+/).length})',
      }),
    })
    apisvc.invalidateSpaceIndex('test-account', 'test-agent')
    const index = apisvc.buildSpaceIndex({
      db: context.db,
      accountId: 'test-account',
      agentId: 'test-agent',
      stateDir: context.stateDir,
      callableTools: context.callableTools,
    })
    expect(index).toContain('word_count')
    const listing = await executeReadVerb(context, {address: '~/tools/'})
    expect(String(listing.markdown)).toContain('word_count — Count words in a text. (authored)')
    const contract = await executeReadVerb(context, {address: '~/tools/word_count'})
    expect(String(contract.markdown)).toContain('## Source')
    expect(String(contract.cid)).toStartWith('b')
  })

  test('expanded set derives from durable read/call events', () => {
    const context = makeContext()
    const now = Date.now()
    context.db.run(
      `INSERT INTO sessions (id, account_id, agent_id, title, title_source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['s1', 'test-account', 'test-agent', null, 'system', 'idle', now, now],
    )
    const append = (seq: number, event: unknown) =>
      context.db.run(
        `INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`,
        [`e${seq}`, 's1', seq, cborEncode(event), now],
      )
    append(1, {type: 'message', role: 'user', content: 'hi'})
    append(2, {type: 'tool_call', id: 't1', name: 'read', input: {address: '~/tools/web_search'}})
    append(3, {type: 'tool_call', id: 't2', name: 'call', input: {tool: 'execute', input: {}}})
    append(4, {type: 'tool_call', id: 't3', name: 'read', input: {address: '~/memory/x'}})
    append(5, {type: 'tool_call', id: 't4', name: 'read', input: {address: '~/tools/write/capabilities'}})
    expect(apisvc.expandedCallablesFromEvents(context.db, 's1').sort()).toEqual(['execute', 'web_search'])
    expect(apisvc.expandedCallablesFromEvents(context.db, 'missing')).toEqual([])
  })
})

describe('trigger introspection (~/triggers/ and ~/self)', () => {
  const scheduleTrigger = JSON.stringify({
    source: {type: 'schedule', schedule: {kind: 'interval', every: 30, unit: 'minutes'}},
    prompt: 'Check the news and summarize.',
    enabled: true,
  })

  test('trigger writes take effect immediately and default to enabled', async () => {
    const context = makeContext()
    const saved = await executeWriteVerb(context, {address: '~/triggers/morning-brief', content: scheduleTrigger})
    expect(saved.enabled).toBe(true)
    expect(context.onTriggersChange).toHaveBeenCalled()
    const row = context.db
      .query<{enabled: number}, []>(`SELECT enabled FROM agent_triggers WHERE name = 'morning-brief'`)
      .get()
    expect(row?.enabled).toBe(1)

    const listing = await executeReadVerb(context, {address: '~/triggers/'})
    expect(String(listing.summary)).toContain('1 trigger')
    const one = await executeReadVerb(context, {address: '~/triggers/morning-brief'})
    expect(one.enabled).toBe(true)
    expect(String(one.summary)).toContain('active')
    expect(String(one.prompt)).toContain('Check the news')
    expect((one.source as {type: string}).type).toBe('schedule')
  })

  test('the agent can disable and re-enable a trigger by writing it', async () => {
    const context = makeContext()
    const mentionTrigger = (enabled: boolean) =>
      JSON.stringify({
        source: {type: 'user-mention', mentionedAccounts: ['z6MkMe']},
        prompt: 'Reply politely.',
        enabled,
      })
    const saved = await executeWriteVerb(context, {address: '~/triggers/mentions', content: mentionTrigger(true)})
    expect(saved.enabled).toBe(true)

    const disabled = await executeWriteVerb(context, {address: '~/triggers/mentions', content: mentionTrigger(false)})
    expect(disabled.enabled).toBe(false)
    expect(String(disabled.summary)).toContain('disabled')

    const reenabled = await executeWriteVerb(context, {address: '~/triggers/mentions', content: mentionTrigger(true)})
    expect(reenabled.enabled).toBe(true)
    const rows = context.db.query<{id: string}, []>(`SELECT id FROM agent_triggers`).all()
    expect(rows.length).toBe(1)
  })

  test('delete, unknown options, and bad JSON are handled loudly', async () => {
    const context = makeContext()
    await executeWriteVerb(context, {address: '~/triggers/x', content: scheduleTrigger})
    await expect(executeWriteVerb(context, {address: '~/triggers/x', content: 'not json'})).rejects.toThrow(
      'expects JSON content',
    )
    await expect(
      executeWriteVerb(context, {address: '~/triggers/x', content: scheduleTrigger, options: {overwrite: true}}),
    ).rejects.toThrow('does not understand')
    const missing = await executeWriteVerb(context, {address: '~/triggers/nope', options: {delete: true}})
    expect(missing.deleted).toBe(false)
    const deleted = await executeWriteVerb(context, {address: '~/triggers/x', options: {delete: true}})
    expect(deleted.deleted).toBe(true)
    const listing = await executeReadVerb(context, {address: '~/triggers/'})
    expect((listing.triggers as unknown[]).length).toBe(0)
  })

  test('read ~/self reports definition, grants, triggers, and guidance', async () => {
    const context = makeContext()
    await executeWriteVerb(context, {address: '~/triggers/morning', content: scheduleTrigger})
    const self = await executeReadVerb(context, {address: '~/self'})
    expect(self.agentId).toBe('test-agent')
    expect(self.name).toBe('Test')
    expect((self.grants as {publish: boolean}).publish).toBe(true)
    expect((self.grants as {callableTools: string[]}).callableTools).toContain('search')
    expect((self.triggers as unknown[]).length).toBe(1)
    expect(String(self.guidance)).toContain('~/triggers/')
  })

  test('space index advertises the triggers affordance and lists active triggers', async () => {
    const context = makeContext()
    await executeWriteVerb(context, {address: '~/triggers/nightly', content: scheduleTrigger})
    apisvc.invalidateSpaceIndex('test-account', 'test-agent')
    const index = apisvc.buildSpaceIndex({
      db: context.db,
      accountId: 'test-account',
      agentId: 'test-agent',
      stateDir: context.stateDir,
      callableTools: context.callableTools,
    })
    expect(index).toContain('write ~/triggers/<name>')
    expect(index).toContain('active: nightly')
  })
})

describe('thread listing and search', () => {
  test('thread: lists sessions newest-first and searches titles and message text', async () => {
    const context = makeContext()
    const now = Date.now()
    const addSession = (id: string, title: string, updatedAt: number) =>
      context.db.run(
        `INSERT INTO sessions (id, account_id, agent_id, title, title_source, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, 'test-account', 'test-agent', title, 'system', 'idle', now, updatedAt],
      )
    addSession('s1', 'Launch planning', now - 1000)
    addSession('s2', 'Weekly review', now)
    context.db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
      'e1',
      's1',
      1,
      cborEncode({type: 'message', role: 'user', content: 'let us discuss the pelican rodeo budget'}),
      now,
    ])

    const listing = await executeReadVerb(context, {address: 'thread:'})
    const threads = listing.threads as Array<{thread: string; snippet?: string}>
    expect(threads.length).toBe(2)
    expect(threads[0]?.thread).toBe('thread:s2')

    const byTitle = await executeReadVerb(context, {address: 'thread:', options: {query: 'weekly'}})
    expect((byTitle.threads as Array<{thread: string}>).map((t) => t.thread)).toEqual(['thread:s2'])

    const byContent = await executeReadVerb(context, {address: 'thread:', options: {query: 'pelican rodeo'}})
    const contentThreads = byContent.threads as Array<{thread: string; snippet?: string}>
    expect(contentThreads[0]?.thread).toBe('thread:s1')
    expect(String(contentThreads[0]?.snippet)).toContain('pelican rodeo')

    const byAgent = await executeReadVerb(context, {address: 'thread:', options: {agentId: 'other-agent'}})
    expect((byAgent.threads as unknown[]).length).toBe(0)
  })
})

describe('publish grant', () => {
  test('ungranted agents write memory freely but cannot publish hm:// or ipfs://', async () => {
    const context = makeContext({publishEnabled: false})
    const memoryWrite = await executeWriteVerb(context, {address: '~/memory/ok.txt', content: 'fine'})
    expect(String(memoryWrite.summary)).toContain('Wrote')
    await expect(
      executeWriteVerb(context, {address: 'hm://z6MkDoc/notes', content: 'x', options: {name: 'X'}}),
    ).rejects.toThrow('Publishing is not enabled')
    await expect(
      executeWriteVerb(context, {address: 'ipfs://', options: {fromPath: '~/memory/ok.txt'}}),
    ).rejects.toThrow('Publishing is not enabled')
  })
})

describe('mcp tools through the call verb', () => {
  function seedMcp(
    context: AgentServicePiToolContext,
    server: string,
    tools: Array<{name: string; description?: string; inputSchema?: unknown}>,
  ) {
    const now = Date.now()
    context.db.run(
      `INSERT INTO mcp_servers (id, account_id, name, config_cbor, tools_cbor, status_cbor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        `id-${server}`,
        context.accountId,
        server,
        cborEncode({url: 'http://127.0.0.1:1/mcp'}),
        cborEncode(tools.map((tool) => toolDocs.mcpToolInfoFromDescriptor(server, tool as never))),
        now,
        now,
      ],
    )
    ;(context.definition as {mcpServers?: string[]}).mcpServers = [
      ...((context.definition as {mcpServers?: string[]}).mcpServers ?? []),
      server,
    ]
    toolDocs.syncMcpToolDocuments(
      context.db,
      context.accountId,
      context.agentId,
      (context.definition as never as {mcpServers: string[]}).mcpServers,
    )
  }

  const forecastTool = {
    name: 'forecast',
    description: 'Forecast for a city.',
    inputSchema: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']},
  }

  test('call proxies to the server over the run pool and returns text, structured, and progress', async () => {
    const calls: unknown[] = []
    const context = makeContext({
      mcp: {
        callTool: mock(async (server: string, tool: string, args: unknown) => {
          calls.push([server, tool, args])
          return {text: 'Sunny, 24°C', structured: {tempC: 24}, images: [], isError: false}
        }),
      },
    })
    seedMcp(context, 'weather', [forecastTool])

    const result = await executeCallVerb(
      context,
      {tool: 'weather__forecast', input: {city: 'Lisbon'}, description: 'Check the weather for the trip'},
      'tc-mcp',
    )
    // The call-level description never reaches the server; the row reads it from the event.
    expect(calls).toEqual([['weather', 'forecast', {city: 'Lisbon'}]])
    expect(result.text).toBe('Sunny, 24°C')
    expect(result.result).toEqual({tempC: 24})
    // The summary names the call by its first short argument; a promoted row reads `argument` alone.
    expect(result.summary).toBe('forecast · Lisbon')
    expect(result.argument).toBe('Lisbon')
    expect(context.onToolProgress).toHaveBeenCalledWith('call', expect.objectContaining({toolCallId: 'tc-mcp'}))
  })

  test('a call whose arguments are long or non-string falls back to naming the server', async () => {
    const context = makeContext({
      mcp: {callTool: mock(async () => ({text: 'ok', images: [], isError: false}))},
    })
    seedMcp(context, 'notes', [{name: 'append'}])
    const result = await executeCallVerb(
      context,
      {tool: 'notes__append', input: {count: 3, body: 'x'.repeat(200)}},
      'tc-long',
    )
    expect(result.summary).toBe('Ran append on the notes MCP server')
    expect(result.argument).toBeUndefined()
    expect(apisvc.firstShortStringArgument({a: '  spaced   out  ', b: 'second'})).toBe('spaced out')
    expect(apisvc.firstShortStringArgument({a: '', b: 'second'})).toBe('second')
  })

  test('a miss answers with the contract; server errors and transport failures are thrown', async () => {
    const context = makeContext({
      mcp: {
        callTool: mock(async (_server: string, tool: string) => {
          if (tool === 'broken') return {text: 'boom', images: [], isError: true}
          throw new Error('connection refused')
        }),
      },
    })
    seedMcp(context, 'weather', [forecastTool, {name: 'broken'}, {name: 'down'}])

    const miss = await executeCallVerb(context, {tool: 'weather__forecast', input: {}}, 'tc-miss')
    expect(String(miss.summary)).toContain('did not match its contract')
    expect(String(miss.contract)).toContain('# weather__forecast')
    expect(miss.validationErrors).toBeArray()

    await expect(executeCallVerb(context, {tool: 'weather__broken', input: {}}, 'tc-err')).rejects.toThrow(
      /reported an error: boom/,
    )
    await expect(executeCallVerb(context, {tool: 'weather__down', input: {}}, 'tc-down')).rejects.toThrow(
      /could not run down: connection refused/,
    )
  })

  test('a server the agent no longer enables cannot be reached, and a context without a pool refuses', async () => {
    const context = makeContext({mcp: {callTool: mock(async () => ({text: '', images: [], isError: false}))}})
    seedMcp(context, 'weather', [forecastTool])
    ;(context.definition as {mcpServers?: string[]}).mcpServers = []
    // The stale document is still present here (sync has not run); the grant check is the guard.
    await expect(executeCallVerb(context, {tool: 'weather__forecast', input: {city: 'x'}}, 'tc')).rejects.toThrow(
      /not enabled for this agent/,
    )
    ;(context.definition as {mcpServers?: string[]}).mcpServers = ['weather']
    delete context.mcp
    await expect(executeCallVerb(context, {tool: 'weather__forecast', input: {city: 'x'}}, 'tc')).rejects.toThrow(
      /cannot open/,
    )
  })

  test('image results ride to vision models only', async () => {
    const pool = {
      callTool: mock(async () => ({
        text: 'a chart',
        structured: undefined,
        images: [{data: 'AAAA', mimeType: 'image/png'}],
        isError: false,
      })),
    }
    const blind = makeContext({mcp: pool, modelAcceptsImages: false})
    seedMcp(blind, 'charts', [{name: 'render'}])
    const blindResult = await executeCallVerb(blind, {tool: 'charts__render', input: {}}, 'tc')
    expect(blindResult.images).toBe(1)
    expect(blindResult.piContent).toBeUndefined()

    const seeing = makeContext({mcp: pool, modelAcceptsImages: true})
    seedMcp(seeing, 'charts', [{name: 'render'}])
    const seeingResult = await executeCallVerb(seeing, {tool: 'charts__render', input: {}}, 'tc')
    expect(seeingResult.piContent).toEqual([
      {type: 'text', text: 'a chart'},
      {type: 'image', data: 'AAAA', mimeType: 'image/png'},
    ])
  })

  test('remote tools appear in the index and listing with their server, and collapse past a handful', async () => {
    const context = makeContext()
    seedMcp(context, 'weather', [forecastTool])
    seedMcp(
      context,
      'github',
      Array.from({length: 9}, (_, index) => ({name: `tool_${index}`, description: `Tool ${index}.`})),
    )
    apisvc.invalidateSpaceIndex('test-account', 'test-agent')
    const index = apisvc.buildSpaceIndex({
      db: context.db,
      accountId: 'test-account',
      agentId: 'test-agent',
      stateDir: context.stateDir,
      callableTools: context.callableTools,
    })
    expect(index).toContain('- weather__forecast — Forecast for a city. (weather MCP)')
    expect(index).toContain('- github__* — 9 tools from the github MCP server')
    expect(index).not.toContain('github__tool_3')

    const listing = await executeReadVerb(context, {address: '~/tools/'})
    expect(String(listing.markdown)).toContain('weather__forecast — Forecast for a city. (weather MCP)')
    expect(String(listing.markdown)).toContain('github__tool_3 — Tool 3. (github MCP)')

    const contract = await executeReadVerb(context, {address: '~/tools/weather__forecast'})
    expect(contract.kind).toBe('mcp')
    expect(String(contract.markdown)).toContain('`forecast` on the weather MCP server')
    expect(String(contract.markdown)).toContain('"required"')
  })
})
