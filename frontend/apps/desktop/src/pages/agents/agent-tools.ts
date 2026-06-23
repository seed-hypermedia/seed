import {seedToolRegistry} from '../../../../../../agents/protocol/src/tool-registry'

/** Tools that let an agent find and read Seed content. */
export const AGENT_READ_TOOL_GROUP = [
  seedToolRegistry.read.name,
  seedToolRegistry.search.name,
  seedToolRegistry.list_activity_feed.name,
]

/** Tool that lets an agent create, sign, and publish Seed content. */
export const AGENT_WRITE_TOOL = seedToolRegistry.write.name

/**
 * Tools granted to a newly created agent: full read access plus write, so the
 * agent can publish as its own auto-created account without extra setup.
 */
export const DEFAULT_AGENT_TOOLS = [...AGENT_READ_TOOL_GROUP, AGENT_WRITE_TOOL]
