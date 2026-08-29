export * from './tool-registry'
import type {JsonSchema} from './tool-registry'
export * from './reasoning'
export * from './model-capabilities'

import type {ReasoningLevel} from './reasoning'

/** Shared options for Seed assistant/agent system prompt construction. */
export type SeedAssistantPromptOptions = {
  currentTime?: string
  contextLines?: string[]
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
    'Append /:directory to an account or document URL (e.g. `hm://z6Mk.../notes/:directory`) to list its child documents (the directory view) with names, links, and child counts. Use it whenever asked what documents live under a space or document, instead of scraping links out of document content.',
    'Use `read` with the `activity:` address for recent activity. To inspect a user/account, filter activity by that account UID when possible.',
    'To explore a section of a site, read the directory first, then read each child document.',
    'Tables read and write as GFM markdown tables carrying identity comments: a `<!-- id:… -->` line before the table, `<!-- col:… -->` inside each header cell, and `<!-- id:… -->` inside the last cell of each row. When editing a table, keep every comment for content you are keeping — they preserve table/column/row identity, history, and anchored comments; only omit them for rows or columns you are adding. Cells never carry their own ids. Use `\\|` for a literal pipe and `<br>` for a line break inside a cell. New tables may be plain GFM without any comments.',
  ]
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
  /**
   * Quick-switch model choices the user checked for this agent. Entries may
   * span multiple providers; selecting one switches `modelProvider` and
   * `model` together. The active pair stays selectable whether or not listed.
   */
  enabledModels?: AgentModelRef[]
  tools?: string[]
  /**
   * Names of the account's MCP servers this agent may call. Each enabled server's tools are
   * projected into the agent's `~/tools/` as `mcp` tool documents named `<server>__<tool>`, so
   * they flow through `call`, the Space index, and promotion exactly like builtins and lambdas.
   */
  mcpServers?: string[]
  signingKey?: string
  signingKeys?: string[]
  metadata?: Record<string, unknown>
}

