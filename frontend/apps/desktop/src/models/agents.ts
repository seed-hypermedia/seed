import {
  getAgentServerHealth,
  getAgentWebSocketUrl,
  isSafeAgentServerSecretTarget,
  normalizeAgentServerUrl,
  sendAgentAction,
  signAgentAction,
  type AgentDefinition,
  type AgentInfo,
  type AgentMessageBlock,
  type AgentRunActivity,
  type AgentRunUsage,
  type AgentTriggerInput,
  type AgentTriggerPatch,
  type AgentWSEvent,
  type MessageSessionContentPart,
  type ModelProviderConfig,
  type ModelProviderInfo,
  type ModelProviderType,
  type SigningIdentity,
  type SigningIdentityIcon,
} from '@/agents-client'
import {client} from '@/trpc'
import {grpcClient} from '@/grpc-client'
import {getToolReferencedUrls} from '@seed-hypermedia/agents-protocol'
import * as cbor from '@shm/shared/cbor'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

const AGENT_SERVER_URL_KEY = 'agent-server-url'
const AGENT_SERVER_URLS_KEY = 'agent-server-urls'
const LOCAL_DEFAULT_AGENT_SERVER_URL = 'http://localhost:3050'
const PRODUCTION_DEFAULT_AGENT_SERVER_URL = 'https://agentic.seed.hyper.media'
/** Returns the built-in default agent server URL for the current desktop runtime. */
export function getDefaultAgentServerUrl() {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_DEFAULT_AGENT_SERVER_URL : LOCAL_DEFAULT_AGENT_SERVER_URL
}
/** The built-in default agent server URL for the current desktop runtime. */
export const DEFAULT_AGENT_SERVER_URL = getDefaultAgentServerUrl()
const AGENT_BACKGROUND_REFETCH_INTERVAL_MS = 5_000

// ─── Agent-referenced content discovery ─────────────────────────────────────
// When an agent session event arrives over the WebSocket it may reference hm:// content the local node
// hasn't synced. We detect those references centrally at the ingestion point — reading tool-result URLs from
// the tool registry's structured `references` metadata (getToolReferencedUrls), and assistant-message URLs
// from the markdown prose — then ask the local daemon to discover/sync each, so the document is available by
// the time the user clicks. The agent publishes to a different node (its HM server), so this only works once
// the local node is peered with it (see useConnectLocalNodeToAgentHmServer).

const HM_REF_REGEX = /hm:\/\/[^\s)"'`\]<>]+/g
/** Canonical discovery URLs already requested this process, to avoid re-discovering the same resource. */
const discoveredAgentRefs = new Set<string>()

/** Normalize an hm:// URL to a bare resource URL (drop version/query, block ref, and any `:view` marker). */
function canonicalAgentRef(raw: string): string | null {
  if (!raw.startsWith('hm://')) return null
  const withoutScheme = (raw.slice('hm://'.length).split('#')[0] ?? '').split('?')[0] ?? ''
  const segments = withoutScheme.split('/').filter((segment) => segment.length > 0)
  const uid = segments[0]
  if (!uid) return null
  const pathSegments: string[] = []
  for (const segment of segments.slice(1)) {
    if (segment.startsWith(':')) break
    pathSegments.push(segment)
  }
  return `hm://${uid}${pathSegments.length ? `/${pathSegments.join('/')}` : ''}`
}

/** Pull hm:// references out of free-form text (assistant prose / markdown links). */
function extractHmUrlsFromText(text: string): string[] {
  return (text.match(HM_REF_REGEX) ?? []).map((match) => match.replace(/[.,;]+$/, ''))
}

/**
 * Triggers local-daemon discovery for any referenced resource not already seen this process. Best-effort and
 * fire-and-forget; logs under `[agents-discovery]` so the agent-content discovery path is visible without the
 * noise of generic per-resource discovery.
 *
 * A comment URL (`hm://target/path/:comments/<author>/<tsid>`) canonicalizes to its target document, but a
 * comment is only synced as part of that document's subtree — so comment references are discovered
 * recursively (`/**`), the same way the document page subscribes (`recursive: true`). Plain document
 * references stay non-recursive.
 */
