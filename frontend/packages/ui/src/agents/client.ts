import type * as AgentsProtocol from '@seed-hypermedia/agents-protocol'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {getAgentsPlatform} from './platform'

/** Definition used when creating a server-hosted Seed agent. */
export type AgentDefinition = AgentsProtocol.AgentDefinition
/** One saved quick-switch choice: a model on a specific configured provider. */
export type AgentModelRef = AgentsProtocol.AgentModelRef
/** Rich block tree preserved for displaying user-authored session messages. */
export type AgentMessageBlock = AgentsProtocol.AgentMessageBlock
/** Message content part submitted to a session. */
export type MessageSessionContentPart = AgentsProtocol.MessageSessionContentPart
/** Public metadata returned by the agents service. */
export type AgentInfo = AgentsProtocol.AgentInfo
/** A read or write role granted to an agent collaborator. */
export type AgentCollaboratorRole = AgentsProtocol.AgentCollaboratorRole
/** One owner, collaborator, or pending invitation on an agent. */
export type AgentCollaboratorInfo = AgentsProtocol.AgentCollaboratorInfo
/** A pending agent invitation shown to its recipient. */
export type AgentInviteInfo = AgentsProtocol.AgentInviteInfo
/** Public metadata returned for a session. */
export type SessionInfo = AgentsProtocol.SessionInfo
/** Per-session model configuration overriding the agent definition's model. */
export type SessionModelOverride = AgentsProtocol.SessionModelOverride
/** Compact trigger attribution attached to sessions created by triggers. */
export type AgentSessionTriggerSummary = AgentsProtocol.AgentSessionTriggerSummary
/** Full trigger context passed into a trigger-created session. */
export type AgentSessionTriggerContext = AgentsProtocol.AgentSessionTriggerContext
/** Public metadata returned for an agent trigger. */
export type AgentTriggerInfo = AgentsProtocol.AgentTriggerInfo
export type TriggerContinuation = AgentsProtocol.TriggerContinuation
export type TriggerFailurePolicy = AgentsProtocol.TriggerFailurePolicy
export type TriggerFiringInfo = AgentsProtocol.TriggerFiringInfo
/** Input used to create an agent trigger. */
export type AgentTriggerInput = AgentsProtocol.AgentTriggerInput
/** Patch used to edit an agent trigger. */
export type AgentTriggerPatch = AgentsProtocol.AgentTriggerPatch
/** Activity source/filter that decides when an agent trigger fires. */
export type AgentTriggerSource = AgentsProtocol.AgentTriggerSource
/** Durable session event returned by the agents service. */
export type SessionEvent = AgentsProtocol.SessionEvent
/** Durable event payload returned by the agents service. */
export type SessionEventPayload = AgentsProtocol.SessionEventPayload
/** Who performed a logged action: the log is shared, so every entry says who acted. */
export type SessionActor = AgentsProtocol.SessionActor
/** User origin or runtime model/provider/usage/timing stamped on a durable event. */
export type SessionEventMeta = AgentsProtocol.SessionEventMeta
/** Server-sent WebSocket event after a signed subscription. */
export type AgentWSEvent = AgentsProtocol.AgentWSEvent
/** Cumulative token usage for the current agent run. */
export type AgentRunUsage = AgentsProtocol.AgentRunUsage
/** What the agent is actively doing right now. */
export type AgentRunActivity = AgentsProtocol.AgentRunActivity
/** Redacted provider metadata returned by the agents service. */
export type ModelProviderInfo = AgentsProtocol.RedactedModelProvider
/** Stored provider configuration (type, optional base URL, secret references). */
export type ModelProviderConfig = AgentsProtocol.ModelProviderConfig
/** Public model metadata returned by the agents service. */
export type ProviderModelInfo = AgentsProtocol.ProviderModelInfo
/** How a provider authenticates: stored API key or OAuth subscription sign-in. */
export type ModelProviderAuthMode = NonNullable<AgentsProtocol.ModelProviderConfig['authMode']>
/** Snapshot of a pending or finished provider OAuth sign-in. */
export type ProviderOAuthStatus = AgentsProtocol.ProviderOAuthStatusResponse
/** One tool document from an agent's ~/tools: a builtin binding, an authored lambda, or an MCP projection. */
export type AgentToolInfo = AgentsProtocol.AgentToolInfo
/** Redacted MCP server record: config minus secrets, plus its last discovered tools and status. */
export type McpServerInfo = AgentsProtocol.RedactedMcpServer
/** Configuration submitted for a remote MCP server. */
export type McpServerConfig = AgentsProtocol.McpServerConfig
/** Transport used to reach a remote MCP server. */
export type McpServerTransport = AgentsProtocol.McpServerTransport
/** One tool an MCP server advertises. */
export type McpToolInfo = AgentsProtocol.McpToolInfo
/** What the last discovery of an MCP server found. */
export type McpServerStatus = AgentsProtocol.McpServerStatus
/** Every editable field submitted when creating or updating an authored tool. */
export type AgentToolInput = AgentsProtocol.AgentToolInput
/** One file or directory inside an agent's private memory filesystem. */
export type AgentMemoryEntry = AgentsProtocol.AgentMemoryEntry
/** Contents of one agent memory file. */
export type AgentMemoryFile = AgentsProtocol.AgentMemoryFile
/** Metadata for one session-private file attached to a session message. */
export type SessionAttachmentInfo = AgentsProtocol.SessionAttachmentInfo
/** Destination of a chunked file upload: agent memory or a session attachment. */
export type FileUploadTarget = AgentsProtocol.FileUploadTarget
/** Public metadata for a server-side Seed account key secret. */
export type SigningIdentity = AgentsProtocol.SigningIdentity
/** Avatar image payload for updating an agent account profile. */
export type SigningIdentityIcon = AgentsProtocol.SigningIdentityIcon
/** Public metadata returned for a durable run. */
export type RunInfo = AgentsProtocol.RunInfo
/** Lifecycle status of a durable run. */
export type RunStatus = AgentsProtocol.RunStatus
/** Step list snapshot shared by session todo lists and run progress. */
export type RunPlan = AgentsProtocol.RunPlan
/** One durable entry in a run's journal. */
export type RunJournalEntryInfo = AgentsProtocol.RunJournalEntryInfo
/**
 * Provider types exposed in the desktop provider-management UI. Most are
 * OpenAI-compatible and differ only by base URL; `custom` lets the user point at
 * any OpenAI-compatible endpoint (self-hosted vLLM/LM Studio/LocalAI, etc.).
 */
