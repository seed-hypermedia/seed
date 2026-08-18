import {
  isLocalAgentServer,
  LOCAL_AGENT_SERVER_LABEL,
  useAcceptAgentInvite,
  useAgentInviteLists,
  useAgentLists,
  useAgentServerHealths,
  useDeclineAgentInvite,
  useAgentServerUrls,
  useAgentWebSocketSubscription,
  useLocalAgentServerUrl,
} from './models'
import {useSelectedAccountId} from './account'
import {useNavigate} from './navigation'
import {hostnameStripProtocol} from '@shm/shared'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Bot, Check, CircleUserRound, Mail, Settings, X} from 'lucide-react'
import React, {useMemo} from 'react'
import {AgentListRow} from './agent-row'
import {CreateAgentDialog, ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'
import {AgentsNoAccountPage} from './no-account'
import {getAgentsPlatform} from './platform'
import {AgentServersDialog} from './server-settings'

function AgentsListPage() {
  const selectedAccountId = useSelectedAccountId()
  // Agent servers reject unauthenticated requests, so without an active account there is nothing
  // this page can load — gate it entirely rather than showing rows that would all fail.
  if (!selectedAccountId) return <AgentsNoAccountPage />
  return <AgentsListContent selectedAccountId={selectedAccountId} />
}

function AgentsListContent({selectedAccountId}: {selectedAccountId: string}) {
  const navigate = useNavigate()
  const serverUrlsQuery = useAgentServerUrls()
  const serverUrls = serverUrlsQuery.data || []
  const localServerUrl = useLocalAgentServerUrl()
  const agentQueries = useAgentLists(serverUrls, selectedAccountId)
  const inviteQueries = useAgentInviteLists(serverUrls, selectedAccountId)
  const healthQueries = useAgentServerHealths(serverUrls)
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
  const createAgentDialog = useAppDialog(CreateAgentDialog)
  const serverSettingsDialog = useAppDialog(AgentServersDialog)
  // Platforms with a settings window (desktop) open it; the rest manage servers in a dialog here.
  const openServerSettings = (getAgentsPlatform().useOpenServerSettings ?? (() => null))()

  const agents = useMemo(
    () =>
      serverUrls.flatMap((serverUrl, index) =>
        (agentQueries[index]?.data || []).map((agent) => ({...agent, serverUrl})),
      ),
    [agentQueries, serverUrls],
  )
  const invites = useMemo(
    () =>
      serverUrls.flatMap((serverUrl, index) =>
        (inviteQueries[index]?.data || []).map((invite) => ({...invite, serverUrl})),
      ),
    [inviteQueries, serverUrls],
  )
  const isLoadingAgents = agentQueries.some((query) => query.isFetching && !query.data)
  const agentError = agentQueries.find((query) => query.isError)?.error
  const createAgentDisabledReason = !serverUrls.length ? 'Configure an agent server before creating an agent.' : null

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
              <Button onClick={() => (openServerSettings ? openServerSettings() : serverSettingsDialog.open(true))}>
                <Settings className="size-4" />
              </Button>
            </Tooltip>
          </div>
          {serverUrls.map((serverUrl, index) => {
            const health = healthQueries[index]
            const status = health?.isLoading ? 'Checking…' : health?.isError ? 'Offline' : 'Online'
            const isLocal = isLocalAgentServer(serverUrl, localServerUrl.data)
            // The local server is part of the app, so an "online" indicator on it is noise. A
            // failure still shows, because that is a real problem the user needs to see.
            const showStatusDot = !isLocal || health?.isError
            return (
              <AgentServerSubscription key={serverUrl} serverUrl={serverUrl} selectedAccountId={selectedAccountId}>
                <div
                  className="border-border bg-card hover:bg-muted/50 flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition-colors"
                  onClick={() => navigate({key: 'agent-server', serverUrl})}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <SizableText size="xs" className={isLocal ? 'truncate font-medium' : 'truncate font-mono'}>
                      {isLocal ? LOCAL_AGENT_SERVER_LABEL : hostnameStripProtocol(serverUrl)}
                    </SizableText>
                    {showStatusDot ? (
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
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-sm:min-h-10"
                      onClick={(event) => {
                        event.stopPropagation()
                        manageAccountsDialog.open({serverUrl, selectedAccountId})
                      }}
                    >
                      <CircleUserRound className="size-4" />
                      Accounts
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="max-sm:min-h-10"
                      onClick={(event) => {
                        event.stopPropagation()
                        providersDialog.open({serverUrl, selectedAccountId})
                      }}
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
        {serverSettingsDialog.content}

        {invites.length ? (
          <section className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Mail className="text-muted-foreground size-4" />
              <SizableText weight="bold">Invites</SizableText>
              <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-bold">
                {invites.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {invites.map((invite) => (
                <AgentInviteRow
                  key={`${invite.serverUrl}:${invite.agentId}`}
                  invite={invite}
                  selectedAccountId={selectedAccountId}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <SizableText weight="bold">All Agents</SizableText>
            <Tooltip content={createAgentDisabledReason || 'Create Agent'}>
              <span>
                <Button
                  className="max-sm:min-h-10"
                  onClick={() => createAgentDialog.open({serverUrls, selectedAccountId})}
                  disabled={!!createAgentDisabledReason}
                >
                  <Bot className="size-4" />
                  Create Agent
                </Button>
              </span>
            </Tooltip>
          </div>
          {isLoadingAgents ? <SizableText color="muted">Loading agents…</SizableText> : null}
          {agentError ? (
            <SizableText className="text-destructive">
              {agentError instanceof Error ? agentError.message : 'Could not load agents'}
            </SizableText>
          ) : null}
          {!isLoadingAgents && !agents.length ? <SizableText color="muted">No agents yet.</SizableText> : null}
          <div className="flex flex-col gap-2">
            {agents.map((agent) => (
              <AgentListRow
                key={`${agent.serverUrl}:${agent.id}`}
                agentId={agent.id}
                name={agent.definition.name}
                status={agent.status}
                serverUrl={agent.serverUrl}
                accessRole={agent.accessRole}
              />
            ))}
          </div>
        </section>
      </Container>
    </PanelContainer>
  )
}

function AgentInviteRow({
  invite,
  selectedAccountId,
}: {
  invite: {
    agentId: string
    agentName: string
    ownerAccountId: string
    role: 'reader' | 'writer'
    serverUrl: string
  }
  selectedAccountId: string
}) {
  const navigate = useNavigate()
  const accept = useAcceptAgentInvite(invite.serverUrl, selectedAccountId)
  const decline = useDeclineAgentInvite(invite.serverUrl, selectedAccountId)
  const pending = accept.isLoading || decline.isLoading

  return (
    <div className="border-border bg-card flex items-center gap-3 rounded-lg border p-3">
      <div className="bg-primary/10 text-primary flex size-9 flex-none items-center justify-center rounded-lg">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <SizableText weight="bold" className="block truncate">
          {invite.agentName}
        </SizableText>
        <SizableText size="xs" color="muted" className="block">
          {invite.role === 'writer' ? 'Write collaborator' : 'Read collaborator'} · invited by{' '}
          {abbreviateUid(invite.ownerAccountId)}
        </SizableText>
      </div>
      <Button
        size="sm"
        onClick={() =>
          accept.mutate(invite.agentId, {
            onSuccess: (result) => {
              if (result._ !== 'AcceptAgentInviteResponse') return
              navigate({key: 'agent', agentId: invite.agentId, serverUrl: invite.serverUrl})
            },
          })
        }
        disabled={pending}
      >
        <Check className="size-4" /> Accept
      </Button>
      <Button variant="ghost" size="sm" onClick={() => decline.mutate(invite.agentId)} disabled={pending}>
        <X className="size-4" /> Decline
      </Button>
    </div>
  )
}

function AgentServerSubscription({
  serverUrl,
  selectedAccountId,
  children,
}: {
  serverUrl: string
  selectedAccountId: string
  children: React.ReactNode
}) {
  useAgentWebSocketSubscription(serverUrl, selectedAccountId, `account/${selectedAccountId}`)
  return <>{children}</>
}

export default AgentsListPage
