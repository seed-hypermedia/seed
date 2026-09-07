import {Notice} from '@shm/ui/notice'
import {toast} from '@shm/ui/toast'
import {useMemo} from 'react'
import type {AgentDefinition, AgentModelRef, SessionModelOverride} from './client'
import {useModelProviders, useUpdateAgent, useUpdateAgentSession} from './models'
import {ProviderModelSelect} from './provider-model-select'
import {coerceReasoningLevel} from './reasoning-select'

/**
 * The provider a session would run its next turn on — the session's override if it has one, else
 * the agent's own — when that provider no longer exists on the server. `null` while the provider
 * list is still loading or refetching (a stale list must not declare a provider gone), and when
 * everything resolves.
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
  modelOverride: SessionModelOverride | null | undefined
}): string | null {
  const providers = useModelProviders(input.serverUrl, input.accountUid, input.agentId)
  return useMemo(() => {
    if (!input.definition || !providers.data || providers.isFetching) return null
    const effective = input.modelOverride?.provider || input.definition.modelProvider
    if (!effective) return null
    return providers.data.some((provider) => provider.name === effective) ? null : effective
  }, [input.definition, input.modelOverride?.provider, providers.data, providers.isFetching])
}

/**
 * Replaces the composer while the session's provider is missing: names the provider that went
 * away and, for writers, offers the picker that repairs it. Picking a pair fixes whichever
 * reference was broken — the session override if that was it, otherwise the agent definition
 * itself (so every session of the agent recovers, not just this one).
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
  const agentProviderGone = !providerNames.has(definition.modelProvider)
  const overrideGone = !!modelOverride && !providerNames.has(modelOverride.provider)

  async function choose(entry: AgentModelRef) {
    if (!entry.provider || !entry.model) return
    const providerType = providers.data?.find((provider) => provider.name === entry.provider)?.type
    try {
      if (overrideGone && !agentProviderGone) {
        // Only this session's pin was broken; the agent itself is fine. Re-pin it, or let the session
        // follow the agent again when the pick is the agent's own pair.
        const isAgentPair = entry.provider === definition.modelProvider && entry.model === definition.model
        const level = coerceReasoningLevel(providerType, entry.model, modelOverride?.reasoningLevel)
        await updateSession.mutateAsync({
          sessionId,
          modelOverride: isAgentPair ? null : {...entry, ...(level ? {reasoningLevel: level} : {})},
        })
        return
      }
      // The agent's own provider is gone: repair the definition, dropping quick-switch entries that
      // point at providers which no longer exist and keeping the chosen pair switchable.
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
      // A broken override on top of a broken agent would still block the session; the agent's new
      // pair is the one the user just chose, so the session simply follows it.
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
