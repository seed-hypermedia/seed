import {describe, expect, test} from 'vitest'
import {
  AGENT_EXECUTE_TOOL,
  AGENT_PUBLISH_GRANT,
  AGENT_SEARCH_TOOL,
  DEFAULT_AGENT_TOOLS,
  normalizeStoredAgentTools,
} from '../agents/agent-tools'

describe('agent tool grants', () => {
  test('a stored tools array is read back as today’s grants, with the tools of mounted apps kept by name', () => {
    expect(DEFAULT_AGENT_TOOLS).not.toContain('convert')
    // The whitelist decides what the UI reads back and re-saves: a name missing here is silently
    // dropped from the agent's grants on the next save, so an app's tool must be named to survive.
    expect(normalizeStoredAgentTools(['execute_code', 'convert', 'write', 'search', 'memory_read'])).toEqual([
      AGENT_EXECUTE_TOOL,
      AGENT_PUBLISH_GRANT,
      AGENT_SEARCH_TOOL,
    ])
    expect(
      normalizeStoredAgentTools(['execute_code', 'convert', 'write', 'search', 'memory_read'], ['convert', 'go']),
    ).toEqual([AGENT_EXECUTE_TOOL, 'convert', AGENT_PUBLISH_GRANT, AGENT_SEARCH_TOOL])
  })
})
