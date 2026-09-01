/**
 * One conversation — the shared log, live.
 *
 * Data flow matches the desktop session page, because the properties that make it trustworthy come
 * from the shape rather than the styling:
 *
 *   - **durable-first.** The transcript is `GetSession`'s durable events and the run tree is
 *     `ListRuns`; the WebSocket only animates them. Backgrounding the app and returning rebuilds
 *     the same screen from the server rather than from whatever was in memory.
 *   - **optimistic sends.** The user's message appears immediately, stamped with a client id the
 *     server echoes on the durable event, so the pending row is replaced by identity rather than by
 *     matching text the server has re-serialized.
 *   - **one spinner.** The run status is suppressed while a pending tool row is already showing its
 *     own live state, so the screen never claims two things are happening.
 */

import type {NativeStackNavigationProp} from '@react-navigation/native-stack'
import type {RunInfo} from '@shm/ui/agents/client'
import {
  addOptimisticSessionMessage,
  useAgentRunTreeSubscription,
  useAgentSession,
  useAgentWebSocketSubscription,
  useCancelRun,
  useMessageAgentSession,
  useRetrySession,
  useRunTree,
  useSessionRuns,
  useSignalRun,
  useStopAgentSession,
} from '@shm/ui/agents/models'
import {buildAgentSessionChatRows, frozenRunIds, interleaveRunRecords} from '@shm/ui/agents/agent-session-rows'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View} from 'react-native'
import type {RootStackParamList} from '../../navigation/types'
import {theme} from '../../theme'
import {useAgentsAccount} from '../account'
import {Composer} from '../components/Composer'
import {ErrorRow, MessageRow, StreamingRow} from '../components/MessageRow'
import {RunCard} from '../components/RunCard'
import {isRunLive, resolvePinnedPlan} from '../session-status'
import {Button, Label, StatePanel} from '../ui/primitives'
import {errorText} from './AgentsScreen'
import {openUrlFromAgents} from '../open-url'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'AgentSession'>
  route: {params: {sessionId: string; serverUrl: string; agentId?: string; title?: string}}
}

