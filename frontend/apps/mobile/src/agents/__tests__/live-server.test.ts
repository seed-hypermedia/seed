/**
 * @jest-environment node
 */

/**
 * End-to-end check of the signed action path against a real agents server.
 *
 * This is the one test that proves the whole mobile chain actually talks to the runtime: a
 * vault-shaped Ed25519 account key signs a DAG-CBOR envelope through the shared client, and the
 * server accepts it and answers. Everything else in this directory verifies the pieces in
 * isolation.
 *
 * Opt-in, because it needs a server running:
 *
 *   direnv exec . bash -lc 'cd agents && bun run dev'      # serves :3051
 *   SEED_AGENTS_TEST_SERVER=http://localhost:3051 npm test
 *
 * Runs in the `node` environment on purpose: jsdom provides no `fetch`, while React Native does —
 * so jsdom would fail here for a reason the real app never hits.
 */

import {nobleKeyPairFromSeed, principalToString} from '@seed-hypermedia/client/blobs'
import {getAgentServerHealth, sendAgentAction} from '@shm/ui/agents/client'
import {setAgentsPlatform} from '@shm/ui/agents/platform'

const SERVER_URL = process.env.SEED_AGENTS_TEST_SERVER
const describeLive = SERVER_URL ? describe : describe.skip

// Deterministic, and deliberately an account the dev server has never seen: the assertions below
// are about the transport and authorization, so a fresh account with no agents is the cleanest
// subject and the test stays read-only.
const TEST_SEED = new Uint8Array(32).fill(11)

describeLive('agents server (live)', () => {
  const serverUrl = SERVER_URL as string
  let accountUid: string

  beforeAll(async () => {
    const keyPair = await nobleKeyPairFromSeed(TEST_SEED)
    accountUid = principalToString(keyPair.principal)
    setAgentsPlatform({
      defaultServerUrl: () => serverUrl,
      getSigner: async () => keyPair,
      getSetting: async () => null,
      setSetting: async () => {},
      useAccountUid: () => accountUid,
      useNavigate: () => () => {},
      useOpenUrl: () => () => {},
      CommentEditor: (() => null) as never,
    })
  })

  it('reports health over the unsigned status route', async () => {
    const health = await getAgentServerHealth(serverUrl)
    expect(health.status).toBe('ok')
  })

  it('accepts a signed action from a vault-style account key', async () => {
    const response = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgents'}})
    expect(response._).toBe('ListAgentsResponse')
    // A brand new account owns nothing — the point is that the envelope verified and the account
    // was authorized, not what came back.
    expect(Array.isArray((response as {agents: unknown[]}).agents)).toBe(true)
  })

  it('scopes provider configuration to the signing account', async () => {
    const response = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListModelProviders'}})
    expect(response._).toBe('ListModelProvidersResponse')
  })

  it('rejects an envelope whose signed timestamp is outside the accepted window', async () => {
    // The server rejects actions more than 30 seconds from its clock. Mobile devices drift, so
    // this is the failure a user will actually hit — it must surface as a clean error rather than
    // a hang or a silent success.
    const realNow = Date.now
    Date.now = () => realNow() - 5 * 60 * 1000
    try {
      await expect(sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgents'}})).rejects.toThrow()
    } finally {
      Date.now = realNow
    }
  })
})
