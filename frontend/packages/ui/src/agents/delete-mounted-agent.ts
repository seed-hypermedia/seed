import {isMountableAgentServerUrl} from '@seed-hypermedia/agents-protocol'
import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {AgentServerError} from './client'
import {useDeleteAgent} from './models'

/** The agents server a document's metadata mounts an agent on, or undefined for any other document. */
export function mountedAgentServerUrl(metadata: HMMetadata | undefined): string | undefined {
  const serverUrl = metadata?.agentServerUrl
  if (metadata?.type !== 'hm://hyper.media/agent' || typeof serverUrl !== 'string') return undefined
  return isMountableAgentServerUrl(serverUrl) ? serverUrl : undefined
}

/**
 * Deleting a mounted agent's document deletes the agent with it: a mounted agent has no separate
 * "delete agent" action. `deleteAgent` does nothing for any other document, and tolerates an
 * agent the server has already lost, so the document can still be cleaned up.
 */
export function useMountedAgentDeletion(
  id: UnpackedHypermediaId,
  metadata: HMMetadata | undefined,
  accountUid: string | null | undefined,
): {serverUrl: string | undefined; isAgent: boolean; deleteAgent: () => Promise<void>} {
  const serverUrl = mountedAgentServerUrl(metadata)
  const deleteAgent = useDeleteAgent(serverUrl, accountUid)
  return {
    serverUrl,
    isAgent: !!serverUrl,
    deleteAgent: async () => {
      if (!serverUrl) return
      try {
        await deleteAgent.mutateAsync(hmId(id.uid, {path: id.path}).id)
      } catch (error) {
        if (error instanceof AgentServerError && error.status === 404) return
        throw error
      }
    },
  }
}