function discoverReferences(urls: string[]): void {
  // Group by canonical resource id, marking a target recursive if any reference to it is a comment.
  const recursiveById = new Map<string, boolean>()
  for (const rawUrl of urls) {
    const id = canonicalAgentRef(rawUrl)
    if (!id) continue
    const recursive = rawUrl.includes('/:comments/') || (recursiveById.get(id) ?? false)
    recursiveById.set(id, recursive)
  }
  for (const [id, recursive] of Array.from(recursiveById.entries())) {
    const discoveryId = recursive ? `${id}/**` : id
    if (discoveredAgentRefs.has(discoveryId)) continue
    discoveredAgentRefs.add(discoveryId)
    console.info('[agents-discovery] agent referenced content — discovering on local node', {id: discoveryId})
    void grpcClient.resources.discoverResource({id: discoveryId}).then(
      (resp) =>
        console.info('[agents-discovery] discovery scheduled', {
          id: discoveryId,
          state: resp.state,
          version: resp.version || '(pending)',
        }),
      (error) =>
        console.warn('[agents-discovery] discovery request failed', {
          id: discoveryId,
          error: error instanceof Error ? error.message : String(error),
        }),
    )
  }
}

function tryNormalizeAgentServerUrl(input: string): string | null {
  try {
    return normalizeAgentServerUrl(input)
  } catch (error) {
    console.warn('Ignoring invalid agent server URL setting', {input, error})
    return null
  }
}

/** Loads all configured agent server URLs. */
export function useAgentServerUrls() {
  return useQuery({
    queryKey: ['agents', 'server-urls'],
    queryFn: async () => {
      const storedList = await client.appSettings.getSetting.query(AGENT_SERVER_URLS_KEY)
      const storedDefault = await client.appSettings.getSetting.query(AGENT_SERVER_URL_KEY)
      const urls = new Set<string>()
      if (Array.isArray(storedList)) {
        for (const value of storedList) {
          if (typeof value === 'string' && value) {
            const normalized = tryNormalizeAgentServerUrl(value)
            if (normalized) urls.add(normalized)
          }
        }
      }
      if (typeof storedDefault === 'string' && storedDefault) {
        const normalized = tryNormalizeAgentServerUrl(storedDefault)
        if (normalized) urls.add(normalized)
      }
      // In local development, seed the list with the built-in default the first
      // time the app runs so there is a server to connect to out of the box.
      // Once the list has been configured (even to empty), respect that choice
      // so removing the last server still sticks.
      if (urls.size === 0 && !Array.isArray(storedList) && process.env.NODE_ENV === 'development') {
        urls.add(DEFAULT_AGENT_SERVER_URL)
      }
      return Array.from(urls)
    },
    useErrorBoundary: false,
  })
}

