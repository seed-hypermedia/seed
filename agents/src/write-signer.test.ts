import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {serialize} from 'superjson'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '@/api-service'
import {executeWriteVerb, type AgentServicePiToolContext} from '@/api-service'
import * as sqlite from '@/sqlite'

/**
 * Which identity signs an hm:// write.
 *
 * The incident: an agent holding two enabled identities was asked to add a writer to the space
 * whose key it holds. Its first call named that space in the address and was rejected with
 * "Multiple signing identities are enabled" — the tool demanding the model restate an account it
 * had already given, and not saying which identities it could have meant. A space's own key is
 * the only key that can sign for it, so the address settles the question.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  globalThis.fetch = originalFetch
  while (cleanups.length) cleanups.pop()?.()
})

const originalFetch = globalThis.fetch

const DELEGATE = blobs.principalToString(blobs.generateNobleKeyPair().principal)
const FOREIGN_SPACE = blobs.principalToString(blobs.generateNobleKeyPair().principal)

/** A service with two enabled signing identities, and a verb context that shares its database. */
async function setup(): Promise<{
  context: AgentServicePiToolContext
  acm: {name: string; accountId: string}
  otter: {name: string; accountId: string}
}> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-signer-test-'))
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  cleanups.push(() => {
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })

  globalThis.fetch = mock(async (url: string | URL) => {
    const href = String(url)
    if (href.includes('/api/PublishBlobs')) return Response.json(serialize({cids: ['bafyfake']}))
    throw new Error(`Unexpected fetch: ${href}`)
  }) as unknown as typeof fetch

  const account = blobs.generateNobleKeyPair()
  const svc = new apisvc.Service(db, dataDir, {hmServerUrl: 'https://hm.test'})
  const created = []
  for (const label of ['ACM HyperText', 'Swift Otter']) {
    const response = await svc.message(
      await apisvc.createSignedEnvelope(account, {
        action: {_: 'CreateSigningIdentity', label, clientRequestId: label},
      }),
    )
    if (response._ !== 'CreateSigningIdentityResponse') throw new Error(`unexpected response ${response._}`)
    created.push({name: response.identity.name, accountId: response.identity.accountId!})
  }
  const [acm, otter] = created as [{name: string; accountId: string}, {name: string; accountId: string}]

  const context = {
    db,
    accountId: blobs.principalToString(account.principal),
    agentId: 'test-agent',
    definition: {
      name: 'Test',
      systemPrompt: '',
      modelProvider: 'p',
      model: 'm',
      signingKeys: [acm.name, otter.name],
    },
    hmServerUrl: 'https://hm.test',
    ipfsServerUrl: 'https://hm.test',
    web: {},
    stateDir: dataDir,
    sessionId: 'session-1',
    modelAcceptsImages: false,
    onMemoryChange: mock(() => {}),
    onToolProgress: mock(() => {}),
    codeExec: {runtimes: [], availability: async () => ({available: false, runtimes: []})},
    callableTools: [],
    publishEnabled: true,
  } as unknown as AgentServicePiToolContext

  return {context, acm, otter}
}

function grant(address: string, options: Record<string, unknown> = {}) {
  return {
    address,
    options: {action: 'capability.grant', input: {delegate: DELEGATE, role: 'WRITER'}, ...options},
  }
}

describe('write signer resolution', () => {
  test('the write address picks the identity when the agent holds that space key', async () => {
    const {context, acm} = await setup()
    const result = await executeWriteVerb(context, grant(`hm://${acm.accountId}`))
    expect((result.signer as {publicKey: string}).publicKey).toBe(acm.accountId)
    expect(result.delegate).toBe(DELEGATE)
  })

  test('an explicit signer still wins over the address', async () => {
    const {context, acm, otter} = await setup()
    const result = await executeWriteVerb(
      context,
      grant(`hm://${acm.accountId}`, {signer: {publicKey: otter.accountId}}),
    )
    expect((result.signer as {publicKey: string}).publicKey).toBe(otter.accountId)
  })

  test('a space the agent holds no key for stays ambiguous, and the error names the candidates', async () => {
    const {context, acm, otter} = await setup()
    const failure = executeWriteVerb(context, grant(`hm://${FOREIGN_SPACE}`))
    await expect(failure).rejects.toThrow('Multiple signing identities are enabled')
    await expect(failure).rejects.toThrow(`"ACM HyperText" (${acm.accountId})`)
    await expect(failure).rejects.toThrow(`"Swift Otter" (${otter.accountId})`)
  })

  test('comments keep the choice with the model: the address is the target, not the author', async () => {
    const {context, acm} = await setup()
    await expect(
      executeWriteVerb(context, {
        address: `hm://${acm.accountId}/some-doc`,
        content: 'Nice work.',
        options: {action: 'comment'},
      }),
    ).rejects.toThrow('Multiple signing identities are enabled')
  })
})