/** One saved quick-switch choice: a model on a specific configured provider. */
export type AgentModelRef = {
  /** Configured provider name (matches a `SetModelProvider` name). */
  provider: string
  /** Model id as the provider reports it. */
  model: string
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
      /**
       * Client-chosen id for this message, echoed back on the durable event so the sender can
       * replace its optimistic pending row with the server's copy by identity instead of by text.
       */
      clientMessageId?: string
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
  /**
   * CID of the published Capability blob by which `account` delegated to `signer` (role AGENT or
   * WRITER). Required whenever `signer` is not `account` — this is how a web device key acts as
   * the vault account it was delegated from, so every surface sees the same agents. The server
   * resolves the blob (from {@link capabilityBlob}, its own cache, or its HM node), verifies the
   * delegation end to end, and remembers it by CID; the reference rides inside the signed payload,
   * so it cannot be swapped in transit.
   */
  capability?: string
  /**
   * Optional raw canonical DAG-CBOR bytes of the {@link capability} blob, for servers that cannot
   * (or need not) fetch it from the network. Must hash to {@link capability}.
   */
  capabilityBlob?: Uint8Array
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
  | ListAgentInvites
  | ListAgentCollaborators
  | InviteAgentCollaborator
  | RemoveAgentCollaborator
  | SetAgentPublicRead
  | SetAgentPublicChat
  | AcceptAgentInvite
  | DeclineAgentInvite
  | CreateAgent
  | ListModelProviders
  | ListProviderModels
  | ListSigningIdentities
  | CreateSigningIdentity
  | ImportSigningIdentity
  | UpdateSigningIdentity
  | DeleteSigningIdentity
  | SetModelProvider
  | DeleteModelProvider
  | ListMcpServers
  | SetMcpServer
  | DeleteMcpServer
  | RefreshMcpServer
  | StartProviderOAuth
  | SubmitProviderOAuthCode
  | GetProviderOAuthStatus
  | CancelProviderOAuth
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
  | ListAgentTools
  | SaveAgentTool
  | DeleteAgentTool
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
  | InvokeSessionTool
  | UploadSessionAttachment
  | ReadSessionAttachment
  | BeginFileUpload
  | AppendFileUploadChunk
  | CommitFileUpload
  | AbortFileUpload
  | StopSession
  | RetrySession
  | GetRun
  | ListRuns
  | CancelRun
  | SignalRun
  | GetRunJournal
  | Subscribe
  | RegisterSigner

/** Lists agents for the signed account. */
export type ListAgents = {
  _: 'ListAgents'
}

/**
 * @deprecated Delegations now ride inside every envelope as {@link SignedActionEnvelope.capability};
 * nothing needs to be registered ahead of time. Still accepted so clients from before that change
 * keep working; remove after one release.
 *
 * Registers the envelope's signer as a delegated signer for another account, proven by a signed
 * Capability blob (the account key delegating role AGENT to this signer). After registration the
 * signer may send envelopes whose `account` is the delegating account.
 */
export type RegisterSigner = {
  _: 'RegisterSigner'
  /**
   * Raw canonical DAG-CBOR bytes of the signed Capability blob. The server verifies the blob's
   * own signature (the account's), that its delegate is the envelope signer, and its role, so
   * possession of both keys is proven end to end.
   */
  capability: Uint8Array
}

/** Lists pending invitations sent to the signed account. */
export type ListAgentInvites = {
  _: 'ListAgentInvites'
}

/** Lists the owner and collaborators who can access one agent. */
export type ListAgentCollaborators = {
  _: 'ListAgentCollaborators'
  agentId: string
}

/** Invites an account to read or write one owned agent. */
export type InviteAgentCollaborator = {
  _: 'InviteAgentCollaborator'
  agentId: string
  accountId: string
  role: AgentCollaboratorRole
}

/**
 * Turns public read access on or off for one owned agent. When on, any signed account that knows the
 * agent id can read it (definition, memory, tools, sessions, live updates) exactly like an invited
 * reader; it is never listed for accounts that are not owner or collaborator.
 */
export type SetAgentPublicRead = {
  _: 'SetAgentPublicRead'
  agentId: string
  publicRead: boolean
}

/**
 * Turns public chat on or off for one owned agent that already has public read access. When on,
 * any signed account that can read the agent publicly is a `chatter`: it can create sessions,
 * message them, attach files, and stop/retry turns, but cannot change the agent, its memory, tools,
 * or triggers, rename or delete sessions, or run session tools. Enabling requires `publicRead`;
 * turning public read off clears this flag.
 */
export type SetAgentPublicChat = {
  _: 'SetAgentPublicChat'
  agentId: string
  publicChat: boolean
}

/** Revokes an accepted collaborator or cancels a pending invitation. */
export type RemoveAgentCollaborator = {
  _: 'RemoveAgentCollaborator'
  agentId: string
  accountId: string
}

/** Accepts a pending invitation sent to the signed account. */
export type AcceptAgentInvite = {
  _: 'AcceptAgentInvite'
  agentId: string
}

/** Declines a pending invitation sent to the signed account. */
export type DeclineAgentInvite = {
  _: 'DeclineAgentInvite'
  agentId: string
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
  /** Lists the owning account's providers when viewing a shared agent. */
  agentId?: string
}

/** Lists remote models available from one configured provider. */
export type ListProviderModels = {
  _: 'ListProviderModels'
  provider: string
  /** Resolves the provider against the owning account of a shared agent. */
  agentId?: string
}

/** Lists uploaded Seed account keys available to the signed account. */
export type ListSigningIdentities = {
  _: 'ListSigningIdentities'
  /** Resolves against the owning account of a shared agent. Non-owner collaborators only see
   * the identities granted to that agent; the owner's other keys stay private. */
  agentId?: string
}

/** Generates a new server-side Seed account key for future signing tools. */
export type CreateSigningIdentity = {
  _: 'CreateSigningIdentity'
  label?: string
  clientRequestId?: string
}

/**
 * Imports an existing Seed account key (an exported `.hmkey.json` seed, decrypted client-side)
 * for the server to sign with. Unlike `CreateSigningIdentity`, nothing is published on import:
 * the account may already exist on the network with a profile and content, and generating a
 * fresh profile/home for it would overwrite what the account's owner already published.
 */
export type ImportSigningIdentity = {
  _: 'ImportSigningIdentity'
  /** Raw 32-byte ed25519 seed of the account key. */
  seed: Uint8Array
  /** Display label; clients default it to the key file's embedded profile name. */
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

/** Lists the account's configured MCP servers, with their last discovered tools and status. */
export type ListMcpServers = {
  _: 'ListMcpServers'
}

/**
 * Creates or updates a named MCP server for the account. The server connects to it right away to
 * discover its tools; the response carries the result so a client can show "connected, N tools"
 * or the exact failure without a second round trip. A failed discovery still saves the record.
 */
export type SetMcpServer = {
  _: 'SetMcpServer'
  name: string
  config: McpServerConfig
}

/** Deletes a named MCP server, the header secrets it owns, and every agent's projection of it. */
export type DeleteMcpServer = {
  _: 'DeleteMcpServer'
  name: string
}

/** Reconnects to one MCP server and re-discovers its tools. */
export type RefreshMcpServer = {
  _: 'RefreshMcpServer'
  name: string
}

/**
 * Starts an OAuth sign-in flow for a subscription-authenticated provider
 * (currently `openai` — “Sign in with ChatGPT”). The server begins the flow and
 * returns the browser URL to open. Completion is observed via
 * `GetProviderOAuthStatus`; when the browser redirect cannot reach the server
 * (remote deployments), the client submits the pasted redirect URL with
 * `SubmitProviderOAuthCode`. Only one login per account runs at a time —
 * starting a new one cancels the previous pending flow.
 */
export type StartProviderOAuth = {
  _: 'StartProviderOAuth'
  /** Provider type to authenticate. Only `openai` is supported today. */
  providerType: string
}

/** Feeds a manually pasted authorization code (or full redirect URL) into a pending OAuth login. */
export type SubmitProviderOAuthCode = {
  _: 'SubmitProviderOAuthCode'
  loginId: string
  code: string
}

/** Polls a pending OAuth login started with `StartProviderOAuth`. */
export type GetProviderOAuthStatus = {
  _: 'GetProviderOAuthStatus'
  loginId: string
}

/** Cancels a pending OAuth login. */
export type CancelProviderOAuth = {
  _: 'CancelProviderOAuth'
  loginId: string
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
  /** Defaults to starting a new thread. */
  continuation?: TriggerContinuation
}

/** Patch used to edit an activity trigger. */
export type AgentTriggerPatch = {
  name?: string
  enabled?: boolean
  source?: AgentTriggerSource
  prompt?: string | AgentPromptBlock[]
  continuation?: TriggerContinuation
}

/** Activity source/filter that decides when an agent trigger fires. */
export type AgentTriggerSource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccounts: string[]; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]}
  | {type: 'schedule'; schedule: AgentScheduleTrigger}
  /** Fires when a run of this account finishes — the source that lets automations chain. */
  | {
      type: 'run-completed'
      /** Only runs of this agent; omitted watches every agent on the account. */
      agentId?: string
      /** Only runs that ended this way; omitted watches all three terminal statuses. */
      status?: 'succeeded' | 'failed' | 'canceled'
      /** Case-insensitive substring the finished run's title must contain. */
      titleMatch?: string
    }