/** Persists the configured agent server URL list. */
export function useSetAgentServerUrls() {
  return useMutation({
    mutationFn: async (serverUrls: string[]) => {
      const normalized = Array.from(new Set(serverUrls.map((url) => normalizeAgentServerUrl(url))))
      await client.appSettings.setSetting.mutate({key: AGENT_SERVER_URLS_KEY, value: normalized})
      const currentDefault = await client.appSettings.getSetting.query(AGENT_SERVER_URL_KEY)
      const normalizedCurrentDefault =
        typeof currentDefault === 'string' ? tryNormalizeAgentServerUrl(currentDefault) : null
      if (!normalizedCurrentDefault || !normalized.includes(normalizedCurrentDefault)) {
        await client.appSettings.setSetting.mutate({
          key: AGENT_SERVER_URL_KEY,
          value: normalized[0] || null,
        })
      }
      return normalized
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Loads the configured agent server URL for the desktop Agents page. */
export function useAgentServerUrl() {
  return useQuery({
    queryKey: ['agents', 'server-url'],
    queryFn: async () => {
      const stored = await client.appSettings.getSetting.query(AGENT_SERVER_URL_KEY)
      if (typeof stored !== 'string' || !stored) return DEFAULT_AGENT_SERVER_URL
      return tryNormalizeAgentServerUrl(stored) || DEFAULT_AGENT_SERVER_URL
    },
    useErrorBoundary: false,
  })
}

/** Persists the configured agent server URL for the desktop Agents page. */
export function useSetAgentServerUrl() {
  return useMutation({
    mutationFn: async (serverUrl: string) => {
      const normalized = normalizeAgentServerUrl(serverUrl)
      await client.appSettings.setSetting.mutate({key: AGENT_SERVER_URL_KEY, value: normalized})
      return normalized
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Polls the configured agent server's status endpoint. */
export function useAgentServerHealth(serverUrl: string | undefined) {
  return useQuery({
    queryKey: ['agents', 'health', serverUrl],
    queryFn: () => getAgentServerHealth(serverUrl || DEFAULT_AGENT_SERVER_URL),
    enabled: !!serverUrl,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/**
 * Ensures the desktop's local Seed node is peered with the agent server's HM node.
 *
 * Agents publish documents/comments to their configured `hmServerUrl` — a different node than the desktop's
 * local embedded daemon. Discovery only queries the node's current set of connected peers, so unless the
 * local node is peered with the HM node that actually holds the content, discovery has nowhere to fetch it
 * from and clicked links stay stuck on a loading spinner. Connecting the local node to the HM server adds it
 * to that peer set so discovery can sync agent-created content directly from it. Best-effort and periodic;
 * failures are non-fatal.
 */
export function useConnectLocalNodeToAgentHmServer(serverUrl: string | undefined) {
  const health = useAgentServerHealth(serverUrl)
  const hmServerUrl = health.data?.hmServerUrl
  return useQuery({
    queryKey: ['agents', 'hm-server-connect', hmServerUrl],
    enabled: !!hmServerUrl,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
    queryFn: async () => {
      if (!hmServerUrl) return null
      return connectLocalNodeToAgentHmServer(hmServerUrl)
    },
  })
}

/** Peers the local node with an agent HM server so discovery can sync content directly from it. */
async function connectLocalNodeToAgentHmServer(hmServerUrl: string): Promise<{peerId: string; addrs: string[]} | null> {
  const config = await client.web.configOfHost.query({host: hmServerUrl})
  if (config.addrs?.length) {
    await grpcClient.networking.connect({addrs: config.addrs})
    console.info('[agents] connected local node to agent HM server', {
      hmServerUrl,
      peerId: config.peerId,
      addrs: config.addrs.length,
    })
  }
  return {peerId: config.peerId, addrs: config.addrs}
}

/**
 * Syncs a newly created agent's HM account onto the local node so it can immediately be searched and
 * @mentioned. The agent account profile/home is published to the agent server's HM node, so we first peer the
 * local node with that HM node (same logic as {@link useConnectLocalNodeToAgentHmServer}) and then discover the
 * account recursively — its profile lives in the account subtree. Best-effort and fire-and-forget; failures
 * are non-fatal and logged under `[agents-discovery]`.
 */
export async function syncAgentAccountToLocalNode(serverUrl: string | undefined, accountUid: string): Promise<void> {
  const discoveryId = `hm://${accountUid}/**`
  try {
    const health = await getAgentServerHealth(serverUrl || DEFAULT_AGENT_SERVER_URL)
    if (health.hmServerUrl) await connectLocalNodeToAgentHmServer(health.hmServerUrl)
    discoveredAgentRefs.add(discoveryId)
    console.info('[agents-discovery] syncing new agent account to local node', {id: discoveryId})
    const resp = await grpcClient.resources.discoverResource({id: discoveryId})
    console.info('[agents-discovery] agent account discovery scheduled', {
      id: discoveryId,
      state: resp.state,
      version: resp.version || '(pending)',
    })
  } catch (error) {
    console.warn('[agents-discovery] failed to sync agent account to local node', {
      id: discoveryId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Lists agents for the selected account on the configured server. */
export function useAgentList(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useQuery({
    queryKey: ['agents', 'list', serverUrl, accountUid],
    queryFn: async () => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgents'}})
      if (res._ !== 'ListAgentsResponse') throw new Error('Unexpected ListAgents response')
      return res.agents
    },
    enabled: !!serverUrl && !!accountUid,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists agents for each configured server. */
export function useAgentLists(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  return useQueries({
    queries: (serverUrls || []).map((serverUrl) => ({
      queryKey: ['agents', 'list', serverUrl, accountUid],
      queryFn: async () => {
        if (!accountUid) return []
        const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgents'}})
        if (res._ !== 'ListAgentsResponse') throw new Error('Unexpected ListAgents response')
        return res.agents
      },
      enabled: !!accountUid,
      refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: true,
      retry: false,
      useErrorBoundary: false,
    })),
  })
}

/** Polls health for each configured server. */
export function useAgentServerHealths(serverUrls: string[] | undefined) {
  return useQueries({
    queries: (serverUrls || []).map((serverUrl) => ({
      queryKey: ['agents', 'health', serverUrl],
      queryFn: () => getAgentServerHealth(serverUrl),
      enabled: !!serverUrl,
      refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: true,
      retry: false,
      useErrorBoundary: false,
    })),
  })
}

/** Lists configured model providers for the selected account on the configured server. */
export function useModelProviders(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useQuery({
    queryKey: ['agents', 'providers', serverUrl, accountUid],
    queryFn: async () => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListModelProviders'}})
      if (res._ !== 'ListModelProvidersResponse') throw new Error('Unexpected ListModelProviders response')
      return res.providers
    },
    enabled: !!serverUrl && !!accountUid,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists remote models available from one configured provider. */
export function useProviderModels(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  provider: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'provider-models', serverUrl, accountUid, provider],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !provider) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListProviderModels', provider}})
      if (res._ !== 'ListProviderModelsResponse') throw new Error('Unexpected ListProviderModels response')
      return res.models
    },
    enabled: !!serverUrl && !!accountUid && !!provider,
    // Provider model catalogs change rarely, so keep them fresh for a while and
    // retain them in cache across dialog open/close so reopening a model
    // dropdown is instant instead of re-fetching the full list every time.
    staleTime: 60 * 60 * 1000,
    cacheTime: 24 * 60 * 60 * 1000,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists uploaded HM account keys for the selected account on the configured server. */
export function useSigningIdentities(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useQuery({
    queryKey: ['agents', 'signing-identities', serverUrl, accountUid],
    queryFn: async (): Promise<SigningIdentity[]> => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListSigningIdentities'}})
      if (res._ !== 'ListSigningIdentitiesResponse') throw new Error('Unexpected ListSigningIdentities response')
      return res.identities
    },
    enabled: !!serverUrl && !!accountUid,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Generates a server-side HM account key for future signing tools. */
export function useCreateSigningIdentity(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (label?: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateSigningIdentity', label, clientRequestId: crypto.randomUUID()},
      })
    },
    onSuccess(result) {
      invalidateQueries(['agents'])
      // The new agent account profile/home was just published to the server's HM node. Sync it onto the
      // local node so it can be searched and @mentioned right away (covers both the create-agent flow and
      // the Tools-tab "New account" workflow).
      if (result._ === 'CreateSigningIdentityResponse' && result.identity.accountId) {
        void syncAgentAccountToLocalNode(serverUrl, result.identity.accountId)
      }
    },
  })
}

/** Renames a server-side HM account key and republishes its profile, optionally setting a new avatar. */
export function useUpdateSigningIdentity(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({name, label, icon}: {name: string; label: string; icon?: SigningIdentityIcon}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateSigningIdentity', name, label, icon}})
    },
    onSuccess(result) {
      invalidateQueries(['agents'])
      // The profile (name/avatar) was republished to the agent server's HM node. Re-sync it onto the local
      // node and refresh the account metadata so the new icon/name shows in the UI without a manual reload.
      if (result._ === 'UpdateSigningIdentityResponse' && result.identity.accountId) {
        const updatedAccountId = result.identity.accountId
        void syncAgentAccountToLocalNode(serverUrl, updatedAccountId)
        invalidateQueries([queryKeys.ACCOUNT, updatedAccountId])
      }
    },
  })
}

/** Deletes a server-side HM account key. */
export function useDeleteSigningIdentity(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (name: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteSigningIdentity', name}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Lists configured model providers for each configured server. */
export function useModelProviderLists(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  return useQueries({
    queries: (serverUrls || []).map((serverUrl) => ({
      queryKey: ['agents', 'providers', serverUrl, accountUid],
      queryFn: async (): Promise<ModelProviderInfo[]> => {
        if (!accountUid) return []
        const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListModelProviders'}})
        if (res._ !== 'ListModelProvidersResponse') throw new Error('Unexpected ListModelProviders response')
        return res.providers
      },
      enabled: !!accountUid,
      refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: true,
      retry: false,
      useErrorBoundary: false,
    })),
  })
}

/** Deletes a configured model provider and its API key secret. */
export function useDeleteModelProvider(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (name: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteModelProvider', name}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Stores an API key and configures a model provider. */
export function useSaveModelProvider(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      type,
      name,
      apiKey,
      baseUrl,
    }: {
      type: ModelProviderType
      name: string
      apiKey: string
      /** Custom endpoint for self-hosted/custom providers (e.g. Ollama). */
      baseUrl?: string
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const providerName = name.trim()
      if (!providerName) throw new Error('Provider name is required')
      const trimmed = apiKey.trim()
      // Only guard the secret transport when a key is actually being sent; local
      // providers (Ollama/custom) can be saved without one.
      if (trimmed && !isSafeAgentServerSecretTarget(serverUrl)) {
        throw new Error('Refusing to send API key to a non-local HTTP agent server. Use HTTPS for remote servers.')
      }
      const trimmedBaseUrl = baseUrl?.trim() || undefined
      const provider: ModelProviderConfig = {type}
      if (trimmedBaseUrl) provider.baseUrl = trimmedBaseUrl
      if (trimmed) {
        const secretName = `${providerName}-api-key`
        await sendAgentAction({
          serverUrl,
          accountUid,
          action: {
            _: 'SetSecret',
            name: secretName,
            value: new TextEncoder().encode(trimmed),
            metadata: {provider: type},
          },
        })
        provider.secretRefs = {apiKey: secretName}
      }
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'SetModelProvider',
          name: providerName,
          provider,
        },
      })
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Stores an OpenAI API key and configures the default desktop-test provider. */
export function useSaveOpenAIProvider(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (apiKey: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      if (!isSafeAgentServerSecretTarget(serverUrl)) {
        throw new Error('Refusing to send API key to a non-local HTTP agent server. Use HTTPS for remote servers.')
      }
      const trimmed = apiKey.trim()
      if (!trimmed) throw new Error('OpenAI API key is required')
      await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'SetSecret', name: 'openai-api-key', value: new TextEncoder().encode(trimmed)},
      })
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'SetModelProvider',
          name: 'desktop-test',
          provider: {type: 'openai', secretRefs: {apiKey: 'openai-api-key'}},
        },
      })
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Ensures a simple provider exists for manual desktop testing. */
export function useEnsureAgentProvider(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'SetModelProvider',
          name: 'desktop-test',
          provider: {type: 'openai', secretRefs: {apiKey: 'openai-api-key'}, modelDefaults: {source: 'desktop'}},
        },
      })
    },
  })
}

/** Creates a testable server-hosted agent from the desktop GUI. */
export function useCreateAgent(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (definition: AgentDefinition) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateAgent', definition, clientRequestId: crypto.randomUUID()},
      })
    },
    onSuccess() {
      invalidateQueries(['agents', 'list'])
    },
  })
}

