import {
  getAgentServerHealth,
  getAgentWebSocketUrl,
  isSafeAgentServerSecretTarget,
  normalizeAgentServerUrl,
  sendAgentAction,
  signAgentAction,
  type AgentCollaboratorInfo,
  type AgentCollaboratorRole,
  type AgentDefinition,
  type AgentInfo,
  type AgentMessageBlock,
  type AgentToolInput,
  type AgentRunActivity,
  type AgentRunUsage,
  type AgentTriggerInfo,
  type AgentTriggerInput,
  type AgentTriggerPatch,
  type AgentWSEvent,
  type MessageSessionContentPart,
  type ModelProviderConfig,
  type ModelProviderInfo,
  type ProviderModelInfo,
  type AgentMemoryEntry,
  type FileUploadTarget,
  type McpServerConfig,
  type McpServerInfo,
  type McpServerTransport,
  type ModelProviderType,
  type RunInfo,
  type RunJournalEntryInfo,
  type RunStatus,
  type SessionAttachmentInfo,
  type SessionInfo,
  type SessionModelOverride,
  type SigningIdentity,
  type SigningIdentityIcon,
} from './client'
import {isOptimisticUserEcho} from './agent-session-rows'
import {moveAgentToServer, type MoveAgentOptions} from './move-agent'
import {getAgentsPlatform} from './platform'
import {parseSpaceAgentIds} from './space-agents'
import {getToolReferencedUrls} from '@seed-hypermedia/agents-protocol'
import * as cbor from '@shm/shared/cbor'
import {getQueryClient, invalidateQueries} from '@shm/shared/models/query-client'
import type {HMMetadata} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {UniversalAppContext} from '@shm/shared/routing'
import type {NavRoute} from '@shm/shared/routes'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRouteOrNull} from '@shm/shared/utils/navigation'
// Deep import, not the `@shm/shared` barrel: that barrel pulls in protobuf, connectrpc, cheerio,
// katex, lowlight and react-tweet, none of which belong in a React Native bundle. This module is
// otherwise platform-neutral and is consumed by the mobile app.
import {queryKeys} from '@shm/shared/models/query-keys'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {useContext, useEffect, useMemo, useRef, useState} from 'react'

const AGENT_SERVER_URL_KEY = 'agent-server-url'
const AGENT_SERVER_URLS_KEY = 'agent-server-urls'
/** Returns the built-in default agent server URL for the host app's runtime, when it has one. */
export function getDefaultAgentServerUrl(): string | null {
  return getAgentsPlatform().defaultServerUrl()
}
/**
 * Poll-until-ready interval for the few queries with no event source: local-server startup and
 * transient state machines (a pending OAuth login, an in-flight run's safety net). Everything else
 * refreshes over the WebSocket — every server mutation emits a change event, so steady-state
 * polling was pure load (measured at ~17 signed actions/second against prod from idle clients).
 */
const AGENT_BACKGROUND_REFETCH_INTERVAL_MS = 5_000
/** Slow keep-alive for server health and HM-node peering, which have no change events. */
const AGENT_HEALTH_REFETCH_INTERVAL_MS = 60_000
/** Safety net for run state while a run is live, in case a WS event is dropped. Foreground only. */
const ACTIVE_RUN_SAFETY_REFETCH_INTERVAL_MS = 30_000

/**
 * Cancels in-flight fetches for the given keys, applies optimistic updates, and returns a rollback
 * for `onError`. The cancellation matters as much as the write: a refetch already in flight would
 * otherwise land on top of the optimistic value with older data — that race is what made
 * autosaving UIs flash back to stale state.
 */
async function applyOptimisticUpdates(
  updates: Array<{queryKey: unknown[]; update: (old: any) => any}>,
): Promise<() => void> {
  const client = getQueryClient()
  await Promise.all(updates.map(({queryKey}) => client.cancelQueries({queryKey})))
  const snapshots = updates.map(({queryKey}) => client.getQueriesData({queryKey}))
  for (const {queryKey, update} of updates) client.setQueriesData({queryKey}, update)
  return () => {
    for (const entries of snapshots) {
      for (const [key, data] of entries) client.setQueryData(key, data)
    }
  }
}

/** Writes a fresh agent snapshot into every cache that renders it (detail and lists). */
function applyAgentToCaches(serverUrl: string, accountUid: string, agent: AgentInfo): void {
  const client = getQueryClient()
  client.setQueriesData({queryKey: ['agents', 'detail', serverUrl, accountUid, agent.id]}, (old: any) => {
    if (!old || old._ !== 'GetAgentResponse') return old
    return {...old, agent}
  })
  client.setQueriesData({queryKey: ['agents', 'list', serverUrl, accountUid]}, (old: any) =>
    Array.isArray(old) ? old.map((entry: AgentInfo) => (entry.id === agent.id ? agent : entry)) : old,
  )
}

/**
 * Writes a fresh session snapshot into every cache that renders it: the session page, the
 * cross-server sidebar list (upserting a session the cache has not seen yet), and the owning
 * agent's cached session list.
 */
function applySessionToCaches(serverUrl: string, accountUid: string, session: SessionInfo): void {
  const client = getQueryClient()
  client.setQueriesData({queryKey: ['agents', 'session', serverUrl, accountUid, session.id]}, (old: any) => {
    if (!old || old._ !== 'GetSessionResponse') return old
    return {...old, session}
  })
  client.setQueriesData({queryKey: ['agents', 'sessions', serverUrl, accountUid]}, (old: any) => {
    if (!Array.isArray(old)) return old
    if (!old.some((entry: AgentSessionListEntry) => entry.session.id === session.id)) {
      return [{serverUrl, session} satisfies AgentSessionListEntry, ...old]
    }
    return old.map((entry: AgentSessionListEntry) => (entry.session.id === session.id ? {...entry, session} : entry))
  })
  client.setQueriesData({queryKey: ['agents', 'detail', serverUrl, accountUid]}, (old: any) => {
    if (!old || old._ !== 'GetAgentResponse' || !Array.isArray(old.sessions)) return old
    if (!old.sessions.some((existing: SessionInfo) => existing.id === session.id)) return old
    return {
      ...old,
      sessions: old.sessions.map((existing: SessionInfo) => (existing.id === session.id ? session : existing)),
    }
  })
}

/**
 * Refreshes exactly the queries one account-change can affect. The server names a reason on every
 * emit, so the client no longer refetches every agent query per event — that blanket invalidation
 * was most of the idle request load, and its refetch races flashed editing UIs to stale values.
 */
function invalidateForAccountChange(
  serverUrl: string,
  accountUid: string,
  value: {reason?: string; agentId?: string; sessionId?: string},
): void {
  const {reason, agentId, sessionId} = value
  switch (reason) {
    case 'agent-memory-changed':
      invalidateQueries(agentId ? ['agents', 'memory', serverUrl, accountUid, agentId] : ['agents', 'memory'])
      return
    case 'agent-tools-changed':
      invalidateQueries(agentId ? ['agents', 'tools', serverUrl, accountUid, agentId] : ['agents', 'tools'])
      return
    case 'trigger-created':
    case 'trigger-updated':
    case 'trigger-deleted':
      invalidateQueries(agentId ? ['agents', 'triggers', serverUrl, accountUid, agentId] : ['agents', 'triggers'])
      invalidateQueries(['agents', 'trigger', serverUrl, accountUid])
      return
    case 'agent-collaborators-changed':
      invalidateQueries(['agents', 'collaborators', serverUrl, accountUid])
      invalidateQueries(['agents', 'invites', serverUrl, accountUid])
      invalidateQueries(['agents', 'list', serverUrl, accountUid])
      return
    case 'agent-invites-changed':
      invalidateQueries(['agents', 'invites', serverUrl, accountUid])
      return
    case 'agent-created':
    case 'agent-deleted':
      invalidateQueries(['agents', 'list', serverUrl, accountUid])
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
      if (agentId) invalidateQueries(['agents', 'detail', serverUrl, accountUid, agentId])
      return
    case 'agent-updated':
      invalidateQueries(['agents', 'list', serverUrl, accountUid])
      if (agentId) invalidateQueries(['agents', 'detail', serverUrl, accountUid, agentId])
      return
    case 'mcp-servers-changed':
      invalidateQueries(['agents', 'mcp-servers', serverUrl, accountUid])
      invalidateQueries(['agents', 'tools', serverUrl, accountUid])
      return
    case 'model-provider-changed':
      invalidateQueries(['agents', 'providers', serverUrl, accountUid])
      invalidateQueries(['agents', 'provider-models', serverUrl, accountUid])
      return
    case 'session-created':
    case 'session-deleted':
    case 'session-updated':
    case 'user-title-wins':
    case 'session-event':
    case 'children':
    case 'budget-pause':
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
      if (sessionId) {
        invalidateQueries(['agents', 'session', serverUrl, accountUid, sessionId])
        invalidateQueries(['agents', 'child-sessions', serverUrl, accountUid])
      }
      if (agentId) invalidateQueries(['agents', 'detail', serverUrl, accountUid, agentId])
      if (reason === 'children' || reason === 'budget-pause') invalidateQueries(['agents', 'runs'])
      return
    default:
      // Unknown reason — likely a newer server. Refresh everything rather than miss it.
      invalidateQueries(['agents'])
  }
}

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

