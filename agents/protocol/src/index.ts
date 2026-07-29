export * from './tool-registry'
export * from './reasoning'
export * from './model-capabilities'

import type {ReasoningLevel} from './reasoning'

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
    'When linking to a specific location inside a Seed document, use only an exact Seed block ID fragment copied from a read result, for example `#y3eQtxFk` from `<!-- id:y3eQtxFk -->`. Seed fragments are not HTML heading anchors: never invent heading slugs, title slugs, or URL-safe text fragments such as `#some-heading-text`.',
    'Before replying with a block-level link, read the target document/version you intend to cite and extract the exact block ID from that result. If you create, fork, copy, or edit a document, read the resulting document before returning block-level links because block IDs may have changed. If the user asks for the exact block changed, return a paragraph/block link rather than only a section or whole-document link.',
    'If the user gives a Markdown link, prefer the link destination URL over the visible label because the destination may carry important server or view information such as dev.hyper.media, :profile, or :comments.',
    'Profile/account URLs use `hm://ACCOUNT_UID/:profile` or Seed web URLs ending in `/:profile`. Read these as profiles/accounts, not as normal documents. Profile reads should use the Seed API/SDK account/profile data and should include recent activity from that account plus related keys such as contacts/capabilities when available.',
    'When asked to read a profile or account, preserve the pasted server context. For example, if the user pasted a dev.hyper.media profile URL, pass that URL to the read tool or set dev/server appropriately instead of stripping it to a production hm:// URL.',
    'Append /:attributes to a document URL (e.g. `hm://z6Mk.../notes/:attributes`) to read only its metadata/attributes without the content. Use it when the user is viewing the attributes view or asks about document metadata.',
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
  /**
   * Reasoning level for reasoning-capable models. Must be one of the levels
   * `modelReasoningSupport` reports for the model. Absent means off (or the
   * provider default when reasoning cannot be disabled).
   */
  reasoningLevel?: ReasoningLevel
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

/**
 * Message content part submitted to a session.
 *
 * `text` parts are the user's words. `context` parts carry ambient client state — the desktop
 * sidebar sends the current window (open document, view, focused block) so "this document" means
 * something to the model. Context is model-facing only: the server attaches it to the turn's user
 * message for the model but keeps it out of the visible transcript content.
 *
 * `attachment` parts reference files previously uploaded with `UploadSessionAttachment`.
 * Attachments are session-private: they live with the session on the agent server, are shown to
 * the model inline (images, when the model supports image input) or as metadata, and are deleted
 * with the session. They are never copied into agent memory or published to IPFS unless the agent
 * explicitly does so with its attachment tools.
 */
export type MessageSessionContentPart =
  | {
      type: 'text'
      text: string
      blocks?: AgentMessageBlock[]
    }
  | {
      type: 'context'
      lines: string[]
    }
  | {
      type: 'attachment'
      /** Attachment id returned by `UploadSessionAttachment`. */
      id: string
    }

/** Metadata for one session-private file attached to a session message. */
export type SessionAttachmentInfo = {
  /** Content-derived id (SHA-256 hex of the bytes), stable across re-uploads of the same file. */
  id: string
  sessionId: string
  /** Original file name, for display and metadata shown to the model. */
  name: string
  /** MIME type reported by the client or inferred from the file name. */
  mimeType?: string
  size: number
  createdAt: number
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
  | ListAgentMemory
  | ReadAgentMemoryFile
  | WriteAgentMemoryFile
  | DeleteAgentMemoryFile
  | DownloadAgentMemoryFile
  | UploadAgentMemoryFileToIpfs
  | CreateSession
  | ListSessions
  | UpdateSession
  | DeleteSession
  | GetSession
  | MessageSession
  | UploadSessionAttachment
  | ReadSessionAttachment
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

/** Avatar image payload for an agent account profile. */
export type SigningIdentityIcon = {
  /** Raw image bytes to upload to the server's HM node. */
  data: Uint8Array
  /** MIME type of the image (e.g. `image/png`); used for the upload. */
  mimeType?: string
  /** Original file name, preserved for the upload form. */
  fileName?: string
}

/** Updates a server-side Seed account key profile name and optional avatar. */
export type UpdateSigningIdentity = {
  _: 'UpdateSigningIdentity'
  name: string
  label: string
  /**
   * Optional avatar image to upload to the server's HM node and set on the
   * profile. Omit to leave the existing icon unchanged.
   */
  icon?: SigningIdentityIcon
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
}

/** Patch used to edit an activity trigger. */
export type AgentTriggerPatch = {
  name?: string
  enabled?: boolean
  source?: AgentTriggerSource
  prompt?: string | AgentPromptBlock[]
}

/** Activity source/filter that decides when an agent trigger fires. */
export type AgentTriggerSource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccounts: string[]; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]}
  | {type: 'schedule'; schedule: AgentScheduleTrigger}

