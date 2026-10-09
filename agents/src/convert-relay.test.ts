import {Database} from 'bun:sqlite'
import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as blobs from '@shm/shared/blobs'
import * as agentMemory from '@/agent-memory'
import * as apisvc from '@/api-service'
import * as auth from '@/auth'
import * as config from '@/config'
import * as conversionLedger from '@/conversion-ledger'
import * as convertRelay from '@/convert-relay'
import {FAKE_DATALAB_COMPLETION, startFakeDatalab} from '@/datalab-test-server'
import {createAPIRoutes} from '@/main'
import * as sqlite from '@/sqlite'

const PDF = new TextEncoder().encode('%PDF-1.4\nfake pdf body')

function openService(options: Partial<apisvc.ConvertToolsConfig>, onEvent?: (event: apisvc.ServiceEvent) => void) {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('schema failed')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-relay-'))
  const svc = new apisvc.Service(db, dataDir, {
    onEvent,
    hmServerUrl: 'https://hm.test',
    convert: {...config.CONVERT_DEFAULTS, pollIntervalMs: 20, ...options},
  })
  return {
    svc,
    db,
    dataDir,
    close: () => {
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    },
  }
}

/** The hosted server behind a real HTTP route, the way the local server reaches it. */
function serveHosted(svc: apisvc.Service) {
  const server = Bun.serve({
    port: 0,
    routes: createAPIRoutes(svc),
    fetch: () => new Response('Not Found', {status: 404}),
  })
  return {url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true)}
}

