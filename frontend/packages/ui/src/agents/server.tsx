import {
  getDefaultAgentServerUrl,
  useAgentAccountsSync,
  useAgentList,
  useAgentServerUrl,
  useAgentWebSocketSubscription,
} from './models'
import {useSelectedAccountId} from './account'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Bot, CircleUserRound, Settings} from 'lucide-react'
import {AgentListRow} from './agent-row'
import {CreateAgentDialog, ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'
import {AgentBreadcrumb} from './header'
import {AgentsNoAccountPage} from './no-account'

export default function AgentServerPage() {
  const route = useNavRoute()
  const selectedAccountId = useSelectedAccountId()
  if (route.key !== 'agent-server') return null
  // Agent servers reject unauthenticated requests, so without an active account there is nothing
  // this page can load — gate it entirely rather than showing requests that would all fail.
  if (!selectedAccountId) return <AgentsNoAccountPage />
  return <AgentServerContent routeServerUrl={route.serverUrl} selectedAccountId={selectedAccountId} />
}

function AgentServerContent({routeServerUrl, selectedAccountId}: {routeServerUrl: string; selectedAccountId: string}) {
  // Keep every account these agents can author as synced locally, so they are immediately
  // mentionable and openable elsewhere in the app.
  useAgentAccountsSync()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || getDefaultAgentServerUrl() || ''
  const agents = useAgentList(serverUrl, selectedAccountId)
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
  const createAgentDialog = useAppDialog(CreateAgentDialog)
  useAgentWebSocketSubscription(serverUrl, selectedAccountId, `account/${selectedAccountId}`)

  return (
    <PanelContainer className="overflow-y-auto">
      <Container className="max-w-4xl gap-4 pt-4 pb-8">
        <AgentBreadcrumb serverUrl={serverUrl} />
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                  <Bot className="size-5" />
                </div>
                <SizableText size="2xl" weight="bold">
                  Agents server
                </SizableText>
              </div>
              <SizableText size="sm" color="muted" className="mt-1 block truncate font-mono">
                {serverUrl}
              </SizableText>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Tooltip content="Create Agent">
              <span>
                <Button
                  className="max-sm:min-h-10"
                  onClick={() => createAgentDialog.open({serverUrls: [serverUrl], selectedAccountId})}
                >
                  <Bot className="size-4" />
                  Create Agent
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="outline"
              className="max-sm:min-h-10"
              onClick={() => manageAccountsDialog.open({serverUrl, selectedAccountId})}
            >
              <CircleUserRound className="size-4" />
              Accounts
            </Button>
            <Button
              variant="outline"
              className="max-sm:min-h-10"
              onClick={() => providersDialog.open({serverUrl, selectedAccountId})}
            >
              <Settings className="size-4" />
              Providers
            </Button>
          </div>
        </header>

        {providersDialog.content}
        {manageAccountsDialog.content}
        {createAgentDialog.content}

        <section className="flex flex-col gap-3">
          <SizableText weight="bold">Agents</SizableText>
          {agents.isLoading ? <SizableText color="muted">Loading agents…</SizableText> : null}
          {agents.isError ? (
            <SizableText className="text-destructive">
              {agents.error instanceof Error ? agents.error.message : 'Could not load agents'}
            </SizableText>
          ) : null}
          {!agents.isLoading && !agents.data?.length ? (
            <SizableText color="muted">No agents on this server yet.</SizableText>
          ) : null}
          <div className="flex flex-col gap-2">
            {(agents.data || []).map((agent) => (
              <AgentListRow
                key={agent.id}
                agentId={agent.id}
                name={agent.definition.name}
                status={agent.status}
                serverUrl={serverUrl}
                accessRole={agent.accessRole}
              />
            ))}
          </div>
        </section>
      </Container>
    </PanelContainer>
  )
}
