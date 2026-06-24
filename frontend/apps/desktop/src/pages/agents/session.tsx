import {
  type AgentRunActivity,
  type AgentRunUsage,
  type AgentSessionTriggerContext,
  type AgentTriggerSource,
  type SessionEvent,
  type SessionInfo,
} from '@/agents-client'
import {
  AssistantMessageParts,
  ChatMessageBubble,
  type ChatBubbleMessage,
} from '@/components/assistant-message-rendering'
import {QueuedChatMessages, useQueuedChatMessages} from '@/components/chat-message-queue'
import {
  addOptimisticSessionMessage,
  type AgentSessionDraftMessage,
  DEFAULT_AGENT_SERVER_URL,
  useAgentDetail,
  useAgentServerUrl,
  useAgentSession,
  useAgentTriggers,
  useAgentWebSocketSubscription,
  useDeleteAgentSession,
  useMessageAgentSession,
  useStopAgentSession,
  useUpdateAgentSession,
} from '@/models/agents'
import {type ChatMessagePart, type ChatToolPart} from '@/models/chat-parts'
import {useSelectedAccountId} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {trimTrailingEmptyBlocks} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {CommentEditor, type CommentEditorSubmitHandle} from '@shm/editor/comment-editor'
import type {NavRoute} from '@shm/shared/routes'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Container, PanelContainer} from '@shm/ui/container'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ArrowDown, ExternalLink, Info, Loader2, ScrollText, Send, Square, Trash2} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AgentHeader, AgentSubpageHeader} from './header'
import {promptBlocksToMarkdown} from './prompt-editor'

function triggerSourceSummary(source: AgentTriggerSource): string {
  if (source.type === 'document-comment') {
    return `Comment in ${source.resource}${source.author ? ` by ${source.author}` : ''}`
  }
  if (source.type === 'user-mention') {
    const legacy = (source as {mentionedAccount?: string}).mentionedAccount
    const accounts = source.mentionedAccounts ?? (legacy ? [legacy] : [])
    const mention = accounts.length ? accounts.map(abbreviateUid).join(', ') : 'anyone'
    return `Mention of ${mention}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
  }
  if (source.type === 'site-update') {
    return `Update in ${source.resourcePrefix}${source.eventTypes?.length ? ` (${source.eventTypes.join(', ')})` : ''}`
  }
  if (source.schedule.kind === 'interval') return `Every ${source.schedule.every} ${source.schedule.unit}`
  if (source.schedule.kind === 'once') return `Once at ${new Date(source.schedule.runAt).toLocaleString()}`
  return `${source.schedule.daysOfWeek
    .map((day) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day])
    .join(', ')} at ${source.schedule.timeOfDay} ${source.schedule.timezone}`
}

function SessionListItem({
  session,
  onOpen,
  onOpenTrigger,
}: {
  session: SessionInfo
  serverUrl: string
  onOpen: () => void
  onOpenTrigger?: () => void
}) {
  return (
    <div className="hover:bg-muted/60 flex flex-col items-start rounded-lg px-3 py-2 transition-colors">
      <button type="button" className="w-full text-left" onClick={onOpen}>
        <SizableText weight="bold">{session.title || 'Untitled session'}</SizableText>
        <SizableText size="sm" color="muted">
          {session.status} · {new Date(session.updatedAt).toLocaleString()}
        </SizableText>
        <SizableText size="xs" color="muted" className="font-mono">
          {session.id}
        </SizableText>
      </button>
      {session.startedByTrigger ? (
        <button
          type="button"
          className="bg-primary/10 text-primary mt-2 rounded-full px-2 py-0.5 text-xs font-bold"
          onClick={(event) => {
            event.stopPropagation()
            onOpenTrigger?.()
          }}
        >
          Triggered by {session.startedByTrigger.triggerName}
        </button>
      ) : null}
    </div>
  )
}

function TriggerContextPopover({
  context,
  onOpenTrigger,
}: {
  context: AgentSessionTriggerContext
  onOpenTrigger: () => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Started by trigger: ${context.triggerName}`}>
          <Info className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="!w-[min(92vw,44rem)]">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <SizableText weight="bold">Started by trigger</SizableText>
              <SizableText size="sm" color="muted" className="block truncate">
                {context.triggerName} · {context.activitySummary}
              </SizableText>
            </div>
            <Button variant="outline" size="sm" onClick={onOpenTrigger}>
              Open trigger
            </Button>
          </div>
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <TriggerDetail label="Source" value={triggerSourceSummary(context.source)} />
            <TriggerDetail label="Activity key" value={context.activityKey} mono />
            <TriggerDetail label="Firing ID" value={context.firingId} mono />
            <TriggerDetail label="Fired at" value={new Date(context.firedAt).toLocaleString()} />
            <TriggerDetail label="Status" value={context.status} />
            {context.error ? <TriggerDetail label="Error" value={context.error} /> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Trigger prompt
              </SizableText>
              <pre className="bg-muted/60 max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                {context.prompt}
              </pre>
            </div>
            <div className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Activity context passed to session
              </SizableText>
              <pre className="bg-muted/60 max-h-60 overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                {JSON.stringify(context.activity, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TriggerDetail({label, value, mono}: {label: string; value: string; mono?: boolean}) {
  return (
    <div className="min-w-0">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <SizableText size="sm" color="muted" className={`block truncate ${mono ? 'font-mono' : ''}`}>
        {value}
      </SizableText>
    </div>
  )
}

