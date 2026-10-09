import {Database} from 'bun:sqlite'
import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as blobs from '@shm/shared/blobs'
import * as agentMemory from '@/agent-memory'
import * as apisvc from '@/api-service'
import * as config from '@/config'
import * as conversionLedger from '@/conversion-ledger'
import {FAKE_DATALAB_COMPLETION, startFakeDatalab} from '@/datalab-test-server'
import * as sqlite from '@/sqlite'

type Fake = ReturnType<typeof startFakeDatalab>

/** Service, account and agent ready to call `convert`; the model call is failed fast by the fetch stub. */
async function setup(options: {fake?: Fake; convert?: Partial<apisvc.ConvertToolsConfig>; tools?: string[]}) {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('schema failed')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-convert-'))
  const events: apisvc.ServiceEvent[] = []
  const svc = new apisvc.Service(db, dataDir, {
    onEvent: (event) => events.push(event),
    hmServerUrl: 'https://hm.test',
    convert: {
      ...config.CONVERT_DEFAULTS,
      pollIntervalMs: 20,
      ...(options.fake ? {datalabApiKey: 'server-key', datalabBaseUrl: options.fake.baseUrl} : {}),
      ...options.convert,
    },
  })
  const account = blobs.generateNobleKeyPair()
  const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
    svc.message(await apisvc.createSignedEnvelope(account, {action}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const agent = await send({
    _: 'CreateAgent',
    definition: {
      name: 'Importer',
      systemPrompt: 'import',
      modelProvider: 'openai',
      model: 'gpt-test',
      tools: options.tools ?? ['convert'],
    },
  })
  if (agent._ !== 'CreateAgentResponse') throw new Error(`unexpected ${agent._}`)
  const session = await send({_: 'CreateSession', agentId: agent.agentId})
  if (session._ !== 'CreateSessionResponse') throw new Error(`unexpected ${session._}`)
  const agentRow = db
    .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
    .get(agent.agentId)
  const stateDir = agentRow!.state_dir
  const convert = async (input: Record<string, unknown>) => {
    const invoked = await send({
      _: 'InvokeSessionTool',
      sessionId: session.sessionId,
      verb: 'call',
      input: {tool: 'convert', input},
    })
    if (invoked._ !== 'InvokeSessionToolResponse') throw new Error(`unexpected ${invoked._}`)
    await svc.awaitQueueIdle()
    return invoked
  }
  const write = (rel: string, content: string | Uint8Array) => agentMemory.writeMemoryFile(stateDir, rel, content)
  const read = (rel: string) => {
    const file = agentMemory.readMemoryFile(stateDir, rel)
    return file.encoding === 'binary' ? new TextDecoder().decode(file.data) : file.content ?? ''
  }
  const exists = (rel: string) => fs.existsSync(agentMemory.resolveMemoryPath(stateDir, rel).absPath)
  const accountId = blobs.principalToString(account.principal)
  const ledgerRows = () =>
    db
      .query<{state: string; pages_reserved: number; pages_charged: number}, []>(
        `SELECT state, pages_reserved, pages_charged FROM conversion_usage ORDER BY created_at`,
      )
      .all()
  return {
    svc,
    db,
    dataDir,
    events,
    send,
    convert,
    write,
    read,
    exists,
    accountId,
    agentId: agent.agentId,
    ledgerRows,
    stateDir,
  }
}

const PDF = new TextEncoder().encode('%PDF-1.4\nfake pdf body')

describe('convert builtin', () => {
  const realFetch = globalThis.fetch
  let cleanups: (() => void)[] = []
  beforeEach(() => {
    // Loopback traffic (the fake Datalab) passes through; the model call fails fast.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
      return new Response('{"error":"no model in tests"}', {status: 401})
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const cleanup of cleanups.splice(0)) cleanup()
  })
  const track = (fake: Fake, t: Awaited<ReturnType<typeof setup>>) => {
    cleanups.push(() => {
      fake.stop()
      sqlite.closeDatabase(t.db)
      fs.rmSync(t.dataDir, {recursive: true, force: true})
    })
  }

  test('converts a PDF with the shared key, writes the output tree and settles the ledger', async () => {
    const fake = startFakeDatalab({processingPolls: 1})
    const t = await setup({fake})
    track(fake, t)
    t.write('incoming/My Paper.pdf', PDF)
    const invoked = await t.convert({files: ['incoming/My Paper.pdf']})
    expect(invoked.error).toBeUndefined()
    const output = invoked.output as Record<string, unknown>
    expect(output.summary).toContain('Converted 1 document into datalab-imports/ (3 pages, 2 figures)')
    expect(output.documents).toEqual([
      {
        source: 'incoming/My Paper.pdf',
        outputDir: 'datalab-imports/my-paper',
        markdownPath: 'datalab-imports/my-paper/seed.md',
        pages: 3,
        images: 2,
        truncated: false,
        captions: 0,
        citationsLinked: 0,
        citationsUnlinked: 0,
      },
    ])
    expect(output.failures).toEqual([])
    expect(output).toMatchObject({keySource: 'server', pagesChargedThisCall: 3, pagesRemainingThisMonth: 997})

    expect(t.read('datalab-imports/my-paper/raw.md')).toBe(FAKE_DATALAB_COMPLETION.markdown)
    expect(t.read('datalab-imports/my-paper/seed.md')).toBe(
      '# Title\n\nText\n\n![Figure 1](assets/fig1.png)\n\nmore text.\n\n![](assets/_page_0_Picture_2.jpeg)\n',
    )
    expect(t.read('datalab-imports/my-paper/assets/fig1.png')).toBe('PNGDATA')
    const manifest = JSON.parse(t.read('datalab-imports/my-paper/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      source: 'incoming/My Paper.pdf',
      keySource: 'server',
      mode: 'accurate',
      pageCount: 3,
      maxPagesApplied: conversionLedger.CONVERT_PAGES_PER_CALL_CAP,
      truncated: false,
      parseQualityScore: 4.5,
      costCents: 1.2,
      imagesRewritten: 2,
      requestId: 'req-1',
    })

    const submission = fake.submissions[0]!
    expect(submission.apiKey).toBe('server-key')
    expect(submission.fileType).toBe('application/pdf')
    expect(submission.fileName).toBe('My Paper.pdf')
    expect(submission.fields).toMatchObject({
      mode: 'accurate',
      extras: 'extract_links,chart_understanding',
      disable_image_captions: 'true',
      max_pages: String(conversionLedger.CONVERT_PAGES_PER_CALL_CAP),
    })
    expect(t.ledgerRows()).toEqual([
      {state: 'settled', pages_reserved: conversionLedger.CONVERT_PAGES_PER_CALL_CAP, pages_charged: 3},
    ])
    expect(
      t.events.some(
        (e) => e.type === 'account-change' && e.reason === 'agent-memory-changed' && e.agentId === t.agentId,
      ),
    ).toBe(true)
  })

  test('captions are attached to their figures and numeric citations linked to the references', async () => {
    const fake = startFakeDatalab({
      completions: [
        {
          ...FAKE_DATALAB_COMPLETION,
          markdown: [
            '# Paper',
            '',
            'Arcs were studied in [1, 2]. See [3].',
            '',
            '![](fig1.png)',
            '',
            'Figure 1: Regular and irregular structures',
            '',
            '#### 5. REFERENCES',
            '',
            '- [1] First, 2004.',
            '- [2] Second, 2004.',
            '',
          ].join('\n'),
          images: {'fig1.png': Buffer.from('PNG').toString('base64')},
        },
      ],
    })
    const t = await setup({fake})
    track(fake, t)
    t.write('paper.pdf', PDF)
    const output = (await t.convert({files: ['paper.pdf']})).output as Record<string, unknown>
    expect(output.summary).toContain(
      '1 caption attached to figures, 2 citations linked to the references, 1 citation without a reference entry left as text',
    )
    expect(output.documents).toEqual([expect.objectContaining({captions: 1, citationsLinked: 2, citationsUnlinked: 1})])
    expect(t.read('datalab-imports/paper/seed.md')).toBe(
      [
        '# Paper',
        '',
        'Arcs were studied in [[1](#ref-1), [2](#ref-2)]. See [3].',
        '',
        '![Figure 1: Regular and irregular structures](assets/fig1.png)',
        '',
        '#### 5. REFERENCES',
        '',
        '- [1] First, 2004. <!-- id:ref-1 -->',
        '- [2] Second, 2004. <!-- id:ref-2 -->',
        '',
      ].join('\n'),
    )
    const manifest = JSON.parse(t.read('datalab-imports/paper/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({captionsFolded: 1, referenceEntries: 2, citationsLinked: 2, citationsUnlinked: [3]})
  })

  test('a folder converts every supported file in parallel, skips the rest, and keeps going past one failure', async () => {
    const fake = startFakeDatalab({
      completions: [
        FAKE_DATALAB_COMPLETION,
        {status: 'complete', success: false, error: 'Could not parse the file'},
        {...FAKE_DATALAB_COMPLETION, page_count: 1, images: {}},
        {...FAKE_DATALAB_COMPLETION, page_count: 2, images: {}},
      ],
    })
    const t = await setup({fake, convert: {concurrency: 2}})
    track(fake, t)
    t.write('papers/a.pdf', PDF)
    t.write('papers/b.pdf', PDF)
    t.write('papers/nested/deck.pptx', new Uint8Array([1, 2, 3]))
    t.write('papers/scan.png', new Uint8Array([137, 80, 78, 71]))
    t.write('papers/notes.txt', 'not a document')
    const invoked = await t.convert({files: ['papers']})
    const output = invoked.output as {
      documents: {source: string}[]
      failures: {source: string; error: string}[]
      summary: string
    }
    expect(output.documents.map((d) => d.source)).toEqual([
      'papers/a.pdf',
      'papers/nested/deck.pptx',
      'papers/scan.png',
    ])
    expect(output.failures).toEqual([{source: 'papers/b.pdf', error: 'Could not parse the file'}])
    expect(output.summary).toContain('Converted 3 documents')
    expect(output.summary).toContain('1 failed')
    expect(output.summary).toContain('1 unsupported file skipped')
    expect(fake.peakInFlight).toBeLessThanOrEqual(2)
    expect(fake.submissions.map((s) => s.fileType).sort()).toEqual(
      [
        'application/pdf',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/png',
      ].sort(),
    )
    const states = t
      .ledgerRows()
      .map((r) => r.state)
      .sort()
    expect(states).toEqual(['released', 'settled', 'settled', 'settled'])
    expect(t.exists('datalab-imports/b')).toBe(false)
  })

  test('overwrite is explicit: an existing output folder is a failure without it and replaced with it', async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake})
    track(fake, t)
    t.write('a.pdf', PDF)
    t.write('datalab-imports/a/seed.md', 'old')
    t.write('datalab-imports/a/assets/stale.png', 'stale')
    const first = (await t.convert({files: ['a.pdf']})).output as {failures: {error: string}[]}
    expect(first.failures[0]?.error).toContain('already exists')
    expect(fake.submissions).toHaveLength(0)
    expect(t.ledgerRows()).toEqual([])
    const second = (await t.convert({files: ['a.pdf'], overwrite: true})).output as {documents: unknown[]}
    expect(second.documents).toHaveLength(1)
    expect(t.read('datalab-imports/a/seed.md')).toContain('# Title')
    expect(t.exists('datalab-imports/a/assets/stale.png')).toBe(false)
  })

  test("the account's own key is used unmetered and may ask for any mode", async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake, convert: {mode: 'balanced'}})
    track(fake, t)
    await t.send({
      _: 'SetSecret',
      name: 'datalab-api-key',
      value: new TextEncoder().encode('own-key\n'),
      metadata: {kind: 'datalab-api-key'},
    })
    t.write('a.pdf', PDF)
    const output = (await t.convert({files: ['a.pdf'], mode: 'accurate', max_pages: 5})).output as Record<
      string,
      unknown
    >
    expect(output.keySource).toBe('own')
    expect(output.pagesChargedThisCall).toBeUndefined()
    expect(fake.submissions[0]).toMatchObject({apiKey: 'own-key', fields: {mode: 'accurate', max_pages: '5'}})
    expect(t.ledgerRows()).toEqual([])
    const manifest = JSON.parse(t.read('datalab-imports/a/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({keySource: 'own', maxPagesApplied: 5, truncated: false})
  })

  test('on the shared key a more expensive mode is lowered to the server mode', async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake, convert: {mode: 'balanced'}})
    track(fake, t)
    t.write('a.pdf', PDF)
    const output = (await t.convert({files: ['a.pdf'], mode: 'accurate'})).output as {summary: string}
    expect(fake.submissions[0]?.fields.mode).toBe('balanced')
    expect(output.summary).toContain('mode lowered to balanced')
    const manifest = JSON.parse(t.read('datalab-imports/a/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({mode: 'balanced', modeDowngraded: true, modeRequested: 'accurate'})
    expect(fake.submissions).toHaveLength(1)
    const cheaper = (await t.convert({files: ['a.pdf'], mode: 'fast', overwrite: true})).output as {summary: string}
    expect(fake.submissions[1]?.fields.mode).toBe('fast')
    expect(cheaper.summary).not.toContain('lowered')
  })

  test('the reservation is what Datalab is told, and a cut document says so', async () => {
    const fake = startFakeDatalab({completions: [{...FAKE_DATALAB_COMPLETION, page_count: 10, images: {}}]})
    const t = await setup({fake, convert: {allowancePagesPerMonth: 10}})
    track(fake, t)
    t.write('long.pdf', PDF)
    const output = (await t.convert({files: ['long.pdf']})).output as {
      documents: {truncated: boolean}[]
      summary: string
    }
    expect(fake.submissions[0]?.fields.max_pages).toBe('10')
    expect(output.documents[0]?.truncated).toBe(true)
    expect(output.summary).toContain('1 cut at the page cap')
    const manifest = JSON.parse(t.read('datalab-imports/long/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      maxPagesApplied: 10,
      truncated: true,
      truncationReason: 'account allowance remaining this month',
    })
    // The allowance is now spent: the next call is refused before anything is sent.
    const refused = await t.convert({files: ['long.pdf'], overwrite: true})
    expect(refused.error).toContain('used 10 of its 10 shared conversion pages')
    expect(refused.error).toContain('datalab-api-key')
    expect(fake.submissions).toHaveLength(1)
  })

  test('a rejected server key stops the batch with a configuration error', async () => {
    const fake = startFakeDatalab({submitStatuses: [401]})
    const t = await setup({fake})
    track(fake, t)
    t.write('a.pdf', PDF)
    const invoked = await t.convert({files: ['a.pdf']})
    expect(invoked.error).toContain('rejected this server')
    expect(invoked.error).not.toContain('server-key')
    expect(t.ledgerRows()).toEqual([
      {state: 'released', pages_reserved: conversionLedger.CONVERT_PAGES_PER_CALL_CAP, pages_charged: 0},
    ])
  })

  test('bad input is answered up front, bad files land in failures', async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake})
    track(fake, t)
    t.write('fake.pdf', 'this is text, not a pdf')
    t.write('notes.md', '# notes')
    const output = (await t.convert({files: ['fake.pdf', 'notes.md', 'missing.pdf']})).output as {
      failures: {source: string; error: string}[]
      summary: string
    }
    expect(output.failures.map((f) => f.source)).toEqual(['missing.pdf', 'fake.pdf', 'notes.md'])
    expect(output.failures[1]?.error).toContain('Not a PDF')
    expect(output.failures[2]?.error).toContain('Unsupported document type')
    expect(output.summary).toBe('Converted nothing. 3 failed.')
    expect(fake.submissions).toHaveLength(0)
    expect((await t.convert({files: ['papers/*.pdf']})).error).toContain('Globs are not expanded')
    expect((await t.convert({files: ['a.pdf'], page_range: 'x-y'})).error).toContain('page_range')
  })

  test('without a key, a relay or an account secret the tool is not offered; with the secret it is', async () => {
    const t = await setup({})
    cleanups.push(() => {
      sqlite.closeDatabase(t.db)
      fs.rmSync(t.dataDir, {recursive: true, force: true})
    })
    expect(t.svc.convertCapabilities()).toEqual({available: false, source: 'none'})
    t.write('a.pdf', PDF)
    const missing = (await t.convert({files: ['a.pdf']})).output as {summary: string}
    expect(missing.summary).toContain('No callable tool named convert')
    const tools = await t.send({_: 'ListAgentTools', agentId: t.agentId})
    if (tools._ !== 'ListAgentToolsResponse') throw new Error('unexpected')
    expect(tools.tools.find((tool) => tool.name === 'convert')?.granted).toBe(false)
    await t.send({_: 'SetSecret', name: 'datalab-api-key', value: new TextEncoder().encode('own-key')})
    const offered = await t.send({_: 'ListAgentTools', agentId: t.agentId})
    if (offered._ !== 'ListAgentToolsResponse') throw new Error('unexpected')
    expect(offered.tools.find((tool) => tool.name === 'convert')?.granted).toBe(true)
  })

  test('capabilities report the key and the relay', () => {
    const db = new Database(':memory:', {create: true, strict: true})
    sqlite.openWithDatabase(db)
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-convert-'))
    try {
      expect(
        new apisvc.Service(db, dataDir, {
          convert: {...config.CONVERT_DEFAULTS, datalabApiKey: 'k'},
        }).convertCapabilities(),
      ).toEqual({
        available: true,
        source: 'key',
      })
      expect(
        new apisvc.Service(db, dataDir, {
          convert: {...config.CONVERT_DEFAULTS, relayUrl: 'http://127.0.0.1:1'},
        }).convertCapabilities(),
      ).toEqual({available: true, source: 'relay'})
    } finally {
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })
})
