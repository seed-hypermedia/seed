import type {AgentDefinition} from './client'

/** The signing keys an agent may sign with, its primary key first. */
export function agentSigningKeys(
  definition: Pick<AgentDefinition, 'signingKey' | 'signingKeys'> | undefined,
): string[] {
  if (!definition) return []
  const keys = definition.signingKeys?.length
    ? definition.signingKeys
    : definition.signingKey
      ? [definition.signingKey]
      : []
  const primary = primaryAgentSigningKey(definition)
  return primary ? [primary, ...keys.filter((key) => key !== primary)] : keys
}

/**
 * The agent's primary signing key: the account it is, which publishes by default, receives its
 * mentions and holds its write access. `signingKey` names it; an agent whose `signingKey` is no
 * longer enabled falls back to its first enabled key, like the server does.
 */
export function primaryAgentSigningKey(
  definition: Pick<AgentDefinition, 'signingKey' | 'signingKeys'> | undefined,
): string | undefined {
  if (!definition) return undefined
  const keys = definition.signingKeys?.length ? definition.signingKeys : []
  if (definition.signingKey && (!keys.length || keys.includes(definition.signingKey))) return definition.signingKey
  return keys[0]
}
