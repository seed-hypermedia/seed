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
  type McpServerConfig,
  type McpServerInfo,
  type McpServerTransport,
  type McpToolInfo,
  type MessageSessionContentPart,
  type ModelProviderInfo,
  type ModelProviderType,
  type SigningIdentity,
} from '@/agents-client'
import {client} from '@/trpc'
import * as cbor from '@shm/shared/cbor'
import {invalidateQueries, queryClient} from '@shm/shared/models/query-client'
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
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Renames a server-side HM account key and republishes its profile. */
export function useUpdateSigningIdentity(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({name, label}: {name: string; label: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'UpdateSigningIdentity', name, label}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
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

/** Lists configured MCP servers for the selected account on the configured server. */
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
    refetchInterval: AGENT_BACKGROUND_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Connects to one MCP server and lists the tools it advertises. */
export function useMcpServerTools(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
  name: string | undefined,
) {
  return useQuery({
    queryKey: ['agents', 'mcp-server-tools', serverUrl, accountUid, name],
    queryFn: async (): Promise<McpToolInfo[]> => {
      if (!serverUrl || !accountUid || !name) return []
      const res = await sendAgentAction({serverUrl, accountUid, action: {_: 'ListMcpServerTools', name}})
      if (res._ !== 'ListMcpServerToolsResponse') throw new Error('Unexpected ListMcpServerTools response')
      return res.tools
    },
    enabled: !!serverUrl && !!accountUid && !!name,
    staleTime: 5 * 60 * 1000,
    retry: false,
    useErrorBoundary: false,
  })
}

/** Input for creating or updating an MCP server, with an optional secret-backed auth header. */
export type SaveMcpServerInput = {
  name: string
  url: string
  transport?: McpServerTransport
  headers?: Record<string, string>
  /** Optional auth header sent encrypted: when set, stored as a secret and referenced by name. */
  authHeaderName?: string
  authHeaderValue?: string
}

/** Stores an MCP server config, persisting any auth header value as an encrypted account secret. */
export function useSaveMcpServer(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({name, url, transport, headers, authHeaderName, authHeaderValue}: SaveMcpServerInput) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      const serverName = name.trim()
      if (!serverName) throw new Error('MCP server name is required')
      const trimmedUrl = url.trim()
      if (!trimmedUrl) throw new Error('MCP server URL is required')

      const config: McpServerConfig = {url: trimmedUrl}
      if (transport) config.transport = transport
      if (headers && Object.keys(headers).length) config.headers = headers

      const headerName = authHeaderName?.trim()
      const headerValue = authHeaderValue?.trim()
      if (headerName && headerValue) {
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

      return sendAgentAction({serverUrl, accountUid, action: {_: 'SetMcpServer', name: serverName, config}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Deletes a configured MCP server and any secret headers it owns. */
export function useDeleteMcpServer(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async (name: string) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      return sendAgentAction({serverUrl, accountUid, action: {_: 'DeleteMcpServer', name}})
    },
    onSuccess() {
      invalidateQueries(['agents'])
    },
  })
}

/** Stores an API key and configures a model provider. */
export function useSaveModelProvider(serverUrl: string | undefined, accountUid: string | null | undefined) {
  return useMutation({
    mutationFn: async ({type, name, apiKey}: {type: ModelProviderType; name: string; apiKey: string}) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and agent server first')
      if (!isSafeAgentServerSecretTarget(serverUrl)) {
        throw new Error('Refusing to send API key to a non-local HTTP agent server. Use HTTPS for remote servers.')
      }
      const providerName = name.trim()
      if (!providerName) throw new Error('Provider name is required')
      const trimmed = apiKey.trim()
      if (!trimmed) throw new Error('API key is required')
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
      return sendAgentAction({
        serverUrl,
        accountUid,
        action: {
          _: 'SetModelProvider',
          name: providerName,
          provider: {type, secretRefs: {apiKey: secretName}},
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
              const eventPayload = event.event.event as {type?: string; role?: string; content?: string}
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
