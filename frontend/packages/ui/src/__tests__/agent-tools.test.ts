import {describe, expect, test} from 'vitest'
import {
  AGENT_EXECUTE_TOOL,
  AGENT_PUBLISH_GRANT,
  AGENT_SEARCH_TOOL,
  DEFAULT_AGENT_TOOLS,
  normalizeStoredAgentTools,
} from '../agents/agent-tools'

describe('agent tool grants', () => {
  test('a stored tools array is read back as today’s grants; an app tool named there is inert', () => {
    expect(DEFAULT_AGENT_TOOLS).not.toContain('convert')
    // Installed apps are granted by being installed, not by name in this list: a grant list from
    // before that still naming an app's tool loses the name, and the tool stays available.
    expect(normalizeStoredAgentTools(['execute_code', 'convert', 'write', 'search', 'memory_read'])).toEqual([
      AGENT_EXECUTE_TOOL,
      AGENT_PUBLISH_GRANT,
      AGENT_SEARCH_TOOL,
    ])
  })
})
