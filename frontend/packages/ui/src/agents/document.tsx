import {useAgentDetail} from './models'
import {AgentServerError} from './client'
import {Spinner} from '../spinner'
import {Button} from '../button'
import type {AgentDocumentViewProps} from '../agent-document-view'
import {isMountableAgentServerUrl} from '@seed-hypermedia/agents-protocol'
import {AgentDetailPage} from './detail'
import {AgentSessionPage} from './session'
import {AgentsNoAccountPage} from './no-account'
import {getAgentsPlatform} from './platform'

/** Renders agent controls using the document's server attribute and canonical identity. */
export default function MountedAgentDocument({document, route, children}: AgentDocumentViewProps) {
  const accountUid = getAgentsPlatform().useAccountUid()
  const serverUrl = document.metadata.agentServerUrl
  const validServer =
    (document.metadata.type === undefined || document.metadata.type === 'hm://hyper.media/agent') &&
    !!serverUrl &&
    isMountableAgentServerUrl(serverUrl)
  const agent = useAgentDetail(validServer ? serverUrl : undefined, accountUid, route.id.id)
  const hasAgent = !!accountUid && validServer && !agent.isError && agent.data?.agent.id === route.id.id
  if (children) return children(hasAgent)
  if (!validServer)
    return (
      <p role="alert" className="p-5">
        This document has no valid agent server address.
      </p>
    )
  if (!accountUid) return <AgentsNoAccountPage />
  if (agent.isInitialLoading)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    )
  if (!hasAgent)
    return (
      <div role="alert" className="flex items-center gap-3 p-5">
        {agent.error && !(agent.error instanceof AgentServerError && agent.error.status === 404)
          ? 'Could not verify this agent. Check your access and server connection.'
          : 'No agent is registered at this document.'}
        <Button variant="outline" onClick={() => agent.refetch()}>
          Retry
        </Button>
      </div>
    )
  // No Home tab for now: the base URL opens Sessions.
  return (
    // The page gives this column its height (see fixedHeightMain in resource-page-common).
    <div className="flex min-h-0 flex-1 flex-col">
      {route.agentView === 'session' && route.agentSessionId ? (
        <AgentSessionPage
          embedded
          sessionId={route.agentSessionId}
          routeAgentId={route.id.id}
          routeServerUrl={serverUrl}
        />
      ) : (
        <AgentDetailPage
          embedded
          agentId={route.id.id}
          routeServerUrl={serverUrl}
          tab={
            route.agentView === 'access'
              ? 'collaborators'
              : route.agentView === 'session'
                ? 'sessions'
                : route.agentView === 'tools'
                  ? 'permissions'
                  : route.agentView ?? 'sessions'
          }
          triggerId={route.agentTriggerId}
          memoryPath={route.agentMemoryPath}
        />
      )}
    </div>
  )
}
