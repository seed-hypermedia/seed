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
  type AgentMemoryEntry,
  type FileUploadTarget,
  type ModelProviderType,
  type RunInfo,
  type RunJournalEntryInfo,
  type RunStatus,
  type SessionAttachmentInfo,
  type SessionInfo,
  type SigningIdentity,
  type SigningIdentityIcon,
} from '@/agents-client'
import {isOptimisticUserEcho} from '@/models/agent-session-rows'
import {client} from '@/trpc'
import {grpcClient} from '@/grpc-client'
import {getToolReferencedUrls} from '@seed-hypermedia/agents-protocol'
import * as cbor from '@shm/shared/cbor'
import {DEFAULT_DESKTOP_AGENTS_URL} from '@shm/shared/constants'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {useEffect, useMemo, useRef, useState} from 'react'

const AGENT_SERVER_URL_KEY = 'agent-server-url'
const AGENT_SERVER_URLS_KEY = 'agent-server-urls'
// Dev runs the agents server on the port from .env.vars; release builds use the baked-in default.
const LOCAL_DEFAULT_AGENT_SERVER_URL = DEFAULT_DESKTOP_AGENTS_URL
const PRODUCTION_DEFAULT_AGENT_SERVER_URL = 'https://agentic.seed.hyper.media'
/** Returns the built-in default agent server URL for the current desktop runtime. */
export function getDefaultAgentServerUrl() {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_DEFAULT_AGENT_SERVER_URL : LOCAL_DEFAULT_AGENT_SERVER_URL
}
/** The built-in default agent server URL for the current desktop runtime. */
export const DEFAULT_AGENT_SERVER_URL = getDefaultAgentServerUrl()
const AGENT_BACKGROUND_REFETCH_INTERVAL_MS = 5_000

// When an open agent session references hm:// content, keep that resource subscribed through the desktop's
// normal sync service. A one-shot discover is insufficient: it can race the peer connection or return a cached
// result from before the agent published. The live subscription keeps touching discovery until the new content
// arrives and stays active until the session closes.
const HM_REF_REGEX = /hm:\/\/[^\s)"'`\]<>]+/g

type AgentReferenceSubscription = {
  url: string
  recursive: boolean
  unsubscribe: () => void
}

type CanonicalAgentRef = {
  key: string
  url: string
}

/** Normalize an hm:// URL to its document while preserving a requested version. */
function canonicalAgentRef(raw: string): CanonicalAgentRef | null {
  if (!raw.startsWith('hm://')) return null
  const withoutFragment = raw.split('#')[0] ?? ''
  const queryIndex = withoutFragment.indexOf('?')
  const pathPart = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex)
  const query = queryIndex === -1 ? '' : withoutFragment.slice(queryIndex)
  const segments = pathPart.slice('hm://'.length).split('/').filter(Boolean)
  const uid = segments[0]
  if (!uid) return null
  const pathSegments: string[] = []
  for (const segment of segments.slice(1)) {
    if (segment.startsWith(':')) break
    pathSegments.push(segment)
  }
  const key = `hm://${uid}${pathSegments.length ? `/${pathSegments.join('/')}` : ''}`
  return {key, url: `${key}${query}`}
}

/** Pull hm:// references out of free-form text (assistant prose / markdown links). */
function extractHmUrlsFromText(text: string): string[] {
  return (text.match(HM_REF_REGEX) ?? []).map((match) => match.replace(/[.,;]+$/, ''))
}

