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
import {buildLegacyChatMessageParts, type ChatMessagePart, type ChatToolPart} from '@/models/chat-parts'
import {useOpenUrl} from '@/open-url'
import {useNavigate} from '@/utils/useNavigate'
import {useResource} from '@shm/shared/models/entity'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {
  ArrowDown,
  ArrowUpRight,
  BookOpenText,
  Bot,
  ChevronDown,
  ChevronRight,
  Compass,
  Info,
  Link2,
  Loader2,
  MessageCirclePlus,
  Search,
  Send,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Markdown} from './markdown'

/** Renders the desktop assistant chat panel. */
export function AssistantPanel({
  initialSessionId,
  newChatRequest,
  onSessionChange,
}: {
  initialSessionId?: string | null
  newChatRequest?: number
  onSessionChange?: (sessionId: string | null) => void
}) {
  const navigate = useNavigate()

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
      <ChatView initialSessionId={initialSessionId} newChatRequest={newChatRequest} onSessionChange={onSessionChange} />
    </div>
  )
}

function ChatView({
  initialSessionId,
  newChatRequest,
  onSessionChange,
}: {
  initialSessionId?: string | null
  newChatRequest?: number
  onSessionChange?: (sessionId: string | null) => void
}) {
  const sessions = useChatSessions()
  const createSession = useCreateChatSession()
  const deleteSession = useDeleteChatSession()
  const [selectedSessionId, setSelectedSessionIdRaw] = useState<string | null>(initialSessionId || null)
  const pendingSessionCreationRef = useRef<Promise<string> | null>(null)
  const lastNewChatRequestRef = useRef(0)

  const setSelectedSessionId = useCallback(
    (id: string | null) => {
      setSelectedSessionIdRaw(id)
      onSessionChange?.(id)
    },
    [onSessionChange],
  )

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const createAndSelectSession = useCallback(
    async ({focusInputAfterCreate = false}: {focusInputAfterCreate?: boolean} = {}) => {
      const createPromise = createSession.mutateAsync(undefined).then((newSession) => {
        setSelectedSessionId(newSession.id)
        if (focusInputAfterCreate) {
          focusInput()
        }
        return newSession.id
      })

      pendingSessionCreationRef.current = createPromise

      try {
        return await createPromise
      } finally {
        if (pendingSessionCreationRef.current === createPromise) {
          pendingSessionCreationRef.current = null
        }
      }
    },
    [createSession, focusInput, setSelectedSessionId],
  )

  const ensureSessionId = useCallback(async () => {
    if (pendingSessionCreationRef.current) {
      return pendingSessionCreationRef.current
    }
    if (selectedSessionId) {
      return selectedSessionId
    }
    return createAndSelectSession()
  }, [createAndSelectSession, selectedSessionId])

  const handleNewSession = useCallback(
    async ({focusInputAfterCreate = false}: {focusInputAfterCreate?: boolean} = {}) => {
      return createAndSelectSession({focusInputAfterCreate})
    },
    [createAndSelectSession],
  )

  useEffect(() => {
    if (!newChatRequest || newChatRequest === lastNewChatRequestRef.current) {
      return
    }

    lastNewChatRequestRef.current = newChatRequest
    focusInput()
    void handleNewSession({focusInputAfterCreate: true})
  }, [focusInput, handleNewSession, newChatRequest])

  const session = useChatSession(selectedSessionId)
  const sendMessage = useSendChatMessage()
  const {streamParts = [], isStreaming, streamComplete, clearStream, stopStream} = useChatStream(selectedSessionId)
  const [input, setInput] = useState('')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Provider selection
  const providers = useAIProviders()
  const setSessionProvider = useSetSessionProvider()
  const sessionProviderId = session.data?.providerId
  const activeProviderId = useMemo(() => {
    const providerItems = providers.data || []
    if (!providerItems.length) return undefined
    return providerItems.some((provider) => provider.id === sessionProviderId)
      ? sessionProviderId
      : providerItems[0]?.id
  }, [providers.data, sessionProviderId])

  // Document context from current route
  const navRoute = useNavRoute()
  const routeId =
    'id' in navRoute && navRoute.key !== 'draft'
      ? (navRoute.id as import('@seed-hypermedia/client/hm-types').UnpackedHypermediaId)
      : undefined
  const resource = useResource(routeId)
  const documentTitle =
    resource.data?.type === 'document' ? resource.data.document?.metadata?.name || undefined : undefined

  const documentContext = useMemo(() => {
    type DocCtx = {
      url?: string
      title?: string
      view?: 'document' | 'comments' | 'directory' | 'activity' | 'collaborators' | 'feed' | 'inspect' | 'draft'
      activePanel?: 'comments' | 'activity' | 'directory' | 'collaborators' | 'options'
      openComment?: string
      focusedBlockId?: string
      focusedBlockRange?: {start: number; end: number}
      isDraft?: boolean
      editingDocumentUrl?: string
    }

    const panel =
      'panel' in navRoute ? (navRoute.panel as {key: string; openComment?: string} | null | undefined) : undefined
    const activePanel = panel?.key as DocCtx['activePanel']

    switch (navRoute.key) {
      case 'document':
      case 'directory':
      case 'activity':
      case 'collaborators':
      case 'inspect':
      case 'feed': {
        const id = navRoute.id
        try {
          const ctx: DocCtx = {
            url: packHmId(id),
            title: documentTitle,
            view: navRoute.key,
            activePanel,
          }
          if (id.blockRef) ctx.focusedBlockId = id.blockRef
          if (id.blockRange) {
            ctx.focusedBlockRange = {
              start: id.blockRange.start ?? 0,
              end: id.blockRange.end ?? 0,
            }
          }
          // Extract openComment from comments side panel
          if (panel?.key === 'comments' && panel.openComment) {
            ctx.openComment = panel.openComment
          }
          return ctx
        } catch {
          return undefined
        }
      }
      case 'comments': {
        const id = navRoute.id
        try {
          const ctx: DocCtx = {
            url: packHmId(id),
            title: documentTitle,
            view: 'comments',
            activePanel,
          }
          if (navRoute.openComment) ctx.openComment = navRoute.openComment
          if (navRoute.targetBlockId) ctx.focusedBlockId = navRoute.targetBlockId
          else if (navRoute.blockId) ctx.focusedBlockId = navRoute.blockId
          if (navRoute.blockRange) {
            ctx.focusedBlockRange = {
              start: navRoute.blockRange.start ?? 0,
              end: navRoute.blockRange.end ?? 0,
            }
          }
          return ctx
        } catch {
          return undefined
        }
      }
      case 'draft': {
        const ctx: DocCtx = {
          view: 'draft',
          isDraft: true,
          activePanel,
        }
        if (navRoute.editUid) {
          try {
            ctx.editingDocumentUrl = packHmId(hmId(navRoute.editUid, {path: navRoute.editPath}))
          } catch {
            // ignore if packing fails
          }
        }
        return ctx
      }
      default:
        return undefined
    }
  }, [navRoute, documentTitle])

  // Message queue for messages sent while streaming
  const queuedMessagesRef = useRef<string[]>([])
  const [queuedMessages, setQueuedMessages] = useState<string[]>([])

  // Scroll state
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const lastMessageCountRef = useRef(0)
  const scrollingToBottomRef = useRef(false)

  const isBusy = isStreaming || streamComplete
  const showStreamingBlock = isStreaming || (streamComplete && streamParts.length > 0)
  const showLoadingIndicator = isStreaming && streamParts.length === 0

  // Auto-select first session
  useEffect(() => {
    if (!selectedSessionId && !pendingSessionCreationRef.current && sessions.data && sessions.data.length > 0) {
      setSelectedSessionId(sessions.data[0].id)
    }
  }, [sessions.data, selectedSessionId, setSelectedSessionId])

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
  }, [messages.length, streamParts, isNearBottom, isStreaming])

  const scrollToBottom = useCallback(() => {
    scrollingToBottomRef.current = true
    setShowScrollButton(false)
    setIsNearBottom(true)
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
  }, [])

  async function doSendMessage(content: string | string[]) {
    const sessionId = await ensureSessionId()
    sendMessage.mutate({
      sessionId,
      content,
      providerId: activeProviderId,
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

  const deleteDialog = useAppDialog(DeleteSessionDialog, {isAlert: true})

  function handleDeleteSession() {
    if (!selectedSessionId) return
    const sessionTitle = sessions.data?.find((s) => s.id === selectedSessionId)?.title
    deleteDialog.open({
      sessionId: selectedSessionId,
      sessionTitle,
      onConfirm: () => {
        deleteSession.mutate(selectedSessionId)
        setSelectedSessionId(null)
      },
    })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {deleteDialog.content}
      {/* Session selector + provider selector */}
      <div className="border-border flex items-center gap-1 border-b px-2 py-1.5">
        <select
          value={selectedSessionId || ''}
          onChange={(e) => setSelectedSessionId(e.target.value || null)}
          className="bg-muted text-foreground min-w-0 flex-1 truncate rounded px-2 py-1 text-xs"
        >
          <option value="">Select a session...</option>
          {sessions.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => void handleNewSession({focusInputAfterCreate: true})}
          className="text-muted-foreground hover:text-foreground p-1"
          title="New chat"
        >
          <MessageCirclePlus className="size-3.5" />
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
            value={activeProviderId || ''}
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
            {streamParts.length > 0 ? <AssistantMessageParts parts={streamParts} isStreaming={isStreaming} /> : null}
            {showLoadingIndicator ? (
              <div className="bg-muted my-1 mr-6 rounded-lg px-3 py-2 text-xs">
                <div className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>Thinking...</span>
                </div>
              </div>
            ) : null}
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

/** Confirmation dialog for deleting a chat session. */
function DeleteSessionDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {sessionId: string; sessionTitle?: string; onConfirm: () => void}
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

function ChatMessageBubble({message}: {message: any}) {
  const isUser = message.role === 'user'

  return (
    <div className="my-1.5">
      {isUser ? (
        <div className="bg-primary text-primary-foreground ml-6 rounded-lg px-3 py-2 text-xs">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      ) : (
        <AssistantMessageParts parts={getAssistantMessageParts(message)} />
      )}
      {message.errorMessage ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-1 mr-6 rounded-lg border px-3 py-2 text-xs">
          <div className="mb-1 font-medium">Error</div>
          <p className="whitespace-pre-wrap">{message.errorMessage}</p>
        </div>
      ) : null}
    </div>
  )
}

function AssistantMessageParts({parts, isStreaming = false}: {parts: ChatMessagePart[]; isStreaming?: boolean}) {
  return parts.map((part, index) => {
    if (part.type === 'tool') {
      return <ToolCallItem key={`${part.id}:${index}`} item={part} />
    }

    const showCursor = isStreaming && index === parts.length - 1
    return (
      <div key={`text:${index}`} className="bg-muted my-1 mr-6 rounded-lg px-3 py-2 text-xs">
        <Markdown>{part.text}</Markdown>
        {showCursor && <span className="bg-foreground inline-block h-3 w-1 animate-pulse" />}
      </div>
    )
  })
}

function getAssistantMessageParts(message: {
  parts?: ChatMessagePart[]
  content?: string
  toolCalls?: Array<{id: string; name: string; args: Record<string, unknown>}>
  toolResults?: Array<{id: string; name: string; result: string; rawOutput?: unknown}>
}) {
  if (message.parts && message.parts.length > 0) {
    return message.parts
  }

  return buildLegacyChatMessageParts({
    content: message.content,
    toolCalls: message.toolCalls,
    toolResults: message.toolResults,
  })
}

type SearchToolResultItem = {
  title: string
  url: string
  type: string
  parentNames: string[]
  versionTime?: string
}

type SearchToolOutput = {
  summary: string
  markdown: string
  query: string
  searchType: string
  includeBody: boolean
  results: SearchToolResultItem[]
}

type ReadToolOutput = {
  summary: string
  resourceUrl: string
  view: string
  markdown: string
  title?: string
  displayLabel?: string
}

type ResolveToolOutput = {
  summary: string
  inputUrl: string
  resourceUrl?: string
  resolvedUrl?: string
}

type NavigateToolOutput = {
  summary: string
  resourceUrl: string
  newWindow: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getStringArg(args: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!args) return undefined
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

function getBooleanArg(args: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!args) return undefined
  const value = args[key]
  return typeof value === 'boolean' ? value : undefined
}

function getSearchToolOutput(rawOutput: unknown): SearchToolOutput | null {
  if (!isRecord(rawOutput) || typeof rawOutput.markdown !== 'string' || !Array.isArray(rawOutput.results)) {
    return null
  }

  const results = rawOutput.results.flatMap((result) => {
    if (
      !isRecord(result) ||
      typeof result.title !== 'string' ||
      typeof result.url !== 'string' ||
      typeof result.type !== 'string' ||
      !Array.isArray(result.parentNames)
    ) {
      return []
    }

    return [
      {
        title: result.title,
        url: result.url,
        type: result.type,
        parentNames: result.parentNames.filter((parent): parent is string => typeof parent === 'string'),
        versionTime: typeof result.versionTime === 'string' ? result.versionTime : undefined,
      },
    ]
  })

  return {
    summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
    markdown: rawOutput.markdown,
    query: typeof rawOutput.query === 'string' ? rawOutput.query : '',
    searchType: typeof rawOutput.searchType === 'string' ? rawOutput.searchType : 'hybrid',
    includeBody: rawOutput.includeBody === true,
    results,
  }
}

function getReadToolOutput(rawOutput: unknown): ReadToolOutput | null {
  if (
    !isRecord(rawOutput) ||
    typeof rawOutput.resourceUrl !== 'string' ||
    typeof rawOutput.view !== 'string' ||
    typeof rawOutput.markdown !== 'string'
  ) {
    return null
  }

  return {
    summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
    resourceUrl: rawOutput.resourceUrl,
    view: rawOutput.view,
    markdown: rawOutput.markdown,
    title: typeof rawOutput.title === 'string' ? rawOutput.title : undefined,
    displayLabel: typeof rawOutput.displayLabel === 'string' ? rawOutput.displayLabel : undefined,
  }
}

function getResolveToolOutput(rawOutput: unknown): ResolveToolOutput | null {
  if (!isRecord(rawOutput) || typeof rawOutput.inputUrl !== 'string') {
    return null
  }

  return {
    summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
    inputUrl: rawOutput.inputUrl,
    resourceUrl: typeof rawOutput.resourceUrl === 'string' ? rawOutput.resourceUrl : undefined,
    resolvedUrl: typeof rawOutput.resolvedUrl === 'string' ? rawOutput.resolvedUrl : undefined,
  }
}

function getNavigateToolOutput(rawOutput: unknown): NavigateToolOutput | null {
  if (!isRecord(rawOutput) || typeof rawOutput.resourceUrl !== 'string' || typeof rawOutput.newWindow !== 'boolean') {
    return null
  }

  return {
    summary: typeof rawOutput.summary === 'string' ? rawOutput.summary : '',
    resourceUrl: rawOutput.resourceUrl,
    newWindow: rawOutput.newWindow,
  }
}

function formatToolDebugValue(value: unknown): string {
  if (value === undefined) return '(none)'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatCompactValue(value: unknown): string {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getToolResourceUrl(item: ChatToolPart): string | undefined {
  if (isRecord(item.rawOutput) && typeof item.rawOutput.resourceUrl === 'string') {
    return item.rawOutput.resourceUrl
  }
  return getStringArg(item.args, 'url')
}

function ToolChip({children}: {children: React.ReactNode}) {
  return (
    <span className="bg-background/75 text-muted-foreground rounded-full border px-1.5 py-0.5 text-[9px] font-medium">
      {children}
    </span>
  )
}

function ToolResourceLink({url, label}: {url: string; label: string}) {
  const openUrl = useOpenUrl()

  return (
    <button
      type="button"
      title={url}
      onClick={(event) => openUrl(url, event.metaKey || event.shiftKey)}
      className="bg-background/75 hover:bg-background inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.75 text-left text-[10px] font-medium transition-colors"
    >
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-2.5 shrink-0" />
    </button>
  )
}

function ToolCallDebugDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ChatToolPart
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>Raw tool call payload captured during the assistant response.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-3">
          <div className="min-h-0 space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Input</div>
            <pre className="bg-muted max-h-48 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {formatToolDebugValue(item.args)}
            </pre>
          </div>
          <div className="min-h-0 space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Output</div>
            <pre className="bg-muted max-h-72 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {formatToolDebugValue(item.rawOutput ?? item.result)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ToolCallBubble({
  item,
  icon: Icon,
  label,
  bubbleClassName,
  iconClassName,
  hideResultText,
  children,
}: {
  item: ChatToolPart
  icon: React.ComponentType<{className?: string}>
  label: string
  bubbleClassName: string
  iconClassName: string
  hideResultText?: boolean
  children?: React.ReactNode
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const isPending = item.result === undefined && item.rawOutput === undefined

  return (
    <>
      <div
        className={cn(
          'group relative my-1.5 mr-6 overflow-hidden rounded-xl border px-2.5 py-2 text-[11px] shadow-sm',
          bubbleClassName,
        )}
      >
        <button
          type="button"
          title="View raw tool input/output"
          onClick={() => setDetailsOpen(true)}
          className="bg-background/85 text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 rounded-full border p-0.75 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Info className="size-3" />
        </button>
        <div className="flex items-start gap-2.5 pr-7">
          <div
            className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border', iconClassName)}
          >
            {isPending ? <Loader2 className="size-3 animate-spin" /> : <Icon className="size-3" />}
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-medium">{label}</span>
              {isPending ? <ToolChip>Running</ToolChip> : null}
            </div>
            {hideResultText ? null : <p className="text-foreground/80">{item.result || 'Running...'}</p>}
            {children}
          </div>
        </div>
      </div>
      <ToolCallDebugDialog item={item} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </>
  )
}

function SearchToolCallBubble({item}: {item: ChatToolPart}) {
  const [expanded, setExpanded] = useState(false)
  const searchOutput = getSearchToolOutput(item.rawOutput)
  const hasExpandableContent = Boolean(searchOutput)

  return (
    <ToolCallBubble
      item={item}
      icon={Search}
      label="Search"
      bubbleClassName="border-sky-500/30 bg-sky-500/10"
      iconClassName="border-sky-500/25 bg-background/80 text-sky-500"
    >
      {searchOutput ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {searchOutput.query ? <ToolChip>&ldquo;{searchOutput.query}&rdquo;</ToolChip> : null}
            <ToolChip>
              {searchOutput.results.length} result{searchOutput.results.length === 1 ? '' : 's'}
            </ToolChip>
            <ToolChip>{searchOutput.searchType}</ToolChip>
            <ToolChip>{searchOutput.includeBody ? 'body included' : 'titles only'}</ToolChip>
          </div>
          {hasExpandableContent ? (
            <button
              type="button"
              onClick={() => setExpanded((current) => !current)}
              className="hover:bg-background/70 inline-flex items-center gap-1 rounded-full border px-2 py-0.75 text-[10px] font-medium transition-colors"
            >
              <span>{expanded ? 'Hide results' : 'Show results'}</span>
              {expanded ? <ChevronDown className="size-2.5" /> : <ChevronRight className="size-2.5" />}
            </button>
          ) : null}
          {expanded ? (
            <div className="bg-background/60 rounded-xl border px-2.5 py-2">
              <Markdown>{searchOutput.markdown}</Markdown>
            </div>
          ) : null}
        </div>
      ) : null}
    </ToolCallBubble>
  )
}

function ReadToolCallBubble({item}: {item: ChatToolPart}) {
  const readOutput = getReadToolOutput(item.rawOutput)
  const resourceUrl = readOutput?.resourceUrl || getToolResourceUrl(item)
  const resourceLabel =
    readOutput?.displayLabel ||
    (readOutput?.view === 'comments' ? (readOutput.title ? `${readOutput.title} Comments` : 'Comments') : undefined) ||
    readOutput?.title ||
    resourceUrl ||
    'Untitled document'

  return (
    <ToolCallBubble
      item={item}
      icon={BookOpenText}
      label="Read"
      bubbleClassName="border-emerald-500/30 bg-emerald-500/10"
      iconClassName="border-emerald-500/25 bg-background/80 text-emerald-500"
      hideResultText
    >
      <div className="flex flex-wrap gap-2">{readOutput?.view ? <ToolChip>{readOutput.view}</ToolChip> : null}</div>
      {resourceUrl ? <ToolResourceLink url={resourceUrl} label={resourceLabel} /> : null}
    </ToolCallBubble>
  )
}

function ResolveToolCallBubble({item}: {item: ChatToolPart}) {
  const resolveOutput = getResolveToolOutput(item.rawOutput)
  const sourceUrl = resolveOutput?.inputUrl || getStringArg(item.args, 'url')
  const resolvedUrl = resolveOutput?.resolvedUrl

  return (
    <ToolCallBubble
      item={item}
      icon={Link2}
      label="Resolve URL"
      bubbleClassName="border-violet-500/30 bg-violet-500/10"
      iconClassName="border-violet-500/25 bg-background/80 text-violet-500"
    >
      {sourceUrl ? (
        <div className="bg-background/70 text-muted-foreground rounded-xl border px-2 py-1.5 text-[10px] break-all">
          {sourceUrl}
        </div>
      ) : null}
      {resolvedUrl ? <ToolResourceLink url={resolvedUrl} label={resolvedUrl} /> : null}
    </ToolCallBubble>
  )
}

function NavigateToolCallBubble({item}: {item: ChatToolPart}) {
  const navigateOutput = getNavigateToolOutput(item.rawOutput)
  const resourceUrl = navigateOutput?.resourceUrl || getToolResourceUrl(item)
  const opensInNewWindow = navigateOutput?.newWindow ?? getBooleanArg(item.args, 'newWindow')

  return (
    <ToolCallBubble
      item={item}
      icon={Compass}
      label="Navigate"
      bubbleClassName="border-amber-500/30 bg-amber-500/10"
      iconClassName="border-amber-500/25 bg-background/80 text-amber-500"
    >
      <div className="flex flex-wrap gap-2">
        <ToolChip>{opensInNewWindow ? 'new window' : 'current window'}</ToolChip>
      </div>
      {resourceUrl ? <ToolResourceLink url={resourceUrl} label="Open target" /> : null}
    </ToolCallBubble>
  )
}

function GenericToolCallBubble({item}: {item: ChatToolPart}) {
  const hasArgs = Boolean(item.args && Object.keys(item.args).length > 0)

  return (
    <ToolCallBubble
      item={item}
      icon={Wrench}
      label={item.name}
      bubbleClassName="border-border bg-muted/60"
      iconClassName="border-border bg-background/80 text-muted-foreground"
    >
      {hasArgs ? (
        <div className="bg-background/70 text-muted-foreground rounded-xl border px-2 py-1.5 text-[10px]">
          {Object.entries(item.args!).map(([key, value], index) => (
            <div key={key} className={cn('break-all', index > 0 && 'mt-1')}>
              <span className="font-medium">{key}:</span> {formatCompactValue(value)}
            </div>
          ))}
        </div>
      ) : null}
    </ToolCallBubble>
  )
}

function ToolCallItem({item}: {item: ChatToolPart}) {
  switch (item.name) {
    case 'search':
      return <SearchToolCallBubble item={item} />
    case 'read':
      return <ReadToolCallBubble item={item} />
    case 'resolveUrl':
      return <ResolveToolCallBubble item={item} />
    case 'navigate':
      return <NavigateToolCallBubble item={item} />
    default:
      return <GenericToolCallBubble item={item} />
  }
}