/**
 * Keeps agent-referenced resources synced for as long as their session is open.
 *
 * A comment URL (`hm://target/path/:comments/<author>/<tsid>`) canonicalizes to its target document, but a
 * comment is only synced as part of that document's subtree — so comment references subscribe
 * recursively, the same way the document page does. Plain document references stay non-recursive.
 *
 * Only a platform that runs a local HM node can sync; on the web this is a no-op.
 */
function subscribeToAgentReferences(
  urls: string[],
  activeSubscriptions: Map<string, AgentReferenceSubscription>,
): void {
  const subscribeToEntity = getAgentsPlatform().subscribeToEntity
  if (!subscribeToEntity) return
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
    const subscription = subscribeToEntity(
      {id, recursive: reference.recursive},
      {
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
  if (
    route.key !== 'agent-server' &&
    route.key !== 'agent' &&
    route.key !== 'agent-session' &&
    route.key !== 'agent-run'
  )
    return null
  return route.serverUrl || getDefaultAgentServerUrl()
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

/** Loads the URL of the agents server the host app runs locally, when there is one. */
export function useLocalAgentServerUrl() {
  const getLocalServerUrl = getAgentsPlatform().getLocalServerUrl
  return useQuery({
    queryKey: ['agents', 'local-server-url'],
    queryFn: async () => {
      if (!getLocalServerUrl) return null
      const url = await getLocalServerUrl()
      return url ? tryNormalizeAgentServerUrl(url) : null
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
      const platform = getAgentsPlatform()
      const storedList = await platform.getSetting(AGENT_SERVER_URLS_KEY)
      const storedDefault = await platform.getSetting(AGENT_SERVER_URL_KEY)
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
      const defaultServerUrl = getDefaultAgentServerUrl()
      if (configured.size === 0 && !Array.isArray(storedList) && defaultServerUrl) {
        configured.add(defaultServerUrl)
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
  const advertisedServerUrl = useSiteAdvertisedAgentServerUrl()

  // Order is meaning: the assistant panel's default agent context is the first agent of the first
  // server. The app's own local server keeps that spot; a server the site in view advertises comes
  // next, ahead of the user's configured list, so on a site (or the gateway, which shows many) the
  // panel opens on that site's agents.
  const data = useMemo(() => {
    if (!configured.data) return undefined
    const urls = new Set<string>()
    if (localServerUrl.data) urls.add(localServerUrl.data)
    if (advertisedServerUrl) urls.add(advertisedServerUrl)
    for (const url of configured.data) urls.add(url)
    return Array.from(urls)
  }, [advertisedServerUrl, configured.data, localServerUrl.data])

  return {...configured, data, advertisedServerUrl}
}

/**
 * Home document metadata of the space in view, if any.
 *
 * The space is the account of the current route's document (a draft's edit target counts). Where
 * the app is itself served by a space — the web app and the gateway — that space is the fallback
 * for routes that name no document, so the /hm/agents pages are still "in" the space hosting them.
 * The desktop app sets no origin, so there it is the route or nothing. Code rendered outside a
 * navigation provider (settings windows) reads no space at all rather than throwing.
 */
function useSiteHomeMetadata(): {metadata: HMMetadata | undefined; isLoading: boolean} {
  const route = useNavRouteOrNull()
  const originHomeId = useContext(UniversalAppContext).originHomeId
  const siteUid = (route ? siteUidOfRoute(route) : undefined) ?? originHomeId?.uid
  const home = useResource(siteUid ? hmId(siteUid) : undefined)
  return {
    metadata: home.data?.type === 'document' ? home.data.document?.metadata : undefined,
    // A disabled query (no space in view) also reports loading; only a real fetch counts.
    isLoading: !!siteUid && !!home.isLoading && home.data === undefined,
  }
}

/**
 * The agents server advertised by the site whose document is on screen, if any.
 *
 * Read from the site home document's `agentServerUrl` metadata — the same signed document that
 * names the site — so it is discoverable wherever the site's content is, with no server config.
 * It is never persisted into the user's configured list: it applies while viewing that site.
 */
export function useSiteAdvertisedAgentServerUrl(): string | null {
  const raw = useSiteHomeMetadata().metadata?.agentServerUrl
  return useMemo(() => (typeof raw === 'string' && raw ? tryNormalizeAgentServerUrl(raw) : null), [raw])
}

/** One agent a space publishes, paired with the server it lives on. */
export type SpaceAgentOption = {serverUrl: string; agent: AgentInfo}

/**
 * The agents the space in view publishes to its readers, in the order it published them.
 *
 * A reader cannot list a space's agents — `ListAgents` only ever returns agents the caller owns or
 * collaborates on — so each one is fetched by the id the space named in its home document. The
 * server resolves the owning account from the id itself and answers for any signed account once the
 * agent is public-read, which is what lets somebody who just joined a space open the assistant and
 * find something to talk to.
 *
 * Agents that fail to load are dropped rather than surfaced: a space naming an agent that was since
 * deleted, made private, or moved should quietly offer one fewer agent, not an error where a chat
 * belongs. The queries share their cache key with {@link useAgentDetail}, so opening one of these
 * agents in the full view renders from what the panel already loaded.
 *
 * The same `GetAgent` answer carries every session of the agent, and that is the only way a reader
 * gets to see them: the account-wide `ListSessions` the sidebar otherwise relies on covers agents
 * the account owns or collaborates on, never public ones — so a visitor's own chats with a space's
 * agent, let alone everybody else's, would stay hidden behind "no chats yet". They are returned
 * here as list entries (top level only; children nest under their parent's disclosure) for the
 * sidebar to merge into its session list.
 *
 * `isLoading` covers the space's home document as well as the agent fetches: until the home has
 * loaded there is no way to know whether the space publishes anything, and callers that settle
 * their selection on "the agent lists are in" must not settle on that gap.
 */
export function useSpaceAgents(accountUid: string | null | undefined): {
  agents: SpaceAgentOption[]
  sessions: AgentSessionListEntry[]
  isLoading: boolean
} {
  const {metadata, isLoading: isHomeLoading} = useSiteHomeMetadata()
  const rawServerUrl = metadata?.agentServerUrl
  const serverUrl = useMemo(
    () => (typeof rawServerUrl === 'string' && rawServerUrl ? tryNormalizeAgentServerUrl(rawServerUrl) : null),
    [rawServerUrl],
  )
  const agentIds = useMemo(() => parseSpaceAgentIds(metadata?.spaceAgents), [metadata?.spaceAgents])
  const queries = useQueries({
    queries: (serverUrl && accountUid ? agentIds : []).map((agentId) => ({
      queryKey: ['agents', 'detail', serverUrl, accountUid, agentId],
      queryFn: async () => {
        const res = await sendAgentAction({
          serverUrl: serverUrl!,
          accountUid: accountUid!,
          action: {_: 'GetAgent', agentId},
        })
        if (res._ !== 'GetAgentResponse') throw new Error('Unexpected GetAgent response')
        return res
      },
      retry: false,
      useErrorBoundary: false,
    })),
  })
  const responses = queries.map((query) => query.data)
  const agents = serverUrl
    ? responses
        .map((response) => response?.agent)
        .filter((agent): agent is AgentInfo => !!agent)
        .map((agent) => ({serverUrl, agent}))
    : []
  const sessions: AgentSessionListEntry[] = serverUrl
    ? responses.flatMap((response) =>
        response
          ? response.sessions
              .filter((session) => !session.parentSessionId)
              .map((session): AgentSessionListEntry => ({serverUrl, session, agent: response.agent}))
          : [],
      )
    : []
  return {agents, sessions, isLoading: isHomeLoading || queries.some((query) => query.isLoading)}
}

/** Account uid of the site a route is looking at, when the route is about a document. */
export function siteUidOfRoute(route: NavRoute): string | undefined {
  if (route.key === 'draft') return route.editUid ?? undefined
  if ('id' in route && route.id && typeof route.id === 'object' && 'uid' in route.id) {
    return (route.id as {uid?: string}).uid || undefined
  }
  return undefined
}

/** Persists the configured agent server URL list. */
export function useSetAgentServerUrls() {
  return useMutation({
    mutationFn: async (serverUrls: string[]) => {
      const normalized = Array.from(new Set(serverUrls.map((url) => normalizeAgentServerUrl(url))))
      const platform = getAgentsPlatform()
      await platform.setSetting(AGENT_SERVER_URLS_KEY, normalized)
      const currentDefault = await platform.getSetting(AGENT_SERVER_URL_KEY)
      const normalizedCurrentDefault =
        typeof currentDefault === 'string' ? tryNormalizeAgentServerUrl(currentDefault) : null
      if (!normalizedCurrentDefault || !normalized.includes(normalizedCurrentDefault)) {
        await platform.setSetting(AGENT_SERVER_URL_KEY, normalized[0] || null)
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
      const stored = await getAgentsPlatform().getSetting(AGENT_SERVER_URL_KEY)
      if (typeof stored !== 'string' || !stored) return getDefaultAgentServerUrl()
      return tryNormalizeAgentServerUrl(stored) || getDefaultAgentServerUrl()
    },
    useErrorBoundary: false,
  })
}

/** Persists the configured agent server URL for the desktop Agents page. */
export function useSetAgentServerUrl() {
  return useMutation({
    mutationFn: async (serverUrl: string) => {
      const normalized = normalizeAgentServerUrl(serverUrl)
      await getAgentsPlatform().setSetting(AGENT_SERVER_URL_KEY, normalized)
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
    queryFn: () => getAgentServerHealth(serverUrl || getDefaultAgentServerUrl() || ''),
    enabled: !!serverUrl,
    // Health has no change events, so it keeps a slow foreground poll — it is both the
    // connectivity indicator and how a server coming back from a restart is noticed.
    refetchInterval: AGENT_HEALTH_REFETCH_INTERVAL_MS,
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
  const canConnect = !!getAgentsPlatform().connectToHmServer
  return useQuery({
    queryKey: ['agents', 'hm-server-connect', hmServerUrl],
    enabled: !!hmServerUrl && canConnect,
    // Peering is a keep-alive with no event source; a slow foreground poll re-pins it.
    refetchInterval: AGENT_HEALTH_REFETCH_INTERVAL_MS,
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
  const connectToHmServer = getAgentsPlatform().connectToHmServer
  if (!connectToHmServer) return null
  return connectToHmServer(hmServerUrl)
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
  const platform = getAgentsPlatform()
  const targetServerUrl = serverUrl || getDefaultAgentServerUrl()
  if (!platform.discoverEntity || !targetServerUrl) return
  try {
    const health = await getAgentServerHealth(targetServerUrl)
    if (health.hmServerUrl) await connectLocalNodeToAgentHmServer(health.hmServerUrl)
    console.info('[agents-discovery] syncing new agent account to local node', {id: discoveryId})
    const resp = await platform.discoverEntity(discoveryId)
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

/**
 * Peers the local node with every configured server's HM node — the multi-server counterpart of
 * {@link useConnectLocalNodeToAgentHmServer}, sharing its query keys so the two never double-connect.
 */
function useConnectLocalNodeToAgentHmServers(serverUrls: string[] | undefined) {
  const healthQueries = useAgentServerHealths(serverUrls)
  const canConnect = !!getAgentsPlatform().connectToHmServer
  const hmServerUrls = useMemo(() => {
    const urls = new Set<string>()
    for (const query of healthQueries) {
      const hmServerUrl = query.data?.hmServerUrl
      if (hmServerUrl) urls.add(hmServerUrl)
    }
    return Array.from(urls).sort()
  }, [healthQueries])
  return useQueries({
    queries: hmServerUrls.map((hmServerUrl) => ({
      queryKey: ['agents', 'hm-server-connect', hmServerUrl],
      enabled: canConnect,
      // Peering is a keep-alive with no event source; a slow foreground poll re-pins it.
      refetchInterval: AGENT_HEALTH_REFETCH_INTERVAL_MS,
      retry: false,
      useErrorBoundary: false,
      queryFn: async () => connectLocalNodeToAgentHmServer(hmServerUrl),
    })),
  })
}

/**
 * Lists the signed-in account's uploaded HM account keys on each configured server — the
 * multi-server counterpart of {@link useSigningIdentities}, sharing its query keys.
 */
function useSigningIdentityLists(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  return useQueries({
    queries: (serverUrls || []).map((serverUrl) => ({
      queryKey: ['agents', 'signing-identities', serverUrl, accountUid, undefined],
      queryFn: async (): Promise<SigningIdentity[]> => {
        if (!accountUid) return []
        const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListSigningIdentities'}})
        if (res._ !== 'ListSigningIdentitiesResponse') throw new Error('Unexpected ListSigningIdentities response')
        return res.identities
      },
      enabled: !!accountUid,
      retry: false,
      useErrorBoundary: false,
    })),
  })
}

/**
 * Keeps every account the agents surface can author as synced on the local HM node for as long as
 * an agents page is on screen.
 *
 * Mentions and hm:// navigation elsewhere in the app only resolve accounts the local node has
 * synced, but agent signing accounts live on the agent server's HM node (or a shared agent owner's
 * node) — so without this, the user could watch an agent publish as an account and still be unable
 * to @mention it or open its site. This extends the existing screen-driven sync used for session
 * references ({@link subscribeToAgentReferences}) and resource pages: `platform.subscribeToEntity`
 * holds a live discovery subscription while the page stays mounted, and the daemon's hot-task TTL
 * retires it after navigation. A one-shot discover ({@link syncAgentAccountToLocalNode}) is not
 * enough here — it can race the HM-server peering or settle before new content is published.
 *
 * Three account sets, gathered across every configured server:
 * - the signed-in account's own signing identities (the "Agent Server Accounts" dialog set),
 *   subscribed recursively so their sites arrive whole;
 * - the granted signing identities of agents shared with this account (`ListSigningIdentities`
 *   scoped by agentId returns exactly the granted set for collaborators), also recursive;
 * - the owner accounts behind shared agents and pending invites, non-recursive — enough for their
 *   names and avatars to render.
 *
 * Only a platform with a local HM node participates; on the web every query stays disabled and
 * nothing subscribes.
 */
export function useAgentAccountsSync() {
  const platform = getAgentsPlatform()
  const canSync = !!platform.subscribeToEntity
  const accountUid = platform.useAccountUid()
  const serverUrlsQuery = useAgentServerUrls()
  const serverUrls = useMemo(() => (canSync ? serverUrlsQuery.data || [] : []), [canSync, serverUrlsQuery.data])

  // Discovery only fetches from connected peers, so keep the local node peered with every
  // configured server's HM node — not just the one an open session already peers with.
  useConnectLocalNodeToAgentHmServers(serverUrls)

  const agentQueries = useAgentLists(serverUrls, accountUid)
  const inviteQueries = useAgentInviteLists(serverUrls, accountUid)
  const ownIdentityQueries = useSigningIdentityLists(serverUrls, accountUid)

  // Owned agents can only be granted the account's own keys, which the unscoped lists already
  // cover — only shared agents need the per-agent granted set fetched.
  const sharedAgents = useMemo(
    () =>
      serverUrls.flatMap((serverUrl, index) =>
        (agentQueries[index]?.data || [])
          .filter((agent) => agent.accessRole && agent.accessRole !== 'owner')
          .map((agent) => ({serverUrl, agentId: agent.id, ownerAccountId: agent.account})),
      ),
    [agentQueries, serverUrls],
  )

  const sharedIdentityQueries = useQueries({
    queries: sharedAgents.map(({serverUrl, agentId}) => ({
      queryKey: ['agents', 'signing-identities', serverUrl, accountUid, agentId],
      queryFn: async (): Promise<SigningIdentity[]> => {
        if (!accountUid) return []
        const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListSigningIdentities', agentId}})
        if (res._ !== 'ListSigningIdentitiesResponse') throw new Error('Unexpected ListSigningIdentities response')
        return res.identities
      },
      enabled: !!accountUid,
      retry: false,
      useErrorBoundary: false,
    })),
  })

  const {authorUids, profileUids} = useMemo(() => {
    const authors = new Set<string>()
    for (const query of [...ownIdentityQueries, ...sharedIdentityQueries]) {
      for (const identity of query.data || []) {
        // Never derive a principal from identity.name — secret names only coincidentally embed a
        // uid prefix. accountId is the principal; identities without one cannot be synced.
        if (identity.accountId) authors.add(identity.accountId)
      }
    }
    const profiles = new Set<string>()
    for (const {ownerAccountId} of sharedAgents) {
      if (ownerAccountId) profiles.add(ownerAccountId)
    }
    for (const query of inviteQueries) {
      for (const invite of query.data || []) {
        if (invite.ownerAccountId) profiles.add(invite.ownerAccountId)
      }
    }
    for (const uid of Array.from(authors)) profiles.delete(uid)
    return {authorUids: Array.from(authors).sort(), profileUids: Array.from(profiles).sort()}
  }, [ownIdentityQueries, sharedIdentityQueries, sharedAgents, inviteQueries])

  // Re-subscribe only when the account sets actually change, not on every poll-driven render.
  const subscriptionsKey = `${authorUids.join(',')}|${profileUids.join(',')}`
  const targetsRef = useRef<{uid: string; recursive: boolean}[]>([])
  targetsRef.current = [
    ...authorUids.map((uid) => ({uid, recursive: true})),
    ...profileUids.map((uid) => ({uid, recursive: false})),
  ]

  useEffect(() => {
    const subscribeToEntity = getAgentsPlatform().subscribeToEntity
    if (!subscribeToEntity) return
    const targets = targetsRef.current
    if (targets.length === 0) return
    console.info('[agents-discovery] agents UI on screen — syncing signable accounts to local node', {
      authorAccounts: targets.filter(({recursive}) => recursive).map(({uid}) => uid),
      profileAccounts: targets.filter(({recursive}) => !recursive).map(({uid}) => uid),
    })
    const subscriptions = targets.flatMap(({uid, recursive}) => {
      const id = unpackHmId(`hm://${uid}`)
      if (!id) return []
      const discoveryId = `hm://${uid}${recursive ? '/**' : ''}`
      console.info('[agents-discovery] keeping agent account synced on local node', {id: discoveryId})
      return [
        subscribeToEntity(
          {id, recursive},
          {
            onError: (error) => {
              console.warn('[agents-discovery] agent account sync failed', {
                id: discoveryId,
                error: error instanceof Error ? error.message : String(error),
              })
            },
          },
        ),
      ]
    })
    return () => {
      console.info('[agents-discovery] agents UI left screen — releasing agent account subscriptions', {
        count: subscriptions.length,
      })
      subscriptions.forEach((subscription) => subscription.unsubscribe())
    }
  }, [subscriptionsKey])
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
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists pending agent invitations on one configured server. */
export function useAgentInvites(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useQuery({
    queryKey: ['agents', 'invites', serverUrl, accountUid],
    queryFn: async () => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgentInvites'}})
      if (res._ !== 'ListAgentInvitesResponse') throw new Error('Unexpected ListAgentInvites response')
      return res.invites
    },
    enabled: !!serverUrl && !!accountUid,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists pending invitations for each configured server. */
export function useAgentInviteLists(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  return useQueries({
    queries: (serverUrls || []).map((serverUrl) => ({
      queryKey: ['agents', 'invites', serverUrl, accountUid],
      queryFn: async () => {
        if (!accountUid) return []
        const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgentInvites'}})
        if (res._ !== 'ListAgentInvitesResponse') throw new Error('Unexpected ListAgentInvites response')
        return res.invites
      },
      enabled: !!accountUid,
      retry: false,
      useErrorBoundary: false,
    })),
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
      // Health has no change events; see useAgentServerHealth.
      refetchInterval: AGENT_HEALTH_REFETCH_INTERVAL_MS,
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
 *
 * The space in view counts too. A visitor owns no agents and collaborates on none, so every list
 * comes back empty for them — without this they would be told there is nothing to chat with while
 * standing in a space that publishes agents.
 */
export function useHasAnyAgent(serverUrls: string[] | undefined, accountUid: string | null | undefined) {
  const agentLists = useAgentLists(serverUrls, accountUid)
  const spaceAgents = useSpaceAgents(accountUid)
  const hasAgents = spaceAgents.agents.length > 0 || agentLists.some((query) => (query.data?.length || 0) > 0)
  // "No agents" is only meaningful once every server has answered. Treating the in-flight state as
  // empty would hide the assistant on each launch and discard the restored sidebar state.
  const isSettled =
    serverUrls !== undefined &&
    !spaceAgents.isLoading &&
    (agentLists.length === 0 || agentLists.every((query) => query.isSuccess || query.isError))
  return {hasAgents, isSettled}
}

/** Lists configured model providers for the selected account or a shared agent's owner. */
export function useModelProviders(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId?: string,
) {
  return useQuery({
    queryKey: ['agents', 'providers', serverUrl, accountUid, agentId],
    queryFn: async () => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'ListModelProviders', ...(agentId ? {agentId} : {})},
      })
      if (res._ !== 'ListModelProvidersResponse') throw new Error('Unexpected ListModelProviders response')
      return res.providers
    },
    enabled: !!serverUrl && !!accountUid,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Lists remote models available from one configured provider. */
export function useProviderModels(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  provider: string | undefined,
  agentId?: string,
) {
  return useQuery({
    queryKey: ['agents', 'provider-models', serverUrl, accountUid, provider, agentId],
    queryFn: async () => {
      if (!serverUrl || !accountUid || !provider) return []
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'ListProviderModels', provider, ...(agentId ? {agentId} : {})},
      })
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

/**
 * Fetches the model catalogs of several providers at once, keyed by provider
 * name. Shares query keys (and therefore cache) with {@link useProviderModels}.
 * A provider whose catalog has not loaded (or failed) maps to undefined so
 * callers can treat it as "unknown" rather than "empty".
 */
export function useProviderModelCatalogs(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  providerNames: string[],
  agentId?: string,
): Record<string, ProviderModelInfo[] | undefined> {
  const results = useQueries({
    queries: providerNames.map((provider) => ({
      queryKey: ['agents', 'provider-models', serverUrl, accountUid, provider, agentId],
      queryFn: async (): Promise<ProviderModelInfo[]> => {
        if (!serverUrl || !accountUid || !provider) return []
        const res = await sendAgentAction({
          serverUrl,
          accountUid,
          action: {_: 'ListProviderModels', provider, ...(agentId ? {agentId} : {})},
        })
        if (res._ !== 'ListProviderModelsResponse') throw new Error('Unexpected ListProviderModels response')
        return res.models
      },
      enabled: !!serverUrl && !!accountUid && !!provider,
      staleTime: 60 * 60 * 1000,
      cacheTime: 24 * 60 * 60 * 1000,
      retry: false,
      useErrorBoundary: false,
    })),
  })
  const catalogs: Record<string, ProviderModelInfo[] | undefined> = {}
  providerNames.forEach((name, index) => {
    catalogs[name] = results[index]?.data
  })
  return catalogs
}

/** Lists uploaded HM account keys for the selected account or a shared agent's owner. */
export function useSigningIdentities(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId?: string,
) {
  return useQuery({
    queryKey: ['agents', 'signing-identities', serverUrl, accountUid, agentId],
    queryFn: async (): Promise<SigningIdentity[]> => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'ListSigningIdentities', ...(agentId ? {agentId} : {})},
      })
      if (res._ !== 'ListSigningIdentitiesResponse') throw new Error('Unexpected ListSigningIdentities response')
      return res.identities
    },
    enabled: !!serverUrl && !!accountUid,
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
      invalidateQueries(['agents', 'signing-identities'])
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
      invalidateQueries(['agents', 'signing-identities'])
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
      invalidateQueries(['agents', 'signing-identities'])
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
    async onMutate(name) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'signing-identities', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old) ? old.filter((identity: SigningIdentity) => identity.name !== name) : old,
        },
      ])
    },
    onError(_error, _name, rollback) {
      rollback?.()
    },
    onSettled() {
      invalidateQueries(['agents', 'signing-identities'])
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
    async onMutate(name) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'providers', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old) ? old.filter((provider: ModelProviderInfo) => provider.name !== name) : old,
        },
      ])
    },
    onError(_error, _name, rollback) {
      rollback?.()
    },
    onSettled() {
      invalidateQueries(['agents', 'providers'])
      invalidateQueries(['agents', 'provider-models'])
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
      invalidateQueries(['agents', 'providers'])
      invalidateQueries(['agents', 'provider-models'])
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
      invalidateQueries(['agents', 'providers'])
      invalidateQueries(['agents', 'provider-models'])
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

/** Lists everyone with access to one agent, including pending invitations, plus its public-access flags. */
export function useAgentCollaborators(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'collaborators', serverUrl, accountUid, agentId],
    queryFn: async (): Promise<{
      collaborators: AgentCollaboratorInfo[]
      publicRead: boolean
      publicChat: boolean
    }> => {
      if (!serverUrl || !accountUid || !agentId) return {collaborators: [], publicRead: false, publicChat: false}
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListAgentCollaborators', agentId}})
      if (res._ !== 'ListAgentCollaboratorsResponse') throw new Error('Unexpected collaborator list response')
      return {
        collaborators: res.collaborators,
        publicRead: res.publicRead === true,
        publicChat: res.publicChat === true,
      }
    },
    enabled: !!serverUrl && !!accountUid && !!agentId,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Invites an account or updates an existing collaborator's role. */
export function useInviteAgentCollaborator(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      agentId,
      collaboratorAccountId,
      role,
    }: {
      agentId: string
      collaboratorAccountId: string
      role: AgentCollaboratorRole
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'InviteAgentCollaborator', agentId, accountId: collaboratorAccountId, role},
      })
    },
    onSuccess(result, {agentId}) {
      // The response carries the collaborator row — place it directly so the list shows the
      // invite without waiting for a refetch.
      if (result._ === 'InviteAgentCollaboratorResponse') {
        getQueryClient().setQueriesData(
          {queryKey: ['agents', 'collaborators', serverUrl, accountUid, agentId]},
          (old: any) => {
            if (!old || !Array.isArray(old.collaborators)) return old
            const others = old.collaborators.filter(
              (entry: AgentCollaboratorInfo) => entry.accountId !== result.collaborator.accountId,
            )
            return {...old, collaborators: [...others, result.collaborator]}
          },
        )
      }
      invalidateQueries(['agents', 'collaborators', serverUrl, accountUid, agentId])
      invalidateQueries(['agents', 'invites'])
    },
  })
}

/**
 * Optimistically flips one public-access flag everywhere it renders (the agent snapshot and the
 * sharing panel), so the toggle switch settles instantly instead of bouncing while caches refetch.
 */
function optimisticPublicFlagUpdates(
  serverUrl: string,
  accountUid: string,
  agentId: string,
  flag: 'publicRead' | 'publicChat',
  value: boolean,
): Array<{queryKey: unknown[]; update: (old: any) => any}> {
  return [
    {
      queryKey: ['agents', 'detail', serverUrl, accountUid, agentId],
      update: (old: any) => {
        if (!old || old._ !== 'GetAgentResponse') return old
        return {...old, agent: {...old.agent, [flag]: value}}
      },
    },
    {
      queryKey: ['agents', 'collaborators', serverUrl, accountUid, agentId],
      update: (old: any) => (old && typeof old === 'object' ? {...old, [flag]: value} : old),
    },
  ]
}

/** Owner-only: lets every signed account read the agent by id (or makes it private again). */
export function useSetAgentPublicRead(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, publicRead}: {agentId: string; publicRead: boolean}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'SetAgentPublicRead', agentId, publicRead}})
    },
    async onMutate({agentId, publicRead}) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates(
        optimisticPublicFlagUpdates(serverUrl, accountUid, agentId, 'publicRead', publicRead),
      )
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSuccess(result) {
      if (result._ === 'SetAgentPublicReadResponse' && serverUrl && accountUid) {
        applyAgentToCaches(serverUrl, accountUid, result.agent)
      }
    },
  })
}

