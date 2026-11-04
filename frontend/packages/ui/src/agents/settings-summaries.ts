import type {AgentDefinition, SigningIdentity} from './client'
import {
  AGENT_BROWSER_TOOL,
  AGENT_EXECUTE_TOOL,
  AGENT_PUBLISH_GRANT,
  AGENT_SEARCH_TOOL,
  AGENT_WEB_SEARCH_TOOL,
  DEFAULT_AGENT_TOOLS,
  normalizeStoredAgentTools,
} from './agent-tools'

// Reading, memory, publishing, delegation, and plans are verbs — always on, not configuration.
// What the user toggles here is the CALLABLE tool set dispatched through the call verb.
export const AGENT_TOOL_OPTIONS: {names: string[]; title: string; description?: string; infoTool?: string}[] = [
  {names: [AGENT_SEARCH_TOOL], title: 'Search Seed content'},
  {names: [AGENT_WEB_SEARCH_TOOL], title: 'Search the web'},
  {names: [AGENT_EXECUTE_TOOL], title: 'Execute code'},
  {
    names: [AGENT_BROWSER_TOOL],
    title: 'Use the integrated browser',
    description:
      'Let this agent read and act on websites you open in Seed. You still allow each website, and actions on it, when the agent asks.',
  },
  // The publish grant is not a registry tool — publishing runs through the always-on `write`
  // verb, so its info dialog shows the write verb's model-facing contract.
  {names: [AGENT_PUBLISH_GRANT], title: 'Publish Seed content', infoTool: 'write'},
]

/** The Settings row summary of the permissions page: the enabled grant groups. */
export function describeAgentPermissions(definition: AgentDefinition): string {
  const tools = definition.tools ? normalizeStoredAgentTools(definition.tools) : [...DEFAULT_AGENT_TOOLS]
  const titles = AGENT_TOOL_OPTIONS.filter((group) => group.names.some((name) => tools.includes(name))).map(
    (group) => group.title,
  )
  return titles.length ? titles.join(', ') : 'Nothing enabled.'
}

/** The Settings row summary of the identities page: the granted identities by name. */
export function describeAgentIdentities(definition: AgentDefinition, identities: SigningIdentity[]): string {
  const keys = definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
  const names = keys.map((key) => {
    const identity = identities.find((entry) => entry.name === key)
    return identity ? identity.label || identity.accountId || identity.name : key
  })
  return names.length ? `Authors as ${names.join(', ')}` : 'No identity granted yet.'
}

/** The Settings row summary of the MCP page: how many servers the agent may call. */
export function describeAgentMcpServers(definition: AgentDefinition): string {
  const count = definition.mcpServers?.length ?? 0
  if (count === 0) return 'No servers enabled.'
  return count === 1 ? '1 server enabled.' : `${count} servers enabled.`
}
