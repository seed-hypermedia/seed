import {
  addOptimisticSessionMessage,
  useAgentLists,
  useAgentServerUrls,
  useAgentSession,
  useAgentWebSocketSubscription,
  useAllAgentSessions,
  useCreateAgentSessionOnServer,
  useDeleteAgentSession,
  describeAgentServer,
  isLocalAgentServer,
  useLocalAgentServerUrl,
  useMessageAgentSession,
  useStopAgentSession,
  type AgentSessionListEntry,
} from '@/models/agents'
import {buildAgentSessionChatRows} from '@/models/agent-session-rows'
import {useSelectedAccountId} from '@/selected-account'
import {Button} from '@shm/ui/button'
import {AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {DialogDescription, DialogFooter, DialogTitle} from '@shm/ui/components/dialog'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {SizableText} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ArrowDown, Bot, ChevronDown, Loader2, MessageCirclePlus, Send, Square, Trash2} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AssistantMessageParts, ChatMessageBubble} from './assistant-message-rendering'
import {decodeAssistantSessionRef, encodeAssistantSessionRef, type AssistantSessionRef} from './assistant-session-ref'
import {ChatMessageComposer} from './chat-message-composer'
import {QueuedChatMessages, useQueuedChatMessages} from './chat-message-queue'

/**
 * Assistant sidebar.
 *
 * This is a session view over the Agents service, not a separate assistant runtime: it lists and
 * opens sessions belonging to any agent on any configured server — the locally spawned one included
 * — and renders them with the same components as the full Agents session page.
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
  return (
    <div className="flex h-full flex-col">
      <div className="border-border window-drag flex h-10 items-center justify-between border-b px-3 py-2">
        <div className="no-select flex items-center gap-2">
          <Bot className="text-muted-foreground size-4" />
          <SizableText size="sm" className="font-medium">
            Assistant
          </SizableText>
        </div>
      </div>
      <AssistantChatView
        initialSessionId={initialSessionId}
        newChatRequest={newChatRequest}
        onSessionChange={onSessionChange}
      />
    </div>
  )
}

function AssistantChatView({
  initialSessionId,
  newChatRequest,
  onSessionChange,
}: {
  initialSessionId?: string | null
  newChatRequest?: number
  onSessionChange?: (sessionId: string | null) => void
}) {
  const accountUid = useSelectedAccountId()
  const serverUrls = useAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const sessions = useAllAgentSessions(serverUrls.data, accountUid)

  const [selected, setSelectedRaw] = useState<AssistantSessionRef | null>(() =>
    decodeAssistantSessionRef(initialSessionId),
  )
  const lastNewChatRequestRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const setSelected = useCallback(
    (ref: AssistantSessionRef | null) => {
      setSelectedRaw(ref)
      onSessionChange?.(ref ? encodeAssistantSessionRef(ref) : null)
    },
    [onSessionChange],
  )

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  // Select the most recent session across all servers once the lists arrive, so opening the sidebar
  // lands somewhere useful rather than on an empty picker.
  useEffect(() => {
    if (selected || sessions.entries.length === 0) return
    const newest = sessions.entries[0]!
    setSelected({serverUrl: newest.serverUrl, sessionId: newest.session.id})
  }, [selected, sessions.entries, setSelected])

  const newSessionDialog = useAppDialog(NewAssistantSessionDialog)

  const openNewSessionPicker = useCallback(() => {
    newSessionDialog.open({
      onCreated: (ref: AssistantSessionRef) => {
        setSelected(ref)
        focusInput()
      },
    })
  }, [focusInput, newSessionDialog, setSelected])

  useEffect(() => {
    if (!newChatRequest || newChatRequest === lastNewChatRequestRef.current) return
    lastNewChatRequestRef.current = newChatRequest
    openNewSessionPicker()
  }, [newChatRequest, openNewSessionPicker])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {newSessionDialog.content}
      <AssistantSessionPicker
        entries={sessions.entries}
        isLoading={sessions.isLoading}
        selected={selected}
        localServerUrl={localServerUrl.data ?? null}
        onSelect={setSelected}
        onNewSession={openNewSessionPicker}
      />
      {selected ? (
        <AssistantSessionChat
          key={`${selected.serverUrl}${selected.sessionId}`}
          sessionRef={selected}
          accountUid={accountUid}
          inputRef={inputRef}
          onDeleted={() => setSelected(null)}
        />
      ) : (
        <div className="text-muted-foreground flex flex-1 items-center justify-center px-4 text-center text-xs">
          {sessions.isLoading ? 'Loading sessions…' : 'Start a chat to begin.'}
        </div>
      )}
    </div>
  )
}

/** Session switcher listing every session from every configured server, newest first. */
function AssistantSessionPicker({
  entries,
  isLoading,
  selected,
  localServerUrl,
  onSelect,
  onNewSession,
}: {
  entries: AgentSessionListEntry[]
  isLoading: boolean
  selected: AssistantSessionRef | null
  localServerUrl: string | null
  onSelect: (ref: AssistantSessionRef) => void
  onNewSession: () => void
}) {
  const [open, setOpen] = useState(false)
  const selectedEntry = entries.find(
    (entry) => entry.serverUrl === selected?.serverUrl && entry.session.id === selected?.sessionId,
  )

  return (
    <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="bg-muted text-foreground flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-xs"
          >
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="truncate">
                {selectedEntry?.session.title || (selected ? 'Untitled session' : 'Select a session…')}
              </span>
              {/* Which agent is answering is not obvious once sessions span several agents and
                  servers, so it stays visible rather than living only inside the dropdown. */}
              {selectedEntry ? (
                <span className="text-muted-foreground truncate text-[10px]">
                  {selectedEntry.agent?.definition.name || 'Unknown agent'} ·{' '}
                  {describeAgentServer(selectedEntry.serverUrl, localServerUrl)}
                </span>
              ) : null}
            </span>
            <ChevronDown className="size-3 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto p-1">
          {isLoading && entries.length === 0 ? (
            <div className="text-muted-foreground px-2 py-3 text-center text-xs">Loading sessions…</div>
          ) : entries.length === 0 ? (
            <div className="text-muted-foreground px-2 py-3 text-center text-xs">No sessions yet.</div>
          ) : (
            entries.map((entry) => {
              const isSelected = entry.serverUrl === selected?.serverUrl && entry.session.id === selected?.sessionId
              return (
                <button
                  key={`${entry.serverUrl}${entry.session.id}`}
                  type="button"
                  className={`hover:bg-muted flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left ${
                    isSelected ? 'bg-muted' : ''
                  }`}
                  onClick={() => {
                    onSelect({serverUrl: entry.serverUrl, sessionId: entry.session.id})
                    setOpen(false)
                  }}
                >
                  <span className="w-full truncate text-xs font-medium">
                    {entry.session.title || 'Untitled session'}
                  </span>
                  <span className="text-muted-foreground w-full truncate text-[10px]">
                    {entry.agent?.definition.name || 'Unknown agent'} ·{' '}
                    {describeAgentServer(entry.serverUrl, localServerUrl)}
                  </span>
                </button>
              )
            })
          )}
        </PopoverContent>
      </Popover>
      <button onClick={onNewSession} className="text-muted-foreground hover:text-foreground p-1" title="New chat">
        <MessageCirclePlus className="size-3.5" />
      </button>
    </div>
  )
}

