import {
  addOptimisticSessionMessage,
  addOptimisticSessionToCaches,
  describeAgentServer,
  removeOptimisticSessionFromLists,
  useAgentDetail,
  useAgentLists,
  useAgentServerUrls,
  useAgentSession,
  useSessionRuns,
  useAgentWebSocketSubscription,
  useAllAgentSessions,
  useCreateAgentSessionOnServer,
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
  buildAgentSessionUrl,
  chatRowHasPendingToolCall,
  frozenRunIds,
  retryableErrorRowKey,
} from './agent-session-rows'
import {resolveAssistantSelection, type AssistantAgentKey, type AssistantAgentOption} from './assistant-selection'
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
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {
  ArrowDown,
  Bot,
  ChevronDown,
  LayoutGrid,
  Link2,
  Maximize2,
  MessageCirclePlus,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {agentAccessCanChat, agentAccessCanWrite} from './access'
import {AgentRunStatusBar, useRunStartedAt} from './agent-run-status'
import {AgentErrorRow, AssistantMessageParts, ChatMessageBubble} from './message-rendering'
import {useChatAutoScroll} from './chat-autoscroll'
import {decodeAssistantSessionRef, encodeAssistantSessionRef, type AssistantSessionRef} from './assistant-session-ref'
import {useAssistantWindowContextLines} from './assistant-window-context'
import {AgentRichMessageComposer, SUB_SESSION_DRIVEN_MESSAGE, TERMINAL_RUN_STATUSES} from './rich-message-composer'
import type {AgentsRichEditorSubmitHandle} from './platform'
import {RunRecordCard, SessionRunCard} from './run-card'
import {SessionModelBadge} from './header'
import {SessionStatusDot, SessionSummaryBanner, SubSessionsDisclosure} from './session-children'

/**
 * Assistant sidebar.
 *
 * A session view over the Agents service, scoped to one agent at a time: the dropdown at the very
 * top picks the agent context, the row below it picks a session within that context, and new chats
 * start directly in the current context — no dialog in the way. A new chat is a draft until the
 * first send, which creates the session and delivers the message in one motion.
 *
 * Shared between desktop (mounted in the main window beside the page, toggled from the footer) and
 * web (mounted beside the site page, toggled from the account menu). Everything host-specific —
 * signing, navigation, the account, the rich editor — comes through the agents platform seam.
 */
export function AssistantPanel({
  initialSessionId,
  newChatRequest,
  onSessionChange,
  onClose,
}: {
  /** Serialized {@link AssistantSessionRef} restored from window state. */
  initialSessionId?: string | null
  newChatRequest?: number
  onSessionChange?: (sessionId: string | null) => void
  /** Renders a close button in the header when the host has no other way to dismiss the panel. */
  onClose?: () => void
}) {
  const accountUid = useSelectedAccountId()
  const serverUrls = useAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const agentQueries = useAgentLists(serverUrls.data, accountUid)
  const sessions = useAllAgentSessions(serverUrls.data, accountUid)
  const navigate = useNavigate()

  const agents: AssistantAgentOption[] = useMemo(
    () =>
      (serverUrls.data || []).flatMap((serverUrl, index) =>
        (agentQueries[index]?.data || []).map((agent) => ({serverUrl, agent})),
      ),
    [serverUrls.data, agentQueries],
  )

  const [stored, setStoredRaw] = useState<AssistantSessionRef | null>(() => decodeAssistantSessionRef(initialSessionId))
  const [chosenAgent, setChosenAgent] = useState<AssistantAgentKey | null>(null)
  const [isDraft, setIsDraft] = useState(false)
  const lastNewChatRequestRef = useRef(0)
  // Handle onto whichever rich composer is mounted (session chat or draft), for imperative focus.
  const composerRef = useRef<AgentsRichEditorSubmitHandle | null>(null)

  // Shares its cache with the transcript below; used to attribute a restored session to its agent
  // before the session lists have loaded, and for the full-view navigation target.
  const storedSessionQuery = useAgentSession(stored?.serverUrl, accountUid, stored?.sessionId)

  const selection = resolveAssistantSelection({
    agents,
    sessions: sessions.entries,
    chosenAgent,
    storedSession: stored,
    storedSessionAgentId: storedSessionQuery.data?.session.agentId,
    isDraft,
  })

  const setStored = useCallback(
    (ref: AssistantSessionRef | null) => {
      setStoredRaw(ref)
      onSessionChange?.(ref ? encodeAssistantSessionRef(ref) : null)
    },
    [onSessionChange],
  )

  // Keep window state in step with what is actually shown (e.g. the resolver replaced a stored
  // session from another agent with the active agent's newest). A draft is exempt: it shows no
  // session by design, and the stored ref doubles as the record of which agent the user was last
  // in — clearing it would make every new chat forget its context and fall back to the first
  // agent.
  useEffect(() => {
    if (isDraft) return
    const resolved = selection.session
    const same = resolved?.serverUrl === stored?.serverUrl && resolved?.sessionId === stored?.sessionId
    if (!same && !(resolved === null && stored === null)) setStored(resolved)
  }, [selection.session, stored, setStored, isDraft])

  const focusInput = useCallback(() => {
    composerRef.current?.focus({moveCursorToEnd: true})
    requestAnimationFrame(() => composerRef.current?.focus({moveCursorToEnd: true}))
  }, [])

  const selectSession = useCallback(
    (ref: AssistantSessionRef) => {
      setIsDraft(false)
      setStored(ref)
    },
    [setStored],
  )

  const startDraft = useCallback(() => {
    setIsDraft(true)
    focusInput()
  }, [focusInput])

  useEffect(() => {
    if (!newChatRequest || newChatRequest === lastNewChatRequestRef.current) return
    lastNewChatRequestRef.current = newChatRequest
    startDraft()
  }, [newChatRequest, startDraft])

  const activeAgent = selection.agent
  const activeSession = selection.session
  const sessionEntry = activeSession
    ? sessions.entries.find(
        (entry) => entry.serverUrl === activeSession.serverUrl && entry.session.id === activeSession.sessionId,
      )
    : undefined
  const sessionTitle = sessionEntry?.session.title || storedSessionQuery.data?.session.title
  const sessionAgentId = sessionEntry?.session.agentId || storedSessionQuery.data?.session.agentId

  const deleteSession = useDeleteAgentSession(activeSession?.serverUrl, accountUid)
  const deleteDialog = useAppDialog(DeleteSessionDialog, {isAlert: true})
  const createAgentDialog = useAppDialog(CreateAgentDialog)

  return (
    <div className="flex h-full flex-col">
      {/* Account-wide live updates per server: session changes (titles, statuses) reach the
          sidebar the moment they happen, instead of waiting on the 5s background poll. */}
      {accountUid
        ? (serverUrls.data || []).map((serverUrl) => (
            <AgentAccountLiveUpdates key={serverUrl} serverUrl={serverUrl} accountUid={accountUid} />
          ))
        : null}
      {deleteDialog.content}
      {createAgentDialog.content}
      <div className="border-border window-drag flex h-10 items-center justify-between gap-1 border-b px-2 py-2">
        <AssistantAgentPicker
          agents={agents}
          activeAgent={activeAgent}
          localServerUrl={localServerUrl.data ?? null}
          advertisedServerUrl={serverUrls.advertisedServerUrl}
          onSelect={(key) => setChosenAgent(key)}
          onCreateAgent={() =>
            createAgentDialog.open({
              serverUrls: serverUrls.data || [],
              selectedAccountId: accountUid,
              // Creating from the sidebar stays in the sidebar: select the new agent's context and
              // open a draft so the user can talk to it immediately.
              onCreated: ({serverUrl, agentId}) => {
                setChosenAgent({serverUrl, agentId})
                setIsDraft(true)
                focusInput()
              },
            })
          }
          onOpenAgentsPage={() => navigate({key: 'agents'})}
        />
        <div className="no-window-drag flex shrink-0 items-center">
          <button onClick={startDraft} className="text-muted-foreground hover:text-foreground p-1" title="New chat">
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
      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <AssistantSessionPicker
          entries={selection.agentSessions}
          isLoading={sessions.isLoading}
          accountUid={accountUid}
          selected={activeSession}
          selectedTitle={sessionTitle}
          isDraft={!activeSession}
          onSelect={selectSession}
        />
        {activeSession ? (
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
                      // Drop it from the cached lists first, or the resolver would re-select the
                      // session being deleted from the still-stale list.
                      removeOptimisticSessionFromLists(activeSession.serverUrl, accountUid, activeSession.sessionId)
                      setStored(null)
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
        ) : null}
      </div>
      {activeSession ? (
        <AssistantSessionChat
          key={`${activeSession.serverUrl}${activeSession.sessionId}`}
          sessionRef={activeSession}
          accountUid={accountUid}
          composerRef={composerRef}
        />
      ) : activeAgent ? (
        <AssistantDraftChat
          key={`${activeAgent.serverUrl}${activeAgent.agent.id}`}
          serverUrl={activeAgent.serverUrl}
          agentId={activeAgent.agent.id}
          agentName={activeAgent.agent.definition.name}
          accountUid={accountUid}
          readOnly={!agentAccessCanChat(activeAgent.agent.accessRole)}
          canInvokeTools={agentAccessCanWrite(activeAgent.agent.accessRole)}
          composerRef={composerRef}
          onSessionCreated={selectSession}
        />
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-xs">
          {sessions.isLoading ? 'Loading…' : 'No agents yet. Create one from the Agents menu above.'}
        </div>
      )}
    </div>
  )
}

/**
 * Agent-context dropdown at the very top of the sidebar.
 *
 * Choosing the context up front is what removes the friction of a per-chat agent dialog: every
 * action below (sessions, new chats) applies to this agent. Agents are grouped under their server
 * so the same name on two servers stays distinguishable. The footer actions — creating an agent
 * and jumping to the full Agents page — live here so the sidebar is self-sufficient: on a fresh
 * install with zero agents, this dropdown is where you fix that.
 */
/**
 * Renders nothing; holds one account-wide WebSocket subscription open for a server so every
 * session change (agent-set titles, status flips) invalidates the sidebar queries immediately.
 * A component rather than a hook because the server list is dynamic and hooks cannot loop.
 */
function AgentAccountLiveUpdates({serverUrl, accountUid}: {serverUrl: string; accountUid: string}) {
  useAgentWebSocketSubscription(serverUrl, accountUid, `account/${accountUid}`)
  return null
}

function AssistantAgentPicker({
  agents,
  activeAgent,
  localServerUrl,
  advertisedServerUrl,
  onSelect,
  onCreateAgent,
  onOpenAgentsPage,
}: {
  agents: AssistantAgentOption[]
  activeAgent: AssistantAgentOption | null
  localServerUrl: string | null
  /** Server the site on screen advertises; its group is labeled so the user knows why it is here. */
  advertisedServerUrl?: string | null
  onSelect: (key: AssistantAgentKey) => void
  onCreateAgent: () => void
  onOpenAgentsPage: () => void
}) {
  const [open, setOpen] = useState(false)

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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="no-window-drag hover:bg-muted flex max-w-full min-w-0 items-center gap-2 rounded px-1.5 py-1"
        >
          <Bot className="text-muted-foreground size-4 shrink-0" />
          <SizableText size="sm" className="min-w-0 truncate font-medium">
            {activeAgent?.agent.definition.name || 'Agents'}
          </SizableText>
          <ChevronDown className="text-muted-foreground size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-96 w-72 overflow-y-auto p-1">
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
                    This site
                  </span>
                ) : null}
              </div>
              {group.options.map((option) => {
                const isActive = option.serverUrl === activeAgent?.serverUrl && option.agent.id === activeAgent.agent.id
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
                    <span className="w-full truncate text-xs font-medium">{option.agent.definition.name}</span>
                    <span className="text-muted-foreground w-full truncate text-[10px]">
                      {option.agent.definition.model}
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
  )
}

/** Session dropdown for the active agent context. Most of the row; the "…" menu sits beside it. */
function AssistantSessionPicker({
  entries,
  isLoading,
  accountUid,
  selected,
  selectedTitle,
  isDraft,
  onSelect,
}: {
  entries: AgentSessionListEntry[]
  isLoading: boolean
  accountUid: string | null | undefined
  selected: AssistantSessionRef | null
  selectedTitle?: string
  isDraft: boolean
  onSelect: (ref: AssistantSessionRef) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-muted text-foreground flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-xs"
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {isDraft ? 'New chat' : selectedTitle || 'Untitled session'}
          </span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-72 overflow-y-auto p-1">
        {isLoading && entries.length === 0 ? (
          <div className="text-muted-foreground px-2 py-3 text-center text-xs">Loading sessions…</div>
        ) : entries.length === 0 ? (
          <div className="text-muted-foreground px-2 py-3 text-center text-xs">No chats with this agent yet.</div>
        ) : (
          entries.map((entry) => {
            const isSelected = entry.serverUrl === selected?.serverUrl && entry.session.id === selected?.sessionId
            return (
              <div key={`${entry.serverUrl}${entry.session.id}`} className="flex flex-col">
                <button
                  type="button"
                  className={`hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                    isSelected ? 'bg-muted' : ''
                  }`}
                  onClick={() => {
                    onSelect({serverUrl: entry.serverUrl, sessionId: entry.session.id})
                    setOpen(false)
                  }}
                >
                  <SessionStatusDot status={entry.session.status} className="size-2" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs">{entry.session.title || 'Untitled session'}</span>
                    {entry.session.description ? (
                      <span className="text-muted-foreground line-clamp-3 text-xs">{entry.session.description}</span>
                    ) : null}
                  </span>
                </button>
                {entry.session.childSessionCount ? (
                  <div className="pl-4">
                    <SubSessionsDisclosure
                      compact
                      serverUrl={entry.serverUrl}
                      accountUid={accountUid}
                      parentSessionId={entry.session.id}
                      childSessionCount={entry.session.childSessionCount}
                      selectedSessionId={entry.serverUrl === selected?.serverUrl ? selected?.sessionId : undefined}
                      onOpenSession={(child) => {
                        onSelect({serverUrl: entry.serverUrl, sessionId: child.id})
                        setOpen(false)
                      }}
                    />
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Composer-only state for a chat that does not exist yet.
 *
 * The session is created on the first send and the message delivered in the same motion, so "new
 * chat" costs nothing until the user actually says something — and abandoning it leaves no empty
 * session behind.
 */
function AssistantDraftChat({
  serverUrl,
  agentId,
  agentName,
  accountUid,
  composerRef,
  onSessionCreated,
  readOnly,
  canInvokeTools,
}: {
  serverUrl: string
  agentId: string
  agentName: string
  accountUid: string | null | undefined
  readOnly: boolean
  /** False for chat-only access: the tool palette needs write access to the agent. */
  canInvokeTools: boolean
  composerRef: React.MutableRefObject<AgentsRichEditorSubmitHandle | null>
  onSessionCreated: (ref: AssistantSessionRef) => void
}) {
  const createSession = useCreateAgentSessionOnServer(accountUid)
  const messageSession = useMessageAgentSession(serverUrl, accountUid)
  const windowContextLines = useAssistantWindowContextLines()
  const windowContextLinesRef = useRef(windowContextLines)
  windowContextLinesRef.current = windowContextLines

  const [error, setError] = useState<string | null>(null)
  const isSendingRef = useRef(false)

  async function handleSend(message: AgentSessionDraftMessage) {
    // The composer already cleared itself; a second send racing the create must not open a second
    // session.
    if (!accountUid || isSendingRef.current) return
    setError(null)
    isSendingRef.current = true
    try {
      // No title at creation: the agent names the session (status verb, with the server's fallback
      // namer behind it). 'New chat' is only the optimistic row's display label below.
      const result = await createSession.mutateAsync({serverUrl, agentId})
      if (result._ !== 'CreateSessionResponse') throw new Error('Unexpected CreateSession response')
      // Seed the caches before selecting: the selection resolver can only keep the new session if
      // it can attribute it to this agent, and the list refetch has not landed yet.
      const now = Date.now()
      addOptimisticSessionToCaches(serverUrl, accountUid, {
        id: result.sessionId,
        account: accountUid,
        agentId,
        title: 'New chat',
        status: 'idle',
        createdAt: now,
        updatedAt: now,
      })
      // Send the stamped drafts, so the durable echo replaces the optimistic row by identity.
      const messages = addOptimisticSessionMessage(serverUrl, accountUid, result.sessionId, [
        {...message, contextLines: windowContextLinesRef.current},
      ])
      messageSession.mutate({sessionId: result.sessionId, message: messages})
      onSessionCreated({serverUrl, sessionId: result.sessionId})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the chat')
    } finally {
      isSendingRef.current = false
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-xs">
        {`Send a message to start chatting with ${agentName}`}
      </div>
      {error ? <div className="text-destructive px-3 py-1 text-xs">{error}</div> : null}
      {/* No sessionId yet: attachments and the tool palette unlock once the first send creates
          the session. A draft is always user-initiated, so the composer takes focus on mount. */}
      <AgentRichMessageComposer
        isBusy={false}
        isStreaming={false}
        stopPending={false}
        disabledMessage={readOnly ? 'You have read-only access to this agent.' : undefined}
        serverUrl={serverUrl}
        accountId={accountUid ?? null}
        canInvokeTools={canInvokeTools}
        composerHandleRef={composerRef}
        onSend={(message) => void handleSend(message)}
        onStop={() => {}}
      />
    </div>
  )
}

/** Chat transcript, live stream, and composer for one selected session. */
function AssistantSessionChat({
  sessionRef,
  accountUid,
  composerRef,
}: {
  sessionRef: AssistantSessionRef
  accountUid: string | null | undefined
  composerRef: React.MutableRefObject<AgentsRichEditorSubmitHandle | null>
}) {
  const {serverUrl, sessionId} = sessionRef
  const navigate = useNavigate()
  const session = useAgentSession(serverUrl, accountUid, sessionId)
  const live = useAgentWebSocketSubscription(serverUrl, accountUid, `sessions/${sessionId}`)
  const messageSession = useMessageAgentSession(serverUrl, accountUid)
  const stopSession = useStopAgentSession(serverUrl, accountUid)
  const retrySession = useRetrySession(serverUrl, accountUid)
  // The agent definition, for the composer's user tool palette — same source as the full page.
  const agentDetail = useAgentDetail(serverUrl, accountUid, session.data?.session.agentId)
  const windowContextLines = useAssistantWindowContextLines()
  const windowContextLinesRef = useRef(windowContextLines)
  windowContextLinesRef.current = windowContextLines

  const autoScroll = useChatAutoScroll()

  // Chatters (public chat) may send; only owners/writers may control runs, switch the model, or
  // run session tools.
  const readOnly = !agentAccessCanChat(agentDetail.data?.agent.accessRole)
  const canWrite = !!agentDetail.data && agentAccessCanWrite(agentDetail.data.agent.accessRole)
  const status = session.data?.session.status
  const isStreaming = status === 'streaming'
  const isBusy = messageSession.isPending || isStreaming
  const runStartedAt = useRunStartedAt(isStreaming)
  // A sub-session still being driven by its parent is not the user's to message — same rule and
  // wording as the full session page.
  const parentSessionId = session.data?.session.parentSessionId
  const ownRun = useRun(serverUrl, accountUid, parentSessionId ? session.data?.session.runId : undefined)
  const hasLiveRun = !!ownRun.data && !TERMINAL_RUN_STATUSES.has(ownRun.data.status)
  const isDrivenByParent = !!parentSessionId && (isStreaming || hasLiveRun)
  const events = session.data?.events
  const sessionRuns = useSessionRuns(serverUrl, accountUid, sessionId)
  const rows = useMemo(
    () =>
      interleaveRunRecords(
        buildAgentSessionChatRows(events || [], {
          serverUrl,
          agentId: session.data?.session.agentId,
          sessionId,
          triggerContext: session.data?.triggerContext,
        }),
        sessionRuns.data || [],
        // A model-driven agent keeps its checklist on the session, not on the run, so the freeze
        // decision needs it here for the same reason the pinned card does.
        session.data?.session.plan,
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
      messageSession.mutate({sessionId, message: messages})
    },
    [accountUid, messageSession, serverUrl, sessionId],
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SessionSummaryBanner compact description={session.data?.session.description} />
      <div
        ref={autoScroll.containerRef}
        onScroll={autoScroll.handleScroll}
        className="relative flex-1 overflow-y-auto px-3 py-2"
      >
        <div ref={autoScroll.contentRef} className="flex min-h-full flex-col">
          {rows.length === 0 && !isStreaming ? (
            <div className="text-muted-foreground flex flex-1 items-center justify-center text-xs">
              Send a message to start chatting
            </div>
          ) : null}
          {rows.map((row) => {
            if (row.kind === 'message')
              return (
                <ChatMessageBubble
                  key={row.key}
                  message={row.message}
                  liveActivity={chatRowHasPendingToolCall(row) ? live.activity : undefined}
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
                    navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
                  }
                />
              )
            }
            return null
          })}
          {live.text ? (
            <AssistantMessageParts parts={[{type: 'text', text: live.text}]} isStreaming={isStreaming} />
          ) : null}
          {isStreaming && !(live.activity?.phase === 'tool' && rows.some(chatRowHasPendingToolCall)) ? (
            // Hidden while a pending tool row is showing its own live status, to avoid two spinners.
            <AgentRunStatusBar startedAt={runStartedAt} activity={live.activity} usage={live.usage} />
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
          navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
        }
      />

      {/* No focus-on-mount here: session chats mount with the panel itself (e.g. on app launch),
          where stealing focus from the document would be wrong. Focus is imperative, via the
          panel's new-chat flows. */}
      <AgentRichMessageComposer
        isBusy={isBusy}
        isStreaming={isStreaming}
        disabledMessage={
          readOnly
            ? 'You have read-only access to this agent.'
            : isDrivenByParent
              ? SUB_SESSION_DRIVEN_MESSAGE
              : undefined
        }
        stopPending={stopSession.isPending}
        serverUrl={serverUrl}
        accountId={accountUid ?? null}
        sessionId={sessionId}
        agentTools={agentDetail.data?.agent.definition.tools}
        agentToolsLoading={agentDetail.isLoading}
        focusOnMount={false}
        canInvokeTools={canWrite}
        composerHandleRef={composerRef}
        onSend={handleSend}
        onStop={() => void handleStop()}
      />
      {/* The active model for THIS session: the same per-session override switcher as the full
          session page, so changing it here never touches the agent's default. */}
      {session.data ? (
        <div className="flex flex-none items-center justify-end px-3 pb-2">
          <SessionModelBadge
            agent={agentDetail.data?.agent}
            agentId={session.data.session.agentId}
            serverUrl={serverUrl}
            sessionId={sessionId}
            modelOverride={session.data.session.modelOverride}
            canWrite={canWrite}
          />
        </div>
      ) : null}
    </div>
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
