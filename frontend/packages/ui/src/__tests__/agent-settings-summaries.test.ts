import {describe, expect, it} from 'vitest'
import {describeAgentIdentities, describeAgentMcpServers, describeAgentPermissions} from '../agents/settings-summaries'
import type {AgentDefinition, SigningIdentity} from '../agents/client'

const base = {name: 'Helper', model: 'gpt', modelProvider: 'openai'} as unknown as AgentDefinition

describe('agent settings row summaries', () => {
  it('names the enabled permission groups, in the order of the page', () => {
    expect(describeAgentPermissions({...base, tools: ['publish', 'search']})).toBe(
      'Search Seed content, Publish Seed content',
    )
    expect(describeAgentPermissions({...base, tools: []})).toBe('Nothing enabled.')
  })

  it('falls back to the default grants when the definition has none stored', () => {
    expect(describeAgentPermissions(base)).toContain('Search Seed content')
  })

  it('names the granted identities by label, then account, then key name', () => {
    const identities = [
      {id: '1', name: 'key-a', label: 'Alice', accountId: 'z6MkAlice'},
      {id: '2', name: 'key-b', accountId: 'z6MkBob'},
    ] as unknown as SigningIdentity[]
    expect(describeAgentIdentities({...base, signingKeys: ['key-a', 'key-b', 'key-c']}, identities)).toBe(
      'Authors as Alice, z6MkBob, key-c',
    )
    expect(describeAgentIdentities({...base, signingKey: 'key-a'}, identities)).toBe('Authors as Alice')
    expect(describeAgentIdentities(base, identities)).toBe('No identity granted yet.')
  })

  it('counts the enabled MCP servers', () => {
    expect(describeAgentMcpServers(base)).toBe('No servers enabled.')
    expect(describeAgentMcpServers({...base, mcpServers: ['deck']})).toBe('1 server enabled.')
    expect(describeAgentMcpServers({...base, mcpServers: ['deck', 'gh']})).toBe('2 servers enabled.')
  })
})