describe('convert relay', () => {
  const realFetch = globalThis.fetch
  const cleanups: (() => void)[] = []
  beforeEach(() => {
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

  /** A local server whose agent has its own identity and the convert grant, with the PDF in memory. */
  async function localAgent(relayUrl: string) {
    const events: apisvc.ServiceEvent[] = []
    const local = openService({relayUrl}, (event) => events.push(event))
    cleanups.push(local.close)
    const owner = blobs.generateNobleKeyPair()
    const identity = blobs.generateNobleKeyPair()
    const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
      local.svc.message(await apisvc.createSignedEnvelope(owner, {action}))
    await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
    await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
    const imported = await send({_: 'ImportSigningIdentity', seed: identity.seed, label: 'Importer'})
    if (imported._ !== 'ImportSigningIdentityResponse') throw new Error(`unexpected ${imported._}`)
    const signingKey = imported.identity.name
    const agent = await send({
      _: 'CreateAgent',
      definition: {
        name: 'Importer',
        systemPrompt: 'import',
        modelProvider: 'openai',
        model: 'gpt-test',
        tools: ['convert'],
        signingKey,
        signingKeys: [signingKey],
      },
    })
    if (agent._ !== 'CreateAgentResponse') throw new Error(`unexpected ${agent._}`)
    const session = await send({_: 'CreateSession', agentId: agent.agentId})
    if (session._ !== 'CreateSessionResponse') throw new Error(`unexpected ${session._}`)
    const stateDir = local.db
      .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
      .get(agent.agentId)!.state_dir
    agentMemory.writeMemoryFile(stateDir, 'incoming/paper.pdf', PDF)
    const convert = async (input: Record<string, unknown>) => {
      const invoked = await send({
        _: 'InvokeSessionTool',
        sessionId: session.sessionId,
        verb: 'call',
        input: {tool: 'convert', input},
      })
      if (invoked._ !== 'InvokeSessionToolResponse') throw new Error(`unexpected ${invoked._}`)
      await local.svc.awaitQueueIdle()
      return invoked
    }
    return {
      local,
      events,
      owner,
      identity,
      identityAccountId: blobs.principalToString(identity.principal),
      stateDir,
      convert,
      send,
      agentId: agent.agentId,
    }
  }

  test('a keyless server converts through the hosted one, which bills the agent identity', async () => {
    const fake = startFakeDatalab({processingPolls: 1})
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    const relay = serveHosted(hosted.svc)
    cleanups.push(fake.stop, hosted.close, relay.stop)
    const agent = await localAgent(relay.url)
    expect(agent.local.svc.convertCapabilities()).toEqual({available: true, source: 'relay'})

    const invoked = await agent.convert({files: ['incoming/paper.pdf'], max_pages: 50})
    expect(invoked.error).toBeUndefined()
    const output = invoked.output as Record<string, unknown>
    expect(output).toMatchObject({keySource: 'relay'})
    expect(output.documents).toEqual([
      {
        source: 'incoming/paper.pdf',
        outputDir: 'datalab-imports/paper',
        markdownPath: 'datalab-imports/paper/seed.md',
        pages: 3,
        images: 2,
        truncated: false,
        captions: 0,
        citationsLinked: 0,
        citationsUnlinked: 0,
      },
    ])
    const seed = agentMemory.readMemoryFile(agent.stateDir, 'datalab-imports/paper/seed.md')
    expect(seed.content).toContain('![Figure 1](assets/fig1.png)')
    // The fake's image bytes happen to be valid UTF-8, so the memory read returns them as text.
    const asset = agentMemory.readMemoryFile(agent.stateDir, 'datalab-imports/paper/assets/fig1.png')
    expect(asset.content ?? new TextDecoder().decode(asset.data)).toBe('PNGDATA')
    expect(fake.submissions[0]).toMatchObject({apiKey: 'hosted-key', fields: {max_pages: '50', mode: 'accurate'}})

    // Billed on the hosted server, to the identity account, not on the local one.
    const hostedRows = hosted.db
      .query<{account_id: string; state: string; pages_charged: number}, []>(
        `SELECT account_id, state, pages_charged FROM conversion_usage`,
      )
      .all()
    expect(hostedRows).toEqual([{account_id: agent.identityAccountId, state: 'settled', pages_charged: 3}])
    expect(agent.local.db.query(`SELECT COUNT(*) AS n FROM conversion_usage`).get()).toEqual({n: 0})
    expect(fs.existsSync(path.join(agent.local.dataDir, 'conversions'))).toBe(false)
    expect(
      agent.events.some(
        (e) => e.type === 'account-change' && e.reason === 'agent-memory-changed' && e.agentId === agent.agentId,
      ),
    ).toBe(true)
  })

  test('the hosted job is private to its account and refuses delegated signers', async () => {
    const fake = startFakeDatalab({neverComplete: true})
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    cleanups.push(fake.stop, hosted.close)
    const owner = blobs.generateNobleKeyPair()
    const started = await hosted.svc.message(
      await apisvc.createSignedEnvelope(owner, {
        action: {_: 'ConvertDocument', content: PDF, fileName: 'a.pdf', clientRequestId: 'once'},
      }),
    )
    if (started._ !== 'ConvertDocumentResponse') throw new Error(`unexpected ${started._}`)
    expect(started.reservedPages).toBe(conversionLedger.CONVERT_PAGES_PER_CALL_CAP)

    // Same client request id, same job: no second reservation.
    const again = await hosted.svc.message(
      await apisvc.createSignedEnvelope(owner, {
        action: {_: 'ConvertDocument', content: PDF, fileName: 'a.pdf', clientRequestId: 'once'},
      }),
    )
    expect(again).toMatchObject({_: 'ConvertDocumentResponse', jobId: started.jobId})
    expect(hosted.db.query(`SELECT COUNT(*) AS n FROM conversion_usage`).get()).toEqual({n: 1})

    const polled = await hosted.svc.message(
      await apisvc.createSignedEnvelope(owner, {action: {_: 'GetConversion', jobId: started.jobId}}),
    )
    expect(polled).toMatchObject({_: 'GetConversionResponse', status: 'processing'})

    const stranger = blobs.generateNobleKeyPair()
    await expect(
      hosted.svc.message(
        await apisvc.createSignedEnvelope(stranger, {action: {_: 'GetConversion', jobId: started.jobId}}),
      ),
    ).rejects.toThrow('Conversion not found')

    // A device the owner delegated to is authorized for everything else, but not to spend.
    const device = blobs.generateNobleKeyPair()
    auth.setLocalAuthorization(hosted.db, {
      accountId: blobs.principalToString(owner.principal),
      signerId: blobs.principalToString(device.principal),
      role: 'AGENT',
      now: Date.now(),
    })
    const delegated = (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
      apisvc.createSignedEnvelope(device, {account: owner.principal, action})
    await expect(hosted.svc.message(await delegated({_: 'GetConversion', jobId: started.jobId}))).rejects.toThrow(
      'signed by the account itself',
    )
    await expect(
      hosted.svc.message(await delegated({_: 'ConvertDocument', content: PDF, fileName: 'b.pdf'})),
    ).rejects.toThrow('signed by the account itself')

    // Sweeping past the TTL aborts the job and gives the pages back.
    hosted.svc.sweepConversionJobs(Date.now() + 31 * 60_000)
    await expect(
      hosted.svc.message(
        await apisvc.createSignedEnvelope(owner, {action: {_: 'GetConversion', jobId: started.jobId}}),
      ),
    ).rejects.toThrow('Conversion not found')
    expect(hosted.db.query<{state: string}, []>(`SELECT state FROM conversion_usage`).all()).toEqual([
      {state: 'released'},
    ])
  })

  test('a finished job is returned inline and the relay client maps failures', async () => {
    const fake = startFakeDatalab({
      completions: [{status: 'complete', success: false, error: 'Could not parse the file'}],
    })
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    const relay = serveHosted(hosted.svc)
    cleanups.push(fake.stop, hosted.close, relay.stop)
    const identity = blobs.generateNobleKeyPair()
    const error = (await convertRelay
      .convertDocumentViaRelay({
        relayUrl: relay.url,
        signer: identity,
        bytes: PDF,
        fileName: 'a.pdf',
        pollIntervalMs: 20,
      })
      .catch((e: unknown) => e)) as convertRelay.ConvertRelayError
    expect(error).toBeInstanceOf(convertRelay.ConvertRelayError)
    expect(error.message).toBe('Could not parse the file')
    expect(hosted.db.query<{state: string}, []>(`SELECT state FROM conversion_usage`).all()).toEqual([
      {state: 'released'},
    ])

    // Hosted-side validation reaches the client with the hosted message.
    const bad = (await convertRelay
      .convertDocumentViaRelay({
        relayUrl: relay.url,
        signer: identity,
        bytes: new Uint8Array([1]),
        fileName: 'a.exe',
        pollIntervalMs: 20,
      })
      .catch((e: unknown) => e)) as convertRelay.ConvertRelayError
    expect(bad.status).toBe(400)
    expect(bad.message).toContain('Unsupported document type')
  })

  test('a hosted server without a key never relays further', async () => {
    const hosted = openService({relayUrl: 'http://127.0.0.1:1'})
    cleanups.push(hosted.close)
    const owner = blobs.generateNobleKeyPair()
    await expect(
      hosted.svc.message(
        await apisvc.createSignedEnvelope(owner, {action: {_: 'ConvertDocument', content: PDF, fileName: 'a.pdf'}}),
      ),
    ).rejects.toThrow('no Datalab key is configured')
  })

  test('an agent without a signing identity gets a clear error', async () => {
    const fake = startFakeDatalab()
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    const relay = serveHosted(hosted.svc)
    cleanups.push(fake.stop, hosted.close, relay.stop)
    const local = openService({relayUrl: relay.url})
    cleanups.push(local.close)
    const owner = blobs.generateNobleKeyPair()
    const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
      local.svc.message(await apisvc.createSignedEnvelope(owner, {action}))
    await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
    await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
    const agent = await send({
      _: 'CreateAgent',
      definition: {
        name: 'Importer',
        systemPrompt: 'import',
        modelProvider: 'openai',
        model: 'gpt-test',
        tools: ['convert'],
      },
    })
    if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected')
    const session = await send({_: 'CreateSession', agentId: agent.agentId})
    if (session._ !== 'CreateSessionResponse') throw new Error('unexpected')
    const stateDir = local.db
      .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
      .get(agent.agentId)!.state_dir
    agentMemory.writeMemoryFile(stateDir, 'a.pdf', PDF)
    const invoked = await send({
      _: 'InvokeSessionTool',
      sessionId: session.sessionId,
      verb: 'call',
      input: {tool: 'convert', input: {files: ['a.pdf']}},
    })
    await local.svc.awaitQueueIdle()
    expect(invoked).toMatchObject({_: 'InvokeSessionToolResponse'})
    expect((invoked as {error?: string}).error).toContain('needs a signing identity')
    expect(fake.submissions).toHaveLength(0)
  })

  test('validateConvertDocument guards the boundary', () => {
    const ok = apisvc.validateConvertDocument({
      content: PDF,
      fileName: 'dir/../My Paper.PDF',
      maxPages: 3,
      pageRange: '0-2',
      mode: 'fast',
    })
    expect(ok).toMatchObject({
      fileName: 'My Paper.PDF',
      type: {ext: 'pdf'},
      maxPages: 3,
      pageRange: '0-2',
      mode: 'fast',
    })
    expect(() =>
      apisvc.validateConvertDocument(
        {content: new Uint8Array(2 * 1024 * 1024 + 1), fileName: 'a.png'},
        2 * 1024 * 1024,
      ),
    ).toThrow('2 MiB')
    expect(() => apisvc.validateConvertDocument({content: new Uint8Array([1]), fileName: 'a.pdf'})).toThrow('not a PDF')
    expect(() => apisvc.validateConvertDocument({content: PDF, fileName: 'a.pdf', mode: 'turbo'})).toThrow(
      'Invalid mode',
    )
    expect(() => apisvc.validateConvertDocument({content: PDF, fileName: 'a.pdf', maxPages: 0})).toThrow('maxPages')
    expect(() => apisvc.validateConvertDocument({content: PDF, fileName: 'a.pdf', pageRange: '1-'})).toThrow(
      'pageRange',
    )
    expect(() => apisvc.validateConvertDocument({content: new Uint8Array(), fileName: 'a.pdf'})).toThrow('required')
  })
})