/** Owner-only: lets every signed account chat with a public agent (create and message sessions). */
export function useSetAgentPublicChat(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, publicChat}: {agentId: string; publicChat: boolean}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'SetAgentPublicChat', agentId, publicChat}})
    },
    async onMutate({agentId, publicChat}) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates(
        optimisticPublicFlagUpdates(serverUrl, accountUid, agentId, 'publicChat', publicChat),
      )
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSuccess(result) {
      if (result._ === 'SetAgentPublicChatResponse' && serverUrl && accountUid) {
        applyAgentToCaches(serverUrl, accountUid, result.agent)
      }
    },
  })
}

/** Revokes a collaborator or cancels their pending invitation. */
export function useRemoveAgentCollaborator(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, collaboratorAccountId}: {agentId: string; collaboratorAccountId: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'RemoveAgentCollaborator', agentId, accountId: collaboratorAccountId},
      })
    },
    async onMutate({agentId, collaboratorAccountId}) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'collaborators', serverUrl, accountUid, agentId],
          update: (old: any) => {
            if (!old || !Array.isArray(old.collaborators)) return old
            return {
              ...old,
              collaborators: old.collaborators.filter(
                (entry: AgentCollaboratorInfo) => entry.accountId !== collaboratorAccountId,
              ),
            }
          },
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSettled(_result, _error, {agentId}) {
      invalidateQueries(['agents', 'collaborators', serverUrl, accountUid, agentId])
      invalidateQueries(['agents', 'invites'])
    },
  })
}

