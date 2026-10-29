import {CID} from 'multiformats/cid'
import {resolveDocumentState} from '../frontend/packages/client/src/document-state'
import {createServer, type Server} from 'node:http'
import * as cbor from '../frontend/packages/client/src/cbor'
import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {chromium, type Browser} from 'playwright'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'
import {
  createCapability,
  createSeedClient,
  unpackHmId,
  createDocumentBlobs,
  createChangeOps,
  createChange,
  createVersionRef,
} from '../frontend/packages/client/src'
import {nobleKeyPairFromSeed} from '../frontend/packages/client/src/blobs'
import {createSignerFromKey} from '../frontend/apps/cli/src/utils/signer'
import {createDocumentUpdate, generateTestAccount, registerAccount} from '../frontend/apps/cli/src/test/account-helpers'
import {FIXTURE_ACCOUNT} from '../frontend/apps/cli/src/test/fixture-seed'
import {postSignedAgentAction, signAgentActionWith} from '../frontend/packages/ui/src/agents/client'
import type {UnsignedAgentAction} from '../agents/protocol/src'
import {setupTestEnv, type TestEnv} from './integration'

let env: TestEnv | undefined
let browser: Browser | undefined
let agentProcess: ChildProcess | undefined
let agentDataDir: string | undefined
const localServerUrl = 'http://127.0.0.1:59415'
const serverUrl = localServerUrl
let modelServer: Server | undefined
const signer = nobleKeyPairFromSeed(FIXTURE_ACCOUNT.keyPair.privateKey)
const sharedSpace = generateTestAccount()
let legacyId: string
let sessionId: string

async function send(action: UnsignedAgentAction) {
  return postSignedAgentAction(
    localServerUrl,
    await signAgentActionWith({signer, accountUid: FIXTURE_ACCOUNT.accountId, delegation: null, action}),
  )
}

beforeAll(async () => {
  env = await setupTestEnv({
    webPort: 3495,
    daemonHttpPort: 59411,
    daemonGrpcPort: 59412,
    daemonP2pPort: 59413,
    skipBuild: process.env.SKIP_BUILD === 'true',
  })
  agentDataDir = mkdtempSync(path.join(tmpdir(), 'seed-agent-mount-'))
  agentProcess = spawn('bun', ['src/main.ts'], {
    cwd: path.resolve(__dirname, '../agents'),
    env: {
      ...process.env,
      SEED_AGENTS_HTTP_HOSTNAME: '127.0.0.1',
      SEED_AGENTS_HTTP_PORT: '59415',
      SEED_AGENTS_DB_PATH: path.join(agentDataDir, 'agents.sqlite'),
      SEED_AGENTS_DATA_DIR: agentDataDir,
      SEED_AGENTS_HM_SERVER_URL: env.web.baseUrl,
      SEED_AGENTS_TITLE_GENERATION: 'false',
    },
    stdio: 'pipe',
  })
  agentProcess.stderr?.on('data', (data) => console.error('[agents]', String(data)))
  agentProcess.stdout?.on('data', () => {})
  await vi.waitFor(async () => expect((await fetch(`${localServerUrl}/agents/api/health`)).ok).toBe(true), {
    timeout: 30_000,
  })
  await send({_: 'SetSecret', name: 'test-key', value: new TextEncoder().encode('test-key-not-used')})
  modelServer = createServer((_request, response) => {
    response.writeHead(200, {'content-type': 'application/json'})
    response.end(JSON.stringify({data: [{id: 'test', object: 'model', owned_by: 'test'}]}))
  })
  await new Promise<void>((resolve) => modelServer!.listen(0, '127.0.0.1', resolve))
  const modelPort = (modelServer.address() as import('node:net').AddressInfo).port
  await send({
    _: 'SetModelProvider',
    name: 'test',
    provider: {
      type: 'custom',
      baseUrl: `http://127.0.0.1:${modelPort}`,
      secretRefs: {apiKey: 'test-key'},
    },
  })
  const initialIdentity = await send({_: 'CreateSigningIdentity', label: 'Mount test agent'})
  if (initialIdentity._ !== 'CreateSigningIdentityResponse') throw new Error('Identity creation failed')
  const agent = await send({
    _: 'CreateAgent',
    definition: {
      name: 'Mount test agent',
      systemPrompt: 'Test agent',
      modelProvider: 'test',
      model: 'test',
      tools: [],
      signingKey: initialIdentity.identity.name,
    },
  })
  if (agent._ !== 'CreateAgentResponse') throw new Error('Agent creation failed')
  legacyId = agent.agentId
  const session = await send({_: 'CreateSession', agentId: legacyId})
  if (session._ !== 'CreateSessionResponse') throw new Error('Session creation failed')
  sessionId = session.sessionId
  await send({_: 'UpdateSession', sessionId, title: 'Existing conversation'})
  await send({_: 'WriteAgentMemoryFile', agentId: legacyId, path: 'notes.md', content: 'Preserve this memory'})
  await createDocumentUpdate(env.web.baseUrl, FIXTURE_ACCOUNT, '/server-directory', [
    {
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: 'Server directory'},
        {key: ['agentServerUrl'], value: serverUrl},
      ],
    },
  ])
  await registerAccount(env.web.baseUrl, sharedSpace, 'Shared team')
  await createDocumentUpdate(env.web.baseUrl, sharedSpace, '/team', [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Team agents'}]},
  ])
  const client = createSeedClient(env.web.baseUrl)
  await client.publish(
    await createCapability(
      {delegateUid: FIXTURE_ACCOUNT.accountId, role: 'WRITER', path: '/team'},
      createSignerFromKey(sharedSpace.keyPair),
    ),
  )
  browser = await chromium.launch({headless: true})
}, 600_000)

