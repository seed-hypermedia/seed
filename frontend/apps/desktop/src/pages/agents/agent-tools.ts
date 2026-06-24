import {seedToolRegistry} from '../../../../../../agents/protocol/src/tool-registry'

/** Tools that let an agent find and read Seed content. */
export const AGENT_READ_TOOL_GROUP = [
  seedToolRegistry.read.name,
  seedToolRegistry.search.name,
  seedToolRegistry.list_activity_feed.name,
]

/** Tools that let an agent search and read the public web. Requires server-side web backends. */
export const AGENT_WEB_TOOL_GROUP = [seedToolRegistry.web_search.name, seedToolRegistry.web_read.name]

/** Tool that lets an agent create, sign, and publish Seed content. */
export const AGENT_WRITE_TOOL = seedToolRegistry.write.name

/**
 * Tools granted to a newly created agent: full read access, web search/read, and
 * write, so the agent can research and publish as its own auto-created account
 * without extra setup.
 */
export const DEFAULT_AGENT_TOOLS = [...AGENT_READ_TOOL_GROUP, ...AGENT_WEB_TOOL_GROUP, AGENT_WRITE_TOOL]

/** Web-backend capabilities a server advertises in its health response. */
export type AgentServerWebCapabilities = {search: boolean; readBrowser: boolean}

/**
 * Whether a tool can run on a server with the given web capabilities, plus an optional caveat.
 * `caps` undefined means capabilities are unknown (older server or not yet loaded) — assume available
 * so we never grey out tools we cannot confirm are unavailable.
 */
export function getToolAvailability(
  toolName: string,
  caps: AgentServerWebCapabilities | undefined,
): {available: boolean; note?: string} {
  if (toolName === seedToolRegistry.web_search.name) {
    if (caps && !caps.search)
      return {available: false, note: 'The web search backend (SearXNG) is not configured on this server.'}
    return {available: true}
  }
  if (toolName === seedToolRegistry.web_read.name && caps && !caps.readBrowser) {
    return {
      available: true,
      note: 'Browser rendering is unavailable on this server; reads use direct fetch and the wiki API.',
    }
  }
  return {available: true}
}
