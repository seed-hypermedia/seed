import type {AgentAccessRole} from '@seed-hypermedia/agents-protocol'

/**
 * What an access role lets the UI offer. `chatter` (a public reader on an agent with public chat on)
 * can create and message sessions but cannot change the agent, rename or delete sessions, control
 * runs, or invoke session tools. An absent role comes from the owner's own listing.
 */
export function agentAccessCanWrite(role: AgentAccessRole | undefined): boolean {
  return role === undefined || role === 'owner' || role === 'writer'
}

/** Whether the role may create sessions and send messages (everything but a plain reader). */
export function agentAccessCanChat(role: AgentAccessRole | undefined): boolean {
  return role !== 'reader'
}
