import {agentAccessCanChat, agentAccessCanWrite} from './access'
import {type AgentRunActivity, type AgentSessionTriggerContext} from './client'
import {AgentRunStatusBar, useRunStartedAt} from './agent-run-status'
import {SessionSummaryBanner} from './session-children'
import {
  ContextUsageMeter,
  ContinuationHandoffCard,
  ContinuationHeader,
  sessionContextTokens,
  useFollowContinuation,
} from './continuation'
import {useChatAutoScroll} from './chat-autoscroll'
import {describeAgentError} from './errors'
import {AgentErrorRow, AssistantMessageParts, ChatMessageBubble} from './message-rendering'
import {
  addOptimisticSessionMessage,
  type AgentSessionDraftMessage,
  getDefaultAgentServerUrl,
  useAgentAccountsSync,
  useAgentDetail,
  useAgentServerUrl,
  useAgentSession,
  useAgentTriggers,
  useAgentWebSocketSubscription,
  useDeleteAgentSession,
  useMessageAgentSession,
  useRetrySession,
  useRun,
  useSessionRuns,
  useStopAgentSession,
  useUpdateAgentSession,
} from './models'
import {
  buildAgentSessionChatRows,
  interleaveRunRecords,
  mergeConsecutiveToolMessageRows,
  buildAgentSessionUrl,
  chatRowHasPendingToolCall,
  frozenRunIds,
  getSharedEventIdFromHash,
  retryableErrorRowKey,
  type AgentSessionChatRow as AgentSessionChatRowData,
} from './agent-session-rows'
import {type ChatMessagePart} from './chat-parts'
import {useSelectedAccountId} from './account'
import {useNavigate} from './navigation'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DialogTitle} from '@shm/ui/components/dialog'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Container, PanelContainer} from '@shm/ui/container'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ArrowDown, CornerLeftUp, ExternalLink, Info, Link2, ScrollText, Trash2} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {AgentHeader, AgentSubpageHeader, SessionModelBadge} from './header'
import {RunRecordCard, SessionRunCard} from './run-card'
import {AgentRichMessageComposer, SubSessionDrivenNotice, TERMINAL_RUN_STATUSES} from './rich-message-composer'
import {getTriggerActivityRoute, summarizeTriggerSource, TriggerContextView} from './trigger-types'

/**
 * Header affordance for a sub-session: where it came from. Whether the parent is still driving is
 * told at the composer, where the answer to "why can't I type?" belongs (see
 * {@link SubSessionDrivenNotice}).
 */