export type ModelProviderType =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'deepseek'
  | 'groq'
  | 'xai'
  | 'ollama'
  | 'custom'

type AgentAction = AgentsProtocol.UnsignedAgentAction
type AgentsResponse = AgentsProtocol.AgentResponse

/** Health payload returned by the agent server status route. */
export type AgentServerHealth = {
  status: string
  uptime: number
  /** The Seed HM API server the agent publishes to; desktop connects its local node to this for discovery. */
  hmServerUrl?: string
  /** Direct IPFS gateway for reads. Usually the same origin; local desktop topology splits it. */
  ipfsServerUrl?: string
  /** Optional capability flags for tools that need server-side backends. Absent on older servers. */
  webTools?: {search: boolean; readBrowser: boolean}
  /** Whether the server offers subscription (OAuth) provider sign-in. Absent on older servers. */
  subscriptionAuth?: boolean
  /** Whether the server offers sandboxed code execution (execute_code). */
  codeExec?: boolean
  /** Human-readable explanation when codeExec is false. */
  codeExecReason?: string
  /** Machine-readable cause when codeExec is false (e.g. 'whp-disabled'), for targeted help UI. */
  codeExecReasonCode?: string
}

/** Normalizes an agent server URL for storage and fetch calls. */
export function normalizeAgentServerUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '')
  if (!value) throw new Error('Agent server URL is required')
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Agent server URL must start with http:// or https://')
  }
  if (url.pathname === '/agents' || url.pathname === '/agents/') {
    url.pathname = '/'
  }
  return url.toString().replace(/\/$/, '')
}