/** Keeps agent-referenced resources synced for as long as their session is open. */
function subscribeToAgentReferences(
  urls: string[],
  activeSubscriptions: Map<string, AgentReferenceSubscription>,
): void {
  const references = new Map<string, {url: string; recursive: boolean}>()
  for (const rawUrl of urls) {
    const canonical = canonicalAgentRef(rawUrl)
    if (!canonical) continue
    const recursive = rawUrl.includes('/:comments/') || (references.get(canonical.key)?.recursive ?? false)
    references.set(canonical.key, {url: canonical.url, recursive})
  }

  for (const [key, reference] of Array.from(references.entries())) {
    const existing = activeSubscriptions.get(key)
    if (existing?.recursive && !reference.recursive) continue
    if (existing?.recursive === reference.recursive && existing.url === reference.url) continue
    existing?.unsubscribe()

    const id = unpackHmId(reference.url)
    if (!id) continue
    const discoveryId = `${key}${reference.recursive ? '/**' : ''}`
    console.info('[agents-discovery] keeping agent-referenced content synced on local node', {id: discoveryId})
    const subscription = client.sync.subscribe.subscribe(
      {id, recursive: reference.recursive},
      {
        onData: () => {},
        onError: (error) => {
          console.warn('[agents-discovery] agent reference sync failed', {
            id: discoveryId,
            error: error instanceof Error ? error.message : String(error),
          })
        },
      },
    )
    activeSubscriptions.set(key, {
      url: reference.url,
      recursive: reference.recursive,
      unsubscribe: () => subscription.unsubscribe(),
    })
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

/**
 * Display name for the desktop-managed agents server.
 *
 * It is presented as a named place rather than a URL: its port is assigned at startup, so the
 * address is an implementation detail that changes between runs and means nothing to the user.
 */
export const LOCAL_AGENT_SERVER_LABEL = 'Local Agents'

/** True when `serverUrl` is the agents server this desktop app runs itself. */
export function isLocalAgentServer(serverUrl: string, localServerUrl: string | null | undefined): boolean {
  return !!localServerUrl && serverUrl === localServerUrl
}

/** The agents-server URL an agents route points at, or null for any other route. */
export function agentRouteServerUrl(route: {key: string; serverUrl?: string}): string | null {
  if (route.key !== 'agent-server' && route.key !== 'agent' && route.key !== 'agent-session') return null
  return route.serverUrl || DEFAULT_AGENT_SERVER_URL
}

/** Human-readable name for an agent server: the fixed local label, or the remote host. */
export function describeAgentServer(serverUrl: string, localServerUrl: string | null | undefined): string {
  if (isLocalAgentServer(serverUrl, localServerUrl)) return LOCAL_AGENT_SERVER_LABEL
  try {
    return new URL(serverUrl).host
  } catch {
    return serverUrl
  }
}

/** Loads the URL of the agents server the desktop runs locally, when there is one. */
export function useLocalAgentServerUrl() {
  return useQuery({
    queryKey: ['agents', 'local-server-url'],
    queryFn: async () => {
      const result = await client.localAgentsServer.query()
      return result.url ? tryNormalizeAgentServerUrl(result.url) : null
    },
    // The local server boots asynchronously alongside the app, so an early render can legitimately
    // see null. Keep polling until it reports a URL, then stop.
    refetchInterval: (data) => (data ? false : AGENT_BACKGROUND_REFETCH_INTERVAL_MS),
    retry: false,
    useErrorBoundary: false,
  })
}

/**
 * Loads only the agent server URLs persisted in settings.
 *
 * This is what the settings UI reads and writes. It deliberately excludes the locally spawned
 * server: that URL is chosen at startup, so persisting it would leave a dead entry the first time
 * the port moves. Use {@link useAgentServerUrls} for the list of servers to actually talk to.
 */
export function useConfiguredAgentServerUrls() {
  return useQuery({
    queryKey: ['agents', 'configured-server-urls'],
    queryFn: async () => {
      const storedList = await client.appSettings.getSetting.query(AGENT_SERVER_URLS_KEY)
      const storedDefault = await client.appSettings.getSetting.query(AGENT_SERVER_URL_KEY)
      const configured = new Set<string>()
      if (Array.isArray(storedList)) {
        for (const value of storedList) {
          if (typeof value === 'string' && value) {
            const normalized = tryNormalizeAgentServerUrl(value)
            if (normalized) configured.add(normalized)
          }
        }
      }
      if (typeof storedDefault === 'string' && storedDefault) {
        const normalized = tryNormalizeAgentServerUrl(storedDefault)
        if (normalized) configured.add(normalized)
      }
      // Seed the list with the built-in default the first time the app runs so
      // there is a server to connect to out of the box — the hosted
      // `agentic.seed.hyper.media` in production, the local dev server in dev.
      // Once the list has been configured (even to empty), respect that choice
      // so removing the last server still sticks.
      if (configured.size === 0 && !Array.isArray(storedList)) {
        configured.add(DEFAULT_AGENT_SERVER_URL)
      }
      return Array.from(configured)
    },
    useErrorBoundary: false,
  })
}

/**
 * All agent servers the app can talk to: the locally spawned one first, then configured servers.
 *
 * The local server is always present (when running) and is never persisted, so every consumer —
 * the Agents page, the assistant sidebar — sees it without the user configuring anything.
 */
export function useAgentServerUrls() {
  const localServerUrl = useLocalAgentServerUrl()
  const configured = useConfiguredAgentServerUrls()

  const data = useMemo(() => {
    if (!configured.data) return undefined
    const urls = new Set<string>()
    if (localServerUrl.data) urls.add(localServerUrl.data)
    for (const url of configured.data) urls.add(url)
    return Array.from(urls)
  }, [configured.data, localServerUrl.data])

  return {...configured, data}
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
    console.info('[agents-discovery] syncing new agent account to local node', {id: discoveryId})
    const resp = await grpcClient.entities.discoverEntity({id: discoveryId})
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

/**
 * Whether the account has at least one agent to talk to, across every configured server.
 *
 * The assistant entry points key off this rather than off server availability: the desktop always
 * runs a local server, so "a server exists" is always true and says nothing about whether there is
 * anything to chat with. A server with no agents cannot start a session.
 */
export function useHasAnyAgent(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  const agentLists = useAgentLists(serverUrls, accountUid)
  const hasAgents = agentLists.some((query) => (query.data?.length || 0) > 0)
  // "No agents" is only meaningful once every server has answered. Treating the in-flight state as
  // empty would hide the assistant on each launch and discard the restored sidebar state.
  const isSettled =
    serverUrls !== undefined &&
    (agentLists.length === 0 || agentLists.every((query) => query.isSuccess || query.isError))
  return {hasAgents, isSettled}
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

/**
 * Imports an existing HM account key (a decrypted `.hmkey.json` seed) for the server to sign with.
 *
 * The seed travels inside the signed action envelope to the agent server, which stores it in its
 * own encrypted secrets store — callers are responsible for warning the user when that server is
 * not their local machine. Unlike creation, the server publishes nothing for imported keys.
 */
export function useImportSigningIdentity(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({seed, label}: {seed: Uint8Array; label?: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'ImportSigningIdentity', seed, ...(label ? {label} : {}), clientRequestId: crypto.randomUUID()},
      })
      if (res._ !== 'ImportSigningIdentityResponse') throw new Error('Unexpected ImportSigningIdentity response')
      return res.identity
    },
    onSuccess(identity) {
      invalidateQueries(['agents'])
      // The imported account usually already exists on the network; make sure the local node can
      // resolve it (search, @mentions) the same way created agent accounts are synced.
      if (identity.accountId) void syncAgentAccountToLocalNode(serverUrl, identity.accountId)
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

/** Stores an API key (or references OAuth credentials) and configures a model provider. */
export function useSaveModelProvider(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      type,
      name,
      apiKey,
      baseUrl,
      oauthSecretName,
    }: {
      type: ModelProviderType
      name: string
      apiKey: string
      /** Custom endpoint for self-hosted/custom providers (e.g. Ollama). */
      baseUrl?: string
      /**
       * Server-side OAuth credentials secret from a completed subscription
       * sign-in (`useStartProviderOAuth`). When set, the provider is saved in
       * subscription auth mode and no API key secret is written.
       */
      oauthSecretName?: string
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const providerName = name.trim()
      if (!providerName) throw new Error('Provider name is required')
      if (oauthSecretName) {
        // The OAuth credentials already live server-side; just reference them.
        return sendAgentAction({
          serverUrl,
          accountUid,
          action: {
            _: 'SetModelProvider',
            name: providerName,
            provider: {type, authMode: 'subscription', secretRefs: {oauth: oauthSecretName}},
          },
        })
      }
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

/**
 * Starts a subscription OAuth sign-in (OpenAI: “Sign in with ChatGPT”) on the
 * agent server. Returns the browser URL to open; completion is observed with
 * `useProviderOAuthStatus`, and `useSubmitProviderOAuthCode` covers servers the
 * browser redirect cannot reach (the user pastes the redirect URL instead).
 */
export function useStartProviderOAuth(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (providerType: ModelProviderType) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'StartProviderOAuth', providerType}})
      if (res._ !== 'StartProviderOAuthResponse') throw new Error('Unexpected StartProviderOAuth response')
      return res
    },
  })
}

