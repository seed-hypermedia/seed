import {useAIConfig, useSetAIConfigValue} from '@/models/ai-config'
import {
  useChatSession,
  useChatSessions,
  useChatStream,
  useCreateChatSession,
  useDeleteChatSession,
  useSendChatMessage,
} from '@/models/chat'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {ArrowDown, Bot, Check, Eye, EyeOff, Plus, Send, Settings, Trash2, Wrench} from 'lucide-react'
import {useCallback, useEffect, useRef, useState} from 'react'
import {Markdown} from './markdown'

export function AssistantPanel({
  initialSessionId,
  onSessionChange,
}: {
  initialSessionId?: string | null
  onSessionChange?: (sessionId: string | null) => void
}) {
  const [view, setView] = useState<'chat' | 'settings'>('chat')

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
          onClick={() => setView(view === 'chat' ? 'settings' : 'chat')}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
        </button>
      </div>
      {view === 'settings' ? (
        <SettingsView />
      ) : (
        <ChatView initialSessionId={initialSessionId} onSessionChange={onSessionChange} />
      )}
    </div>
  )
}

function SettingsView() {
  const aiConfig = useAIConfig()
  const setConfigValue = useSetAIConfigValue()
  const existingKey = aiConfig.data?.providers?.openai?.apiKey ?? ''
  const [draft, setDraft] = useState('')
  const [showKey, setShowKey] = useState(false)

  function handleSave() {
    if (!draft.trim()) return
    setConfigValue.mutate({path: 'providers.openai.apiKey', value: draft.trim()}, {onSuccess: () => setDraft('')})
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <SizableText size="sm" className="font-medium">
        OpenAI API Key
      </SizableText>
      {existingKey ? (
        <div className="flex items-center gap-2">
          <code className="bg-muted flex-1 truncate rounded px-2 py-1 text-xs">
            {showKey ? existingKey : `${existingKey.slice(0, 7)}${'*'.repeat(20)}`}
          </code>
          <button onClick={() => setShowKey((s) => !s)} className="text-muted-foreground hover:text-foreground">
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      ) : (
        <SizableText size="xs" className="text-muted-foreground">
          No API key configured
        </SizableText>
      )}
      <div className="flex items-center gap-2">
        <Input
          type="password"
          placeholder="sk-..."
          value={draft}
          onChangeText={setDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
          }}
          className="flex-1 text-xs"
        />
        <Button size="sm" onClick={handleSave} disabled={!draft.trim() || setConfigValue.isLoading}>
          <Check className="size-4" />
        </Button>
      </div>
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
  const {streamingText, isStreaming, streamComplete, pendingToolCalls, pendingToolResults, clearStream} =
    useChatStream(selectedSessionId)
  const [input, setInput] = useState('')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  async function handleSend() {
    if (!input.trim() || isBusy) return
    let sessionId = selectedSessionId
    if (!sessionId) {
      const newSession = await createSession.mutateAsync(undefined)
      sessionId = newSession.id
      setSelectedSessionId(sessionId)
    }
    const content = input.trim()
    setInput('')
    sendMessage.mutate({sessionId, content})
  }

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
      {/* Session selector */}
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
            {pendingToolCalls && pendingToolCalls.length > 0 && (
              <div className="my-1">
                {pendingToolCalls.map((tc) => (
                  <ToolCallDisplay key={tc.id} name={tc.name} args={tc.args} />
                ))}
              </div>
            )}
            {pendingToolResults && pendingToolResults.length > 0 && (
              <div className="my-1">
                {pendingToolResults.map((tr) => (
                  <ToolResultDisplay key={tr.id} name={tr.name} result={tr.result} />
                ))}
              </div>
            )}
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

      {/* Input */}
      <div className="border-border flex items-center gap-2 border-t px-3 py-2">
        <Input
          ref={inputRef}
          placeholder="Type a message..."
          value={input}
          onChangeText={setInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
              requestAnimationFrame(() => inputRef.current?.focus())
            }
          }}
          disabled={isBusy}
          className="flex-1 text-xs"
        />
        <Button size="sm" onClick={handleSend} disabled={!input.trim() || isBusy}>
          <Send className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function ChatMessageBubble({message}: {message: any}) {
  const isUser = message.role === 'user'

  return (
    <div className="my-1.5">
      {message.toolCalls?.map((tc: any) => <ToolCallDisplay key={tc.id} name={tc.name} args={tc.args} />)}
      {message.toolResults?.map((tr: any) => <ToolResultDisplay key={tr.id} name={tr.name} result={tr.result} />)}
      <div
        className={`rounded-lg px-3 py-2 text-xs ${
          isUser ? 'bg-primary text-primary-foreground ml-6' : 'bg-muted mr-6'
        }`}
      >
        {isUser ? <p className="whitespace-pre-wrap">{message.content}</p> : <Markdown>{message.content}</Markdown>}
      </div>
    </div>
  )
}

function ToolCallDisplay({name, args}: {name: string; args: Record<string, unknown>}) {
  return (
    <div className="bg-muted/50 border-border my-1 flex items-start gap-2 rounded border px-2 py-1.5 text-xs">
      <Wrench className="text-muted-foreground mt-0.5 size-3 shrink-0" />
      <div>
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground ml-1">({JSON.stringify(args)})</span>
      </div>
    </div>
  )
}

function ToolResultDisplay({name, result}: {name: string; result: string}) {
  return (
    <div className="bg-muted/50 border-border my-1 flex items-start gap-2 rounded border px-2 py-1.5 text-xs">
      <Check className="text-muted-foreground mt-0.5 size-3 shrink-0" />
      <div>
        <span className="font-medium">{name}</span>
        <span className="text-muted-foreground ml-1">{result}</span>
      </div>
    </div>
  )
}
