import {
  addOptimisticSessionMessage,
  describeAgentServer,
  removeOptimisticSessionFromLists,
  useAgentLists,
  useAgentServerUrls,
  useAgentSession,
  useSessionRuns,
  useAgentWebSocketSubscription,
  useAllAgentSessionPages,
  useAgentSessions,
  useSpaceAgents,
  useDeleteAgentSession,
  useLocalAgentServerUrl,
  useMessageAgentSession,
  useRetrySession,
  useRun,
  useStopAgentSession,
  type AgentSessionDraftMessage,
  type AgentSessionListEntry,
} from './models'
import {
  buildAgentSessionChatRows,
  interleaveRunRecords,
  mergeConsecutiveToolMessageRows,
  buildAgentSessionUrl,
  chatRowEndsInThinkingGroup,
  sessionChildWait,
  sessionQueuedSince,
  sessionTurnStartedAt,
  chatRowHasPendingToolCall,
  frozenRunIds,
  retryableErrorRowKey,
} from './agent-session-rows'
import {
  orderAssistantAgents,
  resolveAssistantSelection,
  type AssistantAgentKey,
  type AssistantAgentOption,
} from './assistant-selection'
import {
  agentRowActivity,
  latestSessionEventAt,
  markAgentSessionRead,
  summarizeAgentActivity,
  useAgentActivityReadState,
  useMarkAgentSessionRead,
  type AgentRowActivity,
} from './activity'
import {AgentActivityMark} from './activity-dot'
import {CreateAgentDialog} from './dialogs'
import {useSelectedAccountId} from './account'
import {useNavigate} from './navigation'
import {AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {
  ArrowDown,
  ArrowLeft,
  Bot,
  ChevronDown,
  LayoutGrid,
  LayoutList,
  Link2,
  Maximize2,
  MessageCirclePlus,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  ContextUsageMeter,
  ContinuationHandoffCard,
  ContinuationHeader,
  sessionContextTokens,
  useFollowContinuation,
} from './continuation'
import {OpenAgentSessionContext} from './open-session-context'
import {agentAccessCanChat, agentAccessCanWrite} from './access'
import {AgentRunStatusBar} from './agent-run-status'
import {AgentErrorRow, AssistantMessageParts, ChatMessageBubble} from './message-rendering'
import {useChatAutoScroll} from './chat-autoscroll'
import {
  decodeAssistantAgentRef,
  decodeAssistantSessionRef,
  encodeAssistantAgentRef,
  encodeAssistantSessionRef,
  type AssistantSessionRef,
} from './assistant-session-ref'
import {AgentProtocolError, AgentServerError, type AgentInfo} from './client'
import {describeAgentError} from './errors'
import {useAssistantWindowContextLines} from './assistant-window-context'
import {
  AgentRichMessageComposer,
  SubSessionDrivenNotice,
  SubSessionHeader,
  TERMINAL_RUN_STATUSES,
} from './rich-message-composer'
import type {AgentsRichEditorSubmitHandle} from './platform'
import {RunRecordCard, SessionRunCard} from './run-card'
import {DelayedSpinner, SessionModelBadge} from './header'
import {SessionSummaryBanner} from './session-children'
import {NewSessionComposer} from './new-session-composer'
import {AgentSessionsFeed, type AgentSessionsFeedProblem} from './sessions-feed'
import {useIsomorphicLayoutEffect} from '@shm/shared/utils/use-isomorphic-layout-effect'

/**
 * Assistant sidebar.
 *
 * The Agents page, in a column: the dropdown at the very top filters the chat list to one agent or
 * to all of them, the list shows those chats newest first with a composer below it, and opening a
 * chat replaces the list until the back button returns to it (same filter, same scroll position).
 * A new chat costs nothing until the first send, which creates the session and opens it here.
 *
 * Shared between desktop (mounted in the main window beside the page, toggled from the footer) and
 * web (mounted beside the site page, toggled from the account menu). Everything host-specific —
 * signing, navigation, the account, the rich editor — comes through the agents platform seam.
 */
export function AssistantPanel({
  initialSessionId,
  initialAgentId,
  newChatRequest,
  onSessionChange,
  onAgentChange,
  onClose,
}: {
  /** Serialized {@link AssistantSessionRef} restored from window state: the chat that was open. */
  initialSessionId?: string | null
  /** Serialized agent ref (see `encodeAssistantAgentRef`) the list was filtered to, restored from window state. */
  initialAgentId?: string | null
  newChatRequest?: number
  /** Reports the open chat (serialized), or null when the list is showing, for the host to persist. */
  onSessionChange?: (sessionId: string | null) => void
  /** Reports the list's agent filter (serialized), or null for all agents, for the host to persist. */
  onAgentChange?: (agentId: string | null) => void
  /** Renders a close button in the header when the host has no other way to dismiss the panel. */
  onClose?: () => void
}) {
  const accountUid = useSelectedAccountId()
  const serverUrls = useAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const agentQueries = useAgentLists(serverUrls.data, accountUid)
  const ownSessions = useAllAgentSessionPages(serverUrls.data, accountUid)
  const navigate = useNavigate()

  const spaceAgents = useSpaceAgents(accountUid)

  // The account-wide lists never include a public agent's chats — the space's agents reach a
  // visitor through GetAgent instead, which carries them along. Merge both, so "All agents" lists a
  // space agent's chats (the visitor's own included) like any other agent's.
  const allSessions = useMemo(() => {
    if (spaceAgents.sessions.length === 0) return ownSessions.entries
    const seen = new Set(ownSessions.entries.map((entry) => `${entry.serverUrl}:${entry.session.id}`))
    const extra = spaceAgents.sessions.filter((entry) => !seen.has(`${entry.serverUrl}:${entry.session.id}`))
    if (extra.length === 0) return ownSessions.entries
    return [...ownSessions.entries, ...extra].sort((a, b) => b.session.updatedAt - a.session.updatedAt)
  }, [ownSessions.entries, spaceAgents.sessions])

  // "No agents" and "that agent is gone" only mean something once every list has answered.
  const agentsSettled =
    !accountUid ||
    (serverUrls.data !== undefined &&
      !spaceAgents.isLoading &&
      agentQueries.every((query) => query.isSuccess || query.isError))

  const serverProblems = (serverUrls.data || []).flatMap((serverUrl, index) => {
    const query = agentQueries[index]
    if (!query?.isError) return []
    return [
      {
        serverUrl,
        notice: describeAgentError(query.error, {
          failed: 'Couldn’t load agents',
          serverLabel: describeAgentServer(serverUrl, localServerUrl.data),
        }),
        refetch: () => void query.refetch(),
        isFetching: query.isFetching,
      },
    ]
  })

  const agents: AssistantAgentOption[] = useMemo(
    () =>
      orderAssistantAgents(
        spaceAgents.agents,
        (serverUrls.data || []).flatMap((serverUrl, index) =>
          (agentQueries[index]?.data || []).map((agent) => ({serverUrl, agent})),
        ),
      ),
    [serverUrls.data, agentQueries, spaceAgents.agents],
  )

  const [stored, setStoredRaw] = useState<AssistantSessionRef | null>(() => decodeAssistantSessionRef(initialSessionId))
  const [chosenAgent, setChosenAgentRaw] = useState<AssistantAgentKey | null>(() =>
    decodeAssistantAgentRef(initialAgentId),
  )
  const lastNewChatRequestRef = useRef(0)
  // The list's new-chat composer and the open chat's composer are never on screen together; each
  // keeps its own handle, so focusing one never reaches a stale editor of the other.
  const listComposerRef = useRef<AgentsRichEditorSubmitHandle | null>(null)
  const sessionComposerRef = useRef<AgentsRichEditorSubmitHandle | null>(null)
  const windowContextLines = useAssistantWindowContextLines()
  const windowContextLinesRef = useRef(windowContextLines)
  windowContextLinesRef.current = windowContextLines

  // Shares its cache with the transcript below; names a restored chat's agent before the lists
  // include it, and is the target of the header's Open action.
  const storedSessionQuery = useAgentSession(stored?.serverUrl, accountUid, stored?.sessionId)

  const selection = resolveAssistantSelection({
    agents,
    sessions: allSessions,
    chosenAgent,
    storedSession: stored,
    storedSessionAgentId: storedSessionQuery.data?.session.agentId,
    // Only a refusal from the server closes the chat; a server that could not be reached may
    // simply be down (the desktop's local one is still booting on launch), so the chat stays and
    // its fetch keeps polling. A protocol mismatch is about the app's version, not the chat.
    storedSessionUnavailable:
      storedSessionQuery.error instanceof AgentServerError && !(storedSessionQuery.error instanceof AgentProtocolError),
    agentsSettled,
  })
  const filterAgent = selection.filterAgent
  const activeSession = selection.session

  const setStored = useCallback(
    (ref: AssistantSessionRef | null) => {
      setStoredRaw(ref)
      onSessionChange?.(ref ? encodeAssistantSessionRef(ref) : null)
    },
    [onSessionChange],
  )

  const setChosenAgent = useCallback(
    (key: AssistantAgentKey | null) => {
      setChosenAgentRaw(key)
      onAgentChange?.(key ? encodeAssistantAgentRef(key) : null)
    },
    [onAgentChange],
  )

  // A chat its server refused is closed, and the host's remembered ref cleared with it.
  useEffect(() => {
    if (stored && !activeSession) setStored(null)
  }, [stored, activeSession, setStored])

  // Going into a chat and back lands on the same list, scrolled where it was: the rows come back
  // from the query cache, so restoring the offset once they render is enough.
  const listScrollRef = useRef<HTMLDivElement>(null)
  const listScrollTopRef = useRef(0)
  const listVisibleRef = useRef(!activeSession)
  listVisibleRef.current = !activeSession
  useIsomorphicLayoutEffect(() => {
    if (!activeSession && listScrollRef.current) listScrollRef.current.scrollTop = listScrollTopRef.current
  }, [activeSession])

  const openSession = useCallback(
    (ref: AssistantSessionRef) => {
      if (listVisibleRef.current) listScrollTopRef.current = listScrollRef.current?.scrollTop ?? 0
      setStored(ref)
    },
    [setStored],
  )
  const backToList = useCallback(() => setStored(null), [setStored])

  // "New chat" (the top bar, the host's footer button, a just-created agent) returns to the list
  // and puts the cursor in its composer. From a chat, the composer only mounts on the next render,
  // so the focus waits for it.
  const focusComposerPendingRef = useRef(false)
  const startNewChat = useCallback(() => {
    setStored(null)
    if (listVisibleRef.current && listComposerRef.current) {
      listComposerRef.current.focus({moveCursorToEnd: true})
      return
    }
    focusComposerPendingRef.current = true
  }, [setStored])
  useEffect(() => {
    if (!focusComposerPendingRef.current || activeSession || !listComposerRef.current) return
    focusComposerPendingRef.current = false
    listComposerRef.current.focus({moveCursorToEnd: true})
  })

  useEffect(() => {
    if (!newChatRequest || newChatRequest === lastNewChatRequestRef.current) return
    lastNewChatRequestRef.current = newChatRequest
    startNewChat()
  }, [newChatRequest, startNewChat])

  // The agent whose chat was open last: under "All agents" the composer starts with them, so a new
  // chat continues with whoever the user was just talking to.
  const lastSessionAgentRef = useRef<AssistantAgentKey | null>(null)
  if (selection.sessionAgent) {
    lastSessionAgentRef.current = {
      serverUrl: selection.sessionAgent.serverUrl,
      agentId: selection.sessionAgent.agent.id,
    }
  }

  // Which agents still have an unseen latest message on this device, so the picker can point at
  // them: the title-bar dot only goes out once every one of these has been looked at.
  const readState = useAgentActivityReadState()
  const rowActivities = useMemo(() => {
    const rows: Record<string, AgentRowActivity> = {}
    for (const option of agents) {
      const row = agentRowActivity(
        option.agent.activity,
        option.serverUrl,
        option.agent.definition.name,
        readState.data,
      )
      if (row) rows[`${option.serverUrl}${option.agent.id}`] = row
    }
    return rows
  }, [agents, readState.data])

  // Opening the panel with something unread lands on it: the newest unread chat across agents,
  // marked read on arrival. Decided once per mount, as soon as the lists have settled, so a
  // message that lands later never yanks the user out of what they are doing. A panel opened to
  // start a new chat keeps that intent instead.
  const jumpedToUnreadRef = useRef(false)
  useEffect(() => {
    if (jumpedToUnreadRef.current || !agentsSettled || ownSessions.isLoading || !readState.data) return
    jumpedToUnreadRef.current = true
    if (newChatRequest) return
    const indicator = summarizeAgentActivity(agents, readState.data)
    if (!indicator?.unread) return
    const picked = agents.find(
      (option) => option.serverUrl === indicator.serverUrl && option.agent.id === indicator.agentId,
    )
    if (!picked?.agent.activity) return
    openSession({serverUrl: indicator.serverUrl, sessionId: indicator.sessionId})
    markAgentSessionRead(indicator.serverUrl, indicator.sessionId, picked.agent.activity.messageAt)
  }, [agentsSettled, ownSessions.isLoading, readState.data, agents, newChatRequest, openSession])

  // The list: every agent's chats, or the chosen agent's own paged list — filtered on the server,
  // so a quiet agent is not found by paging through everyone else's.
  const agentSessionPages = useAgentSessions(filterAgent?.serverUrl, accountUid, filterAgent?.agent.id)
  const listEntries = useMemo<AgentSessionListEntry[]>(() => {
    if (selection.filterPending) return []
    if (!filterAgent) return allSessions
    const seen = new Set<string>()
    const entries: AgentSessionListEntry[] = []
    for (const page of agentSessionPages.data?.pages ?? []) {
      for (const session of page.sessions) {
        if (seen.has(session.id)) continue
        seen.add(session.id)
        entries.push({serverUrl: filterAgent.serverUrl, session, agent: filterAgent.agent})
      }
    }
    return entries
  }, [selection.filterPending, filterAgent, allSessions, agentSessionPages.data])
  const listPaging = filterAgent
    ? {
        isLoading: agentSessionPages.isFetching && !agentSessionPages.data,
        hasNextPage: !!agentSessionPages.hasNextPage,
        isFetchingNextPage: agentSessionPages.isFetchingNextPage,
        fetchNextPage: () => void agentSessionPages.fetchNextPage(),
      }
    : {
        isLoading: selection.filterPending || ownSessions.isLoading || (spaceAgents.isLoading && !allSessions.length),
        hasNextPage: ownSessions.hasNextPage,
        isFetchingNextPage: ownSessions.isFetchingNextPage,
        fetchNextPage: ownSessions.fetchNextPage,
      }
  const listProblems: AgentSessionsFeedProblem[] = filterAgent
    ? agentSessionPages.isError
      ? [
          {
            serverUrl: filterAgent.serverUrl,
            notice: describeAgentError(agentSessionPages.error, {
              failed: 'Couldn’t load chats',
              serverLabel: describeAgentServer(filterAgent.serverUrl, localServerUrl.data),
            }),
            refetch: () => void agentSessionPages.refetch(),
            isFetching: agentSessionPages.isFetching,
          },
        ]
      : []
    : ownSessions.serverErrors.map((problem) => ({
        serverUrl: problem.serverUrl,
        notice: describeAgentError(problem.error, {
          failed: 'Couldn’t load chats',
          serverLabel: describeAgentServer(problem.serverUrl, localServerUrl.data),
        }),
        refetch: problem.refetch,
        isFetching: problem.isFetching,
      }))
  const latestEntry = allSessions[0]
  const composerDefault =
    lastSessionAgentRef.current ??
    (latestEntry ? {serverUrl: latestEntry.serverUrl, agentId: latestEntry.session.agentId} : undefined)

  const sessionEntry = activeSession
    ? allSessions.find(
        (entry) => entry.serverUrl === activeSession.serverUrl && entry.session.id === activeSession.sessionId,
      )
    : undefined
  const sessionTitle = sessionEntry?.session.title || storedSessionQuery.data?.session.title
  const sessionAgentId = sessionEntry?.session.agentId || storedSessionQuery.data?.session.agentId

  const deleteSession = useDeleteAgentSession(activeSession?.serverUrl, accountUid)
  const deleteDialog = useAppDialog(DeleteSessionDialog, {isAlert: true})
  const createAgentDialog = useAppDialog(CreateAgentDialog)
  // Creating from the sidebar stays in the sidebar: filter to the new agent and put the cursor in
  // the composer, so the user can talk to it immediately.
  const openCreateAgent = () =>
    createAgentDialog.open({
      serverUrls: serverUrls.data || [],
      selectedAccountId: accountUid,
      onCreated: ({serverUrl, agentId}) => {
        setChosenAgent({serverUrl, agentId})
        startNewChat()
      },
    })

  return (
    <div className="flex h-full flex-col">
      {/* Account-wide live updates are mounted by the shell (desktop title bar, web assistant host)
          so they also run while this panel is closed, feeding the unread indicator. */}
      {deleteDialog.content}
      {createAgentDialog.content}
      <div className="border-border window-drag flex h-10 items-center justify-between gap-1 border-b px-2 py-2">
        <AssistantAgentPicker
          agents={agents}
          activeAgent={filterAgent}
          pending={selection.filterPending}
          rowActivities={rowActivities}
          localServerUrl={localServerUrl.data ?? null}
          advertisedServerUrl={serverUrls.advertisedServerUrl}
          onSelect={(key) => {
            // Choosing whose chats to see always lands on that list, as on the Agents page.
            setChosenAgent(key)
            setStored(null)
          }}
          onCreateAgent={openCreateAgent}
          onOpenAgentsPage={() => navigate({key: 'agents'})}
          onOpenAgentPage={() =>
            filterAgent
              ? navigate({key: 'agent', agentId: filterAgent.agent.id, serverUrl: filterAgent.serverUrl})
              : navigate({key: 'agents'})
          }
        />
        <div className="no-window-drag flex shrink-0 items-center">
          <button onClick={startNewChat} className="text-muted-foreground hover:text-foreground p-1" title="New chat">
            <MessageCirclePlus className="size-4" />
          </button>
          {onClose ? (
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground p-1"
              title="Close agents panel"
              aria-label="Close agents panel"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      {activeSession ? (
        <>
          <div className="border-border flex items-center gap-1 border-b px-1 py-1">
            <button
              type="button"
              onClick={backToList}
              className="text-muted-foreground hover:text-foreground rounded p-1"
              title="Back to chats"
              aria-label="Back to chats"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-medium">{sessionTitle || 'Untitled session'}</span>
              {!filterAgent && selection.sessionAgent ? (
                <span className="text-muted-foreground truncate text-[10px]">
                  {selection.sessionAgent.agent.definition.name}
                </span>
              ) : null}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground p-1" title="Chat options">
                  <MoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  disabled={!sessionAgentId}
                  onClick={() =>
                    sessionAgentId &&
                    navigate({
                      key: 'agent-session',
                      serverUrl: activeSession.serverUrl,
                      agentId: sessionAgentId,
                      sessionId: activeSession.sessionId,
                    })
                  }
                >
                  <Maximize2 className="size-3.5" />
                  Open
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!sessionAgentId}
                  onClick={() => {
                    const url =
                      sessionAgentId &&
                      buildAgentSessionUrl(activeSession.serverUrl, sessionAgentId, activeSession.sessionId)
                    if (!url) return
                    void navigator.clipboard?.writeText(url)
                    toast.success('Session URL copied')
                  }}
                >
                  <Link2 className="size-3.5" />
                  Copy URL
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() =>
                    deleteDialog.open({
                      sessionTitle,
                      onConfirm: () => {
                        if (!accountUid) return
                        // Drop it from the cached lists first, so the list it returns to never
                        // shows the chat being deleted.
                        removeOptimisticSessionFromLists(activeSession.serverUrl, accountUid, activeSession.sessionId)
                        backToList()
                        deleteSession.mutate(activeSession.sessionId)
                      },
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <AssistantSessionChat
            key={`${activeSession.serverUrl}${activeSession.sessionId}`}
            sessionRef={activeSession}
            accountUid={accountUid}
            agentHint={selection.sessionAgent?.agent}
            agentsSettled={agentsSettled}
            composerRef={sessionComposerRef}
            onOpenSession={(sessionId) => openSession({serverUrl: activeSession.serverUrl, sessionId})}
          />
        </>
      ) : agents.length ? (
        <>
          <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
            <AgentSessionsFeed
              compact
              sessions={listEntries}
              accountUid={accountUid}
              readState={readState.data}
              showAgentName={!filterAgent}
              isLoading={listPaging.isLoading}
              hasNextPage={listPaging.hasNextPage}
              isFetchingNextPage={listPaging.isFetchingNextPage}
              fetchNextPage={listPaging.fetchNextPage}
              problems={listProblems}
              emptyText={filterAgent ? 'No chats with this agent yet.' : 'No chats yet.'}
              onOpenSession={(target) => openSession({serverUrl: target.serverUrl, sessionId: target.sessionId})}
            />
          </div>
          {selection.filterPending ? null : (
            <div className="border-border flex-none border-t">
              <NewSessionComposer
                {...(filterAgent ? {fixedAgent: filterAgent} : {agents, defaultAgent: composerDefault})}
                accountUid={accountUid}
                localServerUrl={localServerUrl.data}
                composerHandleRef={listComposerRef}
                disabledMessage={
                  filterAgent && !agentAccessCanChat(filterAgent.agent.accessRole)
                    ? 'You have read-only access to this agent.'
                    : undefined
                }
                getContextLines={() => windowContextLinesRef.current}
                onSessionStarted={({serverUrl, sessionId}) => openSession({serverUrl, sessionId})}
              />
            </div>
          )}
        </>
      ) : !agentsSettled || ownSessions.isLoading ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-xs">
          Loading…
        </div>
      ) : serverProblems.length ? (
        // With no agent to show, a failing server is the whole story: name it rather than claim
        // there are no agents.
        <div className="flex flex-1 flex-col gap-2 px-3 py-3">
          {serverProblems.map((problem) => (
            <Notice
              key={problem.serverUrl}
              size="sm"
              tone={problem.notice.tone}
              title={problem.notice.title}
              onRetry={problem.refetch}
              retryPending={problem.isFetching}
            >
              {problem.notice.detail}
            </Notice>
          ))}
        </div>
      ) : (
        // Nothing to talk to yet — neither agents of the user's own on any server nor agents the
        // space publishes. The sidebar's whole purpose is blocked, so say so prominently and open
        // the create dialog right here; it walks through provider and model.
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
            <Bot className="size-6" />
          </div>
          <SizableText weight="bold">No agents yet</SizableText>
          <SizableText size="sm" color="muted">
            Create an agent to start chatting. You choose its model and give it a name and instructions.
          </SizableText>
          <Button className="mt-2" onClick={openCreateAgent}>
            <Plus className="size-4" />
            Create an agent
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Agent-context dropdown at the very top of the sidebar.
 *
 * Filters the chat list below to one agent, or to all of them ("All agents", the default); the
 * composer under the list follows the choice. Agents are grouped under their server
 * so the same name on two servers stays distinguishable. The footer actions — creating an agent
 * and jumping to the full Agents page — live here so the sidebar is self-sufficient: on a fresh
 * install with zero agents, this dropdown is where you fix that.
 */
function AssistantAgentPicker({
  agents,
  activeAgent,
  pending = false,
  rowActivities,
  localServerUrl,
  advertisedServerUrl,
  onSelect,
  onCreateAgent,
  onOpenAgentsPage,
  onOpenAgentPage,
}: {
  agents: AssistantAgentOption[]
  activeAgent: AssistantAgentOption | null
  /** A remembered agent choice whose lists are still loading: the filter is not known yet. */
  pending?: boolean
  /** Each agent's own indicator (unread, or working), keyed `${serverUrl}${agentId}`. */
  rowActivities: Record<string, AgentRowActivity>
  localServerUrl: string | null
  /** Server the site on screen advertises; its group is labeled so the user knows why it is here. */
  advertisedServerUrl?: string | null
  /** Filters to one agent, or to all of them with null. */
  onSelect: (key: AssistantAgentKey | null) => void
  onCreateAgent: () => void
  onOpenAgentsPage: () => void
  /** Opens the active agent's full page; the expand affordance shows only while hovering the picker. */
  onOpenAgentPage?: () => void
}) {
  const [open, setOpen] = useState(false)
  // The closed trigger carries what the rows would show: anything unread first, else a working agent.
  const triggerTone =
    Object.values(rowActivities).find((row) => row.unread)?.tone ?? Object.values(rowActivities)[0]?.tone ?? null

  const groups = useMemo(() => {
    const byServer = new Map<string, AssistantAgentOption[]>()
    for (const option of agents) {
      const list = byServer.get(option.serverUrl)
      if (list) list.push(option)
      else byServer.set(option.serverUrl, [option])
    }
    return Array.from(byServer, ([serverUrl, options]) => ({serverUrl, options}))
  }, [agents])

  return (
    // The expand affordance lives outside the trigger (a button cannot nest a button) but inside
    // the shared hover group, so it appears whenever the pointer is anywhere over the picker area.
    <div className="group/agentpicker flex max-w-full min-w-0 items-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="no-window-drag hover:bg-muted flex max-w-full min-w-0 items-center gap-2 rounded px-1.5 py-1"
          >
            <span className="relative inline-flex shrink-0">
              <Bot className="text-muted-foreground size-4 shrink-0" />
              {triggerTone ? (
                <AgentActivityMark
                  tone={triggerTone}
                  className="absolute -top-1 -right-1"
                  label={triggerTone === 'busy' ? 'An agent is working' : 'Unread messages'}
                />
              ) : null}
            </span>
            <SizableText size="sm" className="min-w-0 truncate font-medium">
              {activeAgent ? activeAgent.agent.definition.name : pending ? 'Loading…' : 'All agents'}
            </SizableText>
            <ChevronDown className="text-muted-foreground size-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-96 w-72 overflow-y-auto p-1">
          {groups.length ? (
            <button
              type="button"
              className={`hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium ${
                !activeAgent && !pending ? 'bg-muted' : ''
              }`}
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
            >
              <LayoutList className="text-muted-foreground size-3.5 shrink-0" />
              All agents
            </button>
          ) : null}
          {groups.length === 0 ? (
            <div className="text-muted-foreground px-2 py-3 text-center text-xs">No agents yet.</div>
          ) : (
            groups.map((group) => (
              <div key={group.serverUrl} className="flex flex-col">
                <div className="flex items-center gap-2 px-2 pt-2 pb-1">
                  <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                    {describeAgentServer(group.serverUrl, localServerUrl)}
                  </span>
                  {advertisedServerUrl && group.serverUrl === advertisedServerUrl ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[10px] font-medium">
                      This space
                    </span>
                  ) : null}
                </div>
                {group.options.map((option) => {
                  const isActive =
                    option.serverUrl === activeAgent?.serverUrl && option.agent.id === activeAgent.agent.id
                  const row = rowActivities[`${option.serverUrl}${option.agent.id}`]
                  return (
                    <button
                      key={`${option.serverUrl}${option.agent.id}`}
                      type="button"
                      className={`hover:bg-muted flex w-full flex-col items-start rounded px-2 py-1.5 text-left ${
                        isActive ? 'bg-muted' : ''
                      }`}
                      onClick={() => {
                        onSelect({serverUrl: option.serverUrl, agentId: option.agent.id})
                        setOpen(false)
                      }}
                    >
                      <span className="flex w-full items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">
                          {option.agent.definition.name}
                        </span>
                        <AgentActivityMark tone={row?.tone} label={row?.label} />
                      </span>
                      <span className="text-muted-foreground w-full truncate text-[10px]">
                        {row?.short ?? option.agent.definition.model}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
          <div className="border-border mt-1 flex flex-col border-t pt-1">
            <button
              type="button"
              className="hover:bg-muted text-foreground flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
              onClick={() => {
                setOpen(false)
                onCreateAgent()
              }}
            >
              <Plus className="text-muted-foreground size-3.5 shrink-0" />
              New agent
            </button>
            <button
              type="button"
              className="hover:bg-muted text-foreground flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs"
              onClick={() => {
                setOpen(false)
                onOpenAgentsPage()
              }}
            >
              <LayoutGrid className="text-muted-foreground size-3.5 shrink-0" />
              Agents page
            </button>
          </div>
        </PopoverContent>
      </Popover>
      {onOpenAgentPage ? (
        <button
          type="button"
          title={activeAgent ? `Open ${activeAgent.agent.definition.name}` : 'Open the Agents page'}
          aria-label={activeAgent ? `Open the ${activeAgent.agent.definition.name} agent page` : 'Open the Agents page'}
          onClick={onOpenAgentPage}
          className="no-window-drag text-muted-foreground hover:text-foreground p-1 opacity-0 transition-opacity group-hover/agentpicker:opacity-100 focus-visible:opacity-100"
        >
          <Maximize2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

/** Chat transcript, live stream, and composer for one selected session. */
function AssistantSessionChat({
  sessionRef,
  accountUid,
  agentHint,
  agentsSettled,
  composerRef,
  onOpenSession,
}: {
  sessionRef: AssistantSessionRef
  accountUid: string | null | undefined
  /**
   * The panel's active agent, from the agent lists it already holds. Trusted for this session
   * only once the session names it as its agent; until then the palette waits.
   */
  agentHint?: AgentInfo
  agentsSettled: boolean
  composerRef: React.MutableRefObject<AgentsRichEditorSubmitHandle | null>
  /** Switches the panel to another session of this server (a continuation's successor or predecessor). */
  onOpenSession?: (sessionId: string) => void
}) {
  const {serverUrl, sessionId} = sessionRef
  const navigate = useNavigate()
  const session = useAgentSession(serverUrl, accountUid, sessionId)
  // Resume the socket after the last loaded event: without afterSeq the server replays the whole
  // transcript over the socket on top of the GetSession fetch — the session loads twice. The
  // subscription waits for the fetch so the race cannot resurrect the full replay.
  const lastSeq = session.data?.events.filter((event) => event.seq !== Number.MAX_SAFE_INTEGER).at(-1)?.seq
  const live = useAgentWebSocketSubscription(
    serverUrl,
    accountUid,
    session.data ? `sessions/${sessionId}` : undefined,
    lastSeq ?? 0,
  )
  // This transcript is on screen: whatever it shows is read on this device.
  useMarkAgentSessionRead(serverUrl, sessionId, latestSessionEventAt(session.data?.events))
  const messageSession = useMessageAgentSession(serverUrl, accountUid)
  const stopSession = useStopAgentSession(serverUrl, accountUid)
  const retrySession = useRetrySession(serverUrl, accountUid)
  // The agent definition, for the composer's user tool palette and the access role. Read from the
  // agent lists the panel holds rather than GetAgent: that call returns the agent with every one
  // of its sessions, and this view has no use for those.
  const agent = agentHint && agentHint.id === session.data?.session.agentId ? agentHint : undefined
  const agentLoading = !agent && !agentsSettled
  const windowContextLines = useAssistantWindowContextLines()
  const windowContextLinesRef = useRef(windowContextLines)
  windowContextLinesRef.current = windowContextLines

  const autoScroll = useChatAutoScroll()

  // Chatters (public chat) may send; only owners/writers may control runs, switch the model, or
  // run session tools.
  const readOnly = !agentAccessCanChat(agent?.accessRole)
  const canWrite = !!agent && agentAccessCanWrite(agent.accessRole)
  const status = session.data?.session.status
  const isStreaming = status === 'streaming'
  const isBusy = messageSession.isPending || isStreaming
  // A sub-session still being driven by its parent is not the user's to message — same rule and
  // wording as the full session page.
  const parentSessionId = session.data?.session.parentSessionId
  const parentSession = useAgentSession(serverUrl, accountUid, parentSessionId)
  const ownRun = useRun(serverUrl, accountUid, parentSessionId ? session.data?.session.runId : undefined)
  const hasLiveRun = !!ownRun.data && !TERMINAL_RUN_STATUSES.has(ownRun.data.status)
  const isDrivenByParent = !!parentSessionId && (isStreaming || hasLiveRun)
  // Continuation: the panel follows the turn into its successor like the full page does.
  const sessionInfo = session.data?.session
  const followContinuation = useFollowContinuation({
    session: sessionInfo,
    isStreaming,
    onFollow: useCallback((link) => onOpenSession?.(link.sessionId), [onOpenSession]),
  })
  const contextTokens = useMemo(() => sessionContextTokens(session.data?.events), [session.data?.events])
  const events = session.data?.events
  const sessionRuns = useSessionRuns(serverUrl, accountUid, sessionId)
  const rows = useMemo(
    () =>
      mergeConsecutiveToolMessageRows(
        interleaveRunRecords(
          buildAgentSessionChatRows(events || [], {
            serverUrl,
            agentId: session.data?.session.agentId,
            sessionId,
            triggerContext: session.data?.triggerContext,
            runs: sessionRuns.data,
          }),
          sessionRuns.data || [],
          // A model-driven agent keeps its checklist on the session, not on the run, so the freeze
          // decision needs it here for the same reason the pinned card does.
          session.data?.session.plan,
        ),
      ),
    [
      events,
      serverUrl,
      sessionId,
      session.data?.session.agentId,
      session.data?.session.plan,
      session.data?.triggerContext,
      sessionRuns.data,
    ],
  )
  // Which runs the scroll already owns, so the pinned slot does not tell the same story twice.
  const frozenRuns = useMemo(() => frozenRunIds(rows), [rows])
  // The newest row of a streaming session, with nothing streaming below it, is the one a trailing
  // "Thinking" line speaks for — and while it does, the status bar below would only tick twice.
  const lastRow = rows[rows.length - 1]
  const queuedSince = useMemo(() => sessionQueuedSince(sessionRuns.data), [sessionRuns.data])
  const childWait = useMemo(() => sessionChildWait(rows, sessionRuns.data), [rows, sessionRuns.data])
  const liveTailRowKey = isStreaming && !live.text && queuedSince === undefined ? lastRow?.key : undefined
  const thinkingLineShowing = !!lastRow && liveTailRowKey === lastRow.key && chatRowEndsInThinkingGroup(lastRow)
  const runStartedAt = useMemo(() => sessionTurnStartedAt(rows, sessionRuns.data), [rows, sessionRuns.data])

  const doSendMessage = useCallback(
    (message: AgentSessionDraftMessage | AgentSessionDraftMessage[]) => {
      if (!accountUid) return
      const contextLines = windowContextLinesRef.current
      // Send the stamped drafts, so the durable echo replaces the optimistic row by identity.
      const messages = addOptimisticSessionMessage(
        serverUrl,
        accountUid,
        sessionId,
        (Array.isArray(message) ? message : [message]).map((message, index) =>
          index === 0 && contextLines ? {...message, contextLines} : message,
        ),
      )
      followContinuation.markFollowing()
      messageSession.mutate(
        {sessionId, message: messages},
        {
          onSuccess: (result) => {
            if (result._ === 'MessageSessionResponse' && result.continuedToSessionId) {
              followContinuation.followNow({
                continuationId: '',
                sessionId: result.continuedToSessionId,
                reason: 'other',
                createdAt: Date.now(),
              })
            }
          },
        },
      )
    },
    [accountUid, followContinuation, messageSession, serverUrl, sessionId],
  )

  // Retry is offered on a trailing error only, and survives its own in-flight state: the row goes
  // away when the retried run starts streaming, not when the request is sent.
  const retryableRowKey = retryableErrorRowKey(rows, !!isBusy)
  const handleRetry = useCallback(() => {
    retrySession.mutate(sessionId, {
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not retry this turn'),
    })
  }, [retrySession, sessionId])

  function handleSend(message: AgentSessionDraftMessage) {
    doSendMessage(message)
  }

  async function handleStop() {
    try {
      const result = await stopSession.mutateAsync(sessionId)
      if (!result.stopped) toast.message('No active agent response to stop')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop agent response')
    }
  }

  // Everything rendered under this transcript opens sessions IN THE PANEL: a continuation's
  // successor, a delegate child, a predecessor. Cmd/shift-click still spawns a full window.
  const openInPanel = useCallback((targetSessionId: string) => onOpenSession?.(targetSessionId), [onOpenSession])
  return (
    <OpenAgentSessionContext.Provider value={onOpenSession ? openInPanel : null}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {parentSessionId ? (
          <SubSessionHeader
            compact
            parentTitle={parentSession.data?.session.title}
            onOpenParent={() =>
              onOpenSession
                ? onOpenSession(parentSessionId)
                : navigate({
                    key: 'agent-session',
                    agentId: parentSession.data?.session.agentId,
                    sessionId: parentSessionId,
                    serverUrl,
                  })
            }
          />
        ) : null}
        {sessionInfo?.continuedFrom ? (
          <ContinuationHeader
            compact
            link={sessionInfo.continuedFrom}
            onOpenPredecessor={() => onOpenSession?.(sessionInfo.continuedFrom!.sessionId)}
          />
        ) : null}
        <SessionSummaryBanner compact description={session.data?.session.description} />
        <div
          ref={autoScroll.containerRef}
          onScroll={autoScroll.handleScroll}
          className="relative flex-1 overflow-x-hidden overflow-y-auto px-3 py-2"
        >
          <div ref={autoScroll.contentRef} className="flex min-h-full flex-col">
            {rows.length === 0 && !isStreaming ? (
              <div className="text-muted-foreground flex flex-1 items-center justify-center text-xs">
                {/* While the transcript is on its way, the empty-state prompt would be a lie about a
                  session that may be full of messages — hold quiet, then a tiny spinner. */}
                {session.isLoading ? <DelayedSpinner /> : 'Send a message to start chatting'}
              </div>
            ) : null}
            {rows.map((row) => {
              if (row.kind === 'message')
                return (
                  <ChatMessageBubble
                    key={row.key}
                    message={row.message}
                    liveActivity={chatRowHasPendingToolCall(row) ? live.activity : undefined}
                    isLiveTail={row.key === liveTailRowKey}
                    serverUrl={serverUrl}
                    accountUid={accountUid}
                    agentId={session.data?.session.agentId}
                  />
                )
              if (row.kind === 'error') {
                return (
                  <AgentErrorRow
                    key={row.key}
                    compact
                    message={row.message}
                    onRetry={row.key === retryableRowKey ? handleRetry : undefined}
                    retryPending={retrySession.isPending}
                  />
                )
              }
              if (row.kind === 'run-record') {
                return (
                  <RunRecordCard
                    key={row.key}
                    serverUrl={serverUrl}
                    accountUid={accountUid}
                    runId={row.run.id}
                    plan={row.plan}
                    onOpenSession={(childSessionId, childAgentId) =>
                      onOpenSession
                        ? onOpenSession(childSessionId)
                        : navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
                    }
                  />
                )
              }
              if (row.kind === 'continuation') {
                return (
                  <ContinuationHandoffCard
                    key={row.key}
                    compact
                    projection={row.projection}
                    onOpenPredecessor={onOpenSession}
                  />
                )
              }
              return null
            })}
            {live.text ? (
              <AssistantMessageParts parts={[{type: 'text', text: live.text}]} isStreaming={isStreaming} />
            ) : null}
            {(!isStreaming && childWait) ||
            (isStreaming &&
              (queuedSince !== undefined ||
                (!thinkingLineShowing &&
                  !(live.activity?.phase === 'tool' && rows.some(chatRowHasPendingToolCall))))) ? (
              // Hidden while a thinking line or a pending tool row is showing its own live
              // status, to avoid two spinners. A queued run, or one parked on children, has no
              // live status anywhere else.
              <AgentRunStatusBar
                startedAt={runStartedAt}
                serverUrl={serverUrl}
                activity={live.activity}
                usage={live.usage}
                queuedSince={queuedSince}
                childWait={isStreaming ? undefined : childWait}
              />
            ) : null}
            {autoScroll.showScrollButton ? (
              <div className="pointer-events-none sticky bottom-2 flex justify-center">
                <button
                  onClick={autoScroll.scrollToBottom}
                  className="bg-muted border-border text-foreground pointer-events-auto rounded-full border p-1.5 shadow-lg"
                  aria-label="Scroll to latest message"
                >
                  <ArrowDown className="size-4" />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <SessionRunCard
          compact
          serverUrl={serverUrl}
          accountUid={accountUid}
          sessionId={sessionId}
          sessionPlan={session.data?.session.plan}
          frozenRunIds={frozenRuns}
          readOnly={!canWrite}
          onOpenSession={(childSessionId, childAgentId) =>
            onOpenSession
              ? onOpenSession(childSessionId)
              : navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
          }
        />

        {/* No focus-on-mount here: session chats mount with the panel itself (e.g. on app launch),
          where stealing focus from the document would be wrong. Focus is imperative, via the
          panel's new-chat flows. */}
        <AgentRichMessageComposer
          isBusy={isBusy}
          isStreaming={isStreaming}
          disabledMessage={
            readOnly ? (
              'You have read-only access to this agent.'
            ) : isDrivenByParent ? (
              <SubSessionDrivenNotice
                parentTitle={parentSession.data?.session.title}
                onOpenParent={() =>
                  onOpenSession
                    ? onOpenSession(parentSessionId!)
                    : navigate({
                        key: 'agent-session',
                        agentId: parentSession.data?.session.agentId,
                        sessionId: parentSessionId!,
                        serverUrl,
                      })
                }
              />
            ) : undefined
          }
          stopPending={stopSession.isPending}
          serverUrl={serverUrl}
          accountId={accountUid ?? null}
          sessionId={sessionId}
          agentTools={agent?.definition.tools}
          agentToolsLoading={agentLoading}
          focusOnMount={false}
          canInvokeTools={canWrite}
          composerHandleRef={composerRef}
          onSend={handleSend}
          onStop={() => void handleStop()}
        />
        {/* The active model for THIS session: the same per-session override switcher as the full
          session page, so changing it here never touches the agent's default. */}
        {session.data ? (
          <div className="flex flex-none items-center justify-end gap-2 px-3 pb-2">
            <ContextUsageMeter tokens={contextTokens} contextWindow={session.data.contextWindow} size={16} />
            <SessionModelBadge
              agent={agent}
              agentId={session.data.session.agentId}
              serverUrl={serverUrl}
              sessionId={sessionId}
              modelOverride={session.data.session.modelOverride}
              thoroughness={session.data.session.thoroughness}
              canWrite={canWrite}
            />
          </div>
        ) : null}
      </div>
    </OpenAgentSessionContext.Provider>
  )
}

/** Confirmation dialog for deleting a chat session. Exported for tests: it must render inside an
 * AlertDialog root, and mixing dialog families throws at runtime in a way types cannot catch. */
export function DeleteSessionDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {sessionTitle?: string; onConfirm: () => void}
}) {
  return (
    <>
      <AlertDialogTitle>Delete Chat</AlertDialogTitle>
      <SizableText className="text-muted-foreground text-sm">
        {input.sessionTitle ? `Permanently delete "${input.sessionTitle}"?` : 'Permanently delete this chat?'}
      </SizableText>
      <AlertDialogFooter className="flex-col">
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            input.onConfirm()
            onClose()
          }}
        >
          Delete
        </Button>
      </AlertDialogFooter>
    </>
  )
}
