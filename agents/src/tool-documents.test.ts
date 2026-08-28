import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as sqlite from '@/sqlite'
import * as toolDocs from '@/tool-documents'
import * as dagCbor from '@shm/shared/cbor'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeDb(): Database {
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  const now = Date.now()
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, ['acct', now, now])
  db.run(
    `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['agent', 'acct', new Uint8Array([160]), 'x', 'ready', now, now],
  )
  cleanups.push(() => db.close())
  return db
}

describe('tool documents', () => {
  test('builtin upsert is idempotent with stable CIDs', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const first = toolDocs.listToolDocuments(db, 'acct', 'agent')
    expect(first.map((row) => row.doc.name)).toEqual(['execute', 'search', 'web_search'])
    expect(first.every((row) => row.doc.kind === 'builtin' && row.cid.startsWith('b'))).toBe(true)

    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const second = toolDocs.listToolDocuments(db, 'acct', 'agent')
    expect(second.map((row) => [row.doc.name, row.cid, row.updatedAt])).toEqual(
      first.map((row) => [row.doc.name, row.cid, row.updatedAt]),
    )
  })

  test('a drifted builtin row is refreshed back to the registry contract', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    db.run(`UPDATE tool_documents SET cid = 'stale' WHERE name = 'search'`)
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const row = toolDocs.getToolDocument(db, 'acct', 'agent', 'search')
    expect(row?.cid).not.toBe('stale')
  })

  test('lambda save validates name, source, and schemas; builtins are protected', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const good = {
      name: 'csv_to_table',
      description: 'Convert CSV text into a markdown table.',
      input: {type: 'object', properties: {csv: {type: 'string'}}, required: ['csv']},
      source: 'export default async function (input) { return {ok: true} }',
    }
    const saved = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', good)
    expect(saved.doc.kind).toBe('lambda')
    expect(saved.doc.runtime).toBe('typescript')
    expect(saved.doc.summary).toContain('Convert CSV')

    // Same content → same CID (content addressing), different content → different CID.
    const again = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', good)
    expect(again.cid).toBe(saved.cid)
    const changed = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, source: good.source + ' '})
    expect(changed.cid).not.toBe(saved.cid)

    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, name: 'Bad Name'})).toThrow('lowercase')
    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, name: 'search'})).toThrow('builtin')
    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, source: ''})).toThrow('source')
    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, input: {type: 'wat'}})).toThrow(
      'schema',
    )
  })

  test('delete removes lambdas and refuses builtins', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {
      name: 'tmp_tool',
      description: 'Temp.',
      input: {type: 'object'},
      source: 'export default async () => 1',
    })
    expect(toolDocs.deleteToolDocument(db, 'acct', 'agent', 'tmp_tool')).toBe(true)
    expect(toolDocs.deleteToolDocument(db, 'acct', 'agent', 'tmp_tool')).toBe(false)
    expect(() => toolDocs.deleteToolDocument(db, 'acct', 'agent', 'search')).toThrow('builtin')
  })

  test('contract markdown carries version, schemas, and lambda source', () => {
    const db = makeDb()
    const saved = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {
      name: 'noop',
      description: 'Does nothing, reliably.',
      input: {type: 'object'},
      output: {type: 'object', properties: {ok: {type: 'boolean'}}},
      source: 'export default async () => ({ok: true})',
    })
    const markdown = toolDocs.toolDocumentContractMarkdown(saved)
    expect(markdown).toContain('# noop')
    expect(markdown).toContain(saved.cid)
    expect(markdown).toContain('## Input schema')
    expect(markdown).toContain('## Output schema')
    expect(markdown).toContain('## Source')
  })
})

describe('mcp tool documents', () => {
  function seedServer(
    db: Database,
    name: string,
    tools: Array<{name: string; description?: string; inputSchema?: unknown}>,
  ) {
    const now = Date.now()
    db.run(
      `INSERT INTO mcp_servers (id, account_id, name, config_cbor, tools_cbor, status_cbor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(account_id, name) DO UPDATE SET tools_cbor = excluded.tools_cbor, updated_at = excluded.updated_at`,
      [
        `id-${name}`,
        'acct',
        name,
        dagCbor.encode({url: 'http://127.0.0.1:1/mcp'}),
        dagCbor.encode(
          tools.map((tool) => toolDocs.mcpToolInfoFromDescriptor(name, tool as {name: string; description?: string})),
        ),
        now,
        now,
      ],
    )
  }

  test('projects enabled servers into <server>__<tool> documents and removes them when disabled', () => {
    const db = makeDb()
    seedServer(db, 'weather', [
      {
        name: 'forecast',
        description: 'Forecast for a city. Returns highs and lows.',
        inputSchema: {type: 'object', properties: {city: {type: 'string'}}, required: ['city']},
      },
      {name: 'alerts'},
    ])
    seedServer(db, 'github', [{name: 'create_issue', description: 'Open an issue.'}])

    const first = toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', ['weather'])
    expect(first.changed).toBe(true)
    const names = toolDocs.listToolDocuments(db, 'acct', 'agent').map((row) => row.doc.name)
    expect(names).toEqual(['weather__alerts', 'weather__forecast'])
    const forecast = toolDocs.getToolDocument(db, 'acct', 'agent', 'weather__forecast')!
    expect(forecast.doc).toMatchObject({
      kind: 'mcp',
      server: 'weather',
      remoteName: 'forecast',
      summary: 'Forecast for a city.',
      input: {type: 'object', required: ['city']},
    })
    // A tool with no description still reads as something, and an absent schema is an open object.
    expect(toolDocs.getToolDocument(db, 'acct', 'agent', 'weather__alerts')!.doc).toMatchObject({
      description: 'Tool "alerts" from the weather MCP server.',
      input: {type: 'object'},
    })

    // Idempotent: nothing rewritten when nothing changed.
    expect(toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', ['weather']).changed).toBe(false)

    // Enabling the second server adds its tools; a changed remote contract is a new CID.
    toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', ['weather', 'github'])
    expect(toolDocs.getToolDocument(db, 'acct', 'agent', 'github__create_issue')?.doc.kind).toBe('mcp')
    seedServer(db, 'github', [{name: 'create_issue', description: 'Open an issue with labels.'}])
    const before = toolDocs.getToolDocument(db, 'acct', 'agent', 'github__create_issue')!.cid
    toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', ['weather', 'github'])
    expect(toolDocs.getToolDocument(db, 'acct', 'agent', 'github__create_issue')!.cid).not.toBe(before)

    // Disabling a server removes exactly its documents.
    expect(toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', ['github']).changed).toBe(true)
    expect(toolDocs.listToolDocuments(db, 'acct', 'agent').map((row) => row.doc.name)).toEqual(['github__create_issue'])
    toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', [])
    expect(toolDocs.listToolDocuments(db, 'acct', 'agent')).toEqual([])
  })

  test('an authored tool keeps its name against a remote tool, and remote tools cannot be deleted or replaced', () => {
    const db = makeDb()
    toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {
      name: 'weather__forecast',
      description: 'Mine.',
      source: 'export default () => 1',
    })
    seedServer(db, 'weather', [{name: 'forecast'}, {name: 'alerts'}])
    const result = toolDocs.syncMcpToolDocuments(db, 'acct', 'agent', ['weather'])
    expect(result.conflicts).toEqual(['weather__forecast'])
    expect(toolDocs.getToolDocument(db, 'acct', 'agent', 'weather__forecast')?.doc.kind).toBe('lambda')

    expect(() =>
      toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {
        name: 'weather__alerts',
        description: 'Shadow.',
        source: 'export default () => 1',
      }),
    ).toThrow(/weather MCP server/)
    expect(() => toolDocs.deleteToolDocument(db, 'acct', 'agent', 'weather__alerts')).toThrow(/disable that server/)
    expect(
      toolDocs.toolDocumentContractMarkdown(toolDocs.getToolDocument(db, 'acct', 'agent', 'weather__alerts')!),
    ).toContain('`alerts` on the weather MCP server')
  })
})