function getTriggerActivityRoute(context: AgentSessionTriggerContext): NavRoute | null {
  const blob = recordField(context.activity, 'newBlob')
  if (blob) {
    const blobType = stringField(blob, 'blobType') || stringField(blob, 'blob_type')
    const resource = stringField(blob, 'resource')
    const resourceId = resource ? unpackHmId(resource) : null
    if (blobType === 'Comment' && resourceId) {
      return {key: 'comments', id: resourceId, openComment: stringField(blob, 'blobId') || stringField(blob, 'blob_id')}
    }
    if ((blobType === 'Ref' || blobType === 'Change') && resourceId) {
      return {key: 'document', id: resourceId}
    }
  }

  if (context.source.type === 'document-comment') {
    const id = unpackHmId(context.source.resource)
    return id ? {key: 'comments', id} : null
  }
  if (context.source.type === 'site-update') {
    const id = unpackHmId(context.source.resourcePrefix)
    return id ? {key: 'activity', id} : null
  }
  return null
}

function recordField(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' ? (field as Record<string, unknown>) : null
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field ? field : undefined
}

function AgentSessionPage({
  sessionId,
  routeServerUrl,
  routeAgentId,
}: {
  sessionId: string
  routeServerUrl?: string
  routeAgentId?: string
}) {
  const selectedAccountId = useSelectedAccountId()
  const navigate = useNavigate()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || DEFAULT_AGENT_SERVER_URL
  const session = useAgentSession(serverUrl, selectedAccountId, sessionId)
  const agentId = routeAgentId || session.data?.session.agentId
  const agent = useAgentDetail(serverUrl, selectedAccountId, agentId)
  const triggers = useAgentTriggers(serverUrl, selectedAccountId, agentId)
  const messageSession = useMessageAgentSession(serverUrl, selectedAccountId)
  const stopSession = useStopAgentSession(serverUrl, selectedAccountId)
  const updateSession = useUpdateAgentSession(serverUrl, selectedAccountId)
  const deleteSessionDialog = useAppDialog(DeleteAgentSessionDialog, {isAlert: true})
  const systemPromptDialog = useAppDialog(SystemPromptDialog)
  const lastSeq = session.data?.events.filter((event) => event.seq !== Number.MAX_SAFE_INTEGER).at(-1)?.seq
  const liveState = useAgentWebSocketSubscription(serverUrl, selectedAccountId, `sessions/${sessionId}`, lastSeq)
  const partialAssistantText = liveState.text
  const [titleDraft, setTitleDraft] = useState('')
  const [titleSaveState, setTitleSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesContentRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollingToBottomRef = useRef(false)
  const titleSaveIdRef = useRef(0)
  const loadedSessionId = session.data?.session.id
  const persistedTitle = session.data?.session.title || 'Untitled session'
  const chatRows = useMemo(
    () => buildAgentSessionChatRows(session.data?.events || [], {serverUrl, agentId, sessionId}),
    [agentId, serverUrl, session.data?.events, sessionId],
  )
  const isAgentStreaming = session.data?.session.status === 'streaming'
  const isAgentBusy = messageSession.isPending || isAgentStreaming
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  useEffect(() => {
    // Start the elapsed timer when the agent begins working; clear it when it finishes.
    if (isAgentBusy) setRunStartedAt((prev) => prev ?? Date.now())
    else setRunStartedAt(null)
  }, [isAgentBusy])
  const triggerActivityRoute = useMemo(
    () => (session.data?.triggerContext ? getTriggerActivityRoute(session.data.triggerContext) : null),
    [session.data?.triggerContext],
  )

  const checkIsNearBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true
    const threshold = 100
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom <= threshold
  }, [])

  const handleMessagesScroll = useCallback(() => {
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
    setShowScrollButton(!nearBottom)
  }, [checkIsNearBottom])

  const scrollToBottom = useCallback(() => {
    scrollingToBottomRef.current = true
    setShowScrollButton(false)
    setIsNearBottom(true)
    messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
  }, [])

  const handleMessagesMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (
      target === messagesContainerRef.current ||
      target === messagesContentRef.current ||
      target === messagesEndRef.current
    ) {
    }
  }, [])

  useEffect(() => {
    if (!partialAssistantText) return
    console.info('[agents/ui] rendering streaming assistant partial', {
      sessionId,
      partialLength: partialAssistantText.length,
    })
  }, [partialAssistantText, sessionId])

  useEffect(() => {
    setTitleDraft(persistedTitle)
    setTitleSaveState('idle')
  }, [loadedSessionId])

  useEffect(() => {
    if (titleSaveState === 'idle') setTitleDraft(persistedTitle)
  }, [persistedTitle, titleSaveState])

  useEffect(() => {
    if (!loadedSessionId) return
    const saveId = titleSaveIdRef.current + 1
    titleSaveIdRef.current = saveId
    const title = titleDraft.trim()
    if (!title || title === persistedTitle) {
      setTitleSaveState('idle')
      return
    }
    const timer = setTimeout(() => {
      setTitleSaveState('saving')
      void updateSession
        .mutateAsync({sessionId: loadedSessionId, title})
        .then(() => {
          if (titleSaveIdRef.current !== saveId) return
          setTitleSaveState('saved')
          setTimeout(() => {
            if (titleSaveIdRef.current === saveId) setTitleSaveState('idle')
          }, 1800)
        })
        .catch((error) => {
          if (titleSaveIdRef.current !== saveId) return
          setTitleSaveState('error')
          toast.error(error instanceof Error ? error.message : 'Could not rename session')
        })
    }, 600)
    return () => clearTimeout(timer)
  }, [loadedSessionId, persistedTitle, titleDraft])

  useEffect(() => {
    setIsNearBottom(true)
    setShowScrollButton(false)
    requestAnimationFrame(() => {
      const container = messagesContainerRef.current
      if (container) container.scrollTop = container.scrollHeight
    })
  }, [sessionId])

  useEffect(() => {
    if (isNearBottom) {
      const container = messagesContainerRef.current
      if (container) container.scrollTop = container.scrollHeight
    } else if (partialAssistantText || isAgentBusy || chatRows.length) {
      setShowScrollButton(true)
    }
  }, [chatRows.length, partialAssistantText, isAgentBusy, isNearBottom])

  useEffect(() => {
    const eventId = getSharedEventIdFromHash(window.location.hash)
    if (!eventId || !chatRows.some((row) => row.key === eventId)) return
    requestAnimationFrame(() => document.getElementById(`event-${eventId}`)?.scrollIntoView({block: 'center'}))
  }, [chatRows])

  function openDeleteSessionDialog() {
    if (!session.data) return
    const currentSession = session.data.session
    deleteSessionDialog.open({
      serverUrl,
      selectedAccountId: selectedAccountId ?? null,
      sessionId: currentSession.id,
      sessionTitle: currentSession.title || 'Untitled session',
      onDeleted: () => navigate({key: 'agent', agentId: currentSession.agentId, serverUrl}),
    })
  }

  const doSendAgentMessage = useCallback(
    async (message: AgentSessionDraftMessage | AgentSessionDraftMessage[]) => {
      try {
        const messages = Array.isArray(message) ? message : [message]
        const textLength = messages.map((message) => message.text).join('\n').length
        console.info('[agents/ui] sending session message', {serverUrl, sessionId, textLength})
        if (selectedAccountId) addOptimisticSessionMessage(serverUrl, selectedAccountId, sessionId, message)
        const result = await messageSession.mutateAsync({sessionId, message})
        if (result._ !== 'MessageSessionResponse') throw new Error('Unexpected message response')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not send message')
      }
    },
    [messageSession, selectedAccountId, serverUrl, sessionId],
  )

  const {queuedMessages, queueMessage} = useQueuedChatMessages<AgentSessionDraftMessage>({
    isBusy: isAgentBusy,
    onFlush: doSendAgentMessage,
  })

  async function handleSendMessage(message: AgentSessionDraftMessage) {
    if (isAgentBusy) queueMessage(message)
    else await doSendAgentMessage(message)
  }

  async function handleStopSession() {
    try {
      const result = await stopSession.mutateAsync(sessionId)
      if (!result.stopped) toast.message('No active agent response to stop')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not stop agent response')
    }
  }

  return (
    <PanelContainer className="flex flex-col overflow-hidden">
      <div className="border-border flex-none border-b">
        <Container className="max-w-4xl gap-4 pt-4 pb-4">
          <AgentHeader
            agent={agent.data?.agent}
            agentId={agentId}
            serverUrl={serverUrl}
            activeTab="sessions"
            sessionsCount={agent.data?.sessions.length}
            triggersCount={triggers.data?.length}
            breadcrumbItems={[
              ...(agentId
                ? [{label: 'Sessions', route: {key: 'agent' as const, agentId, serverUrl}}]
                : [{label: 'Sessions'}]),
              {label: titleDraft || persistedTitle},
            ]}
          />
        </Container>
      </div>
      <AgentSubpageHeader
        title={titleDraft}
        placeholder="Untitled session"
        onTitleChange={setTitleDraft}
        saveState={titleSaveState}
        disabled={!session.data}
        backLabel="Back to agent sessions"
        onBack={() => {
          const agentId = session.data?.session.agentId
          navigate(agentId ? {key: 'agent', agentId, serverUrl} : {key: 'agents'})
        }}
        actions={
          <>
            {deleteSessionDialog.content}
            {systemPromptDialog.content}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Show current system prompt"
              onClick={() =>
                systemPromptDialog.open({
                  prompt: session.data?.systemPromptMarkdown || '',
                  updatedAt: session.data?.session.updatedAt,
                })
              }
              disabled={!session.data}
            >
              <ScrollText className="size-4" />
            </Button>
            <OptionsDropdown
              align="end"
              menuItems={[
                {
                  key: 'delete-session',
                  icon: <Trash2 className="size-4" />,
                  label: 'Delete session',
                  variant: 'destructive',
                  onClick: openDeleteSessionDialog,
                },
              ]}
            />
          </>
        }
      >
        {session.data?.triggerContext ? (
          <div className="flex flex-none items-center gap-2">
            <TriggerContextPopover
              context={session.data.triggerContext}
              onOpenTrigger={() =>
                navigate({
                  key: 'agent',
                  agentId: session.data!.session.agentId,
                  serverUrl,
                  tab: 'triggers',
                  triggerId: session.data!.triggerContext!.triggerId,
                })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open triggering comment or document update"
              onClick={() => {
                if (triggerActivityRoute) navigate(triggerActivityRoute)
              }}
              disabled={!triggerActivityRoute}
            >
              <ExternalLink className="size-4" />
            </Button>
          </div>
        ) : null}
      </AgentSubpageHeader>
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col pr-1 pl-4">
        {session.isLoading ? <SizableText color="muted">Loading session…</SizableText> : null}
        {session.isError ? (
          <SizableText className="text-destructive">
            {session.error instanceof Error ? session.error.message : 'Could not load session'}
          </SizableText>
        ) : null}
        {session.data ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              onMouseDown={handleMessagesMouseDown}
              className="min-h-0 flex-1 overflow-y-auto pr-1"
            >
              <div ref={messagesContentRef} className="flex min-h-full flex-col gap-3 pt-4">
                {!chatRows.length ? <SizableText color="muted">No messages yet.</SizableText> : null}
                {chatRows.map((row) => (
                  <div
                    key={row.key}
                    id={`event-${row.key}`}
                    className="target:ring-primary/40 scroll-mt-24 rounded-lg target:ring-2"
                  >
                    <AgentSessionChatRow row={row} />
                  </div>
                ))}
                {partialAssistantText ? <PartialAssistantRow text={partialAssistantText} /> : null}
                {isAgentBusy ? (
                  <AgentRunStatusBar startedAt={runStartedAt} activity={liveState.activity} usage={liveState.usage} />
                ) : null}
                <div ref={messagesEndRef} />
                {showScrollButton ? (
                  <div className="pointer-events-none sticky bottom-2 flex justify-center">
                    <button
                      onClick={scrollToBottom}
                      className="bg-muted border-border text-foreground pointer-events-auto rounded-full border p-1.5 shadow-lg"
                      aria-label="Scroll to latest message"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
            <QueuedChatMessages messages={queuedMessages} getText={(message) => message.text} />
            <AgentRichMessageComposer
              isBusy={isAgentBusy}
              isStreaming={isAgentStreaming}
              stopPending={stopSession.isPending}
              onSend={(message) => void handleSendMessage(message)}
              onStop={() => void handleStopSession()}
            />
          </div>
        ) : null}
      </div>
    </PanelContainer>
  )
}

function SystemPromptDialog({input}: {input: {prompt: string; updatedAt?: number}; onClose: () => void}) {
  return (
    <div className="flex max-w-[min(92vw,42rem)] min-w-[min(92vw,42rem)] flex-col gap-4">
      <div>
        <DialogTitle>Current system prompt</DialogTitle>
        <DialogDescription>
          This is the markdown prompt that will be sent if this session continues now
          {input.updatedAt ? ` (session updated ${new Date(input.updatedAt).toLocaleString()})` : ''}.
        </DialogDescription>
      </div>
      <pre className="bg-muted/60 max-h-[70vh] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
        {input.prompt || 'No system prompt configured.'}
      </pre>
    </div>
  )
}

function DeleteAgentSessionDialog({
  input,
  onClose,
}: {
  input: {
    serverUrl: string
    selectedAccountId: string | null
    sessionId: string
    sessionTitle: string
    onDeleted: () => void
  }
  onClose: () => void
}) {
  const deleteSession = useDeleteAgentSession(input.serverUrl, input.selectedAccountId)

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    try {
      const result = await deleteSession.mutateAsync(input.sessionId)
      if (result._ !== 'DeleteSessionResponse') throw new Error('Unexpected delete response')
      toast.success('Session deleted')
      onClose()
      input.onDeleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete session')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg p-4">
      <AlertDialogTitle>Delete session?</AlertDialogTitle>
      <AlertDialogDescription>
        This will permanently delete “{input.sessionTitle}” and its messages from the agent server. This action cannot
        be undone.
      </AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction asChild>
          <Button
            variant="destructive"
            onClick={(event) => void handleDelete(event)}
            disabled={deleteSession.isLoading}
          >
            <Trash2 className="size-4" />
            Delete session
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  )
}

type CommentEditorSubmitOptions = Parameters<React.ComponentProps<typeof CommentEditor>['submitButton']>[0]

type CommentEditorGetContent = CommentEditorSubmitOptions['getContent']

function AgentRichMessageComposer({
  isBusy,
  isStreaming,
  stopPending,
  onSend,
  onStop,
}: {
  isBusy: boolean
  isStreaming: boolean
  stopPending: boolean
  onSend: (message: AgentSessionDraftMessage) => void
  onStop: () => void
}) {
  const [draftMarkdown, setDraftMarkdown] = useState('')
  const submitHandleRef = useRef<CommentEditorSubmitHandle | null>(null)

  async function submitRichMessage(getContent: CommentEditorGetContent, reset: () => void) {
    const {blockNodes} = await getContent(async () => ({blobs: [], resultCIDs: []}))
    const trimmedBlocks = trimTrailingEmptyBlocks(blockNodes)
    const markdown = promptBlocksToMarkdown(trimmedBlocks)
    if (!markdown.trim()) return
    reset()
    setDraftMarkdown('')
    requestAnimationFrame(() => submitHandleRef.current?.focus({moveCursorToEnd: true}))
    onSend({text: markdown, blocks: trimmedBlocks})
  }

  return (
    <div className="border-border flex items-end gap-2 border-t px-3 py-2">
      <div className="min-w-0 flex-1 font-sans [&_.ProseMirror]:font-sans [&_.ProseMirror]:!text-sm [&_.comment-editor]:!min-h-8 [&_.comment-editor]:!pt-1 [&_.comment-editor]:!pb-1 [&_.comment-editor]:font-sans [&_.comment-editor]:!text-sm [&_.comment-editor_.ProseMirror]:!min-h-0 [&_.comment-editor_.bn-editor]:!min-h-0 [&_.hm-prose]:!text-sm">
        <CommentEditor
          focusOnMount
          hideAvatar
          hideSubmitToolbar
          disableTrailingNode
          submitOnEnter
          submitHandleRef={submitHandleRef}
          initialBlocks={[]}
          onContentChange={(blocks) => setDraftMarkdown(promptBlocksToMarkdown(trimTrailingEmptyBlocks(blocks)))}
          handleSubmit={(getContent, reset) => void submitRichMessage(getContent, reset)}
          submitButton={() => <></>}
        />
      </div>
      <div className="flex shrink-0 gap-1 pb-1">
        {draftMarkdown.trim() ? (
          <Button size="sm" onClick={() => submitHandleRef.current?.submit()} title={isBusy ? 'Queue message' : 'Send'}>
            <Send className="size-3.5" />
          </Button>
        ) : !isBusy ? (
          <Button size="sm" disabled>
            <Send className="size-3.5" />
          </Button>
        ) : null}
        {isStreaming ? (
          <Button size="sm" variant="destructive" onClick={onStop} disabled={stopPending}>
            <Square className="size-3" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

const PartialAssistantRow = React.memo(function PartialAssistantRow({text}: {text: string}) {
  const parts = useMemo<ChatMessagePart[]>(() => [{type: 'text', text}], [text])

  return <AssistantMessageParts parts={parts} isStreaming />
})

/** Formats elapsed milliseconds as m:ss for the live run timer. */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

/** Formats a token count compactly (e.g. 1234 → "1.2k"). */
function formatTokenCount(count: number): string {
  if (count >= 10_000) return `${Math.round(count / 1000)}k`
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k`
  return String(count)
}

/** Human-readable label for the agent's current activity phase. */
function activityLabel(activity?: AgentRunActivity): string {
  switch (activity?.phase) {
    case 'starting':
      return 'Starting…'
    case 'responding':
      return 'Responding…'
    case 'tool':
      return activity.toolName ? `Running ${activity.toolName}…` : 'Running tool…'
    case 'finalizing':
      return 'Finishing…'
    case 'thinking':
      return 'Thinking…'
    default:
      return 'Working…'
  }
}

/** Live status row shown while the agent is working: activity, elapsed time, and token count. */
function AgentRunStatusBar({
  startedAt,
  activity,
  usage,
}: {
  startedAt: number | null
  activity?: AgentRunActivity
  usage?: AgentRunUsage
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [startedAt])
  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt)
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-2 text-xs" aria-live="polite">
      <Loader2 className="size-3.5 shrink-0 animate-spin" />
      <span className="font-medium">{activityLabel(activity)}</span>
      {activity?.detail ? <span className="max-w-64 min-w-0 truncate opacity-75">{activity.detail}</span> : null}
      <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums">
        <span aria-label="Elapsed time">{formatElapsed(elapsed)}</span>
        {usage && usage.total > 0 ? <span aria-label="Tokens used">{formatTokenCount(usage.total)} tokens</span> : null}
      </span>
    </div>
  )
}

type AgentSessionChatRow =
  | {key: string; kind: 'message'; message: ChatBubbleMessage}
  | {key: string; kind: 'error'; message: string}
  | {key: string; kind: 'raw'; event: SessionEvent}

const AgentSessionChatRow = React.memo(function AgentSessionChatRow({row}: {row: AgentSessionChatRow}) {
  if (row.kind === 'message') return <ChatMessageBubble message={row.message} />

  if (row.kind === 'error') {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive mr-6 rounded-lg border px-3 py-2 text-xs">
        <div className="mb-1 font-medium">Error</div>
        <p className="whitespace-pre-wrap">{row.message}</p>
      </div>
    )
  }

  return (
    <pre className="bg-muted mr-6 overflow-auto rounded-lg px-3 py-2 text-xs">
      {JSON.stringify(row.event.event, null, 2)}
    </pre>
  )
})

function buildAgentSessionChatRows(
  events: SessionEvent[],
  context: {serverUrl: string; agentId?: string; sessionId: string},
): AgentSessionChatRow[] {
  const rows: AgentSessionChatRow[] = []
  const toolRowsById = new Map<string, Extract<AgentSessionChatRow, {kind: 'message'}>>()

  for (const event of events) {
    const payload = event.event as {
      type?: string
      role?: string
      content?: string
      message?: string
      id?: string
      toolCallId?: string
      name?: string
      input?: unknown
      output?: unknown
      error?: string
      rawMarkdown?: string
      blocks?: HMBlockNode[]
    }

    if (payload.type === 'message' && typeof payload.content === 'string') {
      rows.push({
        key: event.id,
        kind: 'message',
        message: {
          role: payload.role,
          content: payload.content,
          rawMarkdown: typeof payload.rawMarkdown === 'string' ? payload.rawMarkdown : payload.content,
          blocks: Array.isArray(payload.blocks) ? payload.blocks : undefined,
          eventId: event.id,
          sessionId: event.sessionId,
          seq: event.seq,
          shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
        },
      })
      continue
    }

    if (payload.type === 'tool_call' && typeof payload.id === 'string' && typeof payload.name === 'string') {
      const toolPart: ChatToolPart = {
        type: 'tool',
        id: payload.id,
        name: payload.name,
        args: isRecord(payload.input) ? payload.input : {input: payload.input},
      }
      const row: Extract<AgentSessionChatRow, {kind: 'message'}> = {
        key: event.id,
        kind: 'message',
        message: {
          role: 'assistant',
          parts: [toolPart],
          eventId: event.id,
          sessionId: event.sessionId,
          seq: event.seq,
          shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
        },
      }
      rows.push(row)
      toolRowsById.set(payload.id, row)
      continue
    }

    if (payload.type === 'tool_result' && typeof payload.toolCallId === 'string' && typeof payload.name === 'string') {
      const existingRow = toolRowsById.get(payload.toolCallId)
      const resultText = payload.error || getToolResultSummary(payload.output)
      const resultPart: ChatToolPart = {
        type: 'tool',
        id: payload.toolCallId,
        name: payload.name,
        result: resultText,
        rawOutput: payload.output,
      }

      if (existingRow) {
        existingRow.message = {
          ...existingRow.message,
          parts: [{...((existingRow.message.parts?.[0] as ChatToolPart | undefined) || resultPart), ...resultPart}],
        }
      } else {
        rows.push({
          key: event.id,
          kind: 'message',
          message: {
            role: 'assistant',
            parts: [resultPart],
            eventId: event.id,
            sessionId: event.sessionId,
            seq: event.seq,
            shareUrl: buildAgentSessionEventUrl(context.serverUrl, context.agentId, context.sessionId, event.id),
          },
        })
      }
      continue
    }

    if (payload.type === 'error') {
      rows.push({
        key: event.id,
        kind: 'error',
        message: payload.message || payload.error || payload.content || 'Unknown agent error',
      })
      continue
    }

    rows.push({key: event.id, kind: 'raw', event})
  }

  return rows
}

function buildAgentSessionEventUrl(
  serverUrl: string,
  agentId: string | undefined,
  sessionId: string,
  eventId: string,
): string | undefined {
  if (!agentId) return undefined
  return `${serverUrl.replace(/\/+$/, '')}/agents/${encodeURIComponent(agentId)}/sessions/${encodeURIComponent(
    sessionId,
  )}#event=${encodeURIComponent(eventId)}`
}

function getSharedEventIdFromHash(hash: string): string | null {
  const match = hash.match(/^#event=(.+)$/)
  return match ? decodeURIComponent(match[1] || '') : null
}

function getToolResultSummary(output: unknown): string {
  if (isRecord(output)) {
    if (typeof output.summary === 'string') return output.summary
    if (typeof output.title === 'string') return output.title
  }
  return 'Complete'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export default function AgentSessionRoutePage() {
  const route = useNavRoute()
  if (route.key !== 'agent-session') return null
  return <AgentSessionPage sessionId={route.sessionId} routeServerUrl={route.serverUrl} routeAgentId={route.agentId} />
}
