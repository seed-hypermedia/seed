import {
  getDefaultAgentServerUrl,
  useAgentAccountsSync,
  useAgentList,
  useAgentServerUrl,
  useAgentWebSocketSubscription,
  useAllAgentSessionPages,
  useLocalAgentServerUrl,
} from './models'
import {useSelectedAccountId} from './account'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Bot, CircleUserRound, Settings} from 'lucide-react'
import {useMemo} from 'react'
import {CreateAgentDialog, ManageAgentAccountsDialog, ModelProvidersDialog} from './dialogs'
import {describeAgentError} from './errors'
import {AgentBreadcrumb} from './header'
import {NewSessionComposer, type NewSessionAgent} from './new-session-composer'
import {AgentsNoAccountPage} from './no-account'
import {AgentSessionsFeed, type AgentSessionsFeedProblem} from './sessions-feed'

/** The page's one server is named in its header, so the notice does not repeat it. */
function AgentQueryNotice({
  error,
  failed,
  onRetry,
  retryPending,
}: {
  error: unknown
  failed: string
  onRetry: () => void
  retryPending: boolean
}) {
  const notice = describeAgentError(error, {failed})
  return (
    <Notice tone={notice.tone} title={notice.title} onRetry={onRetry} retryPending={retryPending}>
      {notice.detail}
    </Notice>
  )
}

export default function AgentServerPage() {
  const route = useNavRoute()
  const selectedAccountId = useSelectedAccountId()
  if (route.key !== 'agent-server') return null
  // Agent servers reject unauthenticated requests, so without an active account there is nothing
  // this page can load — gate it entirely rather than showing requests that would all fail.
  if (!selectedAccountId) return <AgentsNoAccountPage />
  return <AgentServerContent routeServerUrl={route.serverUrl} selectedAccountId={selectedAccountId} />
}

/**
 * One server's slice of the Agents home page: the account's sessions across this server's agents,
 * newest activity first, and a composer that can only start a session on one of those agents.
 */
function AgentServerContent({routeServerUrl, selectedAccountId}: {routeServerUrl: string; selectedAccountId: string}) {
  // Keep every account these agents can author as synced locally, so they are immediately
  // mentionable and openable elsewhere in the app.
  useAgentAccountsSync()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || getDefaultAgentServerUrl() || ''
  const localServerUrl = useLocalAgentServerUrl()
  const agents = useAgentList(serverUrl, selectedAccountId)
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
  const createAgentDialog = useAppDialog(CreateAgentDialog)
  useAgentWebSocketSubscription(serverUrl, selectedAccountId, `account/${selectedAccountId}`)

  const serverUrls = useMemo(() => (serverUrl ? [serverUrl] : []), [serverUrl])
  const sessionPages = useAllAgentSessionPages(serverUrls, selectedAccountId)
  const problems: AgentSessionsFeedProblem[] = sessionPages.serverErrors.map((problem) => ({
    serverUrl: problem.serverUrl,
    notice: describeAgentError(problem.error, {failed: 'Couldn’t load sessions'}),
    refetch: problem.refetch,
    isFetching: problem.isFetching,
  }))
  const composerAgents = useMemo<NewSessionAgent[]>(
    () => (agents.data ?? []).map((agent) => ({serverUrl, agent})),
    [agents.data, serverUrl],
  )
  const latestSession = sessionPages.entries[0]
  const defaultComposerAgent = useMemo(
    () => (latestSession ? {serverUrl: latestSession.serverUrl, agentId: latestSession.session.agentId} : undefined),
    [latestSession],
  )

  return (
    <PanelContainer className="flex flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
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

          {/* The composer's agents come from this list, so its failure is worth naming on its own. */}
          {agents.isError ? (
            <AgentQueryNotice
              error={agents.error}
              failed="Couldn’t load agents"
              onRetry={() => void agents.refetch()}
              retryPending={agents.isFetching}
            />
          ) : null}

          <AgentSessionsFeed
            sessions={sessionPages.entries}
            accountUid={selectedAccountId}
            isLoading={sessionPages.isLoading}
            hasNextPage={sessionPages.hasNextPage}
            isFetchingNextPage={sessionPages.isFetchingNextPage}
            fetchNextPage={sessionPages.fetchNextPage}
            problems={problems}
            emptyText={
              agents.data?.length
                ? 'No sessions on this server yet. Start one below.'
                : 'No sessions on this server yet.'
            }
          />
        </Container>
      </div>
      <div className="border-border bg-panel flex-none border-t">
        <Container className="max-w-4xl gap-0 py-2">
          <NewSessionComposer
            // A fresh composer per server: its remembered agent and default belong to the last one.
            key={serverUrl}
            agents={composerAgents}
            accountUid={selectedAccountId}
            localServerUrl={localServerUrl.data}
            defaultAgent={defaultComposerAgent}
          />
        </Container>
      </div>
    </PanelContainer>
  )
}
