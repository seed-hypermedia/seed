import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {isMountableAgentServerUrl} from '@seed-hypermedia/apps-protocol'
import {agentAccessCanChat} from './access'
import {useSelectedAccountId} from './account'
import {useAgentDetail, useLocalAgentServerUrl} from './models'
import {NewSessionComposer} from './new-session-composer'

/**
 * The new-session composer on an agent's Home (its document), pinned to the bottom like on the
 * Sessions tab: the first send creates a session with this agent and opens it. Shown to anyone who
 * can chat with the agent.
 */
export function AgentHomeComposer({docId, document}: {docId: UnpackedHypermediaId; document: HMDocument}) {
  const accountUid = useSelectedAccountId()
  const localServerUrl = useLocalAgentServerUrl()
  const serverUrl =
    typeof document.metadata.agentServerUrl === 'string' && isMountableAgentServerUrl(document.metadata.agentServerUrl)
      ? document.metadata.agentServerUrl
      : undefined
  const agent = useAgentDetail(serverUrl, accountUid, docId.id)
  const info = agent.data?.agent
  if (!serverUrl || !info || info.id !== docId.id || !agentAccessCanChat(info.accessRole ?? 'owner')) return null
  return (
    <div className="border-border bg-panel sticky bottom-0 z-10 flex-none border-t" data-testid="agent-home-composer">
      <div className="mx-auto flex w-full max-w-4xl flex-col px-4 py-2">
        <NewSessionComposer
          fixedAgent={{serverUrl, agent: info}}
          accountUid={accountUid}
          localServerUrl={localServerUrl.data}
          agentToolsLoading={agent.isLoading}
        />
      </div>
    </div>
  )
}
