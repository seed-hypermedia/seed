import {
  addOptimisticSessionMessage,
  describeAgentServer,
  removeOptimisticSessionFromLists,
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
  useStopAgentSession,
  type AgentSessionListEntry,
} from '@/models/agents'
import {
  buildAgentSessionChatRows,
  interleaveRunRecords,
  buildAgentSessionUrl,
  chatRowHasPendingToolCall,
  retryableErrorRowKey,
} from '@/models/agent-session-rows'
import {
  resolveAssistantSelection,
  type AssistantAgentKey,
  type AssistantAgentOption,
} from '@/models/assistant-selection'
import {CreateAgentDialog} from '@/pages/agents/dialogs'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
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
  Send,
  Square,
  Trash2,
} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AgentRunStatusBar, useRunStartedAt} from './agent-run-status'
import {AgentErrorRow, AssistantMessageParts, ChatMessageBubble} from './assistant-message-rendering'
import {useChatAutoScroll} from './chat-autoscroll'
import {decodeAssistantSessionRef, encodeAssistantSessionRef, type AssistantSessionRef} from './assistant-session-ref'
import {useAssistantWindowContextLines} from './assistant-window-context'
import {ChatMessageComposer} from './chat-message-composer'
import {RunRecordCard, SessionRunCard} from '@/pages/agents/run-card'
import {SessionStatusDot, SubSessionsDisclosure} from './session-children'
import {QueuedChatMessages, useQueuedChatMessages} from './chat-message-queue'

/**
 * Assistant sidebar.
 *
 * A session view over the Agents service, scoped to one agent at a time: the dropdown at the very
 * top picks the agent context, the row below it picks a session within that context, and new chats
 * start directly in the current context — no dialog in the way. A new chat is a draft until the
 * first send, which creates the session and delivers the message in one motion.
 */
export function AssistantPanel({
  initialSessionId,
  newChatRequest,
  onSessionChange,
}: {
  /** Serialized {@link AssistantSessionRef} restored from window state. */
  initialSessionId?: string | null
  newChatRequest?: number
  onSessionChange?: (sessionId: string | null) => void
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
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
  // session from another agent with the active agent's newest).
  useEffect(() => {
    const resolved = selection.session
    const same = resolved?.serverUrl === stored?.serverUrl && resolved?.sessionId === stored?.sessionId
    if (!same && !(resolved === null && stored === null)) setStored(resolved)
  }, [selection.session, stored, setStored])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
    requestAnimationFrame(() => inputRef.current?.focus())
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
        <button
          onClick={startDraft}
          className="no-window-drag text-muted-foreground hover:text-foreground p-1"
          title="New chat"
        >
          <MessageCirclePlus className="size-4" />
        </button>
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
          inputRef={inputRef}
        />
      ) : activeAgent ? (
        <AssistantDraftChat
          key={`${activeAgent.serverUrl}${activeAgent.agent.id}`}
          serverUrl={activeAgent.serverUrl}
          agentId={activeAgent.agent.id}
          agentName={activeAgent.agent.definition.name}
          accountUid={accountUid}
          inputRef={inputRef}
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
  onSelect,
  onCreateAgent,
  onOpenAgentsPage,
}: {
  agents: AssistantAgentOption[]
  activeAgent: AssistantAgentOption | null
  localServerUrl: string | null
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
                  <span className="min-w-0 flex-1 truncate text-xs">{entry.session.title || 'Untitled session'}</span>
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
  inputRef,
  onSessionCreated,
}: {
  serverUrl: string
  agentId: string
  agentName: string
  accountUid: string | null | undefined
  inputRef: React.RefObject<HTMLTextAreaElement>
  onSessionCreated: (ref: AssistantSessionRef) => void
}) {
  const createSession = useCreateAgentSessionOnServer(accountUid)
  const messageSession = useMessageAgentSession(serverUrl, accountUid)
  const windowContextLines = useAssistantWindowContextLines()
  const windowContextLinesRef = useRef(windowContextLines)
  windowContextLinesRef.current = windowContextLines

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)

  async function handleSend() {
    const content = input.trim()
    if (!content || !accountUid || isSending) return
    setError(null)
    setIsSending(true)
    try {
      const result = await createSession.mutateAsync({serverUrl, agentId, title: 'New chat'})
      if (result._ !== 'CreateSessionResponse') throw new Error('Unexpected CreateSession response')
      setInput('')
      const messages = [{text: content, contextLines: windowContextLinesRef.current}]
      addOptimisticSessionMessage(serverUrl, accountUid, result.sessionId, messages)
      messageSession.mutate({sessionId: result.sessionId, message: messages})
      onSessionCreated({serverUrl, sessionId: result.sessionId})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the chat')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-xs">
        {`Send a message to start chatting with ${agentName}`}
      </div>
      {error ? <div className="text-destructive px-3 py-1 text-xs">{error}</div> : null}
      <ChatMessageComposer
        textareaRef={inputRef}
        placeholder="Type a message…"
        value={input}
        onChange={setInput}
        onSend={() => void handleSend()}
        disabled={isSending}
        sendDisabled={!input.trim() || isSending}
        className="border-border border-t px-3 py-2"
      />
    </div>
  )
}