/** Polls a pending subscription sign-in until it completes or fails. */
export function useProviderOAuthStatus(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  loginId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'provider-oauth', serverUrl, accountUid, loginId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !loginId) return undefined
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetProviderOAuthStatus', loginId}})
      if (res._ !== 'ProviderOAuthStatusResponse') throw new Error('Unexpected GetProviderOAuthStatus response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!loginId,
    refetchInterval: (data) => (data?.status === 'pending' ? 1500 : false),
    retry: false,
    useErrorBoundary: false,
  })
}

/** Submits a manually pasted authorization code (or redirect URL) to a pending sign-in. */
export function useSubmitProviderOAuthCode(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({loginId, code}: {loginId: string; code: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const trimmed = code.trim()
      if (!trimmed) throw new Error('Paste the authorization code or redirect URL first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'SubmitProviderOAuthCode', loginId, code: trimmed},
      })
    },
    onSuccess(_res, {loginId}) {
      invalidateQueries(['agents', 'provider-oauth', serverUrl, accountUid, loginId])
    },
  })
}

/** Cancels a pending subscription sign-in. */
export function useCancelProviderOAuth(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (loginId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'CancelProviderOAuth', loginId}})
    },
    onSuccess(_res, loginId) {
      invalidateQueries(['agents', 'provider-oauth', serverUrl, accountUid, loginId])
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

/** Lists the files and directories in one agent's private memory. */
export function useAgentMemory(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'memory', serverUrl, accountUid, agentId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !agentId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgentMemory', agentId}})
      if (res._ !== 'ListAgentMemoryResponse') throw new Error('Unexpected ListAgentMemory response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!agentId,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists the tool documents in an agent's ~/tools — authored lambdas with their source, and builtins. */
export function useAgentTools(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'tools', serverUrl, accountUid, agentId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !agentId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgentTools', agentId}})
      if (res._ !== 'ListAgentToolsResponse') throw new Error('Unexpected ListAgentTools response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!agentId,
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Reads one file from an agent's private memory. */
export function useAgentMemoryFile(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
  filePath: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'memory', serverUrl, accountUid, agentId, 'file', filePath],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !agentId || !filePath) return null
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'ReadAgentMemoryFile', agentId, path: filePath},
      })
      if (res._ !== 'ReadAgentMemoryFileResponse') throw new Error('Unexpected ReadAgentMemoryFile response')
      return res.file
    },
    enabled: !!serverUrl && !!accountUid && !!agentId && !!filePath,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Writes one file (UTF-8 text or binary bytes) into an agent's private memory. */
export function useWriteAgentMemoryFile(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, path, content}: {agentId: string; path: string; content: string | Uint8Array}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'WriteAgentMemoryFile', agentId, path, content}})
    },
    onSuccess() {
      invalidateQueries(['agents', 'memory'])
    },
  })
}

/** Downloads a web URL into an agent's private memory on the server. */
export function useDownloadAgentMemoryFile(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, url, path}: {agentId: string; url: string; path?: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: path
          ? {_: 'DownloadAgentMemoryFile', agentId, url, path}
          : {_: 'DownloadAgentMemoryFile', agentId, url},
      })
      if (res._ !== 'DownloadAgentMemoryFileResponse') throw new Error('Unexpected DownloadAgentMemoryFile response')
      return res
    },
    onSuccess() {
      invalidateQueries(['agents', 'memory'])
    },
  })
}

/** Uploads one agent memory file to IPFS via the HM server, returning its ipfs:// URL. */
export function useUploadAgentMemoryFileToIpfs(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, path}: {agentId: string; path: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'UploadAgentMemoryFileToIpfs', agentId, path},
      })
      if (res._ !== 'UploadAgentMemoryFileToIpfsResponse')
        throw new Error('Unexpected UploadAgentMemoryFileToIpfs response')
      return res
    },
  })
}

/** Deletes one file or directory from an agent's private memory. */
export function useDeleteAgentMemoryFile(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, path}: {agentId: string; path: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgentMemoryFile', agentId, path}})
    },
    onSuccess() {
      invalidateQueries(['agents', 'memory'])
    },
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

/**
 * Runs one verb (read/write/call) AS THE USER on a session's shared log. No optimistic rows: the
 * durable actor-'user' events arrive over the session WS subscription — the log is the truth.
 */