/** Optimistically drops one pending invite row, shared by the accept and decline flows. */
function optimisticInviteRemoval(serverUrl: string, accountUid: string, agentId: string) {
  return applyOptimisticUpdates([
    {
      queryKey: ['agents', 'invites', serverUrl, accountUid],
      update: (old: any) => (Array.isArray(old) ? old.filter((invite: any) => invite.agentId !== agentId) : old),
    },
  ])
}

/** Accepts one pending agent invitation. */
export function useAcceptAgentInvite(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (agentId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'AcceptAgentInvite', agentId}})
    },
    async onMutate(agentId) {
      if (!serverUrl || !accountUid) return undefined
      return optimisticInviteRemoval(serverUrl, accountUid, agentId)
    },
    onError(_error, _agentId, rollback) {
      rollback?.()
    },
    onSettled() {
      invalidateQueries(['agents', 'invites'])
      invalidateQueries(['agents', 'list'])
      invalidateQueries(['agents', 'sessions'])
    },
  })
}

/** Declines one pending agent invitation. */
export function useDeclineAgentInvite(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (agentId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeclineAgentInvite', agentId}})
    },
    async onMutate(agentId) {
      if (!serverUrl || !accountUid) return undefined
      return optimisticInviteRemoval(serverUrl, accountUid, agentId)
    },
    onError(_error, _agentId, rollback) {
      rollback?.()
    },
    onSettled() {
      invalidateQueries(['agents', 'invites'])
    },
  })
}

