export * from './tool-registry'

/** Shared options for Seed assistant/agent system prompt construction. */
export type SeedAssistantPromptOptions = {
  currentTime?: string
  contextLines?: string[]
  includeTitleToolInstruction?: boolean
}

/** Returns the shared Seed assistant instructions used by desktop chat and hosted agents. */
export function seedAssistantSystemPrompt(options: SeedAssistantPromptOptions = {}): string {
  const parts = [
    'You are the Seed Assistant. You are part of Seed, connected to the p2p Hypermedia (HM) network, an augmented web.',
    'Be nice but not overly friendly. Be concise. Answer what the user asked; do not offer generic follow-up help.',
    'There are many HM resource types: documents, profiles/accounts, comments, contacts, capabilities, and activity events. Documents have human-readable paths.',
    'Resources in Seed use hm:// URLs. For example: hm://z6Mk.../path-segment',
    'When you mention an hm:// resource or view in your reply, format it as a Markdown link with a descriptive label, for example `[Project notes](hm://z6Mk.../notes)`.',
    'If the user gives a Markdown link, prefer the link destination URL over the visible label because the destination may carry important server or view information such as dev.hyper.media, :profile, or :comments.',
    'Profile/account URLs use `hm://ACCOUNT_UID/:profile` or Seed web URLs ending in `/:profile`. Read these as profiles/accounts, not as normal documents. Profile reads should use the Seed API/SDK account/profile data and should include recent activity from that account plus related keys such as contacts/capabilities when available.',
    'When asked to read a profile or account, preserve the pasted server context. For example, if the user pasted a dev.hyper.media profile URL, pass that URL to the read tool or set dev/server appropriately instead of stripping it to a production hm:// URL.',
    'Use list_activity_feed for recent activity. To inspect a user/account, filter activity by that account UID when possible.',
    'To explore a section of a site, read the directory first, then read each child document.',
  ]
  if (options.includeTitleToolInstruction) {
    parts.push(
      'Use the set_session_title tool to maintain this chat title. On the first assistant turn of a new session, call set_session_title with a concise one-line purpose title as soon as you understand the user request. Do not mention this title-setting step to the user. If the conversation purpose later changes, call set_session_title again with the new purpose.',
    )
  }
  if (options.currentTime) parts.push(`The current time is: ${options.currentTime}`)
  if (options.contextLines?.length) parts.push('', ...options.contextLines)
  return parts.join('\n')
}

/** Definition used when creating a server-hosted Seed agent. */
export type AgentDefinition = {
  name: string
  systemPrompt: string | AgentPromptBlock[]
  modelProvider: string
  model: string
  tools?: string[]
  signingKey?: string
  signingKeys?: string[]
  metadata?: Record<string, unknown>
}

/** Seed block tree node used for rich agent prompts. */
export type AgentPromptBlock = {
  block: Record<string, unknown> & {id: string; type: string}
  children?: AgentPromptBlock[]
}

/** Rich block tree preserved for displaying user-authored session messages. */
export type AgentMessageBlock = AgentPromptBlock

/** Message content part submitted to a session. */
export type MessageSessionContentPart = {
  type: 'text'
  text: string
  blocks?: AgentMessageBlock[]
}

/** Signed CBOR action envelope accepted by `/api/message` and `/agents/ws`. */
export type SignedActionEnvelope = {
  type: 'AgentsAction'
  signer: Uint8Array
  sig: Uint8Array
  account: Uint8Array
  action: AgentAction
}

/** Supported agent service actions with a signed client timestamp. */
export type AgentAction = UnsignedAgentAction & {
  /** Unix epoch milliseconds. Servers reject actions more than 30 seconds from local time. */
  ts: number
}

/** Supported agent service actions before the signing timestamp is attached. */
export type UnsignedAgentAction =
  | ListAgents
  | CreateAgent
  | ListModelProviders
  | ListProviderModels
  | ListSigningIdentities
  | CreateSigningIdentity
  | UpdateSigningIdentity
  | DeleteSigningIdentity
  | SetModelProvider
  | DeleteModelProvider
  | SetSecret
  | GetAgent
  | UpdateAgent
  | DeleteAgent
  | ListAgentTriggers
  | GetAgentTrigger
  | CreateAgentTrigger
  | UpdateAgentTrigger
  | DeleteAgentTrigger
  | CreateSession
  | UpdateSession
  | DeleteSession
  | GetSession
  | MessageSession
  | StopSession
  | Subscribe

/** Lists agents for the signed account. */
export type ListAgents = {
  _: 'ListAgents'
}

