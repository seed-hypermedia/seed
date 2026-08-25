/**
 * One agent: its model, its prompt, and its conversations.
 *
 * v1 of the mobile port covers the Sessions tab — the reason a person opens an agent. The desktop
 * page's other five tabs (triggers, memory, tools, prompt editing, collaborators) are management
 * surfaces and come later; what is here is read-only about configuration and complete about
 * conversations.
 */

import type {NativeStackNavigationProp} from '@react-navigation/native-stack'
import type {SessionInfo} from '@shm/ui/agents/client'
import {useAgentDetail, useAgentWebSocketSubscription, useCreateAgentSession} from '@shm/ui/agents/models'
import React from 'react'
import {RefreshControl, ScrollView, StyleSheet, View} from 'react-native'
import type {RootStackParamList} from '../../navigation/types'
import {theme} from '../../theme'
import {useAgentsAccount} from '../account'
import {formatRelativeTime} from '../format'
import {sessionStatusTone} from '../session-status'
import {Badge, Button, Card, ErrorNote, Label, Section, StatePanel, StatusDot} from '../ui/primitives'
import {errorText} from './AgentsScreen'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Agent'>
  route: {params: {agentId: string; serverUrl: string; title?: string}}
}

export function AgentScreen({navigation, route}: Props) {
  const {agentId, serverUrl} = route.params
  const accountUid = useAgentsAccount()

  const detail = useAgentDetail(serverUrl, accountUid, agentId)
  const createSession = useCreateAgentSession(serverUrl, accountUid)

  // Live agent-scoped updates: a session created or renamed elsewhere, or a status change as a run
  // progresses, refreshes this list without polling it into the ground.
  useAgentWebSocketSubscription(serverUrl, accountUid, `agents/${agentId}`)

  const agent = detail.data?.agent
  const sessions = detail.data?.sessions ?? []

  const startSession = () => {
    createSession.mutate(
      {agentId},
      {
        onSuccess: (response) => {
          if (response._ !== 'CreateSessionResponse') return
          navigation.navigate('AgentSession', {
            sessionId: response.sessionId,
            serverUrl,
            agentId,
            title: agent?.definition.name,
          })
        },
      },
    )
  }

  if (accountUid === undefined || (detail.isLoading && !detail.data)) {
    return <StatePanel loading />
  }
  if (detail.error) {
    return <StatePanel title="Could not load this agent" detail={errorText(detail.error)} />
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={detail.isFetching && !detail.isLoading}
          onRefresh={() => void detail.refetch()}
          tintColor={theme.mutedForeground}
        />
      }
    >
      {agent ? (
        <Card>
          <Label size="lg" weight="700">
            {agent.definition.name || 'Untitled agent'}
          </Label>
          <View style={styles.metaRow}>
            <Badge>{agent.definition.model}</Badge>
            <Label size="xs" tone="muted">
              {agent.definition.modelProvider}
            </Label>
          </View>
          {typeof agent.definition.systemPrompt === 'string' && agent.definition.systemPrompt ? (
            <Label size="sm" tone="muted" numberOfLines={4}>
              {agent.definition.systemPrompt}
            </Label>
          ) : null}
        </Card>
      ) : null}

      <Section
        title="Conversations"
        action={
          <Button
            size="sm"
            variant="primary"
            onPress={startSession}
            busy={createSession.isLoading}
            testID="new-session-button"
          >
            New
          </Button>
        }
      >
        {createSession.error ? <ErrorNote>{errorText(createSession.error)}</ErrorNote> : null}
        {sessions.length === 0 ? (
          <Card>
            <Label size="sm" tone="muted">
              No conversations yet. Start one to talk to this agent.
            </Label>
          </Card>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onPress={() =>
                navigation.navigate('AgentSession', {
                  sessionId: session.id,
                  serverUrl,
                  agentId,
                  title: agent?.definition.name,
                })
              }
            />
          ))
        )}
      </Section>
    </ScrollView>
  )
}

function SessionRow({session, onPress}: {session: SessionInfo; onPress: () => void}) {
  return (
    <Card onPress={onPress} testID={`session-row-${session.id}`}>
      <View style={styles.rowBetween}>
        <Label size="md" weight="600" numberOfLines={1} style={styles.flex}>
          {session.title || 'Untitled conversation'}
        </Label>
        <StatusDot tone={sessionStatusTone(session.status)} />
      </View>
      <Label size="xs" tone="muted">
        {formatRelativeTime(session.updatedAt ?? session.createdAt)}
      </Label>
    </Card>
  )
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: theme.background},
  content: {padding: 16, gap: 24},
  metaRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  rowBetween: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10},
  flex: {flex: 1},
})
