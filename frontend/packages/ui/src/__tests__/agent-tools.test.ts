import {describe, expect, test} from 'vitest'
import {
  AGENT_CONVERT_TOOL,
  AGENT_EXECUTE_TOOL,
  AGENT_PUBLISH_GRANT,
  AGENT_SEARCH_TOOL,
  DEFAULT_AGENT_TOOLS,
  getToolAvailability,
  normalizeStoredAgentTools,
} from '../agents/agent-tools'

describe('agent tool grants', () => {
  test('convert is a default grant and survives normalization of a stored tools array', () => {
    expect(DEFAULT_AGENT_TOOLS).toContain(AGENT_CONVERT_TOOL)
    // The whitelist decides what the UI reads back and re-saves: a name missing here is silently
    // dropped from the agent's grants on the next save.
    expect(normalizeStoredAgentTools(['execute_code', 'convert', 'write', 'search', 'memory_read'])).toEqual([
      AGENT_EXECUTE_TOOL,
      AGENT_CONVERT_TOOL,
      AGENT_PUBLISH_GRANT,
      AGENT_SEARCH_TOOL,
    ])
  })

  test('convert is greyed out only when the server says it cannot convert', () => {
    expect(getToolAvailability(AGENT_CONVERT_TOOL, undefined)).toEqual({available: true})
    expect(getToolAvailability(AGENT_CONVERT_TOOL, {search: true, readBrowser: true})).toEqual({available: true})
    expect(
      getToolAvailability(AGENT_CONVERT_TOOL, {
        search: true,
        readBrowser: true,
        convert: {available: true, source: 'relay'},
      }),
    ).toEqual({available: true})
    const off = getToolAvailability(AGENT_CONVERT_TOOL, {
      search: true,
      readBrowser: true,
      convert: {available: false, source: 'none'},
    })
    expect(off.available).toBe(false)
    expect(off.note).toContain('Datalab')
  })
})
