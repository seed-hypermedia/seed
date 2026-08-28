/**
 * The agents index: the configured server, its health, and every agent on it.
 *
 * The desktop index groups agents under multiple servers; a phone gets one server at a time with a
 * change-server affordance, because the multi-server grouping is a management view and the thing a
 * person opens this screen to do is start talking to an agent.
 */

import type {NativeStackNavigationProp} from '@react-navigation/native-stack'
import {useAgentList, useAgentServerHealth, useAgentServerUrl, useSetAgentServerUrl} from '@shm/ui/agents/models'
import type {AgentInfo} from '@shm/ui/agents/client'
import {normalizeAgentServerUrl} from '@shm/ui/agents/client'
import React, {useState} from 'react'
import {RefreshControl, ScrollView, StyleSheet, View} from 'react-native'
import {theme} from '../../theme'
import type {RootStackParamList} from '../../navigation/types'
import {useAgentsAccount} from '../account'
import {CreateAgentSheet} from '../components/CreateAgentSheet'
import {ProvidersSheet} from '../components/ProvidersSheet'
import {Badge, Button, Card, ErrorNote, Field, Label, Section, Sheet, StatePanel, StatusDot} from '../ui/primitives'

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Agents'>
}

export function AgentsScreen({navigation}: Props) {
  const accountUid = useAgentsAccount()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = serverUrlQuery.data ?? undefined

  const health = useAgentServerHealth(serverUrl)
  const agents = useAgentList(serverUrl, accountUid)

  const [showServerSheet, setShowServerSheet] = useState(false)
  const [showProviders, setShowProviders] = useState(false)
  const [showCreate, setShowCreate] = useState(false)

  // The vault is still opening. Distinct from "no identity" — showing the create-identity prompt
  // during the load would blink on every launch.
  if (accountUid === undefined) {
    return <StatePanel loading />
  }

  if (!accountUid) {
    return (
      <StatePanel
        title="No identity yet"
        detail="Agent servers only accept signed requests, so agents need an identity to act as."
        action={
          <Button variant="primary" onPress={() => navigation.navigate('CreateIdentity')}>
            Create an identity
          </Button>
        }
      />
    )
  }

  const healthTone = health.isLoading ? 'idle' : health.data ? 'active' : 'error'
  const healthText = health.isLoading ? 'Checking…' : health.data ? 'Online' : 'Offline'

  return (
    <>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={agents.isFetching && !agents.isLoading}
            onRefresh={() => {
              void health.refetch()
              void agents.refetch()
            }}
            tintColor={theme.mutedForeground}
          />
        }
      >
        <Section
          title="Agent server"
          action={
            <Button size="sm" variant="ghost" onPress={() => setShowServerSheet(true)}>
              Change
            </Button>
          }
        >
          <Card>
            <View style={styles.rowBetween}>
              <Label size="sm" numberOfLines={1} style={styles.flex}>
                {serverUrl ?? 'Not configured'}
              </Label>
              <View style={styles.statusRow}>
                <StatusDot tone={healthTone} />
                <Label size="xs" tone="muted">
                  {healthText}
                </Label>
              </View>
            </View>
            <View style={styles.buttonRow}>
              <Button size="sm" onPress={() => setShowProviders(true)} testID="agents-providers-button">
                Model providers
              </Button>
            </View>
            {health.error ? <ErrorNote>{errorText(health.error)}</ErrorNote> : null}
          </Card>
        </Section>

        <Section
          title="Agents"
          action={
            <Button size="sm" variant="primary" onPress={() => setShowCreate(true)} testID="agents-create-button">
              New agent
            </Button>
          }
        >
          {agents.isLoading ? (
            <Card>
              <Label size="sm" tone="muted">
                Loading agents…
              </Label>
            </Card>
          ) : agents.error ? (
            <ErrorNote>{errorText(agents.error)}</ErrorNote>
          ) : (agents.data?.length ?? 0) === 0 ? (
            <Card>
              <Label size="sm" weight="600">
                No agents on this server yet
              </Label>
              <Label size="sm" tone="muted">
                Configure a model provider, then create an agent to start a conversation.
              </Label>
            </Card>
          ) : (
            agents.data?.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                onPress={() =>
                  navigation.navigate('Agent', {agentId: agent.id, serverUrl: serverUrl!, title: agent.definition.name})
                }
              />
            ))
          )}
        </Section>
      </ScrollView>

      <ServerSheet visible={showServerSheet} onClose={() => setShowServerSheet(false)} currentUrl={serverUrl} />
      {serverUrl ? (
        <ProvidersSheet
          visible={showProviders}
          onClose={() => setShowProviders(false)}
          serverUrl={serverUrl}
          accountUid={accountUid}
        />
      ) : null}
      {serverUrl ? (
        <CreateAgentSheet
          visible={showCreate}
          onClose={() => setShowCreate(false)}
          serverUrl={serverUrl}
          accountUid={accountUid}
          onCreated={(agentId, name) => {
            setShowCreate(false)
            navigation.navigate('Agent', {agentId, serverUrl, title: name})
          }}
        />
      ) : null}
    </>
  )
}

function AgentRow({agent, onPress}: {agent: AgentInfo; onPress: () => void}) {
  return (
    <Card onPress={onPress} testID={`agent-row-${agent.id}`}>
      <View style={styles.rowBetween}>
        <Label size="md" weight="600" numberOfLines={1} style={styles.flex}>
          {agent.definition.name || 'Untitled agent'}
        </Label>
        <Badge>{agent.definition.model}</Badge>
      </View>
      <Label size="xs" tone="muted" numberOfLines={1}>
        {agent.definition.modelProvider}
      </Label>
    </Card>
  )
}

function ServerSheet({visible, onClose, currentUrl}: {visible: boolean; onClose: () => void; currentUrl?: string}) {
  const [draft, setDraft] = useState(currentUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const setServerUrl = useSetAgentServerUrl()

  const save = () => {
    try {
      // Normalize before saving so a typo like a trailing /agents fails here, with the field still
      // open, rather than as a mysterious offline light on the index.
      normalizeAgentServerUrl(draft)
    } catch (err) {
      setError(errorText(err))
      return
    }
    setError(null)
    setServerUrl.mutate(draft, {onSuccess: onClose, onError: (err) => setError(errorText(err))})
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Agent server"
      footer={
        <Button variant="primary" onPress={save} busy={setServerUrl.isLoading}>
          Save
        </Button>
      }
    >
      <Field
        label="Server URL"
        value={draft}
        onChangeText={setDraft}
        placeholder="https://agentic.seed.hyper.media"
        keyboardType="url"
        hint="The agents runtime this device talks to. Your identity signs every request it sends."
        testID="agents-server-url-input"
      />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
    </Sheet>
  )
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: theme.background},
  content: {padding: 16, gap: 24},
  rowBetween: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  buttonRow: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
})
