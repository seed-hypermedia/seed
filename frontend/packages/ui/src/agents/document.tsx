import {useAcceptAgentInvite, useAgentDetail, useAgentInvites} from './models'
import {toast} from '../toast'
import {AgentServerError} from './client'
import {Spinner} from '../spinner'
import {Button} from '../button'
import {SizableText} from '../text'
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
  // An invited account cannot see the agent until it accepts, so the invite is offered here, on
  // the page the owner would link to, rather than on a screen of its own.
  const notFound = agent.error instanceof AgentServerError && agent.error.status === 404
  const invites = useAgentInvites(validServer && notFound ? serverUrl : undefined, accountUid)
  const invite = invites.data?.find((candidate) => candidate.agentId === route.id.id)
  const acceptInvite = useAcceptAgentInvite(validServer ? serverUrl : undefined, accountUid)
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
  if (!hasAgent) {
    // The server answers 404 both for an agent that is not shared with this account and for one it
    // no longer hosts (orphaned, deleted). The document says an agent lives here, so name both.
    const serverHost = (() => {
      try {
        return new URL(serverUrl).host
      } catch {
        return serverUrl
      }
    })()
    return (
      <div role="alert" className="flex flex-col items-start gap-3 p-5">
        {agent.error && !notFound ? (
          <SizableText>Could not verify this agent. Check your access and server connection.</SizableText>
        ) : invite ? (
          <>
            <SizableText weight="bold">You are invited to this agent</SizableText>
            <SizableText color="muted">
              The agent's owner invited your account {accountUid} as a {invite.role}. Accept to open it.
            </SizableText>
            <Button
              disabled={acceptInvite.isLoading}
              onClick={() =>
                acceptInvite.mutate(route.id.id, {
                  onSuccess: () => void agent.refetch(),
                  onError: (error) =>
                    toast.error(error instanceof Error ? error.message : 'Could not accept the invite'),
                })
              }
            >
              Accept invite
            </Button>
          </>
        ) : notFound ? (
          <>
            <SizableText weight="bold">This agent is not shared with your account</SizableText>
            <SizableText color="muted">
              The agent server at {serverHost} has no agent for this document that your account {accountUid} can see.
              Ask the agent's owner to share it with you from its Agent access tab, or sign in as the owner. If the
              agent was orphaned or deleted, the server no longer knows this document.
            </SizableText>
          </>
        ) : (
          <SizableText>No agent is registered at this document.</SizableText>
        )}
        <Button variant="outline" onClick={() => agent.refetch()}>
          Retry
        </Button>
      </div>
    )
  }
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
          documentName={document.metadata.name}
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
