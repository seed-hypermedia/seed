import {Notice} from '@shm/ui/notice'
import {toast} from '@shm/ui/toast'
import {useMemo} from 'react'
import type {AgentDefinition, AgentModelRef, SessionModelOverride} from './client'
import {useModelProviders, useUpdateAgent, useUpdateAgentSession} from './models'
import {ProviderModelSelect} from './provider-model-select'
import {coerceReasoningLevel} from './reasoning-select'

/**
 * The agent's own provider name when it no longer exists on the server, else `null`. A session
 * override pointing at a missing provider does not count: the runtime ignores such an override
 * and runs the agent's pair (and deleting a provider clears those overrides server-side), so
 * only the agent's provider decides whether the next turn can run. `null` while the provider
 * list is still loading or refetching — a stale list must not declare a provider gone.
 *
 * A deleted provider used to surface only as a failed run ("Model provider not found") after the
 * message was already sent. The session instead stops here, before the send, until someone picks
 * a provider that exists.
 */
export function useMissingSessionProvider(input: {
  serverUrl: string
  accountUid: string | null | undefined
  agentId: string | undefined
  definition: AgentDefinition | undefined
}): string | null {
  const providers = useModelProviders(input.serverUrl, input.accountUid, input.agentId)
  return useMemo(() => {
    if (!input.definition || !providers.data || providers.isFetching) return null
    const name = input.definition.modelProvider
    if (!name) return null
    return providers.data.some((provider) => provider.name === name) ? null : name
  }, [input.definition, providers.data, providers.isFetching])
}

/**
 * Replaces the composer while the agent's provider is missing: names the provider that went away
 * and, for writers, offers the picker that repairs the agent definition itself, so every session
 * of the agent recovers, not just this one. A session override left pointing at a missing provider
 * is cleared along the way so the session plainly follows the repaired agent.
 */
export function SessionProviderGate({
  serverUrl,
  accountUid,
  agentId,
  sessionId,
  definition,
  modelOverride,
  missingProvider,
  canWrite,
}: {
  serverUrl: string
  accountUid: string | null | undefined
  agentId: string
  sessionId: string
  definition: AgentDefinition
  modelOverride: SessionModelOverride | null | undefined
  missingProvider: string
  canWrite: boolean
}) {
  const providers = useModelProviders(serverUrl, accountUid, agentId)
  const updateAgent = useUpdateAgent(serverUrl, accountUid)
  const updateSession = useUpdateAgentSession(serverUrl, accountUid)
  const pending = updateAgent.isLoading || updateSession.isLoading

  const providerNames = new Set((providers.data ?? []).map((provider) => provider.name))
  const overrideGone = !!modelOverride && !providerNames.has(modelOverride.provider)

  async function choose(entry: AgentModelRef) {
    if (!entry.provider || !entry.model) return
    const providerType = providers.data?.find((provider) => provider.name === entry.provider)?.type
    try {
      // Repair the definition, dropping quick-switch entries that point at providers which no
      // longer exist and keeping the chosen pair switchable.
      const enabledModels = (definition.enabledModels ?? []).filter((item) => providerNames.has(item.provider))
      if (!enabledModels.some((item) => item.provider === entry.provider && item.model === entry.model)) {
        enabledModels.push(entry)
      }
      const level = coerceReasoningLevel(providerType, entry.model, definition.reasoningLevel)
      const {reasoningLevel: _previousLevel, ...rest} = definition
      await updateAgent.mutateAsync({
        agentId,
        definition: {
          ...rest,
          modelProvider: entry.provider,
          model: entry.model,
          enabledModels,
          ...(level ? {reasoningLevel: level} : {}),
        },
      })
      // A stale override would keep showing a model that never runs; the agent's new pair is the
      // one the user just chose, so the session simply follows it.
      if (overrideGone) await updateSession.mutateAsync({sessionId, modelOverride: null})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not set the model')
    }
  }

  return (
    <Notice tone="warning" title="Choose a model to continue">
      <div className="flex flex-col gap-2">
        <span>
          The provider “{missingProvider}” this session was using is no longer configured on this server.
          {canWrite
            ? ' Pick a provider and model to keep going.'
            : ' The agent’s owner needs to choose a new provider before this conversation can continue.'}
        </span>
        {canWrite ? (
          <div className="max-w-sm">
            <ProviderModelSelect
              serverUrl={serverUrl}
              accountUid={accountUid}
              agentId={agentId}
              value={{provider: '', model: ''}}
              onChange={(entry) => void choose(entry)}
              disabled={pending}
            />
          </div>
        ) : null}
      </div>
    </Notice>
  )
}
