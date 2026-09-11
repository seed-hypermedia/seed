import {
  describeAgentServer,
  isLocalAgentServer,
  LOCAL_AGENT_SERVER_LABEL,
  useAcceptAgentInvite,
  useAgentAccountsSync,
  useAgentInviteLists,
  useAgentLists,
  useAgentServerHealths,
  useAllAgentSessionPages,
  useDeclineAgentInvite,
  useAgentServerUrls,
  useAgentWebSocketSubscription,
  useLocalAgentServerUrl,
  useSpaceAgents,
} from './models'
import {useSelectedAccountId} from './account'
import {useClickNavigate, useNavigate} from './navigation'
import {hostnameStripProtocol} from '@shm/shared'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Container, PanelContainer} from '@shm/ui/container'
import {Notice, NOTICE_TONE_DOT_CLASS} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ArrowRight, Bot, Check, ChevronDown, CircleUserRound, Mail, Server, Settings, X} from 'lucide-react'
import {useMemo} from 'react'
import {AgentListRow} from './agent-row'
import {CreateAgentDialog, ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'
import {describeAgentError} from './errors'
import {AgentsNoAccountPage} from './no-account'
import {getAgentsPlatform} from './platform'
import {AgentServersDialog} from './server-settings'
import {AgentTitleMenu} from './agent-title-menu'
import {SessionListItem} from './session-list-item'

function AgentsListPage() {
  const selectedAccountId = useSelectedAccountId()
  // Agent servers reject unauthenticated requests, so without an active account there is nothing
  // this page can load — gate it entirely rather than showing rows that would all fail.
  if (!selectedAccountId) return <AgentsNoAccountPage />
  return <AgentsListContent selectedAccountId={selectedAccountId} />
}

function AgentsListContent({selectedAccountId}: {selectedAccountId: string}) {
  // Keep every account these agents can author as synced locally, so they are immediately
  // mentionable and openable elsewhere in the app.
  useAgentAccountsSync()
  const navigate = useNavigate()
  const clickNavigate = useClickNavigate()
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
  const spaceAgents = useSpaceAgents(selectedAccountId)
  // Only the ones the user does not already have. A space owner's own agents belong in the main
  // list below, where they can be opened and edited; what this section is for is the visitor case,
  // where every list comes back empty and the space's published agents are the only way in.
  const publishedAgents = useMemo(
    () =>
      spaceAgents.agents.filter(
        (option) => !agents.some((agent) => agent.serverUrl === option.serverUrl && agent.id === option.agent.id),
      ),
    [agents, spaceAgents.agents],
  )
  // The page's body: the account's sessions across every server, newest activity first. A space's
  // published agents contribute the visitor's chats with them, exactly as the sidebar merges them.
  const sessionPages = useAllAgentSessionPages(serverUrls, selectedAccountId)
  const sessions = useMemo(() => {
    const seen = new Set(sessionPages.entries.map((entry) => `${entry.serverUrl}:${entry.session.id}`))
    const extra = spaceAgents.sessions.filter((entry) => !seen.has(`${entry.serverUrl}:${entry.session.id}`))
    return extra.length
      ? [...sessionPages.entries, ...extra].sort((a, b) => b.session.updatedAt - a.session.updatedAt)
      : sessionPages.entries
  }, [sessionPages.entries, spaceAgents.sessions])
  const isLoadingSessions = sessionPages.isLoading || (spaceAgents.isLoading && !sessions.length)
  // One notice per failing server, named, so a single unreachable server reads as exactly that
  // and never as "agents are broken": the other servers' sessions are still listed below.
  const serverProblems = sessionPages.serverErrors.map((problem) => ({
    serverUrl: problem.serverUrl,
    notice: describeAgentError(problem.error, {
      failed: 'Couldn’t load sessions',
      serverLabel: describeAgentServer(problem.serverUrl, localServerUrl.data),
    }),
    refetch: problem.refetch,
    isFetching: problem.isFetching,
  }))
  const createAgentDisabledReason = !serverUrls.length ? 'Configure an agent server before creating an agent.' : null

  return (
    <PanelContainer className="overflow-y-auto">
      <Container className="max-w-4xl gap-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
              <Bot className="size-6" />
            </div>
            <AgentTitleMenu title="Agents" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="max-sm:min-h-10">
                  <Server className="size-4" />
                  {describeAgentServerCount(serverUrls.length)}
                  <ChevronDown className="size-4 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {serverUrls.map((serverUrl, index) => {
                  const health = healthQueries[index]
                  const status = health?.isLoading ? 'Checking…' : health?.isError ? 'Unreachable' : 'Online'
                  const isLocal = isLocalAgentServer(serverUrl, localServerUrl.data)
                  // The local server is part of the app, so an "online" indicator on it is noise. A
                  // failure still shows, because that is a real problem the user needs to see.
                  const showStatusDot = !isLocal || health?.isError
                  return (
                    <DropdownMenuSub key={serverUrl}>
                      <DropdownMenuSubTrigger>
                        <span className="flex min-w-0 items-center gap-2">
                          <SizableText size="sm" className={isLocal ? 'truncate font-medium' : 'truncate font-mono'}>
                            {isLocal ? LOCAL_AGENT_SERVER_LABEL : hostnameStripProtocol(serverUrl)}
                          </SizableText>
                          {showStatusDot ? (
                            <span
                              aria-label={status}
                              className={`inline-block size-2.5 flex-none rounded-full align-middle ${
                                health?.isLoading
                                  ? 'bg-muted-foreground/40'
                                  : health?.isError
                                    ? NOTICE_TONE_DOT_CLASS.warning
                                    : 'bg-green-500'
                              } `}
                            />
                          ) : null}
                        </span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-48">
                        <DropdownMenuLabel className="flex flex-col gap-0.5">
                          <SizableText size="sm" className={isLocal ? 'font-medium' : 'font-mono'}>
                            {isLocal ? LOCAL_AGENT_SERVER_LABEL : hostnameStripProtocol(serverUrl)}
                          </SizableText>
                          <SizableText size="xs" color="muted">
                            {isLocal && !health?.isError ? 'Managed by this app' : status}
                          </SizableText>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => navigate({key: 'agent-server', serverUrl})}>
                          <ArrowRight />
                          Open Server
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => manageAccountsDialog.open({serverUrl, selectedAccountId})}>
                          <CircleUserRound />
                          Accounts
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => providersDialog.open({serverUrl, selectedAccountId})}>
                          <Settings />
                          Providers
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                })}
                {!serverUrls.length ? <DropdownMenuItem disabled>No agent servers configured.</DropdownMenuItem> : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => (openServerSettings ? openServerSettings() : serverSettingsDialog.open(true))}
                >
                  <Server />
                  Manage Agent Servers
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
        </div>

        {/* Live updates for every server stay mounted regardless of whether the servers menu is open. */}
        {serverUrls.map((serverUrl) => (
          <AgentServerSubscription key={serverUrl} serverUrl={serverUrl} selectedAccountId={selectedAccountId} />
        ))}

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

        {publishedAgents.length ? (
          <section className="flex flex-col gap-3">
            <SizableText weight="bold">Agents in this space</SizableText>
            <div className="flex flex-col gap-2">
              {publishedAgents.map(({serverUrl, agent}) => (
                <AgentListRow
                  key={`${serverUrl}:${agent.id}`}
                  agentId={agent.id}
                  name={agent.definition.name}
                  status={agent.status}
                  serverUrl={serverUrl}
                  accessRole={agent.accessRole}
                  activity={agent.activity}
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <SizableText weight="bold">Recent Sessions</SizableText>
          {isLoadingSessions ? <SizableText color="muted">Loading sessions…</SizableText> : null}
          {serverProblems.map((problem) => (
            <Notice
              key={problem.serverUrl}
              tone={problem.notice.tone}
              title={problem.notice.title}
              onRetry={problem.refetch}
              retryPending={problem.isFetching}
            >
              {problem.notice.detail}
            </Notice>
          ))}
          {!isLoadingSessions && !sessions.length && !serverProblems.length ? (
            <SizableText color="muted">
              {serverUrls.length ? 'No sessions yet. Pick an agent from the title to start one.' : 'No sessions yet.'}
            </SizableText>
          ) : null}
          <div className="flex flex-col gap-1">
            {sessions.map(({serverUrl, session, agent}) => (
              <SessionListItem
                key={`${serverUrl}:${session.id}`}
                session={session}
                serverUrl={serverUrl}
                accountUid={selectedAccountId}
                agentName={agent?.definition.name || session.agentId}
                onOpen={(event) =>
                  clickNavigate(
                    {key: 'agent-session', agentId: session.agentId, sessionId: session.id, serverUrl},
                    event,
                  )
                }
                onOpenSession={(child, event) =>
                  clickNavigate({key: 'agent-session', agentId: child.agentId, sessionId: child.id, serverUrl}, event)
                }
                onOpenTrigger={() =>
                  session.startedByTrigger
                    ? navigate({
                        key: 'agent',
                        agentId: session.agentId,
                        serverUrl,
                        tab: 'triggers',
                        triggerId: session.startedByTrigger.triggerId,
                      })
                    : undefined
                }
              />
            ))}
          </div>
          {sessionPages.hasNextPage ? (
            <Button
              className="w-full"
              variant="outline"
              disabled={sessionPages.isFetchingNextPage}
              onClick={() => sessionPages.fetchNextPage()}
            >
              {sessionPages.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
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

/** Keeps the account-scoped live subscription to one server open while the list is on screen. */
function AgentServerSubscription({serverUrl, selectedAccountId}: {serverUrl: string; selectedAccountId: string}) {
  useAgentWebSocketSubscription(serverUrl, selectedAccountId, `account/${selectedAccountId}`)
  return null
}

/** Label for the servers menu button: "Agent Server" alone when there is one, counted otherwise. */
export function describeAgentServerCount(count: number) {
  if (count === 1) return 'Agent Server'
  if (count === 0) return 'No Agent Servers'
  return `${count} Agent Servers`
}

export default AgentsListPage