afterAll(async () => {
  for (const context of browser?.contexts() || []) {
    for (const page of context.pages()) {
      console.log('Final browser state:', await page.locator('body').innerText())
      await page.screenshot({path: path.join(tmpdir(), 'seed-agent-mount-final.png')})
    }
  }
  await browser?.close()
  if (agentProcess && agentProcess.exitCode === null) {
    const closed = new Promise<void>((resolve) => agentProcess!.once('exit', () => resolve()))
    agentProcess.kill('SIGTERM')
    await closed
  }
  if (modelServer) await new Promise<void>((resolve) => modelServer!.close(() => resolve()))
  await env?.cleanup()
  if (agentDataDir) rmSync(agentDataDir, {recursive: true, force: true})
})

describe('agent mounting', () => {
  it('mounts through the picker in a shared writable location and serves document/session URLs', async () => {
    const page = await browser!.newPage({viewport: {width: 1440, height: 1000}})
    const errors: string[] = []
    page.on('pageerror', (error) => {
      errors.push(error.message)
      console.error('Browser error:', error.message)
    })
    await page.goto(env!.web.baseUrl)
    // Install only this test's deterministic identity in this isolated browser context.
    await page.evaluate(
      async ({seed, publicKey}) => {
        const prefix = [48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]
        const privateKey = await crypto.subtle.importKey(
          'pkcs8',
          new Uint8Array([...prefix, ...seed]),
          {name: 'Ed25519'},
          false,
          ['sign'],
        )
        const key = await crypto.subtle.importKey('raw', new Uint8Array(publicKey), {name: 'Ed25519'}, true, ['verify'])
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('keyStore-04')
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result
            const transaction = db.transaction('keys-01', 'readwrite')
            transaction.objectStore('keys-01').put(privateKey, 'privateKey')
            transaction.objectStore('keys-01').put(key, 'publicKey')
            transaction.oncomplete = () => {
              db.close()
              resolve()
            }
            transaction.onerror = () => reject(transaction.error)
          }
        })
      },
      {seed: Array.from(FIXTURE_ACCOUNT.keyPair.privateKey), publicKey: Array.from(FIXTURE_ACCOUNT.keyPair.publicKey)},
    )
    const directoryUrl = `${env!.web.baseUrl}/server-directory`
    await page.goto(`${directoryUrl}/:sessions`)
    await page.getByRole('alert').filter({hasText: 'No agent is registered at this document.'}).waitFor()
    expect(await page.getByRole('link', {name: 'Sessions', exact: true}).count()).toBe(0)
    await page.goto(directoryUrl)
    await page.getByText('Server directory', {exact: true}).first().waitFor()
    expect(await page.getByRole('link', {name: 'Sessions', exact: true}).count()).toBe(0)
    // A successful lookup for a different ID (such as a server alias) is not a mount at this document.
    const directoryId = `hm://${FIXTURE_ACCOUNT.accountId}/server-directory`
    const otherAgent = await send({_: 'GetAgent', agentId: legacyId})
    await page.route(`${localServerUrl}/api/message`, async (request) => {
      const body = request.request().postDataBuffer()
      const envelope = body ? cbor.decode<{action?: {_: string; agentId?: string}}>(new Uint8Array(body)) : null
      if (envelope?.action?._ === 'GetAgent' && envelope.action.agentId === directoryId) {
        await request.fulfill({
          status: 200,
          contentType: 'application/cbor',
          body: Buffer.from(cbor.encode(otherAgent)),
        })
      } else await request.continue()
    })
    await page.goto(`${directoryUrl}/:sessions`)
    await page.getByRole('alert').filter({hasText: 'No agent is registered at this document.'}).waitFor()
    expect(await page.getByRole('link', {name: 'Sessions', exact: true}).count()).toBe(0)
    await page.unroute(`${localServerUrl}/api/message`)
    await page.goto(`${env!.web.baseUrl}/hm/agents/agent/${legacyId}?server=${encodeURIComponent(localServerUrl)}`)
    expect(await page.getByText('Local agents cannot be mounted', {exact: true}).count()).toBe(0)
    await page.getByRole('button', {name: 'Mount agent', exact: true}).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', {name: /Team agents/}).click()
    await dialog.getByPlaceholder('url-path').fill('helper')
    await dialog.getByRole('button', {name: 'Mount Agent', exact: true}).click()
    const docUrl = `${env!.web.baseUrl}/hm/${sharedSpace.accountId}/team/helper`
    await page.waitForURL(`${docUrl}/:sessions`)
    await page.getByText('Existing conversation', {exact: true}).first().waitFor()
    expect(await page.getByRole('region', {name: 'Mount agent'}).count()).toBe(0)
    const id = `hm://${sharedSpace.accountId}/team/helper`
    const client = createSeedClient(env!.web.baseUrl)
    const document = await client.request('Resource', unpackHmId(id)!)
    expect(document).toMatchObject({
      type: 'document',
      document: {metadata: {type: 'hm://hyper.media/agent', agentServerUrl: serverUrl}},
    })
    if (document.type !== 'document') throw new Error('Missing mount document')
    expect(Object.keys(document.document.metadata).sort()).toEqual(['agentServerUrl', 'name', 'type'])
    // Opening the ordinary document URL also discovers the server-side registration.
    await page.goto(docUrl)
    await page.getByRole('link', {name: 'Sessions', exact: true}).waitFor()
    expect(await send({_: 'GetAgent', agentId: legacyId})).toMatchObject({agent: {id}})
    expect(await send({_: 'ReadAgentMemoryFile', agentId: id, path: 'notes.md'})).toMatchObject({
      file: {content: 'Preserve this memory'},
    })
    for (const view of ['tools', 'settings', 'sessions']) {
      const label = view[0]!.toUpperCase() + view.slice(1)
      await page.getByRole('link', {name: label, exact: true}).click()
      await page.waitForURL(`${docUrl}/:${view}`)
      expect(await page.getByRole('link', {name: 'Content', exact: true}).count()).toBe(0)
      expect(await page.getByRole('link', {name: 'Home', exact: true}).count()).toBeGreaterThan(0)
      await page.reload()
      await page.getByRole('link', {name: label, exact: true}).waitFor()
    }
    await page.goto(`${docUrl}/:session/${sessionId}`)
    await page.getByPlaceholder('Untitled session').waitFor()
    expect(await page.getByPlaceholder('Untitled session').inputValue()).toBe('Existing conversation')
    await page.screenshot({path: path.join(tmpdir(), 'seed-agent-mount-session.png')})
    await page.goto(`${env!.web.baseUrl}/hm/agents/agent/${legacyId}?server=${encodeURIComponent(serverUrl)}`)
    await page.waitForURL(`${docUrl}/:sessions`)
    await page.setViewportSize({width: 390, height: 844})
    await page.getByText('Existing conversation', {exact: true}).first().waitFor()
    await page.screenshot({path: path.join(tmpdir(), 'seed-agent-mount-mobile.png')})

    const personal = await send({
      _: 'CreateAgent',
      definition: {
        name: 'Personal helper',
        systemPrompt: 'Test agent',
        modelProvider: 'test',
        model: 'test',
        tools: [],
      },
    })
    if (personal._ !== 'CreateAgentResponse') throw new Error('Agent creation failed')
    await page.setViewportSize({width: 1440, height: 1000})
    await page.goto(`${env!.web.baseUrl}/hm/agents/agent/${personal.agentId}?server=${encodeURIComponent(serverUrl)}`)
    await page.getByRole('button', {name: 'Mount agent', exact: true}).click()
    await dialog.getByRole('button', {name: 'Minimal Fixture Site', exact: true}).click()
    await dialog.getByPlaceholder('url-path').fill('personal-helper')
    await dialog.getByRole('button', {name: 'Mount Agent', exact: true}).click()
    await page.waitForURL(`${env!.web.baseUrl}/personal-helper/:sessions`)
    await page.goto(`${env!.web.baseUrl}/personal-helper/:settings`)
    await page.getByRole('link', {name: 'Settings', exact: true}).waitFor()
    expect(await send({_: 'GetAgent', agentId: personal.agentId})).toMatchObject({
      agent: {id: `hm://${FIXTURE_ACCOUNT.accountId}/personal-helper`},
    })
    // New agents are created from a document's New menu, under that document, at a path derived
    // from the agent's name. The server sees one CreateAgent action with that document ID.
    await page.goto(`${env!.web.baseUrl}/hm/${sharedSpace.accountId}/team`)
    await page.getByRole('button', {name: 'Choose what to create', exact: true}).click()
    await page.getByRole('menuitem', {name: 'Agent', exact: true}).click()
    await dialog.getByLabel('Name', {exact: true}).fill('New local helper')
    expect(await dialog.getByRole('button', {name: 'Choose location', exact: true}).count()).toBe(0)
    expect(await dialog.getByText('System prompt', {exact: true}).count()).toBe(0)
    expect(await dialog.getByText('Thoroughness').count()).toBe(0)
    const createButton = dialog.getByRole('button', {name: 'Create Agent', exact: true})
    await vi.waitFor(async () => expect(await createButton.isEnabled()).toBe(true))
    await page.screenshot({path: path.join(tmpdir(), 'seed-agent-create-location.png')})
    let createRequests = 0
    await page.route(`${localServerUrl}/api/message`, async (route) => {
      const body = route.request().postDataBuffer()
      const envelope = body ? cbor.decode<{action?: {_: string}}>(new Uint8Array(body)) : null
      if (envelope?.action?._ !== 'CreateAgent') return route.continue()
      createRequests++
      if (createRequests !== 1) return route.continue()
      // The server completes creation, but its response is lost. Retry must reuse the same identity and request.
      await route.fetch()
      await route.fulfill({
        status: 503,
        contentType: 'application/cbor',
        body: Buffer.from(cbor.encode({_: 'Error', message: 'Test response lost'})),
      })
    })
    await createButton.click()
    await page.getByText('Test response lost', {exact: true}).waitFor()
    const newId = `hm://${sharedSpace.accountId}/team/new-local-helper`
    expect(await send({_: 'GetAgent', agentId: newId})).toMatchObject({agent: {id: newId}})
    // Retry reuses the published document, the signing identity and the request.
    await dialog.getByRole('button', {name: 'Retry', exact: true}).click()
    await page.waitForURL(`${env!.web.baseUrl}/hm/${sharedSpace.accountId}/team/new-local-helper/:sessions`)
    expect(createRequests).toBe(2)
    await page.reload()
    await page.getByRole('link', {name: 'Settings', exact: true}).waitFor()
    expect(await page.getByRole('region', {name: 'Mount agent'}).count()).toBe(0)
    await page.getByText('No sessions yet.', {exact: true}).waitFor()
    await page.screenshot({path: path.join(tmpdir(), 'seed-agent-created-local.png')})
    const newAgent = await send({_: 'GetAgent', agentId: newId})
    const identities = await send({_: 'ListSigningIdentities', agentId: newId})
    if (newAgent._ !== 'GetAgentResponse' || identities._ !== 'ListSigningIdentitiesResponse')
      throw new Error('Agent identity unavailable')
    const identity = identities.identities.find((identity) => identity.name === newAgent.agent.definition.signingKey)!
    const home = unpackHmId(`hm://${identity.accountId}`)!
    const {capabilities} = await client.request('ListCapabilities', {targetId: home})
    const grants = capabilities.filter((cap) => cap.delegate === sharedSpace.accountId && cap.role === 'WRITER')
    expect(grants).toHaveLength(1)
    const grant = grants[0]!
    expect(grant.path || '').toBe('')
    expect(grant.noRecursive).not.toBe(true)
    expect(grant.isExact).not.toBe(true)
    expect(capabilities.some((cap) => cap.delegate === FIXTURE_ACCOUNT.accountId)).toBe(false)
    // Prove the mount space's key can edit the agent's existing root and create descendants.
    const homeState = await resolveDocumentState(client, home.id)
    const mountOwnerSigner = createSignerFromKey(sharedSpace.keyPair)
    const change = createChangeOps({
      genesisCid: CID.parse(homeState.genesis),
      deps: homeState.heads.map((head) => CID.parse(head)),
      depth: homeState.headDepth + 1,
      ops: [{type: 'SetAttributes', attrs: [{key: ['summary'], value: 'Edited by mount owner'}]}],
    })
    const signedChange = await createChange(change.unsignedBytes, mountOwnerSigner)
    const ref = await createVersionRef(
      {
        space: home.uid,
        path: '',
        genesis: homeState.genesis,
        version: signedChange.cid.toString(),
        generation: Number(change.ts),
        capability: grant.id,
      },
      mountOwnerSigner,
    )
    await client.publish({
      blobs: [{cid: signedChange.cid.toString(), data: new Uint8Array(signedChange.bytes)}, ...ref.blobs],
    })
    const child = await createDocumentBlobs(mountOwnerSigner, {
      space: home.uid,
      path: '/owner-note',
      capability: grant.id,
      ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Owner note'}]}],
    })
    await client.publish({blobs: child.blobs})
    expect(await client.request('Resource', home)).toMatchObject({
      document: {metadata: {summary: 'Edited by mount owner'}},
    })
    expect(await client.request('Resource', unpackHmId(`${home.id}/owner-note`)!)).toMatchObject({
      document: {metadata: {name: 'Owner note'}},
    })
    expect(await client.request('Resource', unpackHmId(newId)!)).toMatchObject({document: {content: []}})
    await page.goto(`${env!.web.baseUrl}/hm/${sharedSpace.accountId}/team/new-local-helper`)
    await page.getByRole('link', {name: 'Open home document', exact: true}).waitFor()
    await page.getByText('This is an agentic account.', {exact: true}).waitFor()
    expect(await page.getByRole('link', {name: 'Content', exact: true}).count()).toBe(0)
    await page.screenshot({path: path.join(tmpdir(), 'seed-agent-home.png')})
    // The prompt's readable domain reference resolves before Resource/discovery sees an account ID.
    await createDocumentUpdate(env!.web.baseUrl, FIXTURE_ACCOUNT, '/agent/guide', [
      {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Fixture agent guide'}]},
      {type: 'MoveBlocks', blocks: ['guide-text'], parent: ''},
      {
        type: 'ReplaceBlock',
        block: {id: 'guide-text', type: 'Paragraph', text: 'Domain guide content loaded', attributes: {}},
      },
    ])
    await send({
      _: 'UpdateAgent',
      agentId: newId,
      definition: {
        ...newAgent.agent.definition,
        systemPrompt: [
          {
            block: {
              id: 'guide-embed',
              type: 'Embed',
              link: 'hm://hyper.media/agent/guide',
              attributes: {view: 'Content'},
            },
          },
        ],
      },
    })
    await page.route('**/api/GetDomain*', async (request) => {
      if (!request.request().url().includes('hyper.media')) return request.continue()
      await request.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          domain: 'hyper.media',
          registeredAccountUid: FIXTURE_ACCOUNT.accountId,
          isGateway: true,
          status: 'success',
          lastCheck: null,
          lastSuccess: null,
          peerId: null,
          lastError: null,
        }),
      })
    })
    await page.goto(`${env!.web.baseUrl}/hm/${sharedSpace.accountId}/team/new-local-helper/:prompt`)
    await page.getByText('Domain guide content loaded', {exact: true}).waitFor()
    expect(await page.getByText('failed to parse account hyper.media', {exact: false}).count()).toBe(0)

    expect(errors).toEqual([])
    await page.close()
  }, 120_000)
})