/** Creates a new agent definition. */
export type CreateAgent = {
  _: 'CreateAgent'
  definition: AgentDefinition
  clientRequestId?: string
}

/** Lists configured model providers for the signed account. */
export type ListModelProviders = {
  _: 'ListModelProviders'
}

/** Lists remote models available from one configured provider. */
export type ListProviderModels = {
  _: 'ListProviderModels'
  provider: string
}

/** Lists uploaded Seed account keys available to the signed account. */
export type ListSigningIdentities = {
  _: 'ListSigningIdentities'
}

/** Generates a new server-side Seed account key for future signing tools. */
export type CreateSigningIdentity = {
  _: 'CreateSigningIdentity'
  label?: string
  clientRequestId?: string
}

/** Updates a server-side Seed account key profile name. */
export type UpdateSigningIdentity = {
  _: 'UpdateSigningIdentity'
  name: string
  label: string
}

/** Deletes a server-side Seed account key. */
export type DeleteSigningIdentity = {
  _: 'DeleteSigningIdentity'
  name: string
}

/** Creates or updates a named model provider for the account. */
export type SetModelProvider = {
  _: 'SetModelProvider'
  name: string
  provider: ModelProviderConfig
}

/** Deletes a named model provider and its API key secret for the account. */
export type DeleteModelProvider = {
  _: 'DeleteModelProvider'
  name: string
}

/** Stores a secret value encrypted at rest. */
export type SetSecret = {
  _: 'SetSecret'
  name: string
  value: Uint8Array
  metadata?: Record<string, unknown>
}

/** Loads one agent plus its session list. */
export type GetAgent = {
  _: 'GetAgent'
  agentId: string
}

/** Updates an existing agent definition. */
export type UpdateAgent = {
  _: 'UpdateAgent'
  agentId: string
  definition: AgentDefinition
}

/** Deletes an existing agent and its triggers, sessions, and drafts. */
export type DeleteAgent = {
  _: 'DeleteAgent'
  agentId: string
}

/** Lists triggers saved for one agent. */
export type ListAgentTriggers = {
  _: 'ListAgentTriggers'
  agentId: string
}

/** Loads one trigger plus sessions created by that trigger. */
export type GetAgentTrigger = {
  _: 'GetAgentTrigger'
  triggerId: string
}

/** Creates an activity trigger for an agent. */
export type CreateAgentTrigger = {
  _: 'CreateAgentTrigger'
  agentId: string
  trigger: AgentTriggerInput
  clientRequestId?: string
}

/** Updates an existing activity trigger. */
export type UpdateAgentTrigger = {
  _: 'UpdateAgentTrigger'
  triggerId: string
  patch: AgentTriggerPatch
}

/** Deletes an activity trigger. */
export type DeleteAgentTrigger = {
  _: 'DeleteAgentTrigger'
  triggerId: string
}

/** Input used to create an activity trigger. */
export type AgentTriggerInput = {
  name: string
  enabled?: boolean
  source: AgentTriggerSource
  prompt: string | AgentPromptBlock[]
  cooldownMs?: number
}

/** Patch used to edit an activity trigger. */
export type AgentTriggerPatch = {
  name?: string
  enabled?: boolean
  source?: AgentTriggerSource
  prompt?: string | AgentPromptBlock[]
  cooldownMs?: number | null
}

/** Activity source/filter that decides when an agent trigger fires. */
export type AgentTriggerSource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccount: string; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]}
  | {type: 'schedule'; schedule: AgentScheduleTrigger}

/** Schedule configuration that decides when an agent trigger fires. */
export type AgentScheduleTrigger =
  | {kind: 'interval'; every: number; unit: 'minutes' | 'hours'}
  | {kind: 'weekly'; daysOfWeek: number[]; timeOfDay: string; timezone: string}
  | {kind: 'once'; runAt: number; timezone?: string}

/** Creates a chat-like session for an agent. */
export type CreateSession = {
  _: 'CreateSession'
  agentId: string
  title?: string
  clientRequestId?: string
}

/** Updates editable session metadata. */
export type UpdateSession = {
  _: 'UpdateSession'
  sessionId: string
  title: string
}

/** Deletes an existing session and its durable events. */
export type DeleteSession = {
  _: 'DeleteSession'
  sessionId: string
}

/** Loads one session plus durable events, optionally after a sequence. */
export type GetSession = {
  _: 'GetSession'
  sessionId: string
  afterSeq?: number
}

/** Appends a user message and asks the agent to respond. */
export type MessageSession = {
  _: 'MessageSession'
  sessionId: string
  content: MessageSessionContentPart[]
  clientMessageId?: string
}

