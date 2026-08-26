import {sendAgentAction, type AgentDefinition, type AgentInfo, type ModelProviderInfo} from '@shm/ui/agents/client'
import {ASSISTANT_DEFAULT_TOOLS} from '@shm/ui/agents/agent-tools'
import {pickDefaultProviderModel} from '@shm/ui/agents/model-utils'
import type {ProviderModelInfo} from '@shm/ui/agents/client'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {useEffect, useMemo, useRef} from 'react'
import {useAgentLists, useLocalAgentServerUrl, useModelProviders, useProviderModels} from '@shm/ui/agents/models'

/**
 * Auto-provisioning for the built-in local Assistant.
 *
 * The assistant sidebar is a session view over the Agents service, so on a fresh install there is
 * nothing to chat with until an agent exists — without this, every assistant entry point stays
 * hidden and the sidebar silently disappears for users upgrading from the old assistant. Once the
 * local server has a model provider configured, an agent named "Assistant" is created for the
 * account. It is a completely ordinary agent: users can edit or delete it from the Agents page,
 * and deleting it is respected (see `LOCAL_ASSISTANT_REQUEST_ID`).
 *
 * Creation deliberately waits for a model provider: `CreateAgent` rejects definitions whose
 * provider does not exist, so provisioning any earlier would just fail.
 */

export const LOCAL_ASSISTANT_NAME = 'Assistant'

/**
 * Deterministic idempotency key for the bootstrap `CreateAgent`.
 *
 * Two windows racing on first launch dedupe server-side instead of creating two Assistants. And
 * because the server remembers the key per account, a user who deletes the Assistant does not get
 * it recreated on next launch — the replayed request returns the original (now deleted) agent id
 * instead of creating a new row. Deletion is a real choice; honor it.
 */
export const LOCAL_ASSISTANT_REQUEST_ID = 'local-assistant-bootstrap-v1'

/** Persona for the built-in agent. The service appends the shared Seed assistant prompt itself. */
export const LOCAL_ASSISTANT_SYSTEM_PROMPT =
  'You are the built-in assistant of this Seed desktop app. Help the user find, read, and understand content on their Hypermedia node.'

/** Builds the definition for the auto-provisioned Assistant on the local server. */
export function buildLocalAssistantDefinition(modelProvider: string, model: string): AgentDefinition {
  return {
    name: LOCAL_ASSISTANT_NAME,
    systemPrompt: LOCAL_ASSISTANT_SYSTEM_PROMPT,
    modelProvider,
    model,
    // Search-only callables; the verbs cover reading and memory. No signing key, so hm://
    // publishing stays blocked: local writes-as-the-user are a separate, deliberate step (plan D5).
    tools: [...ASSISTANT_DEFAULT_TOOLS],
  }
}

/** Decision input for {@link resolveLocalAssistantProvisioning}, decoupled from react-query. */
export type LocalAssistantProvisioningInput = {
  serverUrl: string | null | undefined
  accountUid: string | null | undefined
  /** Agents on the local server; undefined while still loading or failed. */
  agents: AgentInfo[] | undefined
  /** Providers on the local server; undefined while still loading or failed. */
  providers: ModelProviderInfo[] | undefined
  /** Models of the first provider; undefined while still loading or failed. */
  providerModels: ProviderModelInfo[] | undefined
}

/**
 * Decides whether to create the Assistant now, returning the definition to create or null.
 *
 * Null means "not now": missing prerequisites, still loading, or an agent already exists. The
 * caller re-evaluates whenever inputs change, so waiting states resolve themselves.
 */
export function resolveLocalAssistantProvisioning(input: LocalAssistantProvisioningInput): AgentDefinition | null {
  if (!input.serverUrl || !input.accountUid) return null
  if (!input.agents || input.agents.length > 0) return null
  const provider = input.providers?.[0]
  if (!provider) return null
  const model = pickDefaultProviderModel(input.providerModels, provider.type)?.id
  if (!model) return null
  return buildLocalAssistantDefinition(provider.name, model)
}

/**
 * Ensures the local agents server has the built-in Assistant for the selected account.
 *
 * Mounted once per window from the main page. At most one creation attempt per mount: on failure
 * (including losing the race to another window) the agent lists are refreshed and the outcome is
 * left to stand rather than retried in a loop.
 */
export function useEnsureLocalAssistantAgent(accountUid: string | null | undefined) {
  const localServerUrl = useLocalAgentServerUrl()
  const serverUrl = localServerUrl.data || undefined
  const serverUrls = useMemo(() => (serverUrl ? [serverUrl] : []), [serverUrl])
  const agentsQuery = useAgentLists(serverUrls, accountUid)[0]
  const providers = useModelProviders(serverUrl, accountUid)
  const firstProviderName = providers.data?.[0]?.name
  const providerModels = useProviderModels(serverUrl, accountUid, firstProviderName)
  // One attempt per (server, account) — switching accounts must provision the new account, but a
  // failed attempt for the same one must not retry in a loop.
  const attemptedForRef = useRef<string | null>(null)

  const definition = resolveLocalAssistantProvisioning({
    serverUrl,
    accountUid,
    agents: agentsQuery?.isSuccess ? agentsQuery.data : undefined,
    providers: providers.isSuccess ? providers.data : undefined,
    providerModels: providerModels.isSuccess ? providerModels.data : undefined,
  })

  useEffect(() => {
    if (!definition || !serverUrl || !accountUid) return
    const attemptKey = `${serverUrl} ${accountUid}`
    if (attemptedForRef.current === attemptKey) return
    attemptedForRef.current = attemptKey
    void (async () => {
      try {
        await sendAgentAction({
          serverUrl,
          accountUid,
          action: {_: 'CreateAgent', definition, clientRequestId: LOCAL_ASSISTANT_REQUEST_ID},
        })
      } catch (error) {
        // Likely lost a race to another window (definition drift shows up as a 409) — the refresh
        // below picks up whatever agent that window created.
        console.warn('Local Assistant provisioning did not complete', error)
      }
      invalidateQueries(['agents'])
    })()
  }, [definition, serverUrl, accountUid])
}