/** Deletes an existing server-hosted agent, dropping it from the cached lists immediately. */
export function useDeleteAgent(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (agentId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgent', agentId}})
    },
    async onMutate(agentId) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'list', serverUrl, accountUid],
          update: (old: any) => (Array.isArray(old) ? old.filter((agent: AgentInfo) => agent.id !== agentId) : old),
        },
        {
          queryKey: ['agents', 'sessions', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old) ? old.filter((entry: AgentSessionListEntry) => entry.session.agentId !== agentId) : old,
        },
      ])
    },
    onError(_error, _agentId, rollback) {
      rollback?.()
    },
    onSuccess(_result, agentId) {
      getQueryClient().removeQueries(['agents', 'detail', serverUrl, accountUid, agentId])
    },
    onSettled() {
      invalidateQueries(['agents', 'list'])
      invalidateQueries(['agents', 'sessions'])
    },
  })
}

/**
 * Moves one agent to another configured agent server: copies its portable state (definition,
 * memory, authored tools, triggers) to the target, then deletes the original. See
 * {@link moveAgentToServer} for what moves and what each server keeps.
 */
export function useMoveAgent(accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (input: Omit<MoveAgentOptions, 'accountUid' | 'send'>) => {
      if (!accountUid) throw new Error('Select an account first')
      return moveAgentToServer({...input, accountUid})
    },
    onSettled() {
      // The copy may exist even when the mutation errored (e.g. the source delete failed), so
      // refresh agent state on both servers regardless of outcome.
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
  getQueryClient().setQueryData(['agents', 'detail', serverUrl, accountUid, agentId], res)
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
    retry: false,
    useErrorBoundary: false,
  })
}

