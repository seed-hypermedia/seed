/**
 * Create an agent: pick a configured provider, pick a model from that provider's live catalogue,
 * name it, and write its system prompt.
 *
 * The desktop dialog writes the prompt in the Seed block editor; `AgentDefinition.systemPrompt`
 * accepts a plain markdown string as well, which is what mobile sends.
 */

import type {AgentDefinition} from '@shm/ui/agents/client'
import {DEFAULT_AGENT_TOOLS} from '@shm/ui/agents/agent-tools'
import {curateProviderModels, modelLabel, pickDefaultProviderModel} from '@shm/ui/agents/model-utils'
import {useCreateAgent, useModelProviders, useProviderModels} from '@shm/ui/agents/models'
import React, {useEffect, useMemo, useState} from 'react'
import {StyleSheet, View} from 'react-native'
import {errorText} from '../screens/AgentsScreen'
import {Button, ErrorNote, Field, Label, OptionList, Sheet} from '../ui/primitives'

const DEFAULT_PROMPT = 'You are a helpful assistant working inside Seed Hypermedia.'

export function CreateAgentSheet({
  visible,
  onClose,
  serverUrl,
  accountUid,
  onCreated,
}: {
  visible: boolean
  onClose: () => void
  serverUrl: string
  accountUid: string
  onCreated: (agentId: string, name: string) => void
}) {
  const providers = useModelProviders(serverUrl, accountUid)
  const createAgent = useCreateAgent(serverUrl, accountUid)

  const [providerName, setProviderName] = useState<string | undefined>()
  const [model, setModel] = useState<string | undefined>()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [error, setError] = useState<string | null>(null)

  // Default to the first configured provider once the list arrives.
  useEffect(() => {
    if (!providerName && providers.data?.length) setProviderName(providers.data[0].name)
  }, [providers.data, providerName])

  const providerType = providers.data?.find((entry) => entry.name === providerName)?.type
  const models = useProviderModels(serverUrl, accountUid, providerName)

  const curated = useMemo(() => curateProviderModels(models.data, providerType), [models.data, providerType])

  // Suggest the provider's flagship rather than whatever sorts first, and re-suggest when the user
  // switches provider — a model id from the previous provider would be rejected on submit.
  useEffect(() => {
    if (!models.data) return
    setModel((current) => {
      if (current && curated.all.some((entry) => entry.id === current)) return current
      return pickDefaultProviderModel(models.data, providerType)?.id
    })
  }, [models.data, providerType, curated.all])

  const submit = () => {
    if (!providerName || !model) {
      setError('Choose a provider and a model first')
      return
    }
    setError(null)
    const definition: AgentDefinition = {
      name: name.trim() || 'Agent',
      systemPrompt: prompt.trim(),
      modelProvider: providerName,
      model,
      tools: DEFAULT_AGENT_TOOLS,
    }
    createAgent.mutate(definition, {
      onSuccess: (response) => {
        if (response._ !== 'CreateAgentResponse') {
          setError('Unexpected response from the agent server')
          return
        }
        onCreated(response.agentId, definition.name)
      },
      onError: (err) => setError(errorText(err)),
    })
  }

  const noProviders = !providers.isLoading && (providers.data?.length ?? 0) === 0

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="New agent"
      footer={
        <Button variant="primary" onPress={submit} busy={createAgent.isLoading} disabled={noProviders}>
          Create
        </Button>
      }
    >
      {noProviders ? (
        <Label size="sm" tone="muted">
          Configure a model provider first — an agent needs one to run.
        </Label>
      ) : (
        <>
          <View style={styles.group}>
            <Label size="sm" tone="muted" weight="600">
              PROVIDER
            </Label>
            <OptionList
              options={(providers.data ?? []).map((entry) => ({
                value: entry.name,
                label: entry.name,
                detail: entry.type,
              }))}
              value={providerName}
              onChange={setProviderName}
              emptyText="Loading providers…"
            />
          </View>

          <View style={styles.group}>
            <Label size="sm" tone="muted" weight="600">
              MODEL
            </Label>
            {models.isLoading ? (
              <Label size="sm" tone="muted">
                Loading models…
              </Label>
            ) : models.error ? (
              <ErrorNote>{errorText(models.error)}</ErrorNote>
            ) : (
              <OptionList
                options={curated.recommended.map((entry) => ({value: entry.id, label: modelLabel(entry)}))}
                value={model}
                onChange={setModel}
                emptyText="This provider reported no chat models."
              />
            )}
          </View>

          <Field label="Name" value={name} onChangeText={setName} placeholder="Agent" autoCapitalize="words" />
          <Field
            label="System prompt"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            autoCapitalize="sentences"
            hint="Markdown. This is the agent's standing instruction, above every conversation."
          />
          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  group: {gap: 8},
})
