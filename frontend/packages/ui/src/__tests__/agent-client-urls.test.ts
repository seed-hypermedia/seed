import {describe, expect, it} from 'vitest'
import {getAgentWebSocketUrl, normalizeAgentServerUrl} from '../agents/client'

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