/** Deletes an existing server-hosted agent. */
export function useDeleteAgent(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (agentId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgent', agentId}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/**
 * Fetches one agent's detail and primes the react-query cache so the agent page
 * renders immediately after navigation instead of flashing a loading state.
 */
export async function prefetchAgentDetail(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
) {
  if (!serverUrl || !accountUid || !agentId) return
  const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetAgent', agentId}})
  if (res._ !== 'GetAgentResponse') throw new Error('Unexpected GetAgent response')
  queryClient.setQueryData(['agents', 'detail', serverUrl, accountUid, agentId], res)
  return res
}

/** Loads one agent and its sessions from the configured server. */
export function useAgentDetail(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'detail', serverUrl, accountUid, agentId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !agentId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetAgent', agentId}})
      if (res._ !== 'GetAgentResponse') throw new Error('Unexpected GetAgent response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!agentId,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists triggers saved for one agent. */
export function useAgentTriggers(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'triggers', serverUrl, accountUid, agentId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !agentId) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgentTriggers', agentId}})
      if (res._ !== 'ListAgentTriggersResponse') throw new Error('Unexpected ListAgentTriggers response')
      return res.triggers
    },
    enabled: !!serverUrl && !!accountUid && !!agentId,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Loads one trigger and its created sessions from the configured server. */
export function useAgentTrigger(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  triggerId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'trigger', serverUrl, accountUid, triggerId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !triggerId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetAgentTrigger', triggerId}})
      if (res._ !== 'GetAgentTriggerResponse') throw new Error('Unexpected GetAgentTrigger response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!triggerId,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Creates an activity trigger for one agent. */
export function useCreateAgentTrigger(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, trigger}: {agentId: string; trigger: AgentTriggerInput}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateAgentTrigger', agentId, trigger, clientRequestId: crypto.randomUUID()},
      })
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Updates an existing activity trigger. */
export function useUpdateAgentTrigger(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({triggerId, patch}: {triggerId: string; patch: AgentTriggerPatch}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateAgentTrigger', triggerId, patch}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Deletes an existing activity trigger. */
export function useDeleteAgentTrigger(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (triggerId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgentTrigger', triggerId}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Loads one agent session and durable events from the configured server. */
export function useAgentSession(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  sessionId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'session', serverUrl, accountUid, sessionId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !sessionId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetSession', sessionId}})
      if (res._ !== 'GetSessionResponse') throw new Error('Unexpected GetSession response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!sessionId,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Updates an existing server-hosted agent. */
export function useUpdateAgent(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, definition}: {agentId: string; definition: AgentDefinition}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateAgent', agentId, definition}})
    },
    onSuccess(result, variables) {
      if (result._ === 'GetAgentResponse') {
        queryClient.setQueriesData({queryKey: ['agents', 'detail', serverUrl, accountUid, variables.agentId]}, result)
        queryClient.setQueriesData(
          {queryKey: ['agents', 'list', serverUrl, accountUid]},
          (old: AgentInfo[] | undefined) =>
            old?.map((agent) => (agent.id === result.agent.id ? result.agent : agent)) ?? old,
        )
      }
      invalidateQueries(['agents'])
    },
  })
}

export type AgentSessionDraftMessage = {
  text: string
  blocks?: AgentMessageBlock[]
}

/** Sends a user message and asks the server-hosted agent to respond. */
export function useMessageAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      sessionId,
      message,
    }: {
      sessionId: string
      message: AgentSessionDraftMessage | AgentSessionDraftMessage[]
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const messages = Array.isArray(message) ? message : [message]
      const content: MessageSessionContentPart[] = messages.map((message) => ({
        type: 'text',
        text: message.text,
        ...(message.blocks ? {blocks: message.blocks} : {}),
      }))
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'MessageSession',
          sessionId,
          content,
          clientMessageId: crypto.randomUUID(),
        },
      })
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Stops an in-flight server-hosted agent response. */
export function useStopAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'StopSession', sessionId}})
      if (res._ !== 'StopSessionResponse') throw new Error('Unexpected StopSession response')
      return res
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Live, in-flight state for one agent session streamed over the WebSocket. */
export type AgentSessionLiveState = {
  /** Assistant text streamed so far for the current (uncommitted) partial. */
  text: string
  /** Cumulative token usage for the current run, if reported. */
  usage?: AgentRunUsage
  /** What the agent is doing right now, if reported. */
  activity?: AgentRunActivity
}

