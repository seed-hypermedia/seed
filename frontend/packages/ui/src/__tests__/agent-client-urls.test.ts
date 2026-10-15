import * as cbor from '@shm/shared/cbor'
import {describe, expect, it, vi} from 'vitest'
import {
  agentServerEndpoint,
  getAgentServerHealth,
  getAgentWebhookUrl,
  getAgentWebSocketUrl,
  isCanonicalAgentServerUrl,
  normalizeAgentServerUrl,
  postSignedAgentAction,
} from '../agents/client'

describe('agent server URLs', () => {
  it('derives the WebSocket URL from the server origin', () => {
    expect(getAgentWebSocketUrl('https://agent.example')).toBe('wss://agent.example/agents/ws')
    expect(getAgentWebSocketUrl('http://127.0.0.1:3053/')).toBe('ws://127.0.0.1:3053/agents/ws')
    expect(getAgentWebSocketUrl('https://agent.example/agents')).toBe('wss://agent.example/agents/ws')
  })

  it('keeps the path of a server behind a reverse proxy', () => {
    expect(normalizeAgentServerUrl('https://deck.example/api/seed-agents/proxy/')).toBe(
      'https://deck.example/api/seed-agents/proxy',
    )
    expect(getAgentWebSocketUrl('https://deck.example/api/seed-agents/proxy')).toBe(
      'wss://deck.example/api/seed-agents/proxy/agents/ws',
    )
  })
})

describe('canonical vs legacy agent server endpoints', () => {
  it('keeps a canonical /hm/api/agents base intact and still strips a bare /agents', () => {
    expect(normalizeAgentServerUrl('https://site.example/hm/api/agents/')).toBe('https://site.example/hm/api/agents')
    expect(normalizeAgentServerUrl('https://agentic.seed.hyper.media/agents')).toBe('https://agentic.seed.hyper.media')
    expect(isCanonicalAgentServerUrl('https://site.example/hm/api/agents')).toBe(true)
    expect(isCanonicalAgentServerUrl('https://agentic.seed.hyper.media')).toBe(false)
    expect(isCanonicalAgentServerUrl('https://agentic.seed.hyper.media/agents')).toBe(false)
  })

  it('builds legacy paths from an origin-only base (with or without /agents)', () => {
    for (const base of ['https://agentic.seed.hyper.media', 'https://agentic.seed.hyper.media/agents/']) {
      expect(agentServerEndpoint(base, 'message')).toBe('https://agentic.seed.hyper.media/api/message')
      expect(agentServerEndpoint(base, 'health')).toBe('https://agentic.seed.hyper.media/agents/api/health')
      expect(agentServerEndpoint(base, 'version')).toBe('https://agentic.seed.hyper.media/agents/api/version')
      expect(agentServerEndpoint(base, 'perf/sessions', 'abc')).toBe(
        'https://agentic.seed.hyper.media/agents/api/perf/sessions/abc',
      )
      expect(getAgentWebSocketUrl(base)).toBe('wss://agentic.seed.hyper.media/agents/ws')
      expect(getAgentWebhookUrl(base, 't1')).toBe('https://agentic.seed.hyper.media/agents/api/webhooks/t1')
      expect(getAgentWebhookUrl(base, 't1', 's/2')).toBe(
        'https://agentic.seed.hyper.media/agents/api/webhooks/t1/s%2F2',
      )
    }
  })

  it('builds canonical paths on a site origin and on the standalone agents host', () => {
    for (const origin of ['https://site.example', 'https://agentic.seed.hyper.media', 'http://localhost:3051']) {
      const base = `${origin}/hm/api/agents`
      const wsOrigin = origin.replace(/^http/, 'ws')
      expect(agentServerEndpoint(base, 'message')).toBe(`${base}/message`)
      expect(agentServerEndpoint(base, 'health')).toBe(`${base}/health`)
      expect(agentServerEndpoint(base, 'version')).toBe(`${base}/version`)
      expect(agentServerEndpoint(base, 'perf')).toBe(`${base}/perf`)
      expect(getAgentWebSocketUrl(base)).toBe(`${wsOrigin}/hm/api/agents/ws`)
      expect(getAgentWebhookUrl(base, 't1')).toBe(`${base}/webhooks/t1`)
      expect(getAgentWebhookUrl(base, 't1', 'sec')).toBe(`${base}/webhooks/t1/sec`)
    }
  })

  it('never treats a site origin as a legacy agents base by accident when given the canonical URL', () => {
    // The #1233 bug: with the server URL set to the site origin the client posted to
    // `${origin}/api/message`, which the site's proxy routes to the web app, not agents.
    expect(agentServerEndpoint('https://site.example/hm/api/agents', 'message')).not.toBe(
      'https://site.example/api/message',
    )
  })

  it('posts signed actions and reads health at the endpoint the base selects', async () => {
    const seen: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      seen.push(url)
      if (url.endsWith('health')) return Response.json({status: 'ok', uptime: 1})
      return new Response(cbor.encode({_: 'ListAgentsResponse', agents: []}) as BodyInit, {
        headers: {'Content-Type': 'application/cbor'},
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await postSignedAgentAction('https://site.example/hm/api/agents', {})
      await postSignedAgentAction('https://agentic.seed.hyper.media', {})
      await getAgentServerHealth('https://site.example/hm/api/agents')
      await getAgentServerHealth('https://agentic.seed.hyper.media')
    } finally {
      vi.unstubAllGlobals()
    }
    expect(seen).toEqual([
      'https://site.example/hm/api/agents/message',
      'https://agentic.seed.hyper.media/api/message',
      'https://site.example/hm/api/agents/health',
      'https://agentic.seed.hyper.media/agents/api/health',
    ])
  })
})
