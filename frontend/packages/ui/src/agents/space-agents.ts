/**
 * The agents a space publishes to its readers.
 *
 * An agent server only ever lists agents the caller owns or collaborates on, so a reader who has
 * just arrived at a space cannot discover its agents by asking. The space names them instead, in
 * its home document's `spaceAgents` metadata, and clients fetch each one by id from the space's
 * `agentServerUrl` — which the server answers for any signed account once the agent is public-read.
 *
 * Stored as `{[agentId]: order}` rather than an ordered list because document metadata attributes
 * have no array encoding (see `getDocAttributeChanges`): values are strings, ints, bools, and
 * nested objects only. Nothing but the id and the position is stored — an agent's name, icon, and
 * status are read from the agent, so renaming one never strands a stale copy in a signed document.
 *
 * These helpers are deliberately free of React and fetching so the encoding is directly testable.
 */

/**
 * Reads the published agent ids, first to last.
 *
 * Tolerates everything a hand-edited or partially-removed document can hold: removing an agent
 * writes a null attribute rather than dropping the key, so tombstones must be skipped, and orders
 * may collide or leave gaps. The id breaks ties, keeping the sort total and stable.
 */
export function parseSpaceAgentIds(spaceAgents: unknown): string[] {
  if (!spaceAgents || typeof spaceAgents !== 'object' || Array.isArray(spaceAgents)) return []
  const entries: [string, number][] = []
  for (const [agentId, order] of Object.entries(spaceAgents as Record<string, unknown>)) {
    if (!agentId) continue
    const position = typeof order === 'number' ? order : typeof order === 'bigint' ? Number(order) : null
    if (position === null || !Number.isFinite(position)) continue
    entries.push([agentId, position])
  }
  entries.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return entries.map(([agentId]) => agentId)
}

/**
 * Encodes an ordered id list back into the metadata value.
 *
 * Positions are always renumbered from zero, so the stored orders stay a dense sequence no matter
 * how the list was edited. Ids dropped from the list are simply absent: `getDocAttributeChanges`
 * diffs the result against the published value and emits the removals itself.
 */
export function spaceAgentsMetadata(agentIds: string[]): Record<string, number> {
  const value: Record<string, number> = {}
  for (const agentId of agentIds) {
    if (!agentId || agentId in value) continue
    value[agentId] = Object.keys(value).length
  }
  return value
}

/**
 * Makes one published agent the space's default, which is simply the first of them: the assistant
 * panel opens on the first option, so position is the whole of what "default" means here.
 */
export function makeSpaceAgentDefault(agentIds: string[], agentId: string): string[] {
  if (!agentIds.includes(agentId) || agentIds[0] === agentId) return agentIds
  return [agentId, ...agentIds.filter((id) => id !== agentId)]
}

/**
 * Whether a space may publish this agent.
 *
 * A published agent has to be readable by the people it is published to, so only an agent that is
 * already public can be published. Publishing deliberately does not grant that itself: opening an
 * agent to the world is its owner's decision to make on the agent, not a side effect of listing it
 * on a space.
 */
export function canPublishAgent(agent: {publicRead?: boolean}): boolean {
  return agent.publicRead === true
}
