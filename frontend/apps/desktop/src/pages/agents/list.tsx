import {useAgentLists, useAgentServerHealths, useAgentServerUrls, useAgentWebSocketSubscription} from '@/models/agents'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {hostnameStripProtocol} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Bot, CircleUserRound, Settings} from 'lucide-react'
import React, {useMemo} from 'react'
import {AgentListRow} from './agent-row'
import {CreateAgentDialog, ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'

function AgentsListPage() {
  const selectedAccountId = useSelectedAccountId()
  const navigate = useNavigate()
  const serverUrlsQuery = useAgentServerUrls()
  const serverUrls = serverUrlsQuery.data || []
  const agentQueries = useAgentLists(serverUrls, selectedAccountId)
  const healthQueries = useAgentServerHealths(serverUrls)
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
  const createAgentDialog = useAppDialog(CreateAgentDialog)

  const agents = useMemo(
    () =>
      serverUrls.flatMap((serverUrl, index) =>
        (agentQueries[index]?.data || []).map((agent) => ({...agent, serverUrl})),
      ),
    [agentQueries, serverUrls],
  )
  const isLoadingAgents = !!selectedAccountId && agentQueries.some((query) => query.isFetching && !query.data)
  const agentError = agentQueries.find((query) => query.isError)?.error
  const createAgentDisabledReason = !selectedAccountId
    ? 'Select an account before creating an agent.'
    : !serverUrls.length
      ? 'Configure an agent server before creating an agent.'
      : null

  return (
    <PanelContainer className="overflow-y-auto">
      <Container className="max-w-4xl gap-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
              <Bot className="size-6" />
            </div>
            <SizableText size="2xl" weight="bold">
              Agents
            </SizableText>
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <SizableText weight="bold">Agent Servers</SizableText>
            <Tooltip content="Configure agent servers">
              <Button onClick={() => navigate({key: 'settings', tab: 'agent-servers'})}>
                <Settings className="size-4" />
              </Button>
            </Tooltip>
          </div>
          {serverUrls.map((serverUrl, index) => {
            const health = healthQueries[index]
            const status = health?.isLoading ? 'Checking…' : health?.isError ? 'Offline' : 'Online'
            return (
              <AgentServerSubscription key={serverUrl} serverUrl={serverUrl} selectedAccountId={selectedAccountId}>
                <div
                  className="border-border bg-card hover:bg-muted/50 flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors"
                  onClick={() => navigate({key: 'agent-server', serverUrl})}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SizableText size="xs" className="truncate font-mono">
                      {hostnameStripProtocol(serverUrl)}
                    </SizableText>
                    <Tooltip content={status} asChild>
                      <span
                        className={`inline-block size-2.5 rounded-full align-middle ${
                          health?.isLoading
                            ? 'bg-muted-foreground/40'
                            : health?.isError
                              ? 'bg-destructive'
                              : 'bg-green-500'
                        } `}
                      />
                    </Tooltip>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        manageAccountsDialog.open({serverUrl, selectedAccountId})
                      }}
                      disabled={!selectedAccountId}
                    >
                      <CircleUserRound className="size-4" />
                      Accounts
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        providersDialog.open({serverUrl, selectedAccountId})
                      }}
                      disabled={!selectedAccountId}
                    >
                      <Settings className="size-4" />
                      Providers
                    </Button>
                  </div>
                </div>
              </AgentServerSubscription>
            )
          })}
          {!serverUrls.length ? <SizableText color="muted">No agent servers configured.</SizableText> : null}
        </section>

        {providersDialog.content}
        {manageAccountsDialog.content}
        {createAgentDialog.content}

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <SizableText weight="bold">All Agents</SizableText>
            <Tooltip content={createAgentDisabledReason || 'Create Agent'}>
              <span>
                <Button
                  onClick={() => createAgentDialog.open({serverUrls, selectedAccountId})}
                  disabled={!!createAgentDisabledReason}
                >
                  <Bot className="size-4" />
                  Create Agent
                </Button>
              </span>
            </Tooltip>
          </div>
          {!selectedAccountId ? <SizableText color="muted">Select an account to load agents.</SizableText> : null}
          {isLoadingAgents ? <SizableText color="muted">Loading agents…</SizableText> : null}
          {agentError ? (
            <SizableText className="text-destructive">
              {agentError instanceof Error ? agentError.message : 'Could not load agents'}
            </SizableText>
          ) : null}
          {selectedAccountId && !isLoadingAgents && !agents.length ? (
            <SizableText color="muted">No agents yet.</SizableText>
          ) : null}
          <div className="flex flex-col gap-2">
            {agents.map((agent) => (
              <AgentListRow
                key={`${agent.serverUrl}:${agent.id}`}
                agentId={agent.id}
                name={agent.definition.name}
                status={agent.status}
                serverUrl={agent.serverUrl}
              />
            ))}
          </div>
        </section>
      </Container>
    </PanelContainer>
  )
}

function AgentServerSubscription({
  serverUrl,
  selectedAccountId,
  children,
}: {
  serverUrl: string
  selectedAccountId: string | null | undefined
  children: React.ReactNode
}) {
  useAgentWebSocketSubscription(
    serverUrl,
    selectedAccountId,
    selectedAccountId ? `account/${selectedAccountId}` : undefined,
  )
  return <>{children}</>
}

export default AgentsListPage