/** Chat transcript, live stream, and composer for one selected session. */
function AssistantSessionChat({
  sessionRef,
  accountUid,
  inputRef,
}: {
  sessionRef: AssistantSessionRef
  accountUid: string | null | undefined
  inputRef: React.RefObject<HTMLTextAreaElement>
}) {
  const {serverUrl, sessionId} = sessionRef
  const navigate = useNavigate()
  const session = useAgentSession(serverUrl, accountUid, sessionId)
  const live = useAgentWebSocketSubscription(serverUrl, accountUid, `sessions/${sessionId}`)
  const messageSession = useMessageAgentSession(serverUrl, accountUid)
  const stopSession = useStopAgentSession(serverUrl, accountUid)
  const retrySession = useRetrySession(serverUrl, accountUid)
  const windowContextLines = useAssistantWindowContextLines()
  const windowContextLinesRef = useRef(windowContextLines)
  windowContextLinesRef.current = windowContextLines

  const [input, setInput] = useState('')
  const autoScroll = useChatAutoScroll()

  const status = session.data?.session.status
  const isStreaming = status === 'streaming'
  const runStartedAt = useRunStartedAt(isStreaming)
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
      ),
    [events, serverUrl, sessionId, session.data?.session.agentId, session.data?.triggerContext, sessionRuns.data],
  )

  const doSendMessage = useCallback(
    (content: string | string[]) => {
      if (!accountUid) return
      const contextLines = windowContextLinesRef.current
      const messages = (Array.isArray(content) ? content : [content]).map((text, index) =>
        index === 0 && contextLines ? {text, contextLines} : {text},
      )
      addOptimisticSessionMessage(serverUrl, accountUid, sessionId, messages)
      messageSession.mutate({sessionId, message: messages})
    },
    [accountUid, messageSession, serverUrl, sessionId],
  )

  const {queuedMessages, queueMessage} = useQueuedChatMessages({isBusy: isStreaming, onFlush: doSendMessage})

  // Retry is offered on a trailing error only, and survives its own in-flight state: the row goes
  // away when the retried run starts streaming, not when the request is sent.
  const retryableRowKey = retryableErrorRowKey(rows, !!isStreaming)
  const handleRetry = useCallback(() => {
    retrySession.mutate(sessionId, {
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not retry this turn'),
    })
  }, [retrySession, sessionId])

  function handleSend() {
    const content = input.trim()
    if (!content) return
    setInput('')
    if (isStreaming) queueMessage(content)
    else doSendMessage(content)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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
        onOpenSession={(childSessionId, childAgentId) =>
          navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
        }
      />

      <QueuedChatMessages messages={queuedMessages} />

      <ChatMessageComposer
        textareaRef={inputRef}
        placeholder={isStreaming ? 'Type to queue a message…' : 'Type a message…'}
        value={input}
        onChange={setInput}
        onSend={() => {
          handleSend()
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
        sendDisabled={!input.trim()}
        className="border-border border-t px-3 py-2"
        actions={
          isStreaming ? (
            <div className="flex gap-1">
              {input.trim() ? (
                <Button size="sm" onClick={handleSend} title="Queue message">
                  <Send className="size-3.5" />
                </Button>
              ) : null}
              <Button size="sm" variant="destructive" onClick={() => stopSession.mutate(sessionId)}>
                <Square className="size-3" />
              </Button>
            </div>
          ) : undefined
        }
      />
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