/**
 * Lists directory levels of one agent's private memory — one query per path, so the Memory tab
 * loads the tree lazily as directories are expanded and a huge memory never forces a full
 * recursive walk on the server (one agent's imported 192k-file tree used to freeze it).
 *
 * No polling: every memory mutation — user actions and agent `memory_*`/upload writes alike —
 * emits an account-change over the WebSocket, and that already invalidates the `['agents']`
 * queries (see {@link useAgentWebSocketSubscription}), so listings refresh the moment memory
 * actually changes.
 */
export function useAgentMemoryDirs(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  agentId: string | undefined,
  paths: string[],
) {
  return useQueries({
    queries: paths.map((path) => ({
      queryKey: ['agents', 'memory', serverUrl, accountUid, agentId, path],
      queryFn: async () => {
        if (!serverUrl || !accountUid || !agentId) return null
        const res = await sendAgentAction({
          serverUrl,
          accountUid,
          action: {_: 'ListAgentMemoryDir', agentId, ...(path ? {path} : {})},
        })
        if (res._ !== 'ListAgentMemoryDirResponse') throw new Error('Unexpected ListAgentMemoryDir response')
        return res
      },
      enabled: !!serverUrl && !!accountUid && !!agentId,
      retry: false,
      useErrorBoundary: false,
    })),
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
    retry: false,
    useErrorBoundary: false,
  })
}

/** Creates, edits, or atomically renames an authored tool document. */
export function useSaveAgentTool(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      agentId,
      tool,
      previousName,
    }: {
      agentId: string
      tool: AgentToolInput
      previousName?: string
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'SaveAgentTool', agentId, tool, ...(previousName ? {previousName} : {})},
      })
      if (res._ !== 'SaveAgentToolResponse') throw new Error('Unexpected SaveAgentTool response')
      return res
    },
    onSuccess() {
      invalidateQueries(['agents', 'tools'])
    },
  })
}

/** Permanently deletes an authored tool document. */
export function useDeleteAgentTool(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, name}: {agentId: string; name: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgentTool', agentId, name}})
      if (res._ !== 'DeleteAgentToolResponse') throw new Error('Unexpected DeleteAgentTool response')
      return res
    },
    async onMutate({agentId, name}) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'tools', serverUrl, accountUid, agentId],
          update: (old: any) => {
            if (!old || !Array.isArray(old.tools)) return old
            return {...old, tools: old.tools.filter((tool: {name: string}) => tool.name !== name)}
          },
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSettled() {
      invalidateQueries(['agents', 'tools'])
    },
  })
}

/** The account's MCP servers, with the tools each advertised at its last discovery. */
export function useMcpServers(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useQuery({
    queryKey: ['agents', 'mcp-servers', serverUrl, accountUid],
    queryFn: async (): Promise<McpServerInfo[]> => {
      if (!serverUrl || !accountUid) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListMcpServers'}})
      if (res._ !== 'ListMcpServersResponse') throw new Error('Unexpected ListMcpServers response')
      return res.servers
    },
    enabled: !!serverUrl && !!accountUid,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Input for connecting or editing an MCP server; the auth header value travels as an encrypted secret. */
export type SaveMcpServerInput = {
  name: string
  url: string
  transport?: McpServerTransport
  authHeaderName?: string
  authHeaderValue?: string
}

/**
 * Saves an MCP server. The server connects to it immediately and the response carries what it
 * found, so callers can show "connected, N tools" or the exact failure without another request.
 */
export function useSaveMcpServer(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({name, url, transport, authHeaderName, authHeaderValue}: SaveMcpServerInput) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const serverName = name.trim()
      if (!serverName) throw new Error('Server name is required')
      const trimmedUrl = url.trim()
      if (!trimmedUrl) throw new Error('Server URL is required')
      const config: McpServerConfig = {url: trimmedUrl}
      if (transport) config.transport = transport
      const headerName = authHeaderName?.trim() || 'Authorization'
      const headerValue = authHeaderValue?.trim()
      if (headerValue) {
        if (!isSafeAgentServerSecretTarget(serverUrl)) {
          throw new Error(
            'Refusing to send a secret header to a non-local HTTP agent server. Use HTTPS for remote servers.',
          )
        }
        const secretName = `mcp-${serverName}-${headerName.toLowerCase()}`
        await sendAgentAction({
          serverUrl,
          accountUid,
          action: {
            _: 'SetSecret',
            name: secretName,
            value: new TextEncoder().encode(headerValue),
            metadata: {kind: 'mcp-header', server: serverName, header: headerName},
          },
        })
        config.secretRefs = {[headerName]: secretName}
      }
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'SetMcpServer', name: serverName, config}})
      if (res._ !== 'SetMcpServerResponse') throw new Error('Unexpected SetMcpServer response')
      return res.server
    },
    onSuccess(server) {
      upsertMcpServerInCaches(serverUrl, accountUid, server)
      invalidateQueries(['agents', 'tools'])
    },
  })
}

/** Places a fresh MCP server row into the cached list (replacing its previous entry, if any). */
function upsertMcpServerInCaches(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  server: McpServerInfo,
): void {
  if (!serverUrl || !accountUid) return
  getQueryClient().setQueriesData({queryKey: ['agents', 'mcp-servers', serverUrl, accountUid]}, (old: any) => {
    if (!Array.isArray(old)) return old
    const others = old.filter((entry: McpServerInfo) => entry.name !== server.name)
    return [...others, server]
  })
}

/** Reconnects to an MCP server and re-discovers its tools. */
export function useRefreshMcpServer(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (name: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'RefreshMcpServer', name}})
      if (res._ !== 'SetMcpServerResponse') throw new Error('Unexpected RefreshMcpServer response')
      return res.server
    },
    onSuccess(server) {
      upsertMcpServerInCaches(serverUrl, accountUid, server)
      invalidateQueries(['agents', 'tools'])
    },
  })
}

