import {describe, expect, it} from 'vitest'
import type {AgentInfo} from '../agents/client'
import {agentSpaceUid, groupAssistantAgentsBySpace} from '../agents/assistant-selection'

/**
 * The assistant panel's agent picker groups by the space an agent lives in, never by server: a
 * person knows their spaces, not which host runs which agent. Agents adopted into no space yet
 * close the list as orphans.
 */

const agent = (id: string, name: string): AgentInfo => ({id, definition: {name}}) as AgentInfo
const HOSTED = 'https://agents.example.com'
const LOCAL = 'http://localhost:3050'

describe('groupAssistantAgentsBySpace', () => {
  it('reads the space from a document id and nothing from a legacy id', () => {
    expect(agentSpaceUid('hm://z6MkSpace/agents/scout')).toBe('z6MkSpace')
    expect(agentSpaceUid('hm://z6MkSpace')).toBe('z6MkSpace')
    expect(agentSpaceUid('legacy-id')).toBeNull()
  })

  it('groups by space in order of first appearance, across servers, with orphans last', () => {
    const groups = groupAssistantAgentsBySpace([
      {serverUrl: HOSTED, agent: agent('hm://z6MkTeam/scout', 'Scout')},
      {serverUrl: LOCAL, agent: agent('legacy-helper', 'Helper')},
      {serverUrl: LOCAL, agent: agent('hm://z6MkMine/editor', 'Editor')},
      {serverUrl: LOCAL, agent: agent('hm://z6MkTeam/writer', 'Writer')},
    ])
    expect(groups.map((group) => group.spaceUid)).toEqual(['z6MkTeam', 'z6MkMine', null])
    expect(groups[0]!.options.map((option) => option.agent.definition.name)).toEqual(['Scout', 'Writer'])
    expect(groups[2]!.options.map((option) => option.agent.definition.name)).toEqual(['Helper'])
  })

  it('has no orphan group when every agent lives somewhere', () => {
    const groups = groupAssistantAgentsBySpace([{serverUrl: HOSTED, agent: agent('hm://z6MkTeam/scout', 'Scout')}])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.spaceUid).toBe('z6MkTeam')
  })
})