/** Returns the public delivery endpoint for an inbound webhook trigger. */
export function getAgentWebhookUrl(serverUrl: string, triggerId: string, secret?: string): string {
  const base = `${normalizeAgentServerUrl(serverUrl)}/agents/api/webhooks/${encodeURIComponent(triggerId)}`
  return secret ? `${base}/${encodeURIComponent(secret)}` : base
}

/** Returns true when a URL can safely receive secrets over the current transport. */
export function isSafeAgentServerSecretTarget(serverUrl: string): boolean {
  const url = new URL(normalizeAgentServerUrl(serverUrl))
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
}

/** Fetches agent server health from the built-in status endpoint. */
export async function getAgentServerHealth(serverUrl: string): Promise<AgentServerHealth> {
  const baseUrl = normalizeAgentServerUrl(serverUrl)
  const res = await fetch(`${baseUrl}/agents/api/health`)
  if (!res.ok) throw new Error(`Agent server health failed: HTTP ${res.status}`)
  return res.json()
}

/** Sends a signed CBOR action to the agents service. */
export function getAgentWebSocketUrl(serverUrl: string): string {
  const baseUrl = new URL(normalizeAgentServerUrl(serverUrl))
  baseUrl.protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  baseUrl.pathname = '/agents/ws'
  baseUrl.search = ''
  baseUrl.hash = ''
  return baseUrl.toString()
}

export async function signAgentAction(input: {accountUid: string; action: AgentAction}) {
  const platform = getAgentsPlatform()
  const signer = await platform.getSigner(input.accountUid)
  // The account is who the action is for; the signer is who holds the key. They differ on web,
  // where a delegated device key acts as the vault account: the envelope then names the account's
  // Capability so the server can verify the delegation itself (see the platform's getDelegation).
  const delegated = blobs.principalToString(signer.principal) !== input.accountUid
  const delegation = delegated ? await platform.getDelegation?.(input.accountUid) : null
  if (delegated && !delegation) {
    throw new Error('The local key holds no delegation for this account')
  }
  return blobs.sign(signer, {
    type: 'AgentsAction',
    signer: signer.principal,
    sig: new Uint8Array(blobs.ED25519_SIGNATURE_SIZE),
    account: blobs.principalFromString(input.accountUid),
    ...(delegation
      ? {
          capability: delegation.capabilityCid,
          ...(delegation.capabilityBlob ? {capabilityBlob: delegation.capabilityBlob} : {}),
        }
      : {}),
    action: {...omitUndefined(input.action), ts: Date.now()},
  } as unknown as blobs.Blob)
}

function omitUndefined<T>(value: T): T {
  if (value === undefined) return undefined as T
  if (value === null) return value
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map((item) => omitUndefined(item)) as T
  if (typeof value !== 'object') return value

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) output[key] = omitUndefined(item)
  }
  return output as T
}

/**
 * An error the agent server answered with (as opposed to a failed connection).
 *
 * Callers that hold onto a remembered resource across transient outages use the distinction: a
 * server that replied "not found" or "forbidden" has settled the question, while a fetch that never
 * reached it has not.
 */
export class AgentServerError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AgentServerError'
    this.status = status
  }
}

export async function sendAgentAction(input: {
  serverUrl: string
  accountUid: string
  action: AgentAction
}): Promise<AgentsResponse> {
  const baseUrl = normalizeAgentServerUrl(input.serverUrl)
  const envelope = await signAgentAction({accountUid: input.accountUid, action: input.action})

  const res = await fetch(`${baseUrl}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor', Accept: 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
  })
  const decoded = cbor.decode<AgentsResponse>(new Uint8Array(await res.arrayBuffer()))
  if (!res.ok || decoded._ === 'Error') {
    throw new AgentServerError(
      decoded._ === 'Error' ? decoded.message : `Agent server request failed: HTTP ${res.status}`,
      res.status,
    )
  }
  return decoded
}