/** Schedule configuration that decides when an agent trigger fires. */
export type AgentScheduleTrigger =
  | {kind: 'interval'; every: number; unit: 'minutes' | 'hours'}
  | {kind: 'weekly'; daysOfWeek: number[]; timeOfDay: string; timezone: string}
  | {kind: 'once'; runAt: number; timezone?: string}

/** One file or directory inside an agent's private memory filesystem. */
export type AgentMemoryEntry = {
  /** Relative path from the agent memory root, always `/`-separated. */
  path: string
  type: 'file' | 'dir'
  /** File size in bytes; 0 for directories. */
  size: number
  /** Last modification time in Unix epoch milliseconds. */
  updatedAt: number
  /** MIME type inferred from the file extension, when recognized. */
  mimeType?: string
}

/** Contents of one agent memory file: UTF-8 text or raw binary bytes. */
export type AgentMemoryFile = {
  path: string
  size: number
  updatedAt: number
  /** MIME type inferred from the file extension, when recognized. */
  mimeType?: string
  /** How the file content is delivered: `utf8` uses `content`, `binary` uses `data`. */
  encoding: 'utf8' | 'binary'
  /** UTF-8 text content, present when `encoding` is `utf8`. */
  content?: string
  /** Raw file bytes, present when `encoding` is `binary`. */
  data?: Uint8Array
}

/** Lists every file and directory in an agent's memory. */
export type ListAgentMemory = {
  _: 'ListAgentMemory'
  agentId: string
}

/** Reads one file (text or binary) from an agent's memory. */
export type ReadAgentMemoryFile = {
  _: 'ReadAgentMemoryFile'
  agentId: string
  path: string
}

/**
 * Writes one file into an agent's memory, creating parent directories as needed. String content is
 * stored as UTF-8 text; `Uint8Array` content is stored verbatim (e.g. media uploaded from the
 * Memory tab).
 */
export type WriteAgentMemoryFile = {
  _: 'WriteAgentMemoryFile'
  agentId: string
  path: string
  content: string | Uint8Array
}

/** Deletes one file, or one directory recursively, from an agent's memory. */
export type DeleteAgentMemoryFile = {
  _: 'DeleteAgentMemoryFile'
  agentId: string
  path: string
}

/** Downloads a web URL into an agent's memory filesystem. */
export type DownloadAgentMemoryFile = {
  _: 'DownloadAgentMemoryFile'
  agentId: string
  /** The http(s) URL to download. */
  url: string
  /** Target memory path. Omit to store under `downloads/` named from the URL. */
  path?: string
}

/**
 * Uploads one agent memory file to the HM server's IPFS endpoint so it can be referenced from
 * Hypermedia content by its `ipfs://<cid>` URL.
 */
export type UploadAgentMemoryFileToIpfs = {
  _: 'UploadAgentMemoryFileToIpfs'
  agentId: string
  path: string
}