export function AgentSessionScreen({navigation, route}: Props) {
  const {sessionId, serverUrl, agentId} = route.params
  const accountUid = useAgentsAccount()

  const session = useAgentSession(serverUrl, accountUid, sessionId)
  const sendMessage = useMessageAgentSession(serverUrl, accountUid)
  const stopSession = useStopAgentSession(serverUrl, accountUid)
  const retrySession = useRetrySession(serverUrl, accountUid)

  // Live durable appends and streamed assistant text for this session.
  const live = useAgentWebSocketSubscription(serverUrl, accountUid, `sessions/${sessionId}`)

  const sessionInfo = session.data?.session
  const events = useMemo(() => session.data?.events ?? [], [session.data])

  const runs = useSessionRuns(serverUrl, accountUid, sessionId)
  // ListRuns {sessionId} returns only root runs; the newest is the turn the card is about.
  const rootRun = runs.data?.[runs.data.length - 1]
  const runTree = useRunTree(serverUrl, accountUid, rootRun?.rootRunId)
  const runLive = useAgentRunTreeSubscription(serverUrl, accountUid, rootRun?.rootRunId)

  // Prefer the socket's snapshot of a run over the last fetch: the card should animate, and the
  // durable list is only refetched on an interval.
  const treeRuns: RunInfo[] = useMemo(() => {
    const byId = new Map<string, RunInfo>()
    for (const run of runTree.data ?? []) byId.set(run.id, run)
    for (const run of Object.values(runLive.runs)) byId.set(run.id, run)
    return Array.from(byId.values())
  }, [runTree.data, runLive.runs])

  const currentRun = rootRun ? treeRuns.find((run) => run.id === rootRun.id) ?? rootRun : undefined
  const busy = !!currentRun && isRunLive(currentRun.status)
  // Parked is not working. The run holds no resources and may be waiting on *you*; the card says so
  // and carries the Answer button, so the composer must not also claim the agent is mid-reply.
  const parked = currentRun?.status === 'waiting'

  const rows = useMemo(() => {
    const chatRows = buildAgentSessionChatRows(events, {serverUrl, agentId, sessionId})
    // EVERY root run of this session, not just the current turn's tree: each finished turn freezes
    // its own card into the scroll, and feeding only the live tree would make previous turns' cards
    // vanish the moment a new turn starts.
    return interleaveRunRecords(chatRows, runs.data ?? [], sessionInfo?.plan)
  }, [events, serverUrl, agentId, sessionId, runs.data, sessionInfo?.plan])

  const pinnedPlan = useMemo(() => resolvePinnedPlan(currentRun, sessionInfo?.plan), [currentRun, sessionInfo?.plan])

  // A run whose story already froze into the transcript must not also be pinned above the composer,
  // or the same turn is told twice.
  const frozen = useMemo(() => frozenRunIds(rows), [rows])
  const showPinnedCard = !!currentRun && !frozen.has(currentRun.id) && (busy || treeRuns.length > 1 || !!pinnedPlan)

  const scrollRef = useRef<ScrollView>(null)
  const [atBottom, setAtBottom] = useState(true)
  // Follow the conversation while the reader is at the bottom; never yank them back if they have
  // scrolled up to read something.
  useEffect(() => {
    if (atBottom) scrollRef.current?.scrollToEnd({animated: true})
  }, [rows.length, live.text, atBottom])

  const cancelRun = useCancelRun(serverUrl, accountUid)
  const signalRun = useSignalRun(serverUrl, accountUid)

  const submit = useCallback(
    (text: string) => {
      if (!accountUid) return
      const drafts = addOptimisticSessionMessage(serverUrl, accountUid, sessionId, {text})
      sendMessage.mutate({sessionId, message: drafts})
    },
    [accountUid, serverUrl, sessionId, sendMessage],
  )

  useEffect(() => {
    navigation.setOptions({title: sessionInfo?.title || route.params.title || 'Conversation'})
  }, [navigation, sessionInfo?.title, route.params.title])

  if (accountUid === undefined || (session.isLoading && !session.data)) {
    return <StatePanel loading />
  }
  if (session.error) {
    return <StatePanel title="Could not load this conversation" detail={errorText(session.error)} />
  }

  // A sub-session is driven by its parent; replacing the composer says so rather than leaving a
  // text box that would be rejected.
  const drivenByParent = !!sessionInfo?.parentSessionId

  // The last row is an error and nothing is running — the only place a retry belongs.
  const trailing = rows[rows.length - 1]
  const showRetry = !busy && trailing?.kind === 'error'

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.log}
        contentContainerStyle={styles.logContent}
        keyboardDismissMode="interactive"
        onScroll={({nativeEvent}) => {
          const distanceFromBottom =
            nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y
          setAtBottom(distanceFromBottom < 80)
        }}
        scrollEventThrottle={100}
      >
        {rows.length === 0 && !live.text ? (
          <Label size="sm" tone="muted" style={styles.empty}>
            Say something to start this conversation.
          </Label>
        ) : null}

        {rows.map((row) => {
          switch (row.kind) {
            case 'message':
              return <MessageRow key={row.key} message={row.message} onOpenUrl={openUrlFromAgents} />
            case 'error':
              return (
                <ErrorRow
                  key={row.key}
                  message={row.message}
                  action={
                    showRetry && row.key === trailing?.key ? (
                      <Button size="sm" onPress={() => retrySession.mutate(sessionId)} busy={retrySession.isLoading}>
                        Retry
                      </Button>
                    ) : undefined
                  }
                />
              )
            case 'run-record':
              return (
                <RunCard
                  key={row.key}
                  run={row.run}
                  plan={row.plan}
                  children={treeRuns.filter((run) => run.id !== row.run.id && run.rootRunId === row.run.rootRunId)}
                  onOpenChild={(child) => openChildSession(navigation, child, serverUrl)}
                />
              )
            case 'continuation':
              return (
                <Label key={row.key} size="sm" tone="muted" style={styles.empty}>
                  Continued from{' '}
                  {row.projection.predecessorTitle ? `“${row.projection.predecessorTitle}”` : 'the previous session'}
                  {' — '}
                  {row.projection.handoffMarkdown.split('\n').find((line) => line && !line.startsWith('#')) ?? ''}
                </Label>
              )
            default:
              return null
          }
        })}

        {live.text ? <StreamingRow text={live.text} /> : null}
      </ScrollView>

      {showPinnedCard && currentRun ? (
        <View style={styles.pinned}>
          <RunCard
            run={currentRun}
            plan={pinnedPlan}
            children={treeRuns.filter((run) => run.id !== currentRun.id)}
            onCancel={() => cancelRun.mutate(currentRun.rootRunId)}
            onAnswer={(signal) => signalRun.mutate({runId: currentRun.id, signal})}
            onOpenChild={(child) => openChildSession(navigation, child, serverUrl)}
          />
        </View>
      ) : null}

      {drivenByParent ? (
        <View style={styles.drivenNotice}>
          <Label size="sm" tone="muted">
            This sub-session is being driven by its parent — watch, or open the parent to intervene.
          </Label>
        </View>
      ) : (
        <Composer
          onSubmit={submit}
          busy={busy && !parked}
          activity={live.activity?.phase}
          onStop={() => stopSession.mutate(sessionId)}
          error={sendMessage.error ? errorText(sendMessage.error) : undefined}
        />
      )}
    </KeyboardAvoidingView>
  )
}

/** Opens a child run's own transcript, when it has one (workflow children have no session). */
function openChildSession(
  navigation: NativeStackNavigationProp<RootStackParamList, 'AgentSession'>,
  child: RunInfo,
  serverUrl: string,
): void {
  if (!child.sessionId) return
  navigation.push('AgentSession', {
    sessionId: child.sessionId,
    serverUrl,
    agentId: child.agentId,
    title: child.title,
  })
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: theme.background},
  log: {flex: 1},
  logContent: {padding: 16, gap: 14},
  empty: {textAlign: 'center', paddingVertical: 32},
  pinned: {paddingHorizontal: 12, paddingBottom: 8},
  drivenNotice: {padding: 16, borderTopWidth: 1, borderTopColor: theme.border},
})
