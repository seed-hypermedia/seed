/**
 * Model providers for one agent server.
 *
 * Lists what is configured (always redacted — the server never returns a key) and adds one. The
 * desktop dialog additionally offers OAuth subscription sign-in; that flow needs the app to catch a
 * loopback redirect, which a phone cannot do, so mobile offers API-key providers only and says so.
 */

import {PROVIDER_METADATA} from '@shm/ui/agents/provider-registry'
import type {ModelProviderType} from '@shm/ui/agents/client'
import {isSafeAgentServerSecretTarget} from '@shm/ui/agents/client'
import {useModelProviders, useSaveModelProvider} from '@shm/ui/agents/models'
import React, {useState} from 'react'
import {StyleSheet, View} from 'react-native'
import {errorText} from '../screens/AgentsScreen'
import {Button, Card, ErrorNote, Field, Label, OptionList, Sheet} from '../ui/primitives'

// Every provider type the shared registry knows, ordered so the common ones come first.
const PROVIDER_TYPES: ModelProviderType[] = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'deepseek',
  'groq',
  'xai',
  'ollama',
  'custom',
]

export function ProvidersSheet({
  visible,
  onClose,
  serverUrl,
  accountUid,
}: {
  visible: boolean
  onClose: () => void
  serverUrl: string
  accountUid: string
}) {
  const providers = useModelProviders(serverUrl, accountUid)
  const saveProvider = useSaveModelProvider(serverUrl, accountUid)

  const [type, setType] = useState<ModelProviderType>('anthropic')
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const meta = PROVIDER_METADATA[type]
  // The agents client refuses to put a key on the wire to a remote plain-HTTP server. Saying so up
  // front beats letting the user type a secret into a field that is going to reject it.
  const secretsAllowed = isSafeAgentServerSecretTarget(serverUrl)

  const chooseType = (next: ModelProviderType) => {
    setType(next)
    setError(null)
    // Prefill from the registry, but never clobber a name the user typed themselves.
    if (!name || name === PROVIDER_METADATA[type].label) setName(PROVIDER_METADATA[next].label)
    setBaseUrl(PROVIDER_METADATA[next].showBaseUrlField ? PROVIDER_METADATA[next].defaultBaseUrl : '')
  }

  const save = () => {
    setError(null)
    saveProvider.mutate(
      {type, name: name.trim() || meta.label, apiKey, baseUrl: baseUrl.trim() || undefined},
      {
        onSuccess: () => {
          setApiKey('')
          setError(null)
        },
        onError: (err) => setError(errorText(err)),
      },
    )
  }

  const canSave = (!meta.requiresApiKey || apiKey.trim().length > 0) && !(meta.requiresApiKey && !secretsAllowed)

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Model providers"
      footer={
        <Button variant="primary" onPress={save} busy={saveProvider.isLoading} disabled={!canSave}>
          Save provider
        </Button>
      }
    >
      <View style={styles.group}>
        <Label size="sm" tone="muted" weight="600">
          CONFIGURED
        </Label>
        {providers.isLoading ? (
          <Label size="sm" tone="muted">
            Loading…
          </Label>
        ) : (providers.data?.length ?? 0) === 0 ? (
          <Label size="sm" tone="muted">
            None yet. An agent needs one to run.
          </Label>
        ) : (
          providers.data?.map((provider) => (
            <Card key={provider.name}>
              <Label size="sm" weight="600">
                {provider.name}
              </Label>
              <Label size="xs" tone="muted">
                {provider.type}
                {provider.authMode === 'subscription' ? ' · subscription' : ''}
              </Label>
            </Card>
          ))
        )}
      </View>

      <View style={styles.group}>
        <Label size="sm" tone="muted" weight="600">
          ADD A PROVIDER
        </Label>
        <OptionList
          options={PROVIDER_TYPES.map((value) => ({value, label: PROVIDER_METADATA[value].label}))}
          value={type}
          onChange={chooseType}
        />
        <Field label="Name" value={name} onChangeText={setName} placeholder={meta.label} />
        {meta.showBaseUrlField ? (
          <Field
            label="Base URL"
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder={meta.defaultBaseUrl || 'https://…'}
            keyboardType="url"
          />
        ) : null}
        <Field
          label={meta.requiresApiKey ? 'API key' : 'API key (optional)'}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder="sk-…"
          secure
          hint={
            secretsAllowed
              ? 'Encrypted on the server and never returned by the API.'
              : 'This server is plain HTTP and not local, so it cannot receive an API key. Use HTTPS.'
          }
        />
        {meta.subscription ? (
          <Label size="xs" tone="muted">
            {meta.subscription.label} sign-in is desktop-only — it needs to catch a redirect on a local port. Use an API
            key here.
          </Label>
        ) : null}
        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  group: {gap: 8},
})
