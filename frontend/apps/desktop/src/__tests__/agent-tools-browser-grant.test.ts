import {describe, expect, it} from 'vitest'

import {
  AGENT_BROWSER_TOOL,
  AGENT_EXECUTE_TOOL,
  AGENT_PUBLISH_GRANT,
  AGENT_SEARCH_TOOL,
  DEFAULT_AGENT_TOOLS,
  normalizeStoredAgentTools,
} from '@shm/ui/agents/agent-tools'

/**
 * The Tools tab stores an agent's callable grants through normalizeStoredAgentTools on every save.
 * If the normalizer dropped "browser", ticking the integrated-browser checkbox would be undone by
 * the next save and the server (which only offers the browser when definition.tools includes it)
 * would never expose the tool.
 */
describe('integrated browser grant', () => {
  it('names the registry browser tool', () => {
    expect(AGENT_BROWSER_TOOL).toBe('browser')
  })

  it('is opt-in: new agents are not granted the browser', () => {
    expect(DEFAULT_AGENT_TOOLS).not.toContain(AGENT_BROWSER_TOOL)
  })

  it('survives normalization alongside the other grants', () => {
    expect(normalizeStoredAgentTools([AGENT_SEARCH_TOOL, 'browser', 'execute_code', 'write', 'unknown'])).toEqual([
      AGENT_SEARCH_TOOL,
      AGENT_BROWSER_TOOL,
      AGENT_EXECUTE_TOOL,
      AGENT_PUBLISH_GRANT,
    ])
  })

  it('is removed when the stored tools omit it', () => {
    expect(normalizeStoredAgentTools([AGENT_SEARCH_TOOL])).not.toContain(AGENT_BROWSER_TOOL)
  })
})
