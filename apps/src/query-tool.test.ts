import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import {unpackHmId} from '@seed-hypermedia/client'
import {writeGuideRegistry} from '@seed-hypermedia/apps-protocol'
import * as apisvc from '@/api-service'
import {executeCallVerb, type AgentServicePiToolContext} from '@/api-service'
import {decode as cborDecode} from '@/cbor'
import * as sqlite from '@/sqlite'
import {lintWorkflowSource, runWorkflowVM, type WorkflowAdapters} from '@/workflow-host'

/**
 * The attribute query as an agent meets it, on the shape that defeated one: an issue tracker with
 * a couple of hundred rows, some with no Priority, asked to "set High on every empty Priority".
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeContext(): AgentServicePiToolContext {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'query-tool-test-'))
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
    sqlite.closeDatabase(db)
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  return {
    db,
    accountId: 'test-account',
    agentId: 'test-agent',
    sessionId: 'test-session',
    stateDir: dataDir,
    hmServerUrl: 'https://hm.test',
    callableTools: ['query', 'attributes'],
  } as unknown as AgentServicePiToolContext
}

type Doc = {account: string; path: string; metadata: Record<string, unknown>; updateTime: string}

/** The tracker document, 5 issues, and one sub-issue two levels down. */
const TRACKER: Doc[] = [
  {account: 'z6MkSpace', path: '/tasks', metadata: {name: 'Issue Tracker'}, updateTime: '2026-11-01T00:00:00Z'},
  {
    account: 'z6MkSpace',
    path: '/tasks/a',
    metadata: {name: 'A', Priority: 'High', Status: 'Done'},
    updateTime: '2026-11-02T00:00:00Z',
  },
  {account: 'z6MkSpace', path: '/tasks/b', metadata: {name: 'B', Status: 'To Do'}, updateTime: '2026-11-03T00:00:00Z'},
  {
    account: 'z6MkSpace',
    path: '/tasks/b/sub',
    metadata: {name: 'Sub of B', Status: 'To Do'},
    updateTime: '2026-11-03T00:00:00Z',
  },
  {
    account: 'z6MkSpace',
    path: '/tasks/c',
    metadata: {name: 'C', Priority: '', Status: 'To Do'},
    updateTime: '2026-11-04T00:00:00Z',
  },
  {
    account: 'z6MkSpace',
    path: '/tasks/d',
    metadata: {name: 'D', Priority: 'Low', Status: 'Done'},
    updateTime: '2026-11-05T00:00:00Z',
  },
  {account: 'z6MkSpace', path: '/tasks/e', metadata: {name: 'E', Status: 'Done'}, updateTime: '2026-11-06T00:00:00Z'},
]

/**
 * Serves QueryDocuments from `docs`, `perPage` at a time with offset page tokens, ignoring the
 * filter (the daemon's matching is not under test; what the tool does with pages is).
 */
function mockQueryApi(options: {
  docs: Doc[]
  perPage?: number
  names?: string[]
  values?: string[]
}): Array<Record<string, unknown>> {
  const requests: Array<Record<string, unknown>> = []
  const originalFetch = globalThis.fetch
  cleanups.push(() => {
    globalThis.fetch = originalFetch
  })
  globalThis.fetch = mock(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    const body = cborDecode<Record<string, unknown>>(init?.body as Uint8Array)
    if (href.includes('/api/QueryDocuments')) {
      requests.push(body)
      const perPage = options.perPage ?? Number(body.pageSize ?? 50)
      const offset = body.pageToken ? Number(body.pageToken) : 0
      const page = options.docs.slice(offset, offset + perPage)
      const next = offset + perPage
      return Response.json({documents: page, nextPageToken: next < options.docs.length ? String(next) : ''})
    }
    if (href.includes('/api/ListDocumentAttributeNames')) {
      return Response.json({
        names: (options.names ?? []).map((name) => ({name, kinds: [{kind: 'DOCUMENT_ATTRIBUTE_KIND_STRING'}]})),
      })
    }
    if (href.includes('/api/ListDocumentAttributeValues')) {
      return Response.json({values: (options.values ?? []).map((value) => ({value: {stringValue: value}}))})
    }
    throw new Error(`Unexpected fetch: ${href}`)
  }) as unknown as typeof fetch
  return requests
}

const query = (context: AgentServicePiToolContext, input: Record<string, unknown>) =>
  executeCallVerb(context, {tool: 'query', input}, undefined)