/** Deletes an MCP server, its header secrets, and every agent's projection of it. */
export function useDeleteMcpServer(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (name: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteMcpServer', name}})
      if (res._ !== 'DeleteMcpServerResponse') throw new Error('Unexpected DeleteMcpServer response')
      return res
    },
    async onMutate(name) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'mcp-servers', serverUrl, accountUid],
          update: (old: any) => (Array.isArray(old) ? old.filter((entry: McpServerInfo) => entry.name !== name) : old),
        },
      ])
    },
    onError(_error, _name, rollback) {
      rollback?.()
    },
    onSettled() {
      invalidateQueries(['agents', 'mcp-servers'])
      invalidateQueries(['agents', 'tools'])
    },
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
    async onMutate({agentId, path, content}) {
      if (!serverUrl || !accountUid || typeof content !== 'string') return undefined
      // The saved text is the cache's new truth immediately, so the editor never renders the
      // previous revision between clearing its draft and the listing refetch landing.
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'memory', serverUrl, accountUid, agentId, 'file', path],
          update: (old: any) => {
            if (!old || old.encoding !== 'utf8') return old
            return {
              ...old,
              content,
              size: new TextEncoder().encode(content).byteLength,
              updatedAt: Date.now(),
            }
          },
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSettled(_result, _error, {agentId}) {
      invalidateQueries(['agents', 'memory', serverUrl, accountUid, agentId])
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
    onSuccess(_result, {agentId}) {
      invalidateQueries(['agents', 'memory', serverUrl, accountUid, agentId])
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

/** Deletes one file or directory from an agent's private memory, dropping its rows immediately. */
export function useDeleteAgentMemoryFile(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, path}: {agentId: string; path: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgentMemoryFile', agentId, path}})
    },
    async onMutate({agentId, path}) {
      if (!serverUrl || !accountUid) return undefined
      // Filter the deleted path (and anything under it, for directories) out of every cached
      // directory level, so the tree row disappears on click instead of after the refetch.
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'memory', serverUrl, accountUid, agentId],
          update: (old: any) => {
            if (!old || !Array.isArray(old.entries)) return old
            const entries = old.entries.filter(
              (entry: {path: string}) => entry.path !== path && !entry.path.startsWith(`${path}/`),
            )
            return entries.length === old.entries.length ? old : {...old, entries}
          },
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSettled(_result, _error, {agentId}) {
      invalidateQueries(['agents', 'memory', serverUrl, accountUid, agentId])
    },
  })
}

/** Creates an activity trigger for one agent. */
export function useCreateAgentTrigger(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      agentId,
      trigger,
      clientRequestId,
    }: {
      agentId: string
      trigger: AgentTriggerInput
      clientRequestId?: string
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      if (trigger.source.type === 'webhook' && !isSafeAgentServerSecretTarget(serverUrl)) {
        throw new Error(
          'Refusing to create a webhook over a non-local HTTP agent server. Use HTTPS for remote servers.',
        )
      }
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateAgentTrigger', agentId, trigger, clientRequestId: clientRequestId ?? crypto.randomUUID()},
      })
    },
    onSuccess(result, {agentId}) {
      // The response carries the created trigger — place it so the list shows it immediately.
      if (result._ === 'CreateAgentTriggerResponse') {
        getQueryClient().setQueriesData(
          {queryKey: ['agents', 'triggers', serverUrl, accountUid, agentId]},
          (old: any) => (Array.isArray(old) ? [...old, result.trigger] : old),
        )
      }
      invalidateQueries(['agents', 'triggers', serverUrl, accountUid, agentId])
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
    onSuccess(_result, {sessionId}) {
      // The WS append is primary, but a stale socket must never hide a durable action.
      invalidateQueries(['agents', 'session', serverUrl, accountUid, sessionId])
    },
  })
}

/**
 * Updates an existing activity trigger, optimistically: the patch merges into the cached rows
 * before the round trip, so an enable/disable toggle settles instantly instead of bouncing.
 */
export function useUpdateAgentTrigger(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({triggerId, patch}: {triggerId: string; patch: AgentTriggerPatch}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateAgentTrigger', triggerId, patch}})
    },
    async onMutate({triggerId, patch}) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'triggers', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old)
              ? old.map((trigger: AgentTriggerInfo) => (trigger.id === triggerId ? {...trigger, ...patch} : trigger))
              : old,
        },
        {
          queryKey: ['agents', 'trigger', serverUrl, accountUid, triggerId],
          update: (old: any) => {
            if (!old || old._ !== 'GetAgentTriggerResponse') return old
            return {...old, trigger: {...old.trigger, ...patch}}
          },
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSuccess(result, {triggerId}) {
      if (result._ !== 'UpdateAgentTriggerResponse') return
      getQueryClient().setQueriesData({queryKey: ['agents', 'triggers', serverUrl, accountUid]}, (old: any) =>
        Array.isArray(old)
          ? old.map((trigger: AgentTriggerInfo) => (trigger.id === triggerId ? result.trigger : trigger))
          : old,
      )
      getQueryClient().setQueriesData(
        {queryKey: ['agents', 'trigger', serverUrl, accountUid, triggerId]},
        (old: any) => {
          if (!old || old._ !== 'GetAgentTriggerResponse') return old
          return {...old, trigger: result.trigger}
        },
      )
    },
  })
}

/** Deletes an existing activity trigger, dropping its cached rows immediately. */
export function useDeleteAgentTrigger(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (triggerId: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteAgentTrigger', triggerId}})
    },
    async onMutate(triggerId) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'triggers', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old) ? old.filter((trigger: AgentTriggerInfo) => trigger.id !== triggerId) : old,
        },
      ])
    },
    onError(_error, _triggerId, rollback) {
      rollback?.()
    },
    onSettled(_result, _error, triggerId) {
      invalidateQueries(['agents', 'triggers'])
      getQueryClient().removeQueries(['agents', 'trigger', serverUrl, accountUid, triggerId])
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
    retry: false,
    useErrorBoundary: false,
  })
}

/**
 * Fetches one durable session event in full. Session loads wire-truncate giant payloads (a
 * multi-megabyte tool output would make every open slow); this is the on-demand path for the
 * rare click that actually wants all of it.
 */
