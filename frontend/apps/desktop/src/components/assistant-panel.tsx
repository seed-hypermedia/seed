import {useAIProviders} from '@/models/ai-config'
import {
  useChatSession,
  useChatSessions,
  useChatStream,
  useCreateChatSession,
  useDeleteChatSession,
  useSendChatMessage,
  useSetSessionProvider,
} from '@/models/chat'
import {useNavigate} from '@/utils/useNavigate'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Send,
  Settings,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Markdown} from './markdown'

export function AssistantPanel({
  initialSessionId,
  onSessionChange,
}: {
  initialSessionId?: string | null
  onSessionChange?: (sessionId: string | null) => void
}) {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="text-muted-foreground size-4" />
          <SizableText size="sm" className="font-medium">
            Assistant
          </SizableText>
        </div>
        <button
          onClick={() => navigate({key: 'settings'})}
          className="text-muted-foreground hover:text-foreground"
          title="Assistant Providers"
        >
          <Settings className="size-4" />
        </button>
      </div>
      <ChatView initialSessionId={initialSessionId} onSessionChange={onSessionChange} />
    </div>
  )
}

function ChatView({
  initialSessionId,
  onSessionChange,
}: {
  initialSessionId?: string | null
  onSessionChange?: (sessionId: string | null) => void
}) {
  const sessions = useChatSessions()
  const createSession = useCreateChatSession()
  const deleteSession = useDeleteChatSession()
  const [selectedSessionId, setSelectedSessionIdRaw] = useState<string | null>(initialSessionId || null)

  const setSelectedSessionId = (id: string | null) => {
    setSelectedSessionIdRaw(id)
    onSessionChange?.(id)
  }
  const session = useChatSession(selectedSessionId)
  const sendMessage = useSendChatMessage()
  const {streamingText, isStreaming, streamComplete, pendingToolCalls, pendingToolResults, clearStream, stopStream} =
    useChatStream(selectedSessionId)
  const [input, setInput] = useState('')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Provider selection
  const providers = useAIProviders()
  const setSessionProvider = useSetSessionProvider()
  const sessionProviderId = session.data?.providerId

  // Document context from current route
  const navRoute = useNavRoute()
  const documentContext = useMemo(() => {
    if (
      navRoute.key === 'document' ||
      navRoute.key === 'comments' ||
      navRoute.key === 'directory' ||
      navRoute.key === 'activity' ||
      navRoute.key === 'collaborators' ||
      navRoute.key === 'feed'
    ) {
      const id = navRoute.id
      try {
        const url = packHmId(id)
        return {url, title: undefined as string | undefined}
      } catch {
        return undefined
      }
    }
    return undefined
  }, [navRoute])

  // Message queue for messages sent while streaming
  const queuedMessagesRef = useRef<string[]>([])
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])

  // Scroll state
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const lastMessageCountRef = useRef(0)
  const scrollingToBottomRef = useRef(false)

  const isBusy = isStreaming || streamComplete
  const showStreamingBlock =
    isStreaming || (streamComplete && !!(streamingText || pendingToolCalls?.length || pendingToolResults?.length))

  // Auto-select first session
  useEffect(() => {
    if (!selectedSessionId && sessions.data && sessions.data.length > 0) {
      setSelectedSessionId(sessions.data[0].id)
    }
  }, [sessions.data, selectedSessionId])

  // Clear streaming state once the persisted message appears in query data
  const messages = session.data?.messages || []
  useEffect(() => {
    if (streamComplete && messages.length > lastMessageCountRef.current) {
      clearStream()
    }
    lastMessageCountRef.current = messages.length
  }, [messages.length, streamComplete, clearStream])

  // Near-bottom detection
  const checkIsNearBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true
    const threshold = 100
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom <= threshold
  }, [])

  const handleScroll = useCallback(() => {
    // During a programmatic smooth-scroll-to-bottom, ignore intermediate scroll events
    // that would incorrectly detect us as "not near bottom" mid-animation
    if (scrollingToBottomRef.current) {
      const nearBottom = checkIsNearBottom()
      if (nearBottom) {
        scrollingToBottomRef.current = false
        setIsNearBottom(true)
        setShowScrollButton(false)
      }
      return
    }
    const nearBottom = checkIsNearBottom()
    setIsNearBottom(nearBottom)
    if (nearBottom) {
      setShowScrollButton(false)
    }
  }, [checkIsNearBottom])

  // Auto-scroll: snap to bottom instantly (no smooth) so it doesn't fight user scrolling
  // or cause intermediate scroll events that flash the pill
  useEffect(() => {
    if (isNearBottom) {
      const container = messagesContainerRef.current
      if (container) {
        container.scrollTop = container.scrollHeight
      }
    } else if (isStreaming || messages.length > lastMessageCountRef.current) {
      setShowScrollButton(true)
    }
  }, [messages.length, streamingText, isNearBottom, isStreaming])

  const scrollToBottom = useCallback(() => {
    scrollingToBottomRef.current = true
    setShowScrollButton(false)
    setIsNearBottom(true)
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
  }, [])

  async function doSendMessage(content: string | string[]) {
    let sessionId = selectedSessionId
    if (!sessionId) {
      const newSession = await createSession.mutateAsync(undefined)
      sessionId = newSession.id
      setSelectedSessionId(sessionId)
    }
    sendMessage.mutate({
      sessionId,
      content,
      providerId: sessionProviderId,
      documentContext,
    })
  }

  async function handleSend() {
    if (!input.trim()) return
    const content = input.trim()
    setInput('')
    if (isBusy) {
      // Queue message to send after current stream completes
      queuedMessagesRef.current = [...queuedMessagesRef.current, content]
      setQueuedMessages([...queuedMessagesRef.current])
    } else {
      doSendMessage(content)
    }
  }

  // Flush all queued messages at once when stream finishes
  useEffect(() => {
    if (!isBusy && queuedMessagesRef.current.length > 0) {
      const allQueued = [...queuedMessagesRef.current]
      queuedMessagesRef.current = []
      setQueuedMessages([])
      doSendMessage(allQueued)
    }
  }, [isBusy])

  async function handleNewSession() {
    const newSession = await createSession.mutateAsync(undefined)
    setSelectedSessionId(newSession.id)
  }

  function handleDeleteSession() {
    if (!selectedSessionId) return
    deleteSession.mutate(selectedSessionId)
    setSelectedSessionId(null)
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Session selector + provider selector */}
      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <select
          value={selectedSessionId || ''}
          onChange={(e) => setSelectedSessionId(e.target.value || null)}
          className="bg-muted text-foreground flex-1 rounded px-2 py-1 text-xs"
        >
          <option value="">Select a session...</option>
          {sessions.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button onClick={handleNewSession} className="text-muted-foreground hover:text-foreground p-1" title="New chat">
          <Plus className="size-3.5" />
        </button>
        {selectedSessionId && (
          <button
            onClick={handleDeleteSession}
            className="text-muted-foreground hover:text-destructive p-1"
            title="Delete chat"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Provider selector */}
      {providers.data && providers.data.length > 0 && (
        <div className="border-border flex items-center gap-1 border-b px-2 py-1">
          <select
            value={sessionProviderId || ''}
            onChange={(e) => {
              if (e.target.value && selectedSessionId) {
                setSessionProvider.mutate({sessionId: selectedSessionId, providerId: e.target.value})
              }
            }}
            className="bg-muted text-foreground flex-1 rounded px-2 py-1 text-xs"
          >
            {providers.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.model})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Messages */}
      <div ref={messagesContainerRef} onScroll={handleScroll} className="relative flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 && !isStreaming && (
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            Send a message to start chatting
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessageBubble key={i} message={msg} />
        ))}
        {/* Streaming state — kept visible until persisted message confirmed */}
        {showStreamingBlock && (
          <>
            {(() => {
              const streamToolItems = mergeToolCallsAndResults(
                pendingToolCalls as Array<{id: string; name: string; args: Record<string, unknown>}>,
                pendingToolResults as Array<{id: string; name: string; result: string}>,
              )
              return streamToolItems.map((item) => <ToolCallItem key={item.id} item={item} />)
            })()}
            {streamingText && (
              <div className="bg-muted my-1 rounded-lg px-3 py-2 text-xs">
                <Markdown>{streamingText}</Markdown>
                {isStreaming && <span className="bg-foreground inline-block h-3 w-1 animate-pulse" />}
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
        {/* Scroll-to-bottom pill */}
        {showScrollButton && (
          <div className="pointer-events-none sticky bottom-2 flex justify-center">
            <button
              onClick={scrollToBottom}
              className="bg-muted border-border text-foreground pointer-events-auto rounded-full border p-1.5 shadow-lg"
            >
              <ArrowDown className="size-4" />
            </button>
          </div>
        )}
      </div>

      {/* Queued messages indicator */}
      {queuedMessages.length > 0 && (
        <div className="border-border border-t px-3 py-1">
          {queuedMessages.map((msg, i) => (
            <div key={i} className="text-muted-foreground truncate text-[10px] italic">
              Queued: {msg}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-border flex items-center gap-2 border-t px-3 py-2">
        <Input
          ref={inputRef}
          placeholder={isBusy ? 'Type to queue a message...' : 'Type a message...'}
          value={input}
          onChangeText={setInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
              requestAnimationFrame(() => inputRef.current?.focus())
            }
          }}
          className="flex-1 text-xs"
        />
        {isStreaming ? (
          <div className="flex gap-1">
            {input.trim() && (
              <Button size="sm" onClick={handleSend} title="Queue message">
                <Send className="size-3.5" />
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={stopStream}>
              <Square className="size-3" />
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={handleSend} disabled={!input.trim()}>
            <Send className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

function ChatMessageBubble({message}: {message: any}) {
  const isUser = message.role === 'user'
  const toolItems = mergeToolCallsAndResults(message.toolCalls, message.toolResults)

  return (
    <div className="my-1.5">
      {toolItems.map((item) => (
        <ToolCallItem key={item.id} item={item} />
      ))}
      {message.content && (
        <div
          className={`rounded-lg px-3 py-2 text-xs ${
            isUser ? 'bg-primary text-primary-foreground ml-6' : 'bg-muted mr-6'
          }`}
        >
          {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <Markdown>{message.content}</Markdown>}
        </div>
      )}
    </div>
  )
}

type MergedToolItem = {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
  pending?: boolean
}

function mergeToolCallsAndResults(
  toolCalls?: Array<{id: string; name: string; args: Record<string, unknown>}>,
  toolResults?: Array<{id: string; name: string; result: string}>,
): MergedToolItem[] {
  const itemsById = new Map<string, MergedToolItem>()

  if (toolCalls) {
    for (const tc of toolCalls) {
      itemsById.set(tc.id, {id: tc.id, name: tc.name, args: tc.args, pending: true})
    }
  }

  if (toolResults) {
    for (const tr of toolResults) {
      const existing = itemsById.get(tr.id)
      if (existing) {
        existing.result = tr.result
        existing.pending = false
      } else {
        itemsById.set(tr.id, {id: tr.id, name: tr.name, result: tr.result})
      }
    }
  }

  return Array.from(itemsById.values())
}

function ToolCallItem({item}: {item: MergedToolItem}) {
  const [expanded, setExpanded] = useState(false)
  const hasArgs = item.args && Object.keys(item.args).length > 0
  const hasResult = item.result !== undefined

  return (
    <div className="bg-muted/50 border-border my-1 overflow-hidden rounded border text-xs">
      <button
        onClick={() => setExpanded(!expanded)}
        className="hover:bg-muted flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        {item.pending ? (
          <Loader2 className="text-muted-foreground size-3 shrink-0 animate-spin" />
        ) : (
          <Wrench className="text-muted-foreground size-3 shrink-0" />
        )}
        <span className="font-medium">{item.name}</span>
        {hasArgs && !expanded && (
          <span className="text-muted-foreground min-w-0 flex-1 truncate">
            (
            {Object.entries(item.args!)
              .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
              .join(', ')}
            )
          </span>
        )}
        <span className="ml-auto shrink-0">
          {expanded ? (
            <ChevronDown className="text-muted-foreground size-3" />
          ) : (
            <ChevronRight className="text-muted-foreground size-3" />
          )}
        </span>
      </button>
      {expanded && (
        <div className="border-border border-t px-2 py-1.5">
          {hasArgs && (
            <div className="mb-1">
              <div className="text-muted-foreground mb-0.5 text-[10px] font-medium uppercase">Arguments</div>
              <div className="bg-background rounded p-1.5">
                {Object.entries(item.args!).map(([key, value]) => (
                  <div key={key} className="flex gap-1">
                    <span className="text-muted-foreground shrink-0">{key}:</span>
                    <span className="min-w-0 break-all">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasResult && (
            <div>
              <div className="text-muted-foreground mb-0.5 text-[10px] font-medium uppercase">Result</div>
              <div className="bg-background max-h-40 overflow-y-auto rounded p-1.5">
                <pre className="break-all whitespace-pre-wrap">{item.result}</pre>
              </div>
            </div>
          )}
          {item.pending && !hasResult && <div className="text-muted-foreground italic">Running...</div>}
        </div>
      )}
    </div>
  )
}
