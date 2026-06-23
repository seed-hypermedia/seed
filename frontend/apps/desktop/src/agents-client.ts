import {grpcClient} from '@/grpc-client'
import type * as AgentsProtocol from '@seed-hypermedia/agents-protocol'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@shm/shared/cbor'
import {base58btc} from 'multiformats/bases/base58'

/** Definition used when creating a server-hosted Seed agent. */
export type AgentDefinition = AgentsProtocol.AgentDefinition
/** Rich block tree preserved for displaying user-authored session messages. */
export type AgentMessageBlock = AgentsProtocol.AgentMessageBlock
/** Message content part submitted to a session. */
export type MessageSessionContentPart = AgentsProtocol.MessageSessionContentPart
/** Public metadata returned by the agents service. */
export type AgentInfo = AgentsProtocol.AgentInfo
/** Public metadata returned for a session. */
export type SessionInfo = AgentsProtocol.SessionInfo
/** Compact trigger attribution attached to sessions created by triggers. */
export type AgentSessionTriggerSummary = AgentsProtocol.AgentSessionTriggerSummary
/** Full trigger context passed into a trigger-created session. */
export type AgentSessionTriggerContext = AgentsProtocol.AgentSessionTriggerContext
/** Public metadata returned for an agent trigger. */
export type AgentTriggerInfo = AgentsProtocol.AgentTriggerInfo
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
/** Server-sent WebSocket event after a signed subscription. */
export type AgentWSEvent = AgentsProtocol.AgentWSEvent
/** Cumulative token usage for the current agent run. */
export type AgentRunUsage = AgentsProtocol.AgentRunUsage
/** What the agent is actively doing right now. */
export type AgentRunActivity = AgentsProtocol.AgentRunActivity
/** Redacted provider metadata returned by the agents service. */
export type ModelProviderInfo = AgentsProtocol.RedactedModelProvider
/** Public model metadata returned by the agents service. */
export type ProviderModelInfo = AgentsProtocol.ProviderModelInfo
/** Public metadata for a server-side Seed account key secret. */
export type SigningIdentity = AgentsProtocol.SigningIdentity
/** Provider types exposed in the desktop provider-management UI. */
export type ModelProviderType = 'openai' | 'anthropic' | 'google'

type AgentAction = AgentsProtocol.UnsignedAgentAction
type AgentsResponse = AgentsProtocol.AgentResponse

/** Health payload returned by the agent server status route. */
export type AgentServerHealth = {
  status: string
  uptime: number
  /** Optional capability flags for tools that need server-side backends. Absent on older servers. */
  webTools?: {search: boolean; readBrowser: boolean}
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
  const signer = createDaemonSigner(input.accountUid)
  return blobs.sign(signer, {
    type: 'AgentsAction',
    signer: signer.principal,
    sig: new Uint8Array(blobs.ED25519_SIGNATURE_SIZE),
    account: signer.principal,
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
    throw new Error(decoded._ === 'Error' ? decoded.message : `Agent server request failed: HTTP ${res.status}`)
  }
  return decoded
}

function createDaemonSigner(accountUid: string): blobs.Signer {
  const principal = base58btc.decode(accountUid)
  return {
    principal,
    sign: async (data: Uint8Array) => {
      const result = await grpcClient.daemon.signData({signingKeyName: accountUid, data: new Uint8Array(data)})
      return new Uint8Array(result.signature)
    },
  }
}