export function useInvokeSessionTool(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      sessionId,
      verb,
      input,
    }: {
      sessionId: string
      verb: 'read' | 'write' | 'call'
      input: unknown
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'InvokeSessionTool', sessionId, verb, input}})
    },
    onSuccess() {
      // The WS append is primary, but a stale socket must never hide a durable action.
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
  /** `poll: false` for sessions shown only by reference (e.g. a child page naming its parent) — the
   * response carries the whole transcript, which is not worth re-fetching every few seconds. */
  options?: {poll?: boolean},
) {
  const poll = options?.poll !== false
  return useQuery({
    queryKey: ['agents', 'session', serverUrl, accountUid, sessionId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !sessionId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetSession', sessionId}})
      if (res._ !== 'GetSessionResponse') throw new Error('Unexpected GetSession response')
      return res
    },
    enabled: !!serverUrl && !!accountUid && !!sessionId,
    refetchInterval: poll ? AGENT_BACKGROUND_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: poll,
    retry: false,
    useErrorBoundary: false,
  })
}

/** One session row in the merged, cross-server sidebar list. */
export type AgentSessionListEntry = {
  /** Server the session lives on. Part of its identity — session ids are only unique per server. */
  serverUrl: string
  session: SessionInfo
  /** The agent that owns the session, when the server reported it. */
  agent?: AgentInfo
}

/**
 * Lists sessions from every configured server, merged and sorted newest-first.
 *
 * The sidebar shows one list spanning all agents on all servers, so this fans out a single
 * `ListSessions` per server rather than walking `ListAgents` -> `GetAgent` per agent. Servers are
 * queried independently and failures are isolated: an unreachable remote server yields an empty
 * contribution instead of emptying the whole list, which matters because the local server is
 * reachable far more often than a hosted one.
 */
export function useAllAgentSessions(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  const queries = useQueries({
    queries: (serverUrls || []).map((serverUrl) => ({
      queryKey: ['agents', 'sessions', serverUrl, accountUid],
      queryFn: async (): Promise<AgentSessionListEntry[]> => {
        if (!accountUid) return []
        // This client nests children under parents itself, so exclude them from the top level.
        const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListSessions', includeChildren: false}})
        if (res._ !== 'ListSessionsResponse') throw new Error('Unexpected ListSessions response')
        const agentsById = new Map(res.agents.map((agent) => [agent.id, agent]))
        return (
          res.sessions
            // Children render nested under their parent's disclosure; filter defensively so a
            // server that ignores includeChildren (older build) can never duplicate them here.
            .filter((session) => !session.parentSessionId)
            .map((session) => ({
              serverUrl,
              session,
              agent: agentsById.get(session.agentId),
            }))
        )
      },
      enabled: !!accountUid,
      refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
      refetchIntervalInBackground: true,
      retry: false,
      useErrorBoundary: false,
    })),
  })

  const entries = queries.flatMap((query) => query.data ?? []).sort((a, b) => b.session.updatedAt - a.session.updatedAt)

  return {
    entries,
    // Loading only while nothing has arrived yet, so one slow server does not blank an already
    // rendered list.
    isLoading: queries.length > 0 && queries.every((query) => query.isLoading),
    isError: queries.length > 0 && queries.every((query) => query.isError),
  }
}

/**
 * Lists the sub-sessions spawned under one parent session.
 *
 * Top-level session lists exclude children, so a parent row shows only a count until the user opens
 * its disclosure — `enabled` keeps the request lazy. Cached results stay fresh through the same
 * `['agents']` invalidation the WebSocket already fires, so child statuses update live once loaded.
 */
export function useChildSessions(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  parentSessionId: string | undefined,
  options?: {enabled?: boolean},
) {
  const enabled = options?.enabled !== false && !!serverUrl && !!accountUid && !!parentSessionId
  return useQuery({
    queryKey: ['agents', 'child-sessions', serverUrl, accountUid, parentSessionId],
    queryFn: async (): Promise<SessionInfo[]> => {
      if (!serverUrl || !accountUid || !parentSessionId) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListSessions', parentSessionId}})
      if (res._ !== 'ListSessionsResponse') throw new Error('Unexpected ListSessions response')
      return res.sessions
    },
    enabled,
    // Only while a disclosure is open, matching how the top-level session lists stay current.
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/**
 * Loads one run by id.
 *
 * A sub-session's own run is a child in its parent's tree, not a root, so `ListRuns {sessionId}`
 * (roots only) never returns it — `SessionInfo.runId` plus this is how a child page reads its status.
 */
export function useRun(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  runId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'runs', 'run', serverUrl, accountUid, runId],
    queryFn: async (): Promise<RunInfo | null> => {
      if (!serverUrl || !accountUid || !runId) return null
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'GetRun', runId}})
      if (res._ !== 'GetRunResponse') throw new Error('Unexpected GetRun response')
      return res.run
    },
    enabled: !!serverUrl && !!accountUid && !!runId,
    // A finished run never changes again, and a long transcript can hold many of these — stop
    // polling as soon as the run reaches a terminal status.
    refetchInterval: (data) =>
      data && TERMINAL_RUN_STATUSES.includes(data.status) ? false : AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Run statuses that never change again. */
const TERMINAL_RUN_STATUSES: RunStatus[] = ['succeeded', 'failed', 'canceled']

/** Lists the root runs of one session, newest first. Root runs only — a sub-session's run is not one. */
export function useSessionRuns(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  sessionId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'runs', 'session', serverUrl, accountUid, sessionId],
    queryFn: async (): Promise<RunInfo[]> => {
      if (!serverUrl || !accountUid || !sessionId) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListRuns', sessionId}})
      if (res._ !== 'ListRunsResponse') throw new Error('Unexpected ListRuns response')
      return res.runs
    },
    enabled: !!serverUrl && !!accountUid && !!sessionId,
    // A run's own changes publish on `runs/<rootRunId>`, which a session page does not subscribe to,
    // so poll: this is what tells a sub-session page its parent has let go of it.
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists every run in one root's tree, oldest first (the order the run card renders them in). */
export function useRunTree(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  rootRunId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'runs', 'tree', serverUrl, accountUid, rootRunId],
    queryFn: async (): Promise<RunInfo[]> => {
      if (!serverUrl || !accountUid || !rootRunId) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListRuns', rootRunId}})
      if (res._ !== 'ListRunsResponse') throw new Error('Unexpected ListRuns response')
      return res.runs
    },
    enabled: !!serverUrl && !!accountUid && !!rootRunId,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Cancels a run and every non-terminal descendant. */
