import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
  constants: {
    NOTIFY_SERVICE_HOST: undefined as string | undefined,
    SEED_AGENT_SERVER_URL: undefined as string | undefined,
  },
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    daemon: {getInfo: async () => ({peerId: 'peer', protocolId: 'proto'})},
    networking: {getPeerInfo: async () => ({addrs: []})},
    documents: {getDocument: async () => ({metadata: undefined})},
  },
}))
vi.mock('@/site-config.server', () => ({getConfig: async () => ({registeredAccountUid: undefined})}))
vi.mock('@/server-signing', () => ({getOrCreateServerSignerAccountUid: async () => 'signer'}))
vi.mock('@shm/shared/constants', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    get NOTIFY_SERVICE_HOST() {
      return mocks.constants.NOTIFY_SERVICE_HOST
    },
    get SEED_AGENT_SERVER_URL() {
      return mocks.constants.SEED_AGENT_SERVER_URL
    },
  }
})

import {loader} from '../routes/hm.api.config'

async function getConfig() {
  const response = (await loader({
    request: new Request('https://site.example/hm/api/config'),
    params: {},
    context: {},
  } as any)) as Response
  return response.json()
}

describe('/hm/api/config', () => {
  beforeEach(() => {
    mocks.constants.NOTIFY_SERVICE_HOST = undefined
    mocks.constants.SEED_AGENT_SERVER_URL = undefined
  })

  it('advertises the canonical notify base and its origin as the legacy host', async () => {
    mocks.constants.NOTIFY_SERVICE_HOST = 'https://site.example/hm/api/notify'
    mocks.constants.SEED_AGENT_SERVER_URL = 'https://site.example/hm/api/agents'
    const config = await getConfig()
    expect(config.notifyServiceUrl).toBe('https://site.example/hm/api/notify')
    expect(config.notifyServiceHost).toBe('https://site.example')
    expect(config.agentServerUrl).toBe('https://site.example/hm/api/agents')
  })

  it('passes a legacy origin-only notify value through', async () => {
    mocks.constants.NOTIFY_SERVICE_HOST = 'https://notify.example.com'
    const config = await getConfig()
    expect(config.notifyServiceUrl).toBe('https://notify.example.com')
    expect(config.notifyServiceHost).toBe('https://notify.example.com')
  })

  it('reports null when nothing is configured', async () => {
    const config = await getConfig()
    expect(config.notifyServiceUrl).toBeNull()
    expect(config.notifyServiceHost).toBeNull()
    expect(config.agentServerUrl).toBeNull()
  })
})