/** Stops an in-flight agent response for a session. */
export type StopSession = {
  _: 'StopSession'
  sessionId: string
}

/** Authorizes a WebSocket subscription to account/agent/session changes. */
export type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}`
  afterSeq?: number
}

/** Flexible model provider config stored as CBOR. */
export type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
}

/** Public metadata returned for an agent. */
export type AgentInfo = {
  id: string
  account: string
  definition: AgentDefinition
  stateDir: string
  status: 'idle' | 'running' | 'stopped' | 'error'
  createdAt: number
  updatedAt: number
}

/** Public metadata returned for an agent trigger. */
export type AgentTriggerInfo = {
  id: string
  account: string
  agentId: string
  name: string
  enabled: boolean
  source: AgentTriggerSource
  prompt: string | AgentPromptBlock[]
  cooldownMs?: number
  createdAt: number
  updatedAt: number
  lastCheckedAt?: number
  lastFiredAt?: number
  lastError?: string
}

/** Public metadata returned for a session. */
export type SessionInfo = {
  id: string
  account: string
  agentId: string
  title?: string
  status: 'idle' | 'streaming' | 'stopped' | 'error'
  createdAt: number
  updatedAt: number
  startedByTrigger?: AgentSessionTriggerSummary
}

/** Compact trigger attribution attached to sessions created by triggers. */
export type AgentSessionTriggerSummary = {
  triggerId: string
  triggerName: string
  firingId: string
  activityKey: string
  activitySummary: string
  source: AgentTriggerSource
  firedAt: number
}

/** Full trigger context passed into a trigger-created session. */
export type AgentSessionTriggerContext = AgentSessionTriggerSummary & {
  prompt: string
  promptBlocks?: AgentPromptBlock[]
  activity: Record<string, unknown>
  status: string
  error?: string
}

/** Durable session event returned by `GetSession`. */
export type SessionEvent = {
  id: string
  sessionId: string
  seq: number
  event: SessionEventPayload
  createdAt: number
}

/** Durable event payloads stored for a session. */
export type SessionEventPayload =
  | {
      type: 'message'
      role: 'user' | 'assistant' | 'tool'
      content: string
      toolCallId?: string
      rawMarkdown?: string
      blocks?: AgentMessageBlock[]
    }
  | {type: 'tool_call'; id: string; name: string; input: unknown}
  | {type: 'tool_result'; toolCallId: string; name: string; output?: unknown; error?: string}
  | {type: 'error'; message: string}
  | Record<string, unknown>

/** Server-sent WebSocket event after a signed subscription. */
export type AgentWSEvent =
  | {_: 'connected'; connectedAt: number}
  | {_: 'subscribed'; key: string; accountId: string}
  | {_: 'append'; key: `sessions/${string}`; event: SessionEvent}
  | {_: 'appendPartial'; key: `sessions/${string}`; partialId: string; patch: {textDelta?: string; done?: boolean}}
  | {_: 'change'; key: `sessions/${string}`; value: SessionInfo}
  | {_: 'change'; key: `agents/${string}`; value: AgentInfo}
  | {_: 'change'; key: `account/${string}`; value: {reason: string; agentId?: string; sessionId?: string}}
  | {_: 'error'; message: string}

/** Redacted provider metadata returned after provider writes. */
export type RedactedModelProvider = {
  id: string
  name: string
  type: string
  hasSecrets: boolean
  createdAt: number
  updatedAt: number
}

/** Public model metadata returned from a configured model provider. */
export type ProviderModelInfo = {
  id: string
  name: string
}

/** Redacted secret metadata returned after secret writes. */
export type RedactedSecret = {
  id: string
  name: string
  metadata?: Record<string, unknown>
  hasValue: true
  createdAt: number
  updatedAt: number
}

/** Public metadata for a server-side Seed account key secret. */
export type SigningIdentity = {
  id: string
  name: string
  accountId?: string
  label?: string
  serverUrl?: string
  dev?: boolean
  createdAt: number
  updatedAt: number
}

/** Successful response for `ListAgents`. */
export type ListAgentsResponse = {
  _: 'ListAgentsResponse'
  agents: AgentInfo[]
}

/** Successful response for `CreateAgent`. */
export type CreateAgentResponse = {
  _: 'CreateAgentResponse'
  agentId: string
}

/** Successful response for `ListModelProviders`. */
export type ListModelProvidersResponse = {
  _: 'ListModelProvidersResponse'
  providers: RedactedModelProvider[]
}

/** Successful response for `ListProviderModels`. */
export type ListProviderModelsResponse = {
  _: 'ListProviderModelsResponse'
  models: ProviderModelInfo[]
}

/** Successful response for `SetModelProvider`. */
export type SetModelProviderResponse = {
  _: 'SetModelProviderResponse'
  provider: RedactedModelProvider
}

/** Successful response for `DeleteModelProvider`. */
export type DeleteModelProviderResponse = {
  _: 'DeleteModelProviderResponse'
  name: string
}

/** Successful response for `ListSigningIdentities`. */
export type ListSigningIdentitiesResponse = {
  _: 'ListSigningIdentitiesResponse'
  identities: SigningIdentity[]
}

/** Successful response for `CreateSigningIdentity`. */
export type CreateSigningIdentityResponse = {
  _: 'CreateSigningIdentityResponse'
  identity: SigningIdentity
}

/** Successful response for `UpdateSigningIdentity`. */
export type UpdateSigningIdentityResponse = {
  _: 'UpdateSigningIdentityResponse'
  identity: SigningIdentity
}

/** Successful response for `DeleteSigningIdentity`. */
export type DeleteSigningIdentityResponse = {
  _: 'DeleteSigningIdentityResponse'
  name: string
}

/** Successful response for `SetSecret`. */
export type SetSecretResponse = {
  _: 'SetSecretResponse'
  secret: RedactedSecret
}

/** Successful response for `GetAgent`. */
export type GetAgentResponse = {
  _: 'GetAgentResponse'
  agent: AgentInfo
  sessions: SessionInfo[]
}

/** Successful response for `ListAgentTriggers`. */
export type ListAgentTriggersResponse = {
  _: 'ListAgentTriggersResponse'
  triggers: AgentTriggerInfo[]
}

/** Successful response for `GetAgentTrigger`. */
export type GetAgentTriggerResponse = {
  _: 'GetAgentTriggerResponse'
  trigger: AgentTriggerInfo
  sessions: SessionInfo[]
}

/** Successful response for `CreateAgentTrigger`. */
export type CreateAgentTriggerResponse = {
  _: 'CreateAgentTriggerResponse'
  trigger: AgentTriggerInfo
}

/** Successful response for `UpdateAgentTrigger`. */
export type UpdateAgentTriggerResponse = {
  _: 'UpdateAgentTriggerResponse'
  trigger: AgentTriggerInfo
}

/** Successful response for `DeleteAgent`. */
export type DeleteAgentResponse = {
  _: 'DeleteAgentResponse'
  agentId: string
}

/** Successful response for `DeleteAgentTrigger`. */
export type DeleteAgentTriggerResponse = {
  _: 'DeleteAgentTriggerResponse'
  triggerId: string
}

/** Successful response for `CreateSession`. */
export type CreateSessionResponse = {
  _: 'CreateSessionResponse'
  sessionId: string
}

/** Successful response for `UpdateSession`. */
export type UpdateSessionResponse = {
  _: 'UpdateSessionResponse'
  session: SessionInfo
}

/** Successful response for `DeleteSession`. */
export type DeleteSessionResponse = {
  _: 'DeleteSessionResponse'
  sessionId: string
  agentId: string
}

/** Successful response for `GetSession`. */
export type GetSessionResponse = {
  _: 'GetSessionResponse'
  session: SessionInfo
  events: SessionEvent[]
  systemPromptMarkdown: string
  triggerContext?: AgentSessionTriggerContext
}

/** Successful response for `MessageSession`. */
export type MessageSessionResponse = {
  _: 'MessageSessionResponse'
  sessionId: string
  assistantEventId: string
}

/** Successful response for `StopSession`. */
export type StopSessionResponse = {
  _: 'StopSessionResponse'
  sessionId: string
  stopped: boolean
}

/** Error response encoded as CBOR. */
export type ErrorResponse = {
  _: 'Error'
  message: string
}

/** Response values for the Agents API. */
export type AgentResponse =
  | ListAgentsResponse
  | ListModelProvidersResponse
  | ListProviderModelsResponse
  | ListSigningIdentitiesResponse
  | CreateSigningIdentityResponse
  | UpdateSigningIdentityResponse
  | DeleteSigningIdentityResponse
  | CreateAgentResponse
  | SetModelProviderResponse
  | DeleteModelProviderResponse
  | SetSecretResponse
  | GetAgentResponse
  | DeleteAgentResponse
  | ListAgentTriggersResponse
  | GetAgentTriggerResponse
  | CreateAgentTriggerResponse
  | UpdateAgentTriggerResponse
  | DeleteAgentTriggerResponse
  | CreateSessionResponse
  | UpdateSessionResponse
  | DeleteSessionResponse
  | GetSessionResponse
  | MessageSessionResponse
  | StopSessionResponse
  | ErrorResponse