describe('query tool', () => {
  test('childrenOf keeps the direct children: not the document itself, not deeper descendants', async () => {
    const requests = mockQueryApi({docs: TRACKER})
    const result = await query(makeContext(), {childrenOf: 'hm://z6MkSpace/tasks', q: 'empty:Priority'})
    expect(requests[0]?.filter).toEqual({
      and: {
        filters: [
          {urlMatch: {url: 'hm://z6MkSpace/tasks', prefix: true}},
          {
            or: {
              filters: [
                {missing: {key: 'Priority'}},
                {comparison: {key: 'Priority', operator: 'EQUAL', value: {stringValue: ''}}},
              ],
            },
          },
        ],
      },
    })
    const urls = (result.results as Array<{url: string}>).map((row) => row.url)
    expect(urls).toEqual([
      'hm://z6MkSpace/tasks/a',
      'hm://z6MkSpace/tasks/b',
      'hm://z6MkSpace/tasks/c',
      'hm://z6MkSpace/tasks/d',
      'hm://z6MkSpace/tasks/e',
    ])
    expect(String(result.summary)).toContain('that is all of them')
  })

  test('a direct-children page keeps reading the subtree until it is full or done', async () => {
    // Every other document is a grandchild, so one subtree page of 4 holds only 2 children.
    const docs: Doc[] = Array.from({length: 12}, (_, index) => ({
      account: 'z6MkSpace',
      path: index % 2 ? `/tasks/i${index - 1}/sub` : `/tasks/i${index}`,
      metadata: {name: `Doc ${index}`},
      updateTime: '2026-11-01T00:00:00Z',
    }))
    const requests = mockQueryApi({docs})
    const result = await query(makeContext(), {childrenOf: 'hm://z6MkSpace/tasks', pageSize: 4})
    expect(requests).toHaveLength(2)
    expect(result.results as unknown[]).toHaveLength(4)
    expect(result.nextPageToken).toBe('8')
    expect(String(result.markdown)).toContain('pageToken "8"')
  })

  test('select shows the asked-for fields, spelling out a missing and an empty value', async () => {
    mockQueryApi({docs: TRACKER})
    const result = await query(makeContext(), {
      childrenOf: 'hm://z6MkSpace/tasks',
      select: ['Priority', 'Status', '$updated'],
    })
    const markdown = String(result.markdown)
    expect(markdown).toContain('- [A](hm://z6MkSpace/tasks/a) — Priority: High · Status: Done · $updated: 2026-11-02')
    expect(markdown).toContain('- [B](hm://z6MkSpace/tasks/b) — Priority: (missing) · Status: To Do')
    expect(markdown).toContain('- [C](hm://z6MkSpace/tasks/c) — Priority: "" · Status: To Do')
  })

  test('count and groupBy read every page and report totals per value', async () => {
    const requests = mockQueryApi({docs: TRACKER, perPage: 3})
    const result = await query(makeContext(), {childrenOf: 'hm://z6MkSpace/tasks', groupBy: 'Priority'})
    expect(requests).toHaveLength(3)
    expect(result.total).toBe(5)
    expect(result.complete).toBe(true)
    expect(result.counts).toEqual([
      {value: '(missing)', count: 2},
      {value: '""', count: 1},
      {value: 'High', count: 1},
      {value: 'Low', count: 1},
    ])
    expect(String(result.markdown)).toContain('- (missing): 2')
    expect(result.results).toBeUndefined()
  })

  test('a query that finds nothing says when a key or a value only differs by case', async () => {
    mockQueryApi({docs: [], names: ['Priority'], values: ['High', 'Low']})
    const wrongKey = await query(makeContext(), {q: 'in:z6MkSpace priority=High'})
    expect(String(wrongKey.markdown)).toContain('did you mean `Priority`?')
    const wrongValue = await query(makeContext(), {q: 'in:z6MkSpace Priority=high'})
    expect(String(wrongValue.markdown)).toContain('did you mean "High"?')
    const unknownValue = await query(makeContext(), {q: 'in:z6MkSpace Priority=Urgent'})
    expect(String(unknownValue.markdown)).toContain('Values in use in this space: "High", "Low".')
  })

  test('a malformed query, a != and a sort directive are all accounted for', async () => {
    const requests = mockQueryApi({docs: TRACKER})
    const result = await query(makeContext(), {q: 'in:z6MkSpace (Status!=Done sort:-$updated,Priority'})
    expect(requests[0]?.sort).toEqual([
      {attribute: 'BUILTIN_SORT_ATTRIBUTE_UPDATE_TIME', descending: true},
      {key: 'Priority', descending: false},
    ])
    const warnings = (result.warnings as string[]).join('\n')
    expect(warnings).toContain('Missing closing parenthesis.')
    expect(warnings).toContain('NOT key=value')
  })

  test('the model gets one compact listing; a script still gets the records', async () => {
    const docs: Doc[] = Array.from({length: 100}, (_, index) => ({
      account: 'z6MkSpace',
      path: `/tasks/issue-${index}`,
      metadata: {name: `Issue ${index}`, Priority: 'High', Status: 'To Do', Notes: 'x'.repeat(500)},
      updateTime: '2026-11-01T00:00:00Z',
    }))
    mockQueryApi({docs: [...docs, ...docs], perPage: 100})
    const forScript = await query(makeContext(), {q: 'in:z6MkSpace has:Priority', pageSize: 100})
    expect(forScript.results as unknown[]).toHaveLength(100)
    const forModel = apisvc.modelFacingCallResult('query', forScript)
    expect(forModel.results).toBeUndefined()
    expect(forModel.filter).toBeUndefined()
    const text = JSON.stringify(forModel)
    // Under the model's result ceiling, with the page token still in it.
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThan(apisvc.MAX_MODEL_TOOL_RESULT_BYTES)
    expect(apisvc.boundModelToolResultText(text)).toBe(text)
    expect(text).toContain('pageToken \\"100\\"')
    expect(String(forModel.markdown)).toMatch(/\d+ more documents are on this page but not shown/)
    // Other tools' results pass through untouched.
    const other = {summary: 'x', results: [1]}
    expect(apisvc.modelFacingCallResult('search', other)).toBe(other)
  })

  test('query and attributes stay callable when an agent lists other tools', () => {
    const enabled = apisvc.enabledCallableTools({tools: ['search', 'web_search', 'execute', 'publish']} as never, true)
    expect(enabled).toEqual(expect.arrayContaining(['search', 'web_search', 'execute', 'query', 'attributes']))
    expect(enabled).not.toContain('browser')
    expect(apisvc.enabledCallableTools({tools: []} as never, true).sort()).toEqual(['attributes', 'query'])
  })
})