export function useCancelRun(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (runId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'CancelRun', runId}})
      if (res._ !== 'CancelRunResponse') throw new Error('Unexpected CancelRun response')
      return res
    },
    onSuccess() {
      invalidateQueries(['agents', 'runs'])
      invalidateQueries(['agents', 'session'])
    },
  })
}

/**
 * Answers a run that is parked on `ctx.waitForEvent`, or releases one paused on its budget.
 *
 * Both are the same action: a budget pause is not listening for a payload, it is waiting for
 * permission, and any signal is that permission. `delivered: false` is a normal outcome — the run
 * finished, timed out, or was listening for something else — so callers report it rather than
 * treating it as a failure.
 */
export function useSignalRun(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({runId, signal, payload}: {runId: string; signal: string; payload?: unknown}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'SignalRun', runId, signal, ...(payload === undefined ? {} : {payload})},
      })
      if (res._ !== 'SignalRunResponse') throw new Error('Unexpected SignalRun response')
      return res
    },
    onSuccess() {
      invalidateQueries(['agents', 'runs'])
      invalidateQueries(['agents', 'session'])
    },
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
  /** Ambient client context (e.g. the sidebar's current window), sent as a `context` part. */
  contextLines?: string[]
  /** Session attachments (already uploaded) referenced by this message. */
  attachments?: SessionAttachmentInfo[]
  /**
   * Identity shared between the optimistic transcript row and the sent message, echoed back on the
   * durable event so the pending row is replaced by its echo instead of rendering next to it.
   * Stamped by {@link addOptimisticSessionMessage}; callers pass its returned drafts to the send.
   */
  clientMessageId?: string
}

export type FileUploadProgress = {sent: number; total: number}

/** Below this size an upload goes as one signed action; above it, in chunks with progress. */
const SINGLE_SHOT_UPLOAD_BYTES = 2 * 1024 * 1024
/**
 * Client-side chunk size; the server may cap it lower via BeginFileUploadResponse.maxChunkBytes.
 * Signing sends the whole CBOR-encoded action to the local daemon over gRPC, whose default max
 * message size is 4 MiB — chunks must stay comfortably under that including envelope overhead.
 */
const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024

/**
 * Uploads a file to the agent server (agent memory or session attachment). Large files go in
 * bounded chunks so each signed action stays small — signing hashes the whole payload, and a
 * single 300MB action freezes the renderer for many seconds — and `onProgress` fires per chunk.
 */
export async function uploadFileToAgentServer({
  serverUrl,
  accountUid,
  target,
  data,
  onProgress,
}: {
  serverUrl: string
  accountUid: string
  target: FileUploadTarget
  data: Uint8Array
  onProgress?: (progress: FileUploadProgress) => void
}): Promise<{entry?: AgentMemoryEntry; attachment?: SessionAttachmentInfo}> {
  const total = data.byteLength
  onProgress?.({sent: 0, total})
  if (total <= SINGLE_SHOT_UPLOAD_BYTES) {
    if (target.kind === 'memory') {
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'WriteAgentMemoryFile', agentId: target.agentId, path: target.path, content: data},
      })
      if (res._ !== 'WriteAgentMemoryFileResponse') throw new Error('Unexpected WriteAgentMemoryFile response')
      onProgress?.({sent: total, total})
      return {entry: res.entry}
    }
    const res = await sendAgentAction({
      serverUrl,
      accountUid,
      action: target.mimeType
        ? {
            _: 'UploadSessionAttachment',
            sessionId: target.sessionId,
            name: target.name,
            mimeType: target.mimeType,
            content: data,
          }
        : {_: 'UploadSessionAttachment', sessionId: target.sessionId, name: target.name, content: data},
    })
    if (res._ !== 'UploadSessionAttachmentResponse') throw new Error('Unexpected UploadSessionAttachment response')
    onProgress?.({sent: total, total})
    return {attachment: res.attachment}
  }

  const begin = await sendAgentAction({serverUrl, accountUid, action: {_: 'BeginFileUpload', target, size: total}})
  if (begin._ !== 'BeginFileUploadResponse') throw new Error('Unexpected BeginFileUpload response')
  const chunkSize = Math.min(begin.maxChunkBytes, UPLOAD_CHUNK_BYTES)
  try {
    let sent = 0
    while (sent < total) {
      const chunk = data.subarray(sent, Math.min(sent + chunkSize, total))
      const appended = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'AppendFileUploadChunk', uploadId: begin.uploadId, offset: sent, content: chunk},
      })
      if (appended._ !== 'AppendFileUploadChunkResponse') throw new Error('Unexpected AppendFileUploadChunk response')
      sent += chunk.byteLength
      onProgress?.({sent, total})
    }
    const commit = await sendAgentAction({
      serverUrl,
      accountUid,
      action: {_: 'CommitFileUpload', uploadId: begin.uploadId},
    })
    if (commit._ !== 'CommitFileUploadResponse') throw new Error('Unexpected CommitFileUpload response')
    return {entry: commit.entry, attachment: commit.attachment}
  } catch (error) {
    // Free the server-side staging eagerly; the TTL sweep is only a fallback.
    void sendAgentAction({serverUrl, accountUid, action: {_: 'AbortFileUpload', uploadId: begin.uploadId}}).catch(
      () => {},
    )
    throw error
  }
}