/** Chat transcript, live stream, and composer for one selected session. */
function AssistantSessionChat({
  sessionRef,
  accountUid,
  inputRef,
  onDeleted,
}: {
  sessionRef: AssistantSessionRef
  accountUid: string | null | undefined
  inputRef: React.RefObject<HTMLTextAreaElement>
  onDeleted: () => void
}) {
  const {serverUrl, sessionId} = sessionRef
  const session = useAgentSession(serverUrl, accountUid, sessionId)
  const live = useAgentWebSocketSubscription(serverUrl, accountUid, `sessions/${sessionId}`)
  const messageSession = useMessageAgentSession(serverUrl, accountUid)
  const stopSession = useStopAgentSession(serverUrl, accountUid)
  const deleteSession = useDeleteAgentSession(serverUrl, accountUid)
  const deleteDialog = useAppDialog(DeleteSessionDialog, {isAlert: true})

  const [input, setInput] = useState('')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const status = session.data?.session.status
  const isStreaming = status === 'streaming'
  const events = session.data?.events
  const rows = useMemo(
    () =>
      buildAgentSessionChatRows(events || [], {
        serverUrl,
        agentId: session.data?.session.agentId,
        sessionId,
        triggerContext: session.data?.triggerContext,
      }),
    [events, serverUrl, sessionId, session.data?.session.agentId, session.data?.triggerContext],
  )

  const checkIsNearBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 100
  }, [])

  const handleScroll = useCallback(() => {
    const nearBottom = checkIsNearBottom()
    setIsNearBottom(nearBottom)
    if (nearBottom) setShowScrollButton(false)
  }, [checkIsNearBottom])

  useEffect(() => {
    if (isNearBottom) {
      const container = messagesContainerRef.current
      if (container) container.scrollTop = container.scrollHeight
    } else if (isStreaming) {
      setShowScrollButton(true)
    }
  }, [rows.length, live.text, isNearBottom, isStreaming])

  const doSendMessage = useCallback(
    (content: string | string[]) => {
      if (!accountUid) return
      const messages = (Array.isArray(content) ? content : [content]).map((text) => ({text}))
      addOptimisticSessionMessage(serverUrl, accountUid, sessionId, messages)
      messageSession.mutate({sessionId, message: messages})
    },
    [accountUid, messageSession, serverUrl, sessionId],
  )

  const {queuedMessages, queueMessage} = useQueuedChatMessages({isBusy: isStreaming, onFlush: doSendMessage})

  function handleSend() {
    const content = input.trim()
    if (!content) return
    setInput('')
    if (isStreaming) queueMessage(content)
    else doSendMessage(content)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {deleteDialog.content}
      <div className="border-border flex items-center justify-end border-b px-2 py-1">
        <button
          onClick={() =>
            deleteDialog.open({
              sessionTitle: session.data?.session.title,
              onConfirm: () => {
                deleteSession.mutate(sessionId)
                onDeleted()
              },
            })
          }
          className="text-muted-foreground hover:text-destructive p-1"
          title="Delete chat"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div ref={messagesContainerRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-3 py-2">
        {rows.length === 0 && !isStreaming ? (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            Send a message to start chatting
          </div>
        ) : null}
        {rows.map((row) => {
          if (row.kind === 'message') return <ChatMessageBubble key={row.key} message={row.message} />
          if (row.kind === 'error') {
            return (
              <div key={row.key} className="text-destructive my-1 rounded-lg px-3 py-2 text-xs">
                {row.message}
              </div>
            )
          }
          return null
        })}
        {live.text ? (
          <AssistantMessageParts parts={[{type: 'text', text: live.text}]} isStreaming={isStreaming} />
        ) : isStreaming ? (
          <div className="bg-muted my-1 mr-6 rounded-lg px-3 py-2 text-xs">
            <div className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" />
              <span>{live.activity?.phase === 'tool' ? `Using ${live.activity.toolName}…` : 'Thinking…'}</span>
            </div>
          </div>
        ) : null}
        <div ref={messagesEndRef} />
        {showScrollButton ? (
          <div className="pointer-events-none sticky bottom-2 flex justify-center">
            <button
              onClick={() => {
                setShowScrollButton(false)
                setIsNearBottom(true)
                messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
              }}
              className="bg-muted border-border text-foreground pointer-events-auto rounded-full border p-1.5 shadow-lg"
            >
              <ArrowDown className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

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

/**
 * Agent picker for starting a new chat, grouped by server.
 *
 * Exported for tests: it must render inside a plain `Dialog` root, and using alert-dialog
 * primitives here throws at runtime in a way types cannot catch.
 *
 * Choosing the agent is the whole point of this dialog — the sidebar can talk to any agent on any
 * configured server, so there is no sensible default to skip the choice with. Agents are grouped
 * under their server so the same agent name on two servers stays distinguishable.
 */
export function NewAssistantSessionDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {onCreated: (ref: AssistantSessionRef) => void}
}) {
  const accountUid = useSelectedAccountId()
  const serverUrls = useAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const agentLists = useAgentLists(serverUrls.data, accountUid)
  const createSession = useCreateAgentSessionOnServer(accountUid)
  const [error, setError] = useState<string | null>(null)
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null)

  const groups = (serverUrls.data || []).map((serverUrl, index) => ({
    serverUrl,
    label: describeAgentServer(serverUrl, localServerUrl.data),
    isLocal: isLocalAgentServer(serverUrl, localServerUrl.data),
    query: agentLists[index],
    agents: agentLists[index]?.data || [],
  }))
  const isLoading = groups.some((group) => group.query?.isLoading)
  const totalAgents = groups.reduce((count, group) => count + group.agents.length, 0)

  async function startSession(serverUrl: string, agentId: string) {
    setError(null)
    setPendingAgentId(agentId)
    try {
      const result = await createSession.mutateAsync({serverUrl, agentId, title: 'New chat'})
      if (result._ !== 'CreateSessionResponse') throw new Error('Unexpected CreateSession response')
      input.onCreated({serverUrl, sessionId: result.sessionId})
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the chat')
    } finally {
      setPendingAgentId(null)
    }
  }

  return (
    <>
      <DialogTitle>New chat</DialogTitle>
      <DialogDescription>Choose an agent to talk to.</DialogDescription>
      <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
        {isLoading && totalAgents === 0 ? (
          <SizableText className="text-muted-foreground text-sm">Loading agents…</SizableText>
        ) : totalAgents === 0 ? (
          <SizableText className="text-muted-foreground text-sm">
            No agents available yet. Create one from the Agents page, then start a chat here.
          </SizableText>
        ) : (
          groups
            .filter((group) => group.agents.length > 0)
            .map((group) => (
              <div key={group.serverUrl} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 px-2">
                  <SizableText size="xs" color="muted" className="font-medium tracking-wide uppercase">
                    {group.label}
                  </SizableText>
                  {group.isLocal ? (
                    <SizableText size="xs" color="muted">
                      built-in
                    </SizableText>
                  ) : null}
                </div>
                {group.agents.map((agent) => (
                  <button
                    key={`${group.serverUrl}${agent.id}`}
                    type="button"
                    disabled={pendingAgentId !== null}
                    className="hover:bg-muted flex w-full flex-col items-start rounded px-2 py-2 text-left disabled:opacity-60"
                    onClick={() => void startSession(group.serverUrl, agent.id)}
                  >
                    <SizableText size="sm" weight="bold">
                      {agent.definition.name}
                      {pendingAgentId === agent.id ? ' — starting…' : ''}
                    </SizableText>
                    <SizableText size="xs" color="muted">
                      {agent.definition.model}
                    </SizableText>
                  </button>
                ))}
              </div>
            ))
        )}
        {error ? (
          <SizableText size="sm" className="text-destructive">
            {error}
          </SizableText>
        ) : null}
      </div>
      <DialogFooter>
        <Button onClick={onClose} variant="ghost">
          Cancel
        </Button>
      </DialogFooter>
    </>
  )
}

/** Confirmation dialog for deleting a chat session. Exported for tests; see the note above. */
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
