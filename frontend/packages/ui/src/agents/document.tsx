import {useResource} from '@shm/shared/models/entity'
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {PageLayout} from '../page-layout'
import {useRouteLink, hmId} from '@shm/shared'
import type {AgentInfo} from './client'
import {useAgentDetail, useSigningIdentities} from './models'
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
export default function MountedAgentDocument({document, route, children, contentMaxWidth}: AgentDocumentViewProps) {
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
  if (!route.agentView)
    return (
      <AgentHome
        agent={agent.data!.agent}
        serverUrl={serverUrl}
        accountUid={accountUid}
        contentMaxWidth={contentMaxWidth}
      />
    )
  return (
    <div className="flex h-[70vh] min-h-96 flex-col">
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
                : route.agentView
          }
          triggerId={route.agentTriggerId}
          memoryPath={route.agentMemoryPath}
        />
      )}
    </div>
  )
}

function AgentHome({
  agent,
  serverUrl,
  accountUid,
  contentMaxWidth,
}: {
  agent: AgentInfo
  serverUrl: string
  accountUid: string
  contentMaxWidth?: number
}) {
  const identities = useSigningIdentities(serverUrl, accountUid, agent.id)
  const key = agent.definition.signingKey || agent.definition.signingKeys?.[0]
  const identity = identities.data?.find((identity) => identity.name === key)
  const home = identity?.accountId ? hmId(identity.accountId) : null
  const resource = useResource(home, {subscribed: true})
  const Viewer = useReadOnlyViewer()
  const homeLink = useRouteLink(home ? {key: 'document', id: home} : null)
  if (identities.isInitialLoading || resource.isInitialLoading) return <Spinner />
  if (identities.isError) return <p role="alert">Could not load the agent home.</p>
  if (!home) return <p>This agent has no home identity.</p>
  const homeDocument = resource.data?.type === 'document' ? resource.data.document : null
  if (!homeDocument) return <p role="alert">Could not load the agent home document.</p>
  return (
    <div className="px-5 py-4">
      <PageLayout contentMaxWidth={contentMaxWidth}>
        <div className="flex flex-col gap-4">
          <a {...homeLink} className="text-primary self-end text-sm underline">
            Open home document
          </a>
          {Viewer && (
            <Viewer
              blocks={homeDocument.content}
              resourceId={home}
              resourceKind="document"
              rootChildrenType={homeDocument.metadata.childrenType}
            />
          )}
        </div>
      </PageLayout>
    </div>
  )
}