function SubSessionHeader({parentTitle, onOpenParent}: {parentTitle?: string; onOpenParent: () => void}) {
  return (
    <div className="flex flex-none flex-col gap-2 pt-3">
      <button
        type="button"
        className="bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground flex max-w-full items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-xs"
        onClick={onOpenParent}
        title="Open the parent session"
      >
        <CornerLeftUp className="size-3 flex-none" />
        <span className="min-w-0 truncate">{parentTitle || 'Parent session'}</span>
      </button>
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
            <TriggerDetail label="Source" value={summarizeTriggerSource(context.source)} />
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
  const serverUrl = routeServerUrl || serverUrlQuery.data || getDefaultAgentServerUrl() || ''
  const session = useAgentSession(serverUrl, selectedAccountId, sessionId)
  const agentId = routeAgentId || session.data?.session.agentId
  const agent = useAgentDetail(serverUrl, selectedAccountId, agentId)
  const triggers = useAgentTriggers(serverUrl, selectedAccountId, agentId)
  const messageSession = useMessageAgentSession(serverUrl, selectedAccountId)
  const stopSession = useStopAgentSession(serverUrl, selectedAccountId)
  const updateSession = useUpdateAgentSession(serverUrl, selectedAccountId)
  const deleteSessionDialog = useAppDialog(DeleteAgentSessionDialog, {isAlert: true})
  const systemPromptDialog = useAppDialog(SystemPromptDialog, {
    className: 'w-[min(44rem,calc(100vw-2rem))] max-h-[85vh]',
  })
  const lastSeq = session.data?.events.filter((event) => event.seq !== Number.MAX_SAFE_INTEGER).at(-1)?.seq
  // The subscription waits for the initial GetSession: subscribing with no afterSeq makes the
  // server replay the whole transcript over the socket on top of the fetch.
  const liveState = useAgentWebSocketSubscription(
    serverUrl,
    selectedAccountId,
    session.data ? `sessions/${sessionId}` : undefined,
    lastSeq ?? 0,
  )
  // Account-wide events too: run changes publish on `runs/<rootRunId>` and agent/trigger changes on
  // their own keys, none of which the session subscription receives — and with no polling, these
  // events are what keep the run state and agent header fresh here.
  useAgentWebSocketSubscription(
    serverUrl,
    selectedAccountId,
    selectedAccountId ? `account/${selectedAccountId}` : undefined,
  )
  const partialAssistantText = liveState.text
  const [titleDraft, setTitleDraft] = useState('')
  const [titleSaveState, setTitleSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const autoScroll = useChatAutoScroll()
  const titleSaveIdRef = useRef(0)
  const loadedSessionId = session.data?.session.id
  // No name at all until the record arrives — "Untitled session" while loading would present a
  // placeholder as if it were the session's actual name.
  const persistedTitle = session.data ? session.data.session.title || 'Untitled session' : ''
  const sessionRuns = useSessionRuns(serverUrl, selectedAccountId, sessionId)
  const chatRows = useMemo(
    () =>
      mergeConsecutiveToolMessageRows(
        interleaveRunRecords(
          buildAgentSessionChatRows(session.data?.events || [], {
            serverUrl,
            agentId,
            sessionId,
            triggerContext: session.data?.triggerContext ?? null,
          }),
          sessionRuns.data || [],
          // A model-driven agent keeps its checklist on the session, not on the run, so the freeze
          // decision needs it here for the same reason the pinned card does.
          session.data?.session.plan,
        ),
      ),
    [
      agentId,
      serverUrl,
      session.data?.events,
      session.data?.session.plan,
      session.data?.triggerContext,
      sessionId,
      sessionRuns.data,
    ],
  )
  // Which runs the scroll already owns, so the pinned slot does not tell the same story twice.
  const frozenRuns = useMemo(() => frozenRunIds(chatRows), [chatRows])
  // Chatters (public chat) may send and retry; only owners/writers may rename, delete, control
  // runs, or run session tools.
  const canChat = !!agent.data && agentAccessCanChat(agent.data.agent.accessRole)
  const canWrite = !!agent.data && agentAccessCanWrite(agent.data.agent.accessRole)
  const isAgentStreaming = session.data?.session.status === 'streaming'
  const isAgentBusy = messageSession.isPending || isAgentStreaming
  const retrySession = useRetrySession(serverUrl, selectedAccountId)
  // Deliberately not gated on the mutation being in flight: the button stays put and shows its
  // pending state until the retried run actually starts streaming, which is what removes the row.
  const retryableRowKey = canChat ? retryableErrorRowKey(chatRows, !!isAgentBusy) : undefined
  const runStartedAt = useRunStartedAt(isAgentBusy)
  // Sub-session affordances: the parent is loaded only for its title/route, and the child's own run
  // to tell "still being driven by the parent" from "finished, yours to continue". That run is a
  // child in the parent's tree, so it is reachable by id (SessionInfo.runId), not by ListRuns.
  const parentSessionId = session.data?.session.parentSessionId
  const parentSession = useAgentSession(serverUrl, selectedAccountId, parentSessionId)
  const ownRun = useRun(serverUrl, selectedAccountId, parentSessionId ? session.data?.session.runId : undefined)
  const hasLiveRun = !!ownRun.data && !TERMINAL_RUN_STATUSES.has(ownRun.data.status)
  const isDrivenByParent = !!parentSessionId && (isAgentStreaming || hasLiveRun)
  // Continuation: follow the turn into its successor when this client was watching it, and show
  // how full the model's context is so a coming continuation is no surprise.
  const sessionInfo = session.data?.session
  const openSuccessor = useCallback(
    (successorId: string) => navigate({key: 'agent-session', agentId, sessionId: successorId, serverUrl}),
    [agentId, navigate, serverUrl],
  )
  const followContinuation = useFollowContinuation({
    session: sessionInfo,
    isStreaming: !!isAgentStreaming,
    onFollow: useCallback((link) => openSuccessor(link.sessionId), [openSuccessor]),
  })
  const contextTokens = useMemo(() => sessionContextTokens(session.data?.events), [session.data?.events])
  const triggerActivityRoute = useMemo(
    () => (session.data?.triggerContext ? getTriggerActivityRoute(session.data.triggerContext) : null),
    [session.data?.triggerContext],
  )

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
    autoScroll.resetToBottom()
  }, [sessionId])

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
        let messages = Array.isArray(message) ? message : [message]
        const textLength = messages.map((message) => message.text).join('\n').length
        console.info('[agents/ui] sending session message', {serverUrl, sessionId, textLength})
        // The stamped drafts carry the clientMessageIds the optimistic rows were keyed with, so the
        // server's echo replaces those rows instead of rendering beside them.
        if (selectedAccountId) messages = addOptimisticSessionMessage(serverUrl, selectedAccountId, sessionId, messages)
        followContinuation.markFollowing()
        const result = await messageSession.mutateAsync({sessionId, message: messages})
        if (result._ !== 'MessageSessionResponse') throw new Error('Unexpected message response')
        if (result.continuedToSessionId) {
          followContinuation.followNow({
            continuationId: '',
            sessionId: result.continuedToSessionId,
            reason: 'other',
            createdAt: Date.now(),
          })
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not send message')
      }
    },
    [followContinuation, messageSession, selectedAccountId, serverUrl, sessionId],
  )

  async function handleSendMessage(message: AgentSessionDraftMessage) {
    await doSendAgentMessage(message)
  }

  const handleRetrySession = useCallback(() => {
    retrySession.mutate(sessionId, {
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not retry this turn'),
    })
  }, [retrySession, sessionId])

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
              {label: titleDraft || persistedTitle || '…'},
            ]}
          />
        </Container>
      </div>
      <AgentSubpageHeader
        title={titleDraft}
        placeholder="Untitled session"
        onTitleChange={setTitleDraft}
        saveState={titleSaveState}
        disabled={!session.data || !canWrite}
        loading={session.isLoading}
        backLabel="Back to agent sessions"
        onBack={() => {
          const agentId = session.data?.session.agentId
          navigate(agentId ? {key: 'agent', agentId, serverUrl} : {key: 'agents'})
        }}
        actions={
          <>
            {deleteSessionDialog.content}
            {systemPromptDialog.content}
            <ContextUsageMeter tokens={contextTokens} contextWindow={session.data?.contextWindow} className="mr-1" />
            <SessionModelBadge
              agent={agent.data?.agent}
              agentId={session.data?.session.agentId ?? agentId}
              serverUrl={serverUrl}
              sessionId={sessionId}
              modelOverride={session.data?.session.modelOverride}
              canWrite={canWrite}
            />
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
                  key: 'copy-session-url',
                  icon: <Link2 className="size-4" />,
                  label: 'Copy session URL',
                  disabled: !agentId,
                  onClick: () => {
                    const url = buildAgentSessionUrl(serverUrl, agentId, sessionId)
                    if (!url) return
                    void navigator.clipboard?.writeText(url)
                    toast.success('Session URL copied')
                  },
                },
                ...(canWrite
                  ? [
                      {
                        key: 'delete-session',
                        icon: <Trash2 className="size-4" />,
                        label: 'Delete session',
                        variant: 'destructive' as const,
                        onClick: openDeleteSessionDialog,
                      },
                    ]
                  : []),
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
          <SessionLoadNotice
            error={session.error}
            onRetry={() => void session.refetch()}
            retryPending={session.isFetching}
          />
        ) : null}
        {session.data ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {parentSessionId ? (
              <SubSessionHeader
                parentTitle={parentSession.data?.session.title}
                onOpenParent={() =>
                  navigate({
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
                link={sessionInfo.continuedFrom}
                onOpenPredecessor={() => openSuccessor(sessionInfo.continuedFrom!.sessionId)}
              />
            ) : null}
            <SessionSummaryBanner description={session.data.session.description} />
            <div
              ref={autoScroll.containerRef}
              onScroll={autoScroll.handleScroll}
              className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1"
            >
              <div ref={autoScroll.contentRef} className="flex min-h-full flex-col gap-3 pt-4">
                {!chatRows.length ? <SizableText color="muted">No messages yet.</SizableText> : null}
                {chatRows.map((row) => (
                  <div
                    key={row.key}
                    id={`event-${row.key}`}
                    className="target:ring-primary/40 scroll-mt-24 rounded-lg target:ring-2"
                  >
                    <AgentSessionChatRow
                      row={row}
                      serverUrl={serverUrl}
                      agentId={agentId}
                      accountUid={selectedAccountId}
                      liveActivity={chatRowHasPendingToolCall(row) ? liveState.activity : undefined}
                      onRetry={row.key === retryableRowKey ? handleRetrySession : undefined}
                      retryPending={retrySession.isPending}
                      onOpenSession={(childSessionId, childAgentId) =>
                        navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
                      }
                    />
                  </div>
                ))}
                {partialAssistantText ? <PartialAssistantRow text={partialAssistantText} /> : null}
                {isAgentBusy && !(liveState.activity?.phase === 'tool' && chatRows.some(chatRowHasPendingToolCall)) ? (
                  // Hidden while a pending tool row is showing its own live status, to avoid two spinners.
                  <AgentRunStatusBar startedAt={runStartedAt} activity={liveState.activity} usage={liveState.usage} />
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
              serverUrl={serverUrl}
              accountUid={selectedAccountId}
              sessionId={sessionId}
              sessionPlan={session.data.session.plan}
              frozenRunIds={frozenRuns}
              readOnly={!canWrite}
              onOpenSession={(childSessionId, childAgentId) =>
                navigate({key: 'agent-session', agentId: childAgentId, sessionId: childSessionId, serverUrl})
              }
            />
            <AgentRichMessageComposer
              isBusy={isAgentBusy}
              isStreaming={isAgentStreaming}
              disabledMessage={
                !canChat ? (
                  'You have read-only access to this agent.'
                ) : isDrivenByParent ? (
                  <SubSessionDrivenNotice
                    parentTitle={parentSession.data?.session.title}
                    onOpenParent={() =>
                      navigate({
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
              accountId={selectedAccountId ?? null}
              sessionId={sessionId}
              agentTools={agent.data?.agent.definition.tools}
              agentToolsLoading={agent.isLoading}
              canInvokeTools={canWrite}
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
    // The dialog frame (useAppDialog's className) owns the width; forcing one here can only
    // disagree with the frame, and any disagreement renders as a horizontal scrollbar.
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <DialogTitle>Current System Prompt</DialogTitle>
      </div>
      {/* overflow-y only: long unbroken tokens (URLs, addresses) break instead of dragging the
          whole dialog into a horizontal scroll. */}
      <pre className="bg-muted/60 max-h-[70vh] min-w-0 overflow-y-auto rounded-md p-3 text-xs break-words whitespace-pre-wrap">
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

const PartialAssistantRow = React.memo(function PartialAssistantRow({text}: {text: string}) {
  const parts = useMemo<ChatMessagePart[]>(() => [{type: 'text', text}], [text])

  return <AssistantMessageParts parts={parts} isStreaming />
})

const AgentSessionChatRow = React.memo(function AgentSessionChatRow({
  row,
  serverUrl,
  agentId,
  accountUid,
  liveActivity,
  onRetry,
  retryPending,
  onOpenSession,
}: {
  row: AgentSessionChatRowData
  serverUrl: string
  agentId?: string
  accountUid?: string | null
  liveActivity?: AgentRunActivity
  /** Set only on a trailing error row, which is the only place a retry is offered. */
  onRetry?: () => void
  retryPending?: boolean
  onOpenSession?: (sessionId: string, agentId?: string) => void
}) {
  if (row.kind === 'message') {
    if (row.triggerContext) {
      // First message of a triggered session: render the human prompt (if any) and a friendly
      // trigger card instead of the raw <trigger_context> text that is sent to the model.
      return (
        <div className="flex flex-col gap-1.5">
          {row.message.content?.trim() || row.message.blocks?.length ? (
            <ChatMessageBubble
              message={row.message}
              liveActivity={liveActivity}
              serverUrl={serverUrl}
              accountUid={accountUid}
              agentId={agentId}
            />
          ) : null}
          <TriggerContextView
            context={row.triggerContext}
            instructions={row.triggerInstructions}
            serverUrl={serverUrl}
            agentId={agentId}
          />
        </div>
      )
    }
    return (
      <ChatMessageBubble
        message={row.message}
        liveActivity={liveActivity}
        serverUrl={serverUrl}
        accountUid={accountUid}
        agentId={agentId}
      />
    )
  }

  if (row.kind === 'error') {
    return <AgentErrorRow message={row.message} onRetry={onRetry} retryPending={retryPending} />
  }

  if (row.kind === 'run-record') {
    // The pinned card's afterlife: the same card, frozen at the moment the run completed.
    return (
      <RunRecordCard
        serverUrl={serverUrl}
        accountUid={accountUid}
        runId={row.run.id}
        plan={row.plan}
        onOpenSession={onOpenSession}
      />
    )
  }

  if (row.kind === 'continuation') {
    // What this session started from: the handoff, readable and inspectable, in place of the raw
    // projection text the model was given.
    return (
      <ContinuationHandoffCard
        id="continuation-handoff"
        projection={row.projection}
        onOpenPredecessor={onOpenSession ? (predecessorId) => onOpenSession(predecessorId) : undefined}
      />
    )
  }

  return (
    <pre className="bg-muted mr-6 overflow-auto rounded-lg px-3 py-2 text-xs">
      {JSON.stringify(row.event.event, null, 2)}
    </pre>
  )
})

function SessionLoadNotice({
  error,
  onRetry,
  retryPending,
}: {
  error: unknown
  onRetry: () => void
  retryPending: boolean
}) {
  const notice = describeAgentError(error, {failed: 'Couldn’t load this session'})
  return (
    <Notice tone={notice.tone} title={notice.title} onRetry={onRetry} retryPending={retryPending} className="my-4">
      {notice.detail}
    </Notice>
  )
}

export default function AgentSessionRoutePage() {
  const route = useNavRoute()
  // Keep every account this account's agents can author as synced locally, so they are
  // immediately mentionable and openable elsewhere in the app.
  useAgentAccountsSync()
  if (route.key !== 'agent-session') return null
  return <AgentSessionPage sessionId={route.sessionId} routeServerUrl={route.serverUrl} routeAgentId={route.agentId} />
}