describe('directory listing as the model reads it', () => {
  test('lists every child with its attributes and pages to the end', async () => {
    const originalFetch = globalThis.fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    const children = Array.from({length: 218}, (_, index) => {
      const slug = `a-long-issue-title-slug-number-${index}-with-many-words-in-its-path`
      return {
        type: 'document',
        id: unpackHmId(`hm://z6MkSpace/tasks/${slug}`),
        path: ['tasks', slug],
        authors: [],
        createTime: '2026-01-01T00:00:00Z',
        updateTime: '2026-02-02T00:00:00Z',
        sortTime: new Date('2026-02-02T00:00:00Z'),
        genesis: 'gen',
        version: 'v1',
        breadcrumbs: [],
        activitySummary: {
          latestCommentId: '',
          commentCount: 0,
          latestChangeTime: '2026-02-02T00:00:00Z',
          isUnread: false,
          childrenCount: 0,
        },
        generationInfo: {genesis: 'gen', generation: 1n},
        metadata: {
          name: `A long issue title number ${index} with many words in it`,
          Status: 'To Do',
          ...(index % 2 ? {Priority: 'High'} : {}),
          Owner: 'hm://z6Mkvz9TgGtv9zsGsdrksfNk1ajbFancgHREJEz3Y2HsAVdk',
        },
        visibility: 'PUBLIC',
      }
    })
    globalThis.fetch = mock(async (url: string | URL) => {
      const href = decodeURIComponent(String(url))
      if (href.includes('/api/Query')) {
        return Response.json(serialize({in: unpackHmId('hm://z6MkSpace/tasks'), mode: 'Children', results: children}))
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }) as unknown as typeof fetch

    const full = await apisvc.readHypermedia({id: 'hm://z6MkSpace/tasks/:directory', server: 'https://hm.test'})
    // A script reads the records, attributes included.
    const documents = full.documents as Array<{attributes: Record<string, unknown>}>
    expect(documents).toHaveLength(218)
    expect(documents[1]?.attributes.Priority).toBe('High')

    const seen: string[] = []
    let offset = 0
    for (let pages = 0; pages < 20; pages++) {
      const input = {address: 'hm://z6MkSpace/tasks/:directory', options: offset ? {offset} : {}}
      const page = apisvc.paginateReadResult(full, input)
      const text = JSON.stringify(page)
      expect(apisvc.boundModelToolResultText(text)).toBe(text)
      expect(page.documents).toBeUndefined()
      seen.push(String(page.markdown))
      const next = (page.page as {nextOffset?: number} | undefined)?.nextOffset
      if (!next) break
      offset = next
    }
    const listing = seen.join('')
    expect(seen.length).toBeGreaterThan(1)
    expect(listing.match(/^- \[/gm)).toHaveLength(218)
    expect(listing).toContain('Status: To Do · Priority: High')
    expect(listing).toContain('childrenOf: "hm://z6MkSpace/tasks"')
    expect(listing).not.toContain('(0 children)')
  })

  test('options a hypermedia read does not take are named, not silently dropped', () => {
    const result = {type: 'hypermedia_directory', markdown: '# Directory', documents: []}
    const page = apisvc.paginateReadResult(result, {
      address: 'hm://z6MkSpace/tasks/:directory',
      format: 'json',
      options: {limit: 10},
    })
    const notes = (page.notes as string[]).join('\n')
    expect(notes).toContain('Ignored option `limit`')
    expect(notes).toContain('query tool')
    expect(notes).toContain('always markdown')
    // Memory reads and their options are none of this note's business.
    const memory = {summary: 'x', content: 'y'}
    expect(apisvc.paginateReadResult(memory, {address: '~/memory/a', options: {limit: 10}})).toBe(memory)
  })
})

describe('the bulk-update script in the documents write guide', () => {
  const guide = (writeGuideRegistry as Record<string, {markdown: string}>).documents!.markdown
  const source = guide.match(/```js\n([\s\S]*?)```/)?.[1] ?? ''

  test('is a valid workflow source', () => {
    expect(source).toContain('export default async function')
    expect(lintWorkflowSource(source)).toEqual([])
  })

  test('collects every page, updates each document, and reports what failed', async () => {
    const docs = Array.from({length: 23}, (_, index) => ({
      url: `hm://z6MkSpace/tasks/issue-${index}`,
      name: `Issue ${index}`,
    }))
    const queries: Array<Record<string, unknown>> = []
    const writes: Array<Record<string, unknown>> = []
    const journal: unknown[] = []
    const adapters = {
      runId: 'wf-bulk',
      input: {parent: 'hm://z6MkSpace/tasks', q: 'empty:Priority', set: {Priority: 'High'}},
      source,
      journal: {load: () => [...journal], append: (entry: unknown) => journal.push(entry)},
      effects: {
        callTool: async (tool: string, input: unknown) => {
          const record = input as Record<string, unknown>
          if (tool === 'query') {
            queries.push(record)
            const offset = record.pageToken ? Number(record.pageToken) : 0
            const next = offset + 10
            return {results: docs.slice(offset, next), nextPageToken: next < docs.length ? String(next) : undefined}
          }
          writes.push(record)
          if (record.address === 'hm://z6MkSpace/tasks/issue-7') throw new Error('Document version conflict')
          if (record.address === 'hm://z6MkSpace/tasks/issue-9') {
            return {type: 'hypermedia_write_error', message: 'not allowed'}
          }
          return {type: 'hypermedia_write_result'}
        },
        spawnAgent: () => ({childRunId: 'child-1'}),
        awaitChild: async () => ({status: 'succeeded', output: null}),
        updatePlan: () => {},
        progress: () => {},
        registerEventWait: () => {},
      },
      isCanceled: () => false,
    } as unknown as WorkflowAdapters
    const outcome = await runWorkflowVM(adapters)
    if (outcome.type !== 'succeeded') throw new Error(`script did not finish: ${JSON.stringify(outcome)}`)
    expect(queries.map((call) => call.pageToken)).toEqual([undefined, '10', '20'])
    expect(queries[0]).toMatchObject({childrenOf: 'hm://z6MkSpace/tasks', q: 'empty:Priority', pageSize: 100})
    expect(writes).toHaveLength(23)
    expect(writes[0]).toEqual({
      address: 'hm://z6MkSpace/tasks/issue-0',
      options: {action: 'update', metadata: {Priority: 'High'}},
    })
    const output = outcome.output as {matched: number; updated: number; failed: Array<{url: string; error: string}>}
    expect(output.matched).toBe(23)
    expect(output.updated).toBe(21)
    expect(output.failed.map((entry) => entry.url).sort()).toEqual([
      'hm://z6MkSpace/tasks/issue-7',
      'hm://z6MkSpace/tasks/issue-9',
    ])
  })
})