export function useFullAgentSessionEvent(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  sessionId: string | undefined,
  seq: number | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['agents', 'session-event', serverUrl, accountUid, sessionId, seq],
    queryFn: async () => {
      const res = await sendAgentAction({
        serverUrl: serverUrl!,
        accountUid: accountUid!,
        action: {_: 'GetSessionEvent', sessionId: sessionId!, seq: seq!},
      })
      if (res._ !== 'GetSessionEventResponse') throw new Error('Unexpected GetSessionEvent response')
      return res.event
    },
    enabled: enabled && !!serverUrl && !!accountUid && !!sessionId && seq !== undefined,
    staleTime: Infinity,
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
    // Only while a disclosure is open, matching how the top-level session lists stay current.    retry: false,
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
    // Run changes stream over the WebSocket; this slow poll is only a safety net while the run is
    // live, in case an event is dropped. A finished run never changes again, so it stops entirely.
    refetchInterval: (data) =>
      data && TERMINAL_RUN_STATUSES.includes(data.status) ? false : ACTIVE_RUN_SAFETY_REFETCH_INTERVAL_MS,
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
    // Run changes publish on `runs/<rootRunId>` and reach the session page through its
    // account-wide subscription (which invalidates the runs queries). The slow poll is only a
    // safety net while a run is live — this is what tells a sub-session page its parent has let
    // go of it, so a dropped event must not strand that state.
    refetchInterval: (data) =>
      data?.some((run) => !TERMINAL_RUN_STATUSES.includes(run.status)) ? ACTIVE_RUN_SAFETY_REFETCH_INTERVAL_MS : false,
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

/**
 * Updates an existing server-hosted agent, optimistically: the submitted definition lands in the
 * caches before the round trip, so an autosaving editor never watches its own change flash back to
 * the old value. No broad invalidation afterwards — the response (and the WS agent-change it
 * triggers) carries the fresh snapshot, and refetching the just-written queries only reopens the
 * stale-response race the optimistic write closed.
 */
export function useUpdateAgent(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({agentId, definition}: {agentId: string; definition: AgentDefinition}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateAgent', agentId, definition}})
    },
    async onMutate({agentId, definition}) {
      if (!serverUrl || !accountUid) return undefined
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'detail', serverUrl, accountUid, agentId],
          update: (old: any) => {
            if (!old || old._ !== 'GetAgentResponse') return old
            return {...old, agent: {...old.agent, definition}}
          },
        },
        {
          queryKey: ['agents', 'list', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old)
              ? old.map((agent: AgentInfo) => (agent.id === agentId ? {...agent, definition} : agent))
              : old,
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSuccess(result) {
      if (result._ === 'GetAgentResponse' && serverUrl && accountUid) {
        applyAgentToCaches(serverUrl, accountUid, result.agent)
      }
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
    onSuccess(_result, {sessionId}) {
      // The durable events stream over the session's WS subscription; refetch only this session
      // (a safety net for a stale socket) and the list (ordering/title may have changed).
      invalidateQueries(['agents', 'session', serverUrl, accountUid, sessionId])
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
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
    onSuccess(_result, sessionId) {
      invalidateQueries(['agents', 'session', serverUrl, accountUid, sessionId])
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
      invalidateQueries(['agents', 'runs'])
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
    onSuccess(_result, sessionId) {
      invalidateQueries(['agents', 'session', serverUrl, accountUid, sessionId])
      invalidateQueries(['agents', 'runs'])
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
        // Refreshing is event-driven, so a reconnect must assume events were missed while the
        // socket was down and refetch once. (`afterSeq` replays session appends, but change
        // events for lists, agents, and runs have no replay.)
        if (retry > 0) invalidateQueries(['agents'])
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
      getQueryClient().setQueriesData(
        {queryKey: ['agents', 'session', serverUrl, accountUid, sessionId]},
        (old: any) => {
          if (!old || old._ !== 'GetSessionResponse') return old
          if (old.events.some((existing: any) => existing.id === event.event.id)) return old
          const events = old.events.filter((existing: any) => {
            if (typeof existing.id !== 'string' || !existing.id.startsWith('optimistic-')) return true
            // Only a message the USER wrote can be the echo of a message the user is waiting on. The
            // runtime writes as `role: 'user'` too, mid-run, over this same stream.
            return !isOptimisticUserEcho(event.event.event, existing.event)
          })
          return {...old, events: [...events, event.event]}
        },
      )
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
      if (event.key.startsWith('runs/')) {
        invalidateQueries(['agents', 'runs'])
      } else if (event.key.startsWith('agents/') && serverUrl && accountUid) {
        // The event carries the fresh agent snapshot — write it straight into the caches
        // instead of refetching it back from the server.
        applyAgentToCaches(serverUrl, accountUid, event.value as AgentInfo)
      } else if (event.key.startsWith('sessions/') && serverUrl && accountUid) {
        applySessionToCaches(serverUrl, accountUid, event.value as SessionInfo)
      } else if (event.key.startsWith('account/') && serverUrl && accountUid) {
        invalidateForAccountChange(serverUrl, accountUid, (event.value ?? {}) as {reason?: string; agentId?: string})
      } else {
        invalidateQueries(['agents'])
      }
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
  getQueryClient().setQueriesData({queryKey: ['agents', 'sessions', serverUrl, accountUid]}, (old: any) => {
    if (!Array.isArray(old)) return old
    return old.filter((entry: AgentSessionListEntry) => entry.session.id !== sessionId)
  })
  // A space agent's sessions reach the sidebar through its cached GetAgent answer (see
  // useSpaceAgents), so that copy of the list must forget the session too.
  getQueryClient().setQueriesData({queryKey: ['agents', 'detail', serverUrl, accountUid]}, (old: any) => {
    if (!old || old._ !== 'GetAgentResponse' || !Array.isArray(old.sessions)) return old
    if (!old.sessions.some((session: SessionInfo) => session.id === sessionId)) return old
    return {...old, sessions: old.sessions.filter((session: SessionInfo) => session.id !== sessionId)}
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
  getQueryClient().setQueryData(['agents', 'sessions', serverUrl, accountUid], (old: any) => {
    const list = Array.isArray(old) ? old : []
    if (list.some((entry: AgentSessionListEntry) => entry.session.id === session.id)) return old
    return [{serverUrl, session} satisfies AgentSessionListEntry, ...list]
  })
  getQueryClient().setQueryData(['agents', 'session', serverUrl, accountUid, session.id], (old: any) => {
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
  getQueryClient().setQueriesData({queryKey: ['agents', 'session', serverUrl, accountUid, sessionId]}, (old: any) => {
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
            // The exact signer arrives with the durable echo; the acting account is already known
            // locally, so its profile icon can render without waiting for the round trip.
            meta: {accountId: accountUid},
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
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
      invalidateQueries(['agents', 'detail', serverUrl, accountUid])
    },
  })
}

/** Creates a session on the server associated with a listed agent. */
export function useCreateAgentSessionOnServer(accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({serverUrl, agentId, title}: {serverUrl: string; agentId: string; title?: string}) => {
      if (!accountUid) throw new Error('Select an account first')
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateSession', agentId, ...(title ? {title} : {}), clientRequestId: crypto.randomUUID()},
      })
    },
    onSuccess(_result, {serverUrl}) {
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
      invalidateQueries(['agents', 'detail', serverUrl, accountUid])
    },
  })
}

/** Updates editable session metadata from the desktop GUI. */
export function useUpdateAgentSession(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({
      sessionId,
      title,
      modelOverride,
    }: {
      sessionId: string
      title?: string
      /** Pins the session to a provider/model pair; null returns it to the agent's own model. */
      modelOverride?: SessionModelOverride | null
    }) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const res = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'UpdateSession',
          sessionId,
          ...(title !== undefined ? {title} : {}),
          ...(modelOverride !== undefined ? {modelOverride} : {}),
        },
      })
      if (res._ !== 'UpdateSessionResponse') throw new Error('Unexpected UpdateSession response')
      return res.session
    },
    async onMutate({sessionId, title, modelOverride}) {
      if (!serverUrl || !accountUid) return undefined
      // Merge the edited fields into every cached copy immediately, so a rename never flashes
      // back to the old title while the round trip is in flight.
      const patchSession = (session: SessionInfo): SessionInfo => ({
        ...session,
        ...(title !== undefined ? {title} : {}),
        ...(modelOverride !== undefined ? {modelOverride: modelOverride ?? undefined} : {}),
      })
      return applyOptimisticUpdates([
        {
          queryKey: ['agents', 'session', serverUrl, accountUid, sessionId],
          update: (old: any) => {
            if (!old || old._ !== 'GetSessionResponse') return old
            return {...old, session: patchSession(old.session)}
          },
        },
        {
          queryKey: ['agents', 'sessions', serverUrl, accountUid],
          update: (old: any) =>
            Array.isArray(old)
              ? old.map((entry: AgentSessionListEntry) =>
                  entry.session.id === sessionId ? {...entry, session: patchSession(entry.session)} : entry,
                )
              : old,
        },
        {
          queryKey: ['agents', 'detail', serverUrl, accountUid],
          update: (old: any) => {
            if (!old || old._ !== 'GetAgentResponse' || !Array.isArray(old.sessions)) return old
            if (!old.sessions.some((session: SessionInfo) => session.id === sessionId)) return old
            return {
              ...old,
              sessions: old.sessions.map((session: SessionInfo) =>
                session.id === sessionId ? patchSession(session) : session,
              ),
            }
          },
        },
      ])
    },
    onError(_error, _variables, rollback) {
      rollback?.()
    },
    onSuccess(updatedSession) {
      if (serverUrl && accountUid) applySessionToCaches(serverUrl, accountUid, updatedSession)
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
    onMutate(sessionId) {
      // Drop the session from the cached lists right away, so selection resolvers cannot
      // re-select the row that is being deleted (see removeOptimisticSessionFromLists).
      if (serverUrl && accountUid) removeOptimisticSessionFromLists(serverUrl, accountUid, sessionId)
    },
    onSuccess(deletedSession) {
      getQueryClient().removeQueries(['agents', 'session', serverUrl, accountUid, deletedSession.sessionId])
    },
    onSettled() {
      invalidateQueries(['agents', 'sessions', serverUrl, accountUid])
      invalidateQueries(['agents', 'detail', serverUrl, accountUid])
    },
  })
}