/** Creates a chat-like session for an agent. */
export type CreateSession = {
  _: 'CreateSession'
  agentId: string
  title?: string
  clientRequestId?: string
}

/**
 * Lists sessions for the signed account across every agent on this server, newest first.
 *
 * Backs the desktop assistant sidebar, which shows one merged session list spanning all agents on
 * all configured servers. Without this the client would have to call `ListAgents` and then
 * `GetAgent` per agent just to enumerate sessions.
 */
export type ListSessions = {
  _: 'ListSessions'
  /** Restrict to one agent. Omit for every agent on this server. */
  agentId?: string
  /** Maximum sessions to return. Server clamps to a sane bound. */
  limit?: number
  /** Continue after a previous page. Pass the `nextCursor` from `ListSessionsResponse` verbatim. */
  cursor?: SessionListCursor
}

/**
 * Keyset pagination cursor for `ListSessions`, ordered by `(updatedAt, id)` descending.
 *
 * The session id is part of the cursor because sessions can share an `updatedAt` millisecond — a
 * trigger firing across a batch of activity events creates several at once. A timestamp-only cursor
 * would skip every tied row past the page boundary, silently losing sessions from the list.
 */
export type SessionListCursor = {
  updatedBefore: number
  idBefore: string
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

/**
 * Uploads one session-private attachment so a later `MessageSession` can reference it. Uploading
 * the same bytes twice returns the same attachment id. Attachments are deleted with the session.
 */
export type UploadSessionAttachment = {
  _: 'UploadSessionAttachment'
  sessionId: string
  /** Original file name, used for display and model-facing metadata. */
  name: string
  /** MIME type reported by the client; inferred from `name` when absent. */
  mimeType?: string
  content: Uint8Array
}

/** Reads one session attachment's metadata and raw bytes (e.g. to render it in the chat thread). */
export type ReadSessionAttachment = {
  _: 'ReadSessionAttachment'
  sessionId: string
  attachmentId: string
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
      /**
       * Client context lines (from a `context` content part) that accompanied this user message.
       * Fed to the model with the message but never part of `content`, so transcripts stay clean.
       */
      contextLines?: string[]
      /** Session-private attachments that accompanied this user message. */
      attachments?: SessionAttachmentInfo[]
    }
  | {type: 'tool_call'; id: string; name: string; input: unknown}
  | {type: 'tool_result'; toolCallId: string; name: string; output?: unknown; error?: string}
  | {type: 'error'; message: string}
  | Record<string, unknown>

/** Cumulative token usage for the current agent run, updated as turns complete. */
export type AgentRunUsage = {
  /** Input/prompt tokens billed so far in this run. */
  input: number
  /** Output/completion tokens generated so far in this run. */
  output: number
  /** Cached input tokens read so far in this run. */
  cacheRead: number
  /** Input tokens written to cache so far in this run. */
  cacheWrite: number
  /** Sum of all token categories above. */
  total: number
}

/** What the agent is actively doing right now, surfaced live to the UI. */
export type AgentRunActivity = {
  /**
   * Coarse phase of the current run:
   * - `starting`: the run was accepted and the model request is being prepared
   * - `thinking`: waiting on the model before any text/tool output
   * - `responding`: assistant text is streaming in
   * - `tool`: a tool call is executing (see `toolName`)
   * - `finalizing`: the run is wrapping up
   */
  phase: 'starting' | 'thinking' | 'responding' | 'tool' | 'finalizing'
  /** Tool currently executing, when `phase` is `tool`. */
  toolName?: string
  /** ID of the tool call currently executing, so clients can attach live progress to its chat row. */
  toolCallId?: string
  /** Optional short human-readable detail (e.g. tool argument summary). */
  detail?: string
  /** Recent stdout/stderr tail from a long-running tool call (e.g. execute_code), when `phase` is `tool`. */
  outputTail?: string
}

/** Server-sent WebSocket event after a signed subscription. */
export type AgentWSEvent =
  | {_: 'connected'; connectedAt: number}
  | {_: 'subscribed'; key: string; accountId: string}
  | {_: 'append'; key: `sessions/${string}`; event: SessionEvent}
  | {
      _: 'appendPartial'
      key: `sessions/${string}`
      partialId: string
      patch: {textDelta?: string; done?: boolean; usage?: AgentRunUsage; activity?: AgentRunActivity}
    }
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
  /** Avatar URI (`ipfs://<cid>`) currently published on the profile. */
  icon?: string
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

/** Successful response for `ListAgentMemory`. */
export type ListAgentMemoryResponse = {
  _: 'ListAgentMemoryResponse'
  agentId: string
  entries: AgentMemoryEntry[]
  /** Total bytes across all memory files. */
  totalBytes: number
}

/** Successful response for `ReadAgentMemoryFile`. */
export type ReadAgentMemoryFileResponse = {
  _: 'ReadAgentMemoryFileResponse'
  agentId: string
  file: AgentMemoryFile
}

/** Successful response for `WriteAgentMemoryFile`. */
export type WriteAgentMemoryFileResponse = {
  _: 'WriteAgentMemoryFileResponse'
  agentId: string
  entry: AgentMemoryEntry
}

/** Successful response for `DeleteAgentMemoryFile`. */
export type DeleteAgentMemoryFileResponse = {
  _: 'DeleteAgentMemoryFileResponse'
  agentId: string
  path: string
  /** False when nothing existed at the path. */
  deleted: boolean
}

/** Successful response for `DownloadAgentMemoryFile`. */
export type DownloadAgentMemoryFileResponse = {
  _: 'DownloadAgentMemoryFileResponse'
  agentId: string
  entry: AgentMemoryEntry
  /** URL actually fetched, after redirects. */
  finalUrl: string
  /** Content type reported by the server, when present. */
  contentType?: string
}

/** Successful response for `UploadAgentMemoryFileToIpfs`. */
export type UploadAgentMemoryFileToIpfsResponse = {
  _: 'UploadAgentMemoryFileToIpfsResponse'
  agentId: string
  path: string
  /** The IPFS content identifier of the uploaded file. */
  cid: string
  /** `ipfs://<cid>` URL usable from Hypermedia content. */
  url: string
  size: number
  mimeType?: string
}

/** Successful response for `CreateSession`. */
export type CreateSessionResponse = {
  _: 'CreateSessionResponse'
  sessionId: string
}

/** Successful response for `ListSessions`. */
export type ListSessionsResponse = {
  _: 'ListSessionsResponse'
  /** Sessions ordered by `updatedAt` descending. Each carries its `agentId`. */
  sessions: SessionInfo[]
  /** Agents referenced by `sessions`, so clients can label rows without a second round trip. */
  agents: AgentInfo[]
  /** Cursor for the next page: pass back as `cursor`. Absent when the list is exhausted. */
  nextCursor?: SessionListCursor
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

/** Successful response for `UploadSessionAttachment`. */
export type UploadSessionAttachmentResponse = {
  _: 'UploadSessionAttachmentResponse'
  attachment: SessionAttachmentInfo
}

/** Successful response for `ReadSessionAttachment`. */
export type ReadSessionAttachmentResponse = {
  _: 'ReadSessionAttachmentResponse'
  attachment: SessionAttachmentInfo
  data: Uint8Array
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
  | ListAgentMemoryResponse
  | ReadAgentMemoryFileResponse
  | WriteAgentMemoryFileResponse
  | DeleteAgentMemoryFileResponse
  | DownloadAgentMemoryFileResponse
  | UploadAgentMemoryFileToIpfsResponse
  | CreateSessionResponse
  | ListSessionsResponse
  | UpdateSessionResponse
  | DeleteSessionResponse
  | GetSessionResponse
  | MessageSessionResponse
  | UploadSessionAttachmentResponse
  | ReadSessionAttachmentResponse
  | StopSessionResponse
  | ErrorResponse