const EMPTY_SESSION_LIVE_STATE: AgentSessionLiveState = {text: ''}

/** Subscribes to signed agent-server WebSocket updates and refreshes cached data. */
export function useAgentWebSocketSubscription(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | undefined,
  afterSeq?: number,
): AgentSessionLiveState {
  const [partials, setPartials] = useState<Record<string, AgentSessionLiveState>>({})

  // Keep the local node peered with this server's HM node so agent-created content can be discovered locally.
  useConnectLocalNodeToAgentHmServer(serverUrl)

  useEffect(() => {
    if (!serverUrl || !accountUid || !key) return
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let retry = 0

    const log = (message: string, fields: Record<string, unknown> = {}) => {
      console.info(`[agents/ws] ${message}`, {serverUrl, accountUid, key, ...fields})
    }

    const parseMessage = async (data: MessageEvent['data']): Promise<AgentWSEvent> => {
      if (typeof data === 'string') return JSON.parse(data) as AgentWSEvent
      if (data instanceof Blob) return JSON.parse(await data.text()) as AgentWSEvent
      if (data instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(data)) as AgentWSEvent
      return JSON.parse(String(data)) as AgentWSEvent
    }

    const connect = () => {
      const wsUrl = getAgentWebSocketUrl(serverUrl)
      log('connecting', {wsUrl, retry})
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      ws.addEventListener('open', () => {
        retry = 0
        const action =
          afterSeq === undefined ? ({_: 'Subscribe', key} as const) : ({_: 'Subscribe', key, afterSeq} as const)
        log('open; signing subscribe', {afterSeq, omittedUndefinedAfterSeq: afterSeq === undefined})
        void signAgentAction({accountUid, action})
          .then((envelope) => {
            if (!cancelled && ws?.readyState === WebSocket.OPEN) {
              ws.send(cbor.encode(envelope) as Uint8Array)
              log('subscribe sent', {afterSeq})
            }
          })
          .catch((error) => {
            log('subscribe signing failed', {error: error instanceof Error ? error.message : String(error)})
          })
      })
      ws.addEventListener('message', (message) => {
        void (async () => {
          try {
            const event = await parseMessage(message.data)
            if (event._ === 'connected') {
              log('connected event', {connectedAt: event.connectedAt})
            } else if (event._ === 'subscribed') {
              log('subscribed event', {subscribedKey: event.key, accountId: event.accountId})
            } else if (event._ === 'append') {
              log('append event', {sessionId: event.event.sessionId, seq: event.event.seq})
              const eventPayload = event.event.event as {
                type?: string
                role?: string
                content?: string
                name?: string
                output?: unknown
              }
              // Central detection point: sync any hm:// content this agent event references onto the local
              // node — tool-result URLs come from the registry's structured reference metadata, message URLs
              // from the markdown prose.
              if (eventPayload.type === 'tool_result' && typeof eventPayload.name === 'string') {
                discoverReferences(getToolReferencedUrls(eventPayload.name, {output: eventPayload.output}))
              } else if (eventPayload.type === 'message' && typeof eventPayload.content === 'string') {
                discoverReferences(extractHmUrlsFromText(eventPayload.content))
              }
              if (eventPayload.type === 'message' && eventPayload.role === 'assistant') {
                // The streamed text is now a durable message, but the run may continue
                // (more turns after tool calls), so keep usage/activity until idle.
                setPartials((current) => {
                  const existing = current[event.event.sessionId]
                  if (!existing) return current
                  return {...current, [event.event.sessionId]: {...existing, text: ''}}
                })
              }
              const sessionId = event.event.sessionId
              queryClient.setQueriesData(
                {queryKey: ['agents', 'session', serverUrl, accountUid, sessionId]},
                (old: any) => {
                  if (!old || old._ !== 'GetSessionResponse') return old
                  if (old.events.some((existing: any) => existing.id === event.event.id)) return old
                  const events = old.events.filter((existing: any) => {
                    if (typeof existing.id !== 'string' || !existing.id.startsWith('optimistic-')) return true
                    const existingPayload = existing.event as {type?: string; role?: string; content?: string}
                    return !(
                      eventPayload.type === 'message' &&
                      eventPayload.role === 'user' &&
                      existingPayload.type === 'message' &&
                      existingPayload.role === 'user' &&
                      existingPayload.content === eventPayload.content
                    )
                  })
                  return {...old, events: [...events, event.event]}
                },
              )
              invalidateQueries(['agents', 'detail'])
            } else if (event._ === 'appendPartial') {
              const sessionId = event.key.slice('sessions/'.length)
              const textDeltaLength = event.patch.textDelta?.length ?? 0
              log('partial event', {
                sessionId,
                partialId: event.partialId,
                textDeltaLength,
                done: event.patch.done === true,
                activity: event.patch.activity?.phase,
                totalTokens: event.patch.usage?.total,
              })
              setPartials((current) => {
                const existing = current[sessionId] ?? EMPTY_SESSION_LIVE_STATE
                // Usage and activity updates always apply, even on the `done` patch.
                const next: AgentSessionLiveState = {
                  ...existing,
                  ...(event.patch.usage ? {usage: event.patch.usage} : {}),
                  ...(event.patch.activity ? {activity: event.patch.activity} : {}),
                }
                if (event.patch.done) {
                  log('partial marked done; keeping visible until durable append', {
                    sessionId,
                    partialId: event.partialId,
                    totalLength: existing.text.length,
                  })
                  return {...current, [sessionId]: next}
                }
                next.text = existing.text + (event.patch.textDelta || '')
                log('partial state updated', {sessionId, partialId: event.partialId, totalLength: next.text.length})
                return {...current, [sessionId]: next}
              })
            } else if (event._ === 'error') {
              log('server error event', {message: event.message})
            } else if (event._ === 'change') {
              log('change event', {changedKey: event.key})
              invalidateQueries(['agents'])
            }
          } catch (error) {
            console.warn('[agents/ws] ignored malformed message', {
              serverUrl,
              accountUid,
              key,
              dataType: Object.prototype.toString.call(message.data),
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })()
      })
      ws.addEventListener('error', () => {
        log('socket error')
      })
      ws.addEventListener('close', (event) => {
        log('closed', {code: event.code, reason: event.reason, wasClean: event.wasClean})
        if (cancelled) return
        retry += 1
        reconnectTimer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry))
      })
    }

    connect()
    return () => {
      cancelled = true
      log('cleanup')
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [serverUrl, accountUid, key])

  if (!key?.startsWith('sessions/')) return EMPTY_SESSION_LIVE_STATE
  return partials[key.slice('sessions/'.length)] ?? EMPTY_SESSION_LIVE_STATE
}

/** Adds an optimistic user message to the cached session while the signed request is in flight. */
export function addOptimisticSessionMessage(
  serverUrl: string,
  accountUid: string,
  sessionId: string,
  message: AgentSessionDraftMessage | AgentSessionDraftMessage[],
) {
  queryClient.setQueriesData({queryKey: ['agents', 'session', serverUrl, accountUid, sessionId]}, (old: any) => {
    if (!old || old._ !== 'GetSessionResponse') return old
    const messages = Array.isArray(message) ? message : [message]
    const now = Date.now()
    return {
      ...old,
      events: [
        ...old.events,
        ...messages.map((message) => ({
          id: `optimistic-${crypto.randomUUID()}`,
          sessionId,
          seq: Number.MAX_SAFE_INTEGER,
          event: {
            type: 'message',
            role: 'user',
            content: message.text,
            rawMarkdown: message.text,
            ...(message.blocks ? {blocks: message.blocks} : {}),
          },
          createdAt: now,
        })),
      ],
    }
  })
}

/** Creates a session for an existing server-hosted agent from the desktop GUI. */
export function useCreateAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, title}: {agentId: string; title: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateSession', agentId, title, clientRequestId: crypto.randomUUID()},
      })
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Creates a session on the server associated with a listed agent. */
export function useCreateAgentSessionOnServer(accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({serverUrl, agentId, title}: {serverUrl: string; agentId: string; title: string}) => {
      if (!accountUid) throw new Error('Select an account first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateSession', agentId, title, clientRequestId: crypto.randomUUID()},
      })
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Updates editable session metadata from the desktop GUI. */
export function useUpdateAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({sessionId, title}: {sessionId: string; title: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateSession', sessionId, title}})
      if (res._ !== 'UpdateSessionResponse') throw new Error('Unexpected UpdateSession response')
      return res.session
    },
    onSuccess(updatedSession) {
      queryClient.setQueriesData(
        {queryKey: ['agents', 'session', serverUrl, accountUid, updatedSession.id]},
        (old: any) => {
          if (!old || old._ !== 'GetSessionResponse') return old
          return {...old, session: updatedSession}
        },
      )
      invalidateQueries(['agents'])
    },
  })
}

/** Deletes an existing agent session from the desktop GUI. */
export function useDeleteAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteSession', sessionId}})
      if (res._ !== 'DeleteSessionResponse') throw new Error('Unexpected DeleteSession response')
      return res
    },
    onSuccess(deletedSession) {
      queryClient.removeQueries(['agents', 'session', serverUrl, accountUid, deletedSession.sessionId])
      invalidateQueries(['agents'])
    },
  })
}