/**
 * What a trigger does when it fires. Omitted means `newThread`, which is what every trigger did
 * before continuations existed.
 */
export type TriggerContinuation =
  /** Start a fresh thread from the trigger's prompt. */
  | {kind: 'newThread'}
  /**
   * Deliver a signal to a run parked on `ctx.waitForEvent` — the same delivery a SignalRun makes,
   * so a trigger can answer a waiting run instead of starting a new one. Without `runId`, the
   * account's parked runs are searched for one this signal satisfies.
   */
  | {kind: 'wake'; signal: string; runId?: string; payload?: unknown}

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

/**
 * Lists every tool document in an agent's `~/tools` — builtin bindings and authored lambdas alike,
 * source included. This is the owner's transparency view: the same documents the agent itself sees
 * when it reads `~/tools/`.
 */
export type ListAgentTools = {
  _: 'ListAgentTools'
  agentId: string
}

/** Every editable field in an authored lambda tool document. */
export type AgentToolInput = {
  name: string
  summary?: string
  description: string
  input: Record<string, unknown>
  output?: Record<string, unknown>
  source: string
  runtime: 'typescript' | 'python'
}

/** Creates or updates an authored tool, optionally renaming the previous document atomically. */
export type SaveAgentTool = {
  _: 'SaveAgentTool'
  agentId: string
  tool: AgentToolInput
  /** Existing authored-tool name when editing; omit when creating. */
  previousName?: string
}

/** Permanently deletes one authored tool document. */
export type DeleteAgentTool = {
  _: 'DeleteAgentTool'
  agentId: string
  name: string
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
  /** List only the children of this session (ignores `includeChildren`). */
  parentSessionId?: string
  /**
   * Pass false to exclude child sessions from the top-level listing (lineage-aware clients nest
   * them under their parents). Absent/true returns every session, which keeps older clients whole.
   */
  includeChildren?: boolean
}

/** Loads one run. */
export type GetRun = {
  _: 'GetRun'
  runId: string
}

/**
 * Lists runs, newest first. Exactly one selector: `rootRunId` returns the whole tree of one root
 * (oldest first, for tree rendering); `sessionId` returns root runs referencing a session;
 * `agentId` returns runs of one agent.
 */
export type ListRuns = {
  _: 'ListRuns'
  rootRunId?: string
  sessionId?: string
  agentId?: string
  status?: RunStatus
  limit?: number
}

/** Cancels a run and every non-terminal descendant. */
export type CancelRun = {
  _: 'CancelRun'
  runId: string
}

/**
 * Delivers a named signal to a run parked on `ctx.waitForEvent`, waking it with the payload.
 *
 * This is how a person (or another system) answers a workflow that is waiting for something the
 * activity feed cannot express — an approval, a webhook, a human decision. Signalling a run that is
 * not listening for this signal is not an error: the response says it was not delivered.
 */
export type SignalRun = {
  _: 'SignalRun'
  runId: string
  /** Signal name; a wait with no criteria accepts any name. */
  signal: string
  /** Whatever the run should receive. Must be JSON-serializable. */
  payload?: unknown
}

/** Loads a run's durable journal entries, optionally after a sequence. */
export type GetRunJournal = {
  _: 'GetRunJournal'
  runId: string
  afterSeq?: number
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
  title?: string
  /**
   * Sets or clears the session's model override: an object pins this session
   * to that provider/model (and reasoning level), `null` returns the session
   * to the agent's own model. Omit to leave the override unchanged.
   */
  modelOverride?: SessionModelOverride | null
}

/**
 * Per-session model configuration. When present, runs in this session use this
 * provider/model pair (and reasoning level — absent means off) instead of the
 * agent definition's. If the named provider no longer exists, the agent's own
 * model runs.
 */