/** Uploads one session-private attachment; the returned id is referenced from a later message. */
export function useUploadSessionAttachment(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      sessionId,
      name,
      mimeType,
      content,
    }: {
      sessionId: string
      name: string
      mimeType?: string
      content: Uint8Array
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: mimeType
          ? {_: 'UploadSessionAttachment', sessionId, name, mimeType, content}
          : {_: 'UploadSessionAttachment', sessionId, name, content},
      })
      if (res._ !== 'UploadSessionAttachmentResponse') throw new Error('Unexpected UploadSessionAttachment response')
      return res.attachment
    },
  })
}

/**
 * Resolves session attachment ids to `data:` URLs for rendering attached images in the chat
 * thread. Each id is fetched once and cached; unknown ids resolve to nothing (the block keeps its
 * unrenderable `attachment://` URL).
 */
export function useSessionAttachmentDataUrls(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  sessionId: string | undefined,
  attachmentIds: string[],
): Record<string, string> {
  const results = useQueries({
    queries: attachmentIds.map((attachmentId) => ({
      queryKey: ['agents', 'session-attachment', serverUrl, sessionId, attachmentId],
      enabled: !!serverUrl && !!accountUid && !!sessionId,
      staleTime: Infinity,
      retry: false,
      queryFn: async () => {
        const res = await sendAgentAction({
          serverUrl: serverUrl!,
          accountUid: accountUid!,
          action: {_: 'ReadSessionAttachment', sessionId: sessionId!, attachmentId},
        })
        if (res._ !== 'ReadSessionAttachmentResponse') throw new Error('Unexpected ReadSessionAttachment response')
        return {
          id: attachmentId,
          dataUrl: `data:${res.attachment.mimeType || 'application/octet-stream'};base64,${uint8ToBase64(res.data)}`,
        }
      },
    })),
  })
  return useMemo(() => {
    const byId: Record<string, string> = {}
    for (const result of results) {
      if (result.data) byId[result.data.id] = result.data.dataUrl
    }
    return byId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((result) => (result.data ? result.data.id : '')).join('|')])
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
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
      // Context describes the sending window as a whole, so all lines collapse into one part.
      const contextLines = messages.flatMap((message) => message.contextLines ?? [])
      const attachmentIds = Array.from(new Set(messages.flatMap((m) => (m.attachments ?? []).map((a) => a.id))))
      const content: MessageSessionContentPart[] = [
        ...(contextLines.length > 0 ? [{type: 'context', lines: contextLines} as const] : []),
        ...attachmentIds.map((id): MessageSessionContentPart => ({type: 'attachment', id})),
        ...messages.map(
          (message): MessageSessionContentPart => ({
            type: 'text',
            text: message.text,
            ...(message.blocks ? {blocks: message.blocks} : {}),
            ...(message.clientMessageId ? {clientMessageId: message.clientMessageId} : {}),
          }),
        ),
      ]
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'MessageSession',
          sessionId,
          content,
          // Doubles as the action's idempotency key; unique per send since drafts are stamped
          // fresh by addOptimisticSessionMessage.
          clientMessageId: messages[0]?.clientMessageId ?? crypto.randomUUID(),
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

/**
 * Re-runs a session whose last turn failed, with no new user message.
 *
 * The server re-enters the turn from the durable transcript, so the retried run streams into the
 * session exactly like the original — nothing here has to reconcile the transcript, the usual
 * WebSocket append and invalidation carry it.
 */
export function useRetrySession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (sessionId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'RetrySession', sessionId}})
      if (res._ !== 'RetrySessionResponse') throw new Error('Unexpected RetrySession response')
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

/** Logger passed to socket event handlers, pre-tagged with the connection's server/account/key. */
type AgentSocketLog = (message: string, fields?: Record<string, unknown>) => void

/** Everything a signed subscription can watch. */
export type AgentSubscriptionKey = `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`

/**
 * Opens one signed agent-server WebSocket for `key` and hands every event to `onEvent`.
 *
 * Shared by the session and run subscriptions: the lifecycle (sign the Subscribe action, reconnect
 * with backoff, tear down on unmount) is identical, only the event handling differs. `onEvent` is
 * held in a ref so a handler closing over render-scoped state never forces a reconnect.
 */
