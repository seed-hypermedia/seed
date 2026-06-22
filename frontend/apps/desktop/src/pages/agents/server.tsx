import {type AgentInfo} from '@/agents-client'
import {
  DEFAULT_AGENT_SERVER_URL,
  useAgentList,
  useAgentServerHealth,
  useAgentServerUrl,
  useAgentWebSocketSubscription,
  useModelProviders,
} from '@/models/agents'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Bot, CircleUserRound, Settings} from 'lucide-react'
import {CreateAgentDialog, ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'
import {AgentBreadcrumb} from './header'

export default function AgentServerPage() {
  const route = useNavRoute()
  if (route.key !== 'agent-server') return null
  return <AgentServerContent routeServerUrl={route.serverUrl} />
}

function AgentServerContent({routeServerUrl}: {routeServerUrl: string}) {
  const selectedAccountId = useSelectedAccountId()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || DEFAULT_AGENT_SERVER_URL
  const agents = useAgentList(serverUrl, selectedAccountId)
  const health = useAgentServerHealth(serverUrl)
  const providers = useModelProviders(serverUrl, selectedAccountId)
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
  const createAgentDialog = useAppDialog(CreateAgentDialog)
  useAgentWebSocketSubscription(
    serverUrl,
    selectedAccountId,
    selectedAccountId ? `account/${selectedAccountId}` : undefined,
  )

  const status = health.isLoading ? 'Checking…' : health.isError ? 'Offline' : 'Online'
  const createAgentDisabledReason = !selectedAccountId ? 'Select an account before creating an agent.' : null

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
              <SizableText size="sm" color="muted">
                {status} · {providers.data?.length || 0} model providers
              </SizableText>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Tooltip content={createAgentDisabledReason || 'Create Agent'}>
              <span>
                <Button
                  onClick={() => createAgentDialog.open({serverUrls: [serverUrl], selectedAccountId})}
                  disabled={!!createAgentDisabledReason}
                >
                  <Bot className="size-4" />
                  Create Agent
                </Button>
              </span>
            </Tooltip>
            <Button
              variant="outline"
              onClick={() => manageAccountsDialog.open({serverUrl, selectedAccountId})}
              disabled={!selectedAccountId}
            >
              <CircleUserRound className="size-4" />
              Accounts
            </Button>
            <Button
              variant="outline"
              onClick={() => providersDialog.open({serverUrl, selectedAccountId})}
              disabled={!selectedAccountId}
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
              <AgentServerAgentItem key={agent.id} agent={agent} serverUrl={serverUrl} />
            ))}
          </div>
        </section>
      </Container>
    </PanelContainer>
  )
}

function AgentServerAgentItem({agent, serverUrl}: {agent: AgentInfo; serverUrl: string}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="border-border hover:bg-muted/60 flex w-full cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 text-left transition-colors"
      onClick={() => navigate({key: 'agent', agentId: agent.id, serverUrl})}
    >
      <div className="min-w-0">
        <SizableText weight="bold">{agent.definition.name}</SizableText>
        <SizableText size="sm" color="muted" className="block truncate">
          {agent.definition.modelProvider} · {agent.definition.model} · {agent.status}
        </SizableText>
        <SizableText size="xs" color="muted" className="block truncate font-mono">
          {agent.id}
        </SizableText>
      </div>
    </button>
  )
}
