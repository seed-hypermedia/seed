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
import {useResource} from '@shm/shared/models/entity'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {SizableText} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ArrowDown, Bot, Loader2, MessageCirclePlus, Send, Square, Trash2} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AssistantMessageParts, ChatMessageBubble} from './assistant-message-rendering'
import {ChatMessageComposer} from './chat-message-composer'
import {QueuedChatMessages, useQueuedChatMessages} from './chat-message-queue'

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
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  const doSendMessage = useCallback(
    async (content: string | string[]) => {
      const sessionId = await ensureSessionId()
      sendMessage.mutate({
        sessionId,
        content,
        providerId: activeProviderId,
        documentContext,
      })
    },
    [activeProviderId, documentContext, sendMessage, ensureSessionId],
  )

  const {queuedMessages, queueMessage} = useQueuedChatMessages({isBusy, onFlush: doSendMessage})

  async function handleSend() {
    if (!input.trim()) return
    const content = input.trim()
    setInput('')
    if (isBusy) {
      queueMessage(content)
    } else {
      doSendMessage(content)
    }
  }

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
          <option value="">Select a session…</option>
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
                  <span>Thinking…</span>
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

      <QueuedChatMessages messages={queuedMessages} />

      {/* Input */}
      <ChatMessageComposer
        textareaRef={inputRef}
        placeholder={isBusy ? 'Type to queue a message…' : 'Type a message…'}
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
              {input.trim() && (
                <Button size="sm" onClick={handleSend} title="Queue message">
                  <Send className="size-3.5" />
                </Button>
              )}
              <Button size="sm" variant="destructive" onClick={stopStream}>
                <Square className="size-3" />
              </Button>
            </div>
          ) : undefined
        }
      />
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