export type SessionModelOverride = {
  provider: string
  model: string
  reasoningLevel?: ReasoningLevel
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
 * Runs one verb (read, write, or call) AS THE USER on a session's shared log. The call and its
 * result append as actor-'user' events the agent reads on its next turn — the same log, the same
 * verbs, no side channel. Rejected while the session has a live run.
 */
export type InvokeSessionTool = {
  _: 'InvokeSessionTool'
  sessionId: string
  verb: 'read' | 'write' | 'call'
  input: unknown
}

export type InvokeSessionToolResponse = {
  _: 'InvokeSessionToolResponse'
  sessionId: string
  /** Durable event id of the appended tool_result. */
  resultEventId: string
  output?: unknown
  error?: string
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

/**
 * Where a chunked file upload lands when committed: a path in an agent's memory, or a
 * session-private attachment.
 */
export type FileUploadTarget =
  | {kind: 'memory'; agentId: string; path: string}
  | {kind: 'session-attachment'; sessionId: string; name: string; mimeType?: string}

/**
 * Starts a chunked file upload. Large files upload in bounded chunks — each signed action stays
 * small, so clients never hash hundreds of megabytes in one blocking call and can show progress.
 * The target is validated up front; bytes stage server-side until `CommitFileUpload`.
 */
export type BeginFileUpload = {
  _: 'BeginFileUpload'
  target: FileUploadTarget
  /** Total upload size in bytes; `CommitFileUpload` requires exactly this many bytes staged. */
  size: number
}

/** Appends one chunk to a staged upload. Chunks must arrive in order (`offset` = bytes so far). */
export type AppendFileUploadChunk = {
  _: 'AppendFileUploadChunk'
  uploadId: string
  /** Byte offset of this chunk; must equal the count of bytes already received. */
  offset: number
  content: Uint8Array
}

/** Completes a staged upload, materializing it at its target. */
export type CommitFileUpload = {
  _: 'CommitFileUpload'
  uploadId: string
}

/** Discards a staged upload. */
export type AbortFileUpload = {
  _: 'AbortFileUpload'
  uploadId: string
}

/** Stops an in-flight agent response for a session. */
export type StopSession = {
  _: 'StopSession'
  sessionId: string
}

/**
 * Re-runs a session whose latest run failed, without appending a new user message: the turn
 * re-enters from the durable transcript (error events are not replayed to the provider). Rejected
 * when a run is live or the latest run did not fail.
 */
export type RetrySession = {
  _: 'RetrySession'
  sessionId: string
}

/** Authorizes a WebSocket subscription to account/agent/session/run changes. */
export type Subscribe = {
  _: 'Subscribe'
  key: `account/${string}` | `agents/${string}` | `sessions/${string}` | `runs/${string}`
  afterSeq?: number
}

/** Flexible model provider config stored as CBOR. */
export type ModelProviderConfig = {
  type: string
  modelDefaults?: Record<string, unknown>
  secretRefs?: Record<string, string>
  baseUrl?: string
  /**
   * How requests to the provider are authenticated. `api-key` (default) uses
   * the `secretRefs.apiKey` secret. `subscription` uses OAuth credentials in
   * the `secretRefs.oauth` secret (OpenAI: “Sign in with ChatGPT”, requests go
   * to the ChatGPT Codex backend under the user's ChatGPT plan).
   */
  authMode?: 'api-key' | 'subscription'
}

/** A collaborator's access level on an agent. */
export type AgentCollaboratorRole = 'reader' | 'writer'

/** The signed account's relationship to an agent. */
/**
 * What the requesting account may do with an agent. `owner`/`writer`/`reader` are memberships;
 * `chatter` is a public reader on an agent with public chat enabled (see `SetAgentPublicChat`).
 */
export type AgentAccessRole = 'owner' | AgentCollaboratorRole | 'chatter'

/** One owner, accepted collaborator, or pending invitation on an agent. */
export type AgentCollaboratorInfo = {
  accountId: string
  role: AgentAccessRole
  status: 'accepted' | 'pending'
  createdAt: number
  updatedAt: number
}

/** A pending agent invitation visible to its recipient before agent contents are disclosed. */
export type AgentInviteInfo = {
  agentId: string
  agentName: string
  ownerAccountId: string
  role: AgentCollaboratorRole
  createdAt: number
  updatedAt: number
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
  /** Permissions of the signed account that requested this value. */
  accessRole?: AgentAccessRole
  /** True when any signed account can read this agent by id (see `SetAgentPublicRead`). */
  publicRead?: boolean
  /** True when any signed account can also create and message sessions (see `SetAgentPublicChat`). */
  publicChat?: boolean
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
  continuation?: TriggerContinuation
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
  /** Set on sessions spawned by another session (sub-sessions and agent-started sessions). */
  parentSessionId?: string
  /** The run this session is the transcript of, for sessions created as run children. */
  runId?: string
  /** Todo/plan snapshot maintained by the agent via the update_plan tool. */
  plan?: RunPlan
  /** Number of sessions spawned under this one (rendered as the sub-session disclosure). */
  childSessionCount?: number
  /** Per-session model configuration; absent means the agent's own model runs. */
  modelOverride?: SessionModelOverride
  /**
   * The agent's own one-or-two-sentence account of what this session is doing, maintained via
   * the `status` verb. Shown beside the title in session lists so a reader (or a parent session)
   * can see inside without opening the transcript.
   */
  description?: string
}

/** Lifecycle status of a durable run. */
export type RunStatus = 'queued' | 'claimed' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'canceled'

/** Why a run is parked in `waiting`. */
export type RunWaitInfo = {
  /**
   * What the run is waiting for: its spawned children, the clock, something to happen
   * (`ctx.waitForEvent` — an activity event or a SignalRun), or a person, when it paused on its
   * budget rather than spending more.
   */
  reason: 'children' | 'timer' | 'event' | 'budget-pause'
  /** When the clock will wake it: a sleep's end, or an event wait's timeout. */
  wakeAt?: number
  /** Unresolved child tool calls the run is parked on. */
  pendingChildren?: number
  /** What the run said it is waiting for, e.g. "approval from the reviewer". */
  label?: string
  /**
   * The signal name that would answer this wait by hand, when one can — absent for a run watching
   * the activity feed, which nobody answers with a button.
   */
  answerWith?: string
}

/** One item on the checklist: a stable id, a label the model rewrites freely, and where it stands. */
export type RunPlanStep = {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  /**
   * Set when the RUNTIME closed this step rather than the agent or the user — every sub-agent
   * attached to it came back succeeded, so the work is done as a matter of record and waiting for
   * the model to say so would only stall the run.
   *
   * Absent means what it always meant: the status is the model's own word (or the user's). Only
   * success is ever derived this way — a failed child's meaning is a judgment call, and the runtime
   * does not make it.
   */
  resolvedBy?: 'runtime'
}

/** Step list snapshot rendered by the pinned run card and session todo lists. */
export type RunPlan = {
  title?: string
  steps: RunPlanStep[]
  /**
   * Run that owns this session-level plan. Stamped by the server, never accepted from model input.
   * This lets clients freeze a completed checklist into the correct turn even after that run ends.
   */
  ownerRunId?: string
  /**
   * When the last step stopped being able to move — every step done, failed or skipped.
   *
   * A checklist that has fully settled has finished telling its story, and the card showing it can
   * leave the pinned slot and freeze into the log at this moment. That needs a timestamp that does
   * not drift, which is why the server records it: plan edits leave no durable event of their own,
   * so a client watching only the plan snapshot has no other way to say WHEN it settled. Cleared
   * again if a later edit reopens a step, and absent on plans that have never fully settled.
   */
  settledAt?: number
}

/** Cumulative persisted usage for a run, including rolled-up child usage. */
export type RunUsageInfo = AgentRunUsage & {
  children?: AgentRunUsage & {runs: number}
}

/**
 * Something a run committed to and had not delivered when it ended. Runs are asked to finish or
 * honestly close their obligations before ending; when a run spends that budget without doing so it
 * still ends, carrying the debt in the open rather than quietly writing it off.
 */
export type UnmetObligation =
  /** A typed delegate child that never delivered a schema-valid `return_result` payload. */
  | {kind: 'typed-result'}
  /** Plan steps left neither finished nor written off — labels as the agent last wrote them. */
  | {kind: 'plan'; steps: string[]}

/** Public metadata returned for a durable run. */
export type RunInfo = {
  id: string
  account: string
  rootRunId: string
  parentRunId?: string
  /**
   * The parent's tool call that spawned this run, when one did. It is how a delegate row in a
   * transcript finds the child it started — including while that child is still working, before
   * any result has been recorded against the call.
   */
  parentToolCallId?: string
  /**
   * The run this one continues. `ctx.continueAsNew` ends a run and starts a successor carrying only
   * the state it declared, so a long-lived loop never grows an unbounded journal; the two runs are
   * one piece of work, linked by this field (and by `continuedAsRunId` on the predecessor's output).
   */
  continuedFromRunId?: string
  depth: number
  kind: 'agent' | 'workflow'
  agentId?: string
  /** Transcript session for agent runs; workflow runs have none. */
  sessionId?: string
  origin: 'user' | 'trigger' | 'agent' | 'workflow' | 'system'
  /** Always present: every run is created with a real title (message excerpt, brief, or name). */
  title: string
  /** Label of the parent's plan step this run works on, when the spawner recorded one. */
  stepLabel?: string
  /**
   * Id of that plan step — the durable join for attaching this run to its step. Prefer it over
   * `stepLabel`: labels are display strings the agent rewrites between turns, so a stamped label
   * stops matching the plan it came from, while step ids are stable by the plan verb's contract.
   * Absent on runs spawned before this field existed, which still attach by label.
   */
  planStepId?: string
  /** The exact module a workflow run executes — the code the agent wrote, for review. */
  sourceText?: string
  /** How many child runs this run spawned. Populated by GetRun/ListRuns; absent means zero. */
  childRunCount?: number
  status: RunStatus
  wait?: RunWaitInfo
  plan?: RunPlan
  error?: {
    code: string
    message: string
    /** Script stack for workflow errors; `workflow.js:LINE` frames index into `sourceText`. */
    stack?: string
    /** Tool name of the failed call this error propagated from, when it was one. */
    tool?: string
    /** Journal callSeq of that failed call — joins the error to its journaled args and result. */
    callSeq?: number
    /** Structured detail the failing tool attached. */
    detail?: unknown
  }
  /**
   * Obligations this run ended without meeting. Absent on every run that kept its word — which is
   * nearly all of them — so its presence is the signal.
   */
  unmetObligations?: UnmetObligation[]
  usage?: RunUsageInfo
  createdAt: number
  startedAt?: number
  finishedAt?: number
  updatedAt: number
}

/** One durable entry in a workflow run's journal (loose until the workflow engine lands). */
export type RunJournalEntryInfo = {
  runId: string
  seq: number
  entry: Record<string, unknown>
  createdAt: number
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

/**
 * Who performed a logged action. The session log is a shared workspace log, not a chat: the user
 * holds the same verbs the agent does, and every entry says who acted. Events recorded before
 * this field existed derive their actor from shape via {@link sessionEventActor}.
 */
export type SessionActor = 'user' | 'agent' | 'system' | 'trigger'

/** Resolves an event payload's actor, deriving the pre-actor-field default from its shape. */
export function sessionEventActor(payload: SessionEventPayload): SessionActor {
  const value = payload as {actor?: unknown; type?: unknown; role?: unknown}
  if (value.actor === 'user' || value.actor === 'agent' || value.actor === 'system' || value.actor === 'trigger') {
    return value.actor
  }
  if (value.type === 'message' && value.role === 'user') return 'user'
  if (value.type === 'error') return 'system'
  return 'agent'
}

/**
 * Provenance stamped on events at append time: which account and signer authored a user event, or
 * which runtime produced an agent event, what it cost, and how long it took. Written once, so an
 * event still explains itself long after its request or run is gone. Events recorded before this
 * field existed simply have none — every reader treats it as optional detail, never as required
 * structure.
 */
export type SessionEventMeta = {
  /** Seed account that originated a user-authored event. */
  accountId?: string
  /** Exact cryptographic signer of the signed action that originated a user-authored event. */
  signerId?: string
  /** Model that produced the message, e.g. `gpt-5-mini`. */
  model?: string
  /** Provider the model ran on, e.g. `openai`. */
  provider?: string
  /** Token usage for this one turn (not the run's cumulative total). */
  usage?: AgentRunUsage
  /** Wall time this message or tool call took, in milliseconds. */
  durationMs?: number
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
      /**
       * Echo of the sender's `clientMessageId` on a user message, so the sending client can match
       * this event to its optimistic pending row by identity. Absent on events from other writers.
       */
      clientMessageId?: string
      actor?: SessionActor
      /** Origin metadata for user messages, or model/provider/usage/timing for assistant messages. */
      meta?: SessionEventMeta
    }
  | {type: 'tool_call'; id: string; name: string; input: unknown; actor?: SessionActor}
  | {
      /**
       * A `delegate` call spawned its child. Appended the moment the child exists — before it has
       * run a single step — so the transcript names the child while the call is still parked on it
       * and a client can open the child without discovering it through the run tree. The call's
       * `tool_result` still arrives from the child's finalizer; this event never stands in for it.
       */
      type: 'tool_spawn'
      toolCallId: string
      name: string
      /** The child run. Present for every kind of child. */
      runId: string
      /** The child's session. Present for model children; a script child has a run and no session. */
      sessionId?: string
      title: string
      actor?: SessionActor
    }
  | {
      type: 'tool_result'
      toolCallId: string
      name: string
      output?: unknown
      error?: string
      actor?: SessionActor
      /** How long the tool took. Absent on legacy events and on results appended by a child's finalizer. */
      meta?: SessionEventMeta
    }
  | {type: 'error'; message: string; actor?: SessionActor}
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
  | {_: 'change'; key: `runs/${string}`; value: RunInfo}
  | {_: 'append'; key: `runs/${string}`; runId: string; seq: number; entry: Record<string, unknown>; createdAt: number}
  | {
      _: 'appendPartial'
      key: `runs/${string}`
      runId: string
      partialId: string
      patch: {
        progress?: {fraction?: number; label?: string}
        activity?: AgentRunActivity
        usage?: AgentRunUsage
      }
    }
  | {_: 'error'; message: string}

/** Redacted provider metadata returned after provider writes. */
export type RedactedModelProvider = {
  id: string
  name: string
  type: string
  hasSecrets: boolean
  /** Authentication mode; absent means `api-key`. */
  authMode?: 'api-key' | 'subscription'
  /**
   * Subscription-auth health. `ok` when OAuth credentials are stored and usable;
   * `needs-login` when they are missing or a token refresh failed (expired or
   * revoked), meaning the user must sign in again. Absent for api-key providers.
   */
  authStatus?: 'ok' | 'needs-login'
  createdAt: number
  updatedAt: number
}

/** Transport used to reach a remote MCP server. */
export type McpServerTransport = 'http' | 'sse'

/**
 * Configuration for a remote (Streamable HTTP / SSE) MCP server, stored as CBOR. Only remote
 * transports exist here: the hosted, multi-tenant service never spawns local stdio processes.
 */
export type McpServerConfig = {
  /** http(s) endpoint of the MCP server. */
  url: string
  /** Transport; absent means Streamable HTTP first, falling back to SSE when the connect fails. */
  transport?: McpServerTransport
  /** Non-secret headers sent on every request. */
  headers?: Record<string, string>
  /** Header name → account secret name, resolved to plaintext at connect time. */
  secretRefs?: Record<string, string>
}

/** What the last discovery of an MCP server found. */
export type McpServerStatus = {
  state: 'ok' | 'error' | 'unknown'
  /** Failure message when `state` is `error`. */
  error?: string
  /** When the discovery ran. Absent when the server was never reached. */
  checkedAt?: number
}

/** One tool an MCP server advertises, as last discovered. */
export type McpToolInfo = {
  /** The tool's name on the MCP server. */
  name: string
  /** The name of the agent-side tool document (`<server>__<tool>`), which is what `call` uses. */
  toolName: string
  description?: string
  inputSchema?: JsonSchema
}

/** Redacted MCP server record returned to clients; never carries secret values. */
export type RedactedMcpServer = {
  id: string
  name: string
  url: string
  transport: McpServerTransport
  /** Non-secret header names. */
  headerNames: string[]
  /** Header names backed by encrypted account secrets. */
  secretHeaderNames: string[]
  hasSecrets: boolean
  /** Tools found at the last successful discovery (kept across a later failed refresh). */
  tools: McpToolInfo[]
  status: McpServerStatus
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

/** Successful response for `RegisterSigner`. */
export type RegisterSignerResponse = {
  _: 'RegisterSignerResponse'
  /** The delegating account the signer may now act as. */
  accountId: string
  /** The registered delegate signer. */
  signerId: string
}

/** Successful response for `ListAgentInvites`. */
export type ListAgentInvitesResponse = {
  _: 'ListAgentInvitesResponse'
  invites: AgentInviteInfo[]
}

/** Successful response for `ListAgentCollaborators`. */
export type ListAgentCollaboratorsResponse = {
  _: 'ListAgentCollaboratorsResponse'
  /** Whether the agent is readable by every signed account (see `SetAgentPublicRead`). */
  publicRead: boolean
  /** Whether every signed account may also chat with the agent (see `SetAgentPublicChat`). */
  publicChat: boolean
  agentId: string
  collaborators: AgentCollaboratorInfo[]
}

/** Successful response for an agent collaborator upsert. */
export type InviteAgentCollaboratorResponse = {
  _: 'InviteAgentCollaboratorResponse'
  collaborator: AgentCollaboratorInfo
}

/** Successful response for `SetAgentPublicRead`. */
export type SetAgentPublicReadResponse = {
  _: 'SetAgentPublicReadResponse'
  agent: AgentInfo
}

/** Successful response for `SetAgentPublicChat`. */
export type SetAgentPublicChatResponse = {
  _: 'SetAgentPublicChatResponse'
  agent: AgentInfo
}

/** Successful response for revoking or canceling agent access. */
export type RemoveAgentCollaboratorResponse = {
  _: 'RemoveAgentCollaboratorResponse'
  agentId: string
  accountId: string
}

/** Successful response for accepting an agent invitation. */
export type AcceptAgentInviteResponse = {
  _: 'AcceptAgentInviteResponse'
  agent: AgentInfo
}

/** Successful response for declining an agent invitation. */
export type DeclineAgentInviteResponse = {
  _: 'DeclineAgentInviteResponse'
  agentId: string
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

/** Successful response for `ListMcpServers`. */
export type ListMcpServersResponse = {
  _: 'ListMcpServersResponse'
  servers: RedactedMcpServer[]
}

/** Successful response for `SetMcpServer` and `RefreshMcpServer`. */
export type SetMcpServerResponse = {
  _: 'SetMcpServerResponse'
  server: RedactedMcpServer
}

/** Successful response for `DeleteMcpServer`. */
export type DeleteMcpServerResponse = {
  _: 'DeleteMcpServerResponse'
  name: string
}

/** Successful response for `StartProviderOAuth`. */
export type StartProviderOAuthResponse = {
  _: 'StartProviderOAuthResponse'
  loginId: string
  /** Browser URL the user must open to authorize. */
  authUrl: string
  /** Unix epoch ms when the pending login times out server-side. */
  expiresAt: number
}

/** Successful response for `SubmitProviderOAuthCode`. */
export type SubmitProviderOAuthCodeResponse = {
  _: 'SubmitProviderOAuthCodeResponse'
}

/** Snapshot of a pending or finished OAuth login. */
export type ProviderOAuthStatusResponse = {
  _: 'ProviderOAuthStatusResponse'
  loginId: string
  status: 'pending' | 'completed' | 'failed'
  /** Set when `completed`: name of the stored OAuth credentials secret to reference as `secretRefs.oauth`. */
  secretName?: string
  /** Set when `failed`. */
  error?: string
}

/** Successful response for `CancelProviderOAuth`. */
export type CancelProviderOAuthResponse = {
  _: 'CancelProviderOAuthResponse'
  loginId: string
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

/** Successful response for `ImportSigningIdentity`. */
export type ImportSigningIdentityResponse = {
  _: 'ImportSigningIdentityResponse'
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

/** One tool document from an agent's `~/tools`: a builtin binding, an authored lambda, or an MCP projection. */
export type AgentToolInfo = {
  name: string
  kind: 'builtin' | 'lambda' | 'mcp'
  /** MCP tools: the account MCP server this tool is projected from. */
  server?: string
  /** MCP tools: the tool's name on that server (the document name is `<server>__<remoteName>`). */
  remoteName?: string
  /** One line for listings and the Space index. */
  summary: string
  /** Full model-facing instructions, shown on expansion. */
  description: string
  /** JSON Schema for the tool's input. */
  input: Record<string, unknown>
  /** JSON Schema for the tool's return value, when the tool declares one. */
  output?: Record<string, unknown>
  /** Lambda source code, exactly as authored. Builtins carry none. */
  source?: string
  /** Lambda source language. */
  runtime?: 'typescript' | 'python'
  /** Content address of the tool document (DAG-CBOR, CIDv1); changes on every edit. */
  cid: string
  enabled: boolean
  /**
   * For builtins: whether the agent's grant set actually offers this tool. Authored lambdas are
   * always callable, so this is always true for them.
   */
  granted: boolean
  createdAt: number
  updatedAt: number
}

/** Successful response for `ListAgentTools`. */
export type ListAgentToolsResponse = {
  _: 'ListAgentToolsResponse'
  agentId: string
  tools: AgentToolInfo[]
}

/** Successful response for `SaveAgentTool`. */
export type SaveAgentToolResponse = {
  _: 'SaveAgentToolResponse'
  agentId: string
  tool: AgentToolInfo
}

/** Successful response for `DeleteAgentTool`. */
export type DeleteAgentToolResponse = {
  _: 'DeleteAgentToolResponse'
  agentId: string
  name: string
  /** False when the authored tool was already absent. */
  deleted: boolean
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
  /**
   * Final assistant event of the turn. Empty string when the turn did not produce one before the
   * request returned: background enqueues and runs that parked on sub-sessions (the rest of the
   * turn streams over WS).
   */
  assistantEventId: string
}

/** Successful response for `RetrySession`. */
export type RetrySessionResponse = {
  _: 'RetrySessionResponse'
  sessionId: string
  /** Final assistant event of the retried turn; empty string when the turn parked (streams over WS). */
  assistantEventId: string
}

/** Successful response for `GetRun`. */
export type GetRunResponse = {
  _: 'GetRunResponse'
  run: RunInfo
}

/** Successful response for `ListRuns`. */
export type ListRunsResponse = {
  _: 'ListRunsResponse'
  runs: RunInfo[]
}

/** Successful response for `CancelRun`. */
export type CancelRunResponse = {
  _: 'CancelRunResponse'
  runId: string
  /** False when the run was already terminal. */
  canceled: boolean
}

/** Successful response for `SignalRun`. */
export type SignalRunResponse = {
  _: 'SignalRunResponse'
  runId: string
  /** False when the run was not parked on a wait this signal satisfies. */
  delivered: boolean
}

/** Successful response for `GetRunJournal`. */
export type GetRunJournalResponse = {
  _: 'GetRunJournalResponse'
  runId: string
  entries: RunJournalEntryInfo[]
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

/** Successful response for `BeginFileUpload`. */
export type BeginFileUploadResponse = {
  _: 'BeginFileUploadResponse'
  uploadId: string
  /** Largest chunk the server accepts per `AppendFileUploadChunk`. */
  maxChunkBytes: number
}

/** Successful response for `AppendFileUploadChunk`. */
export type AppendFileUploadChunkResponse = {
  _: 'AppendFileUploadChunkResponse'
  uploadId: string
  /** Total bytes staged so far. */
  received: number
}

/** Successful response for `CommitFileUpload`. */
export type CommitFileUploadResponse = {
  _: 'CommitFileUploadResponse'
  /** The stored memory entry, when the target was agent memory. */
  entry?: AgentMemoryEntry
  /** The stored attachment, when the target was a session attachment. */
  attachment?: SessionAttachmentInfo
}

/** Successful response for `AbortFileUpload`. */
export type AbortFileUploadResponse = {
  _: 'AbortFileUploadResponse'
  uploadId: string
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
  | RegisterSignerResponse
  | ListAgentInvitesResponse
  | ListAgentCollaboratorsResponse
  | InviteAgentCollaboratorResponse
  | RemoveAgentCollaboratorResponse
  | SetAgentPublicReadResponse
  | SetAgentPublicChatResponse
  | AcceptAgentInviteResponse
  | DeclineAgentInviteResponse
  | ListModelProvidersResponse
  | ListProviderModelsResponse
  | ListSigningIdentitiesResponse
  | CreateSigningIdentityResponse
  | ImportSigningIdentityResponse
  | UpdateSigningIdentityResponse
  | DeleteSigningIdentityResponse
  | CreateAgentResponse
  | SetModelProviderResponse
  | DeleteModelProviderResponse
  | ListMcpServersResponse
  | SetMcpServerResponse
  | DeleteMcpServerResponse
  | StartProviderOAuthResponse
  | SubmitProviderOAuthCodeResponse
  | ProviderOAuthStatusResponse
  | CancelProviderOAuthResponse
  | SetSecretResponse
  | GetAgentResponse
  | DeleteAgentResponse
  | ListAgentTriggersResponse
  | GetAgentTriggerResponse
  | CreateAgentTriggerResponse
  | UpdateAgentTriggerResponse
  | DeleteAgentTriggerResponse
  | ListAgentMemoryResponse
  | ListAgentToolsResponse
  | SaveAgentToolResponse
  | DeleteAgentToolResponse
  | ReadAgentMemoryFileResponse
  | WriteAgentMemoryFileResponse
  | DeleteAgentMemoryFileResponse
  | DownloadAgentMemoryFileResponse
  | UploadAgentMemoryFileToIpfsResponse
  | CreateSessionResponse
  | ListSessionsResponse
  | RetrySessionResponse
  | GetRunResponse
  | ListRunsResponse
  | CancelRunResponse
  | SignalRunResponse
  | GetRunJournalResponse
  | UpdateSessionResponse
  | DeleteSessionResponse
  | GetSessionResponse
  | MessageSessionResponse
  | InvokeSessionToolResponse
  | UploadSessionAttachmentResponse
  | ReadSessionAttachmentResponse
  | BeginFileUploadResponse
  | AppendFileUploadChunkResponse
  | CommitFileUploadResponse
  | AbortFileUploadResponse
  | StopSessionResponse
  | ErrorResponse

export * from './write-guides'