function useSignedAgentSocket(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  key: AgentSubscriptionKey | undefined,
  afterSeq: number | undefined,
  onEvent: (event: AgentWSEvent, log: AgentSocketLog) => void,
) {
  const handlerRef = useRef(onEvent)
  handlerRef.current = onEvent
  // Read at subscribe time rather than captured per effect, so a reconnect resumes from the newest
  // durable sequence instead of replaying everything since the page opened.
  const afterSeqRef = useRef(afterSeq)
  afterSeqRef.current = afterSeq

  useEffect(() => {
    if (!serverUrl || !accountUid || !key) return
    let cancelled = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let retry = 0

    const log: AgentSocketLog = (message, fields = {}) => {
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
        const afterSeq = afterSeqRef.current
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
            handlerRef.current(await parseMessage(message.data), log)
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
}

/** Subscribes to signed agent-server WebSocket updates and refreshes cached data. */
export function useAgentWebSocketSubscription(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  key: AgentSubscriptionKey | undefined,
  afterSeq?: number,
): AgentSessionLiveState {
  const [partials, setPartials] = useState<Record<string, AgentSessionLiveState>>({})
  const referenceSubscriptionsRef = useRef(new Map<string, AgentReferenceSubscription>())

  // Keep the local node peered with this server's HM node so agent-created content can be discovered locally.
  useConnectLocalNodeToAgentHmServer(serverUrl)

  useEffect(() => {
    const subscriptions = referenceSubscriptionsRef.current
    return () => {
      for (const subscription of Array.from(subscriptions.values())) subscription.unsubscribe()
      subscriptions.clear()
    }
  }, [serverUrl, accountUid, key])

  useSignedAgentSocket(serverUrl, accountUid, key, afterSeq, (event, log) => {
    if (event._ === 'connected') {
      log('connected event', {connectedAt: event.connectedAt})
    } else if (event._ === 'subscribed') {
      log('subscribed event', {subscribedKey: event.key, accountId: event.accountId})
    } else if (event._ === 'append') {
      // Run-journal appends (runs/<id> keys) are handled by the run-tree hook, not here.
      if (!('event' in event)) return
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
      if (key?.startsWith('sessions/') && event.key === key) {
        if (eventPayload.type === 'tool_result' && typeof eventPayload.name === 'string') {
          subscribeToAgentReferences(
            getToolReferencedUrls(eventPayload.name, {output: eventPayload.output}),
            referenceSubscriptionsRef.current,
          )
        } else if (eventPayload.type === 'message' && typeof eventPayload.content === 'string') {
          subscribeToAgentReferences(extractHmUrlsFromText(eventPayload.content), referenceSubscriptionsRef.current)
        }
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
      queryClient.setQueriesData({queryKey: ['agents', 'session', serverUrl, accountUid, sessionId]}, (old: any) => {
        if (!old || old._ !== 'GetSessionResponse') return old
        if (old.events.some((existing: any) => existing.id === event.event.id)) return old
        const events = old.events.filter((existing: any) => {
          if (typeof existing.id !== 'string' || !existing.id.startsWith('optimistic-')) return true
          // Only a message the USER wrote can be the echo of a message the user is waiting on. The
          // runtime writes as `role: 'user'` too, mid-run, over this same stream.
          return !isOptimisticUserEcho(event.event.event, existing.event)
        })
        return {...old, events: [...events, event.event]}
      })
      invalidateQueries(['agents', 'detail'])
    } else if (event._ === 'appendPartial') {
      // Run-keyed partials (workflow progress) are handled by the run-tree hook, not here.
      if (!event.key.startsWith('sessions/')) return
      const patch = event.patch as {
        textDelta?: string
        done?: boolean
        usage?: AgentRunUsage
        activity?: AgentRunActivity
      }
      const sessionId = event.key.slice('sessions/'.length)
      const textDeltaLength = patch.textDelta?.length ?? 0
      log('partial event', {
        sessionId,
        partialId: event.partialId,
        textDeltaLength,
        done: patch.done === true,
        activity: patch.activity?.phase,
        totalTokens: patch.usage?.total,
      })
      setPartials((current) => {
        const existing = current[sessionId] ?? EMPTY_SESSION_LIVE_STATE
        // Usage and activity updates always apply, even on the `done` patch.
        const next: AgentSessionLiveState = {
          ...existing,
          ...(patch.usage ? {usage: patch.usage} : {}),
          ...(patch.activity ? {activity: patch.activity} : {}),
        }
        if (patch.done) {
          log('partial marked done; keeping visible until durable append', {
            sessionId,
            partialId: event.partialId,
            totalLength: existing.text.length,
          })
          return {...current, [sessionId]: next}
        }
        next.text = existing.text + (patch.textDelta || '')
        log('partial state updated', {sessionId, partialId: event.partialId, totalLength: next.text.length})
        return {...current, [sessionId]: next}
      })
    } else if (event._ === 'error') {
      log('server error event', {message: event.message})
    } else if (event._ === 'change') {
      log('change event', {changedKey: event.key})
      // Run rows tick often while a workflow executes; refreshing only the runs queries keeps
      // that from re-fetching every session and agent list on each step.
      if (event.key.startsWith('runs/')) invalidateQueries(['agents', 'runs'])
      else invalidateQueries(['agents'])
    }
  })

  if (!key?.startsWith('sessions/')) return EMPTY_SESSION_LIVE_STATE
  return partials[key.slice('sessions/'.length)] ?? EMPTY_SESSION_LIVE_STATE
}

/** Live, durable-first state for one run tree streamed over the WebSocket. */
export type AgentRunTreeLiveState = {
  /** Every run in the tree, keyed by run id, newest snapshot wins. */
  runs: Record<string, RunInfo>
  /** In-flight progress per run, from `appendPartial` — never persisted, purely animation. */
  progress: Record<string, {fraction?: number; label?: string}>
  /** What each run is doing right now, when reported. */
  activity: Record<string, AgentRunActivity>
  /** Journal entries received so far, oldest first (replayed durably on every (re)connect). */
  journal: RunJournalEntryInfo[]
}

const EMPTY_RUN_TREE_LIVE_STATE: AgentRunTreeLiveState = {runs: {}, progress: {}, activity: {}, journal: []}

/** Journal entries kept in memory per run tree. Well above what the activity drawer renders. */
const RUN_JOURNAL_BUFFER_LIMIT = 500

/**
 * Subscribes to one run tree (`runs/<rootRunId>`).
 *
 * Durable-first by construction: subscribing replays the current `RunInfo` of every run in the tree
 * plus its journal, so a reload rebuilds the whole progress card from the socket alone. Partials
 * only animate what the durable snapshots already say.
 */
export function useAgentRunTreeSubscription(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  rootRunId: string | undefined,
): AgentRunTreeLiveState {
  const [state, setState] = useState<AgentRunTreeLiveState>(() => ({runs: {}, progress: {}, activity: {}, journal: []}))
  const key = rootRunId ? (`runs/${rootRunId}` as const) : undefined

  // A different root means a different card; drop the previous tree rather than merging two.
  useEffect(() => {
    setState({runs: {}, progress: {}, activity: {}, journal: []})
  }, [key])

  useSignedAgentSocket(serverUrl, accountUid, key, undefined, (event, log) => {
    if (event._ === 'change' && event.key.startsWith('runs/')) {
      const run = event.value as RunInfo
      setState((current) => ({...current, runs: {...current.runs, [run.id]: run}}))
      // Keep the durable queries (and anything else reading runs) in step with the stream.
      invalidateQueries(['agents', 'runs'])
    } else if (event._ === 'append' && !('event' in event)) {
      const entry: RunJournalEntryInfo = {
        runId: event.runId,
        seq: event.seq,
        entry: event.entry,
        createdAt: event.createdAt,
      }
      setState((current) => {
        // Keyed on (runId, seq): seq is per-run, so it repeats across a tree's runs.
        if (current.journal.some((existing) => existing.runId === entry.runId && existing.seq === entry.seq)) {
          return current
        }
        // A long workflow journals without bound; the drawer only ever shows the tail.
        return {...current, journal: [...current.journal, entry].slice(-RUN_JOURNAL_BUFFER_LIMIT)}
      })
    } else if (event._ === 'appendPartial' && event.key.startsWith('runs/')) {
      const {runId, patch} = event as {runId: string; patch: AgentWSRunPatch}
      setState((current) => ({
        ...current,
        progress: patch.progress ? {...current.progress, [runId]: patch.progress} : current.progress,
        activity: patch.activity ? {...current.activity, [runId]: patch.activity} : current.activity,
      }))
    } else if (event._ === 'error') {
      log('run subscription error', {message: event.message})
    }
  })

  return rootRunId ? state : EMPTY_RUN_TREE_LIVE_STATE
}

/** Patch shape of a `runs/` appendPartial. */
type AgentWSRunPatch = {progress?: {fraction?: number; label?: string}; activity?: AgentRunActivity}

/** Adds an optimistic user message to the cached session while the signed request is in flight. */
/**
 * Optimistically drops a session from the cached cross-server session lists.
 *
 * Deletion flows call this before the DeleteSession round trip: anything that re-derives its
 * selection from the list (the sidebar picks "the agent's newest session" when none is selected)
 * would otherwise re-select the session that is being deleted from the still-stale cache.
 */
export function removeOptimisticSessionFromLists(serverUrl: string, accountUid: string, sessionId: string) {
  queryClient.setQueriesData({queryKey: ['agents', 'sessions', serverUrl, accountUid]}, (old: any) => {
    if (!Array.isArray(old)) return old
    return old.filter((entry: AgentSessionListEntry) => entry.session.id !== sessionId)
  })
}

/**
 * Optimistically seeds the caches with a session that was just created.
 *
 * The mirror of {@link removeOptimisticSessionFromLists}, for the same reason on the other side:
 * `CreateSession` only returns an id, and until the list refetch lands the sidebar's selection
 * resolver cannot attribute the new session to its agent — so it would fall back to the agent's
 * newest *old* session and the sync-back effect would make that wrong selection sticky. Seeding the
 * list entry and an empty `GetSession` response makes the new session attributable immediately (and
 * lets the optimistic first message render, which needs a cached session to attach to). Real
 * fetches replace both seeds as they land.
 */
export function addOptimisticSessionToCaches(serverUrl: string, accountUid: string, session: SessionInfo) {
  queryClient.setQueryData(['agents', 'sessions', serverUrl, accountUid], (old: any) => {
    const list = Array.isArray(old) ? old : []
    if (list.some((entry: AgentSessionListEntry) => entry.session.id === session.id)) return old
    return [{serverUrl, session} satisfies AgentSessionListEntry, ...list]
  })
  queryClient.setQueryData(['agents', 'session', serverUrl, accountUid, session.id], (old: any) => {
    if (old) return old
    return {_: 'GetSessionResponse', session, events: [], systemPromptMarkdown: ''}
  })
}

export function addOptimisticSessionMessage(
  serverUrl: string,
  accountUid: string,
  sessionId: string,
  message: AgentSessionDraftMessage | AgentSessionDraftMessage[],
): AgentSessionDraftMessage[] {
  // Every pending row gets an identity the server echoes back on the durable event. Callers send
  // the returned drafts, so the row and the message on the wire share one id and the echo replaces
  // exactly this row — text comparison can't do that, since the server re-serializes `content`.
  const messages = (Array.isArray(message) ? message : [message]).map((message) => ({
    ...message,
    clientMessageId: message.clientMessageId ?? crypto.randomUUID(),
  }))
  queryClient.setQueriesData({queryKey: ['agents', 'session', serverUrl, accountUid, sessionId]}, (old: any) => {
    if (!old || old._ !== 'GetSessionResponse') return old
    const now = Date.now()
    return {
      ...old,
      events: [
        ...old.events,
        ...messages.map((message) => ({
          id: `optimistic-${message.clientMessageId}`,
          sessionId,
          seq: Number.MAX_SAFE_INTEGER,
          event: {
            type: 'message',
            role: 'user',
            // Stamped rather than inferred: `role: 'user'` is a shape the runtime writes too, and
            // this row is the one case where the app knows for certain a person typed it.
            actor: 'user',
            content: message.text,
            rawMarkdown: message.text,
            clientMessageId: message.clientMessageId,
            ...(message.blocks ? {blocks: message.blocks} : {}),
            // Mirrors the durable event shape so the context info chip shows without waiting for
            // the server round trip.
            ...(message.contextLines?.length ? {contextLines: message.contextLines} : {}),
            ...(message.attachments?.length ? {attachments: message.attachments} : {}),
          },
          createdAt: now,
        })),
      ],
    }
  })
  return messages
}

/** Creates a session for an existing server-hosted agent from the desktop GUI. */
export function useCreateAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    // No title by default: the agent names its session, with a server-side fallback from the first
    // user message. Sending a display placeholder as a real title defeats both.
    mutationFn: async ({agentId, title}: {agentId: string; title?: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateSession', agentId, ...(title ? {title} : {}), clientRequestId: crypto.randomUUID()},
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
