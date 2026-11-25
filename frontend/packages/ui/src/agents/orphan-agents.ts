import {isMountableAgentServerUrl} from '@seed-hypermedia/apps-protocol'
import type {AgentInfo} from './client'

/**
 * Agents the account owns that still live under a legacy id on a server that can host mounts: the
 * ones a user carries over from before agents were documents. Collaborator access cannot mount.
 * Kept import-light so the models and the mount dialog can both use it.
 */
export function unmountedOwnedAgents<T extends {serverUrl: string; agent: AgentInfo}>(options: T[]): T[] {
  return options.filter(
    ({serverUrl, agent}) =>
      agent.accessRole === 'owner' && !agent.id.startsWith('hm://') && isMountableAgentServerUrl(serverUrl),
  )
}
