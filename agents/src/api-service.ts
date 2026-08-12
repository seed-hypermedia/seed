import type {Database} from 'bun:sqlite'
import type * as api from '@/api'
import {
  callableToolRegistry,
  getSeedTool,
  sessionEventActor,
  isReasoningLevel,
  modelReasoningSupport,
  modelSupportsImageInput,
  normalizeSeedToolName,
  seedAssistantSystemPrompt,
  seedToolRegistry,
  seedVerbRegistry,
  toolContractMarkdown,
  toolSummaryLine,
  type JsonSchema,
  type SeedToolMetadata,
} from '@seed-hypermedia/agents-protocol'
import {validateJsonSchemaShape, validateJsonSchemaValue} from '@/json-schema'
import * as activityTriggers from '@/activity-triggers'
import * as agentMemory from '@/agent-memory'
import * as sessionAttachments from '@/session-attachments'
import {
  buildLambdaProgram,
  CodeExecError,
  createCodeExecutor,
  defaultCodeExecConfig,
  parseLambdaResult,
  type CodeExecAvailability,
  type CodeExecConfig,
  type CodeExecResult,
  type CodeExecutor,
  type LambdaRuntime,
} from '@/code-exec'
import * as scheduleTriggers from '@/schedule-triggers'
import * as auth from '@/auth'
import * as cbor from '@/cbor'
import * as runs from '@/runs'
import * as runEvents from '@/run-events'
import * as toolDocs from '@/tool-documents'
import {
  lintWorkflowSource,
  normalizeRunPlan,
  runWorkflowVM,
  type WorkflowChildResolution,
  type WorkflowJournalEntry,
} from '@/workflow-host'
import {executeWebRead, executeWebSearch, type WebToolsConfig} from '@/web-tools'
import * as blobs from '@shm/shared/blobs'
import {
  blocksToMarkdown,
  commentToResolvedMarkdown,
  createCapability,
  createChange,
  createChangeOps,
  createComment,
  commentRecordIdFromBlob,
  createContact,
  createGenesisChange,
  createBlocksMap,
  createRedirectRef,
  createSeedClient,
  createTombstoneRef,
  createVersionRef,
  deleteComment,
  deleteContact,
  flattenToOperations,
  computeReplaceOps,
  hmBlockNodeToBlockNode,
  markdownBlockNodesToHMBlockNodes,
  packHmId,
  parseMarkdown,
  fileToIpfsBlobs,
  resolveFileLinksInBlocks,
  resolveCapability,
  resolveDocumentState,
  resolveIdWithClient,
  updateComment,
  documentToResolvedMarkdown,
  contentToResolvedMarkdown,
} from '@seed-hypermedia/client'
import type {CollectedBlob, DocumentOperation} from '@seed-hypermedia/client'
import {HMBlockNodeSchema} from '@seed-hypermedia/client/hm-types'
import type {
  HMSigner,
  HMBlockNode,
  HMDocument,
  HMMetadata,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath, unpackHmId} from '@seed-hypermedia/client/hm-types'
import * as pi from '@mariozechner/pi-coding-agent'
import {getModels} from '@mariozechner/pi-ai'
import type {OAuthCredentials} from '@mariozechner/pi-ai/oauth'
import {openaiCodexOAuthProvider} from '@mariozechner/pi-ai/oauth'
import {OAUTH_PROVIDER_TYPES, PersistedOAuthBackend, ProviderOAuthManager} from './provider-oauth'
import {CID} from 'multiformats/cid'
import {z} from 'zod'
import * as fs from 'node:fs'
import * as path from 'node:path'

const MAX_NAME_BYTES = 256
const MAX_PROMPT_BYTES = 64 * 1024
const MAX_MODEL_BYTES = 256
const MAX_METADATA_CBOR_BYTES = 16 * 1024
const MAX_TOOL_COUNT = 32
const MAX_TOOL_NAME_BYTES = 128
const MAX_TOOLS_TOTAL_BYTES = 4 * 1024
const MAX_SECRET_BYTES = 64 * 1024
const MAX_MESSAGE_TEXT_BYTES = 64 * 1024
/** Longest chain of agent-started sessions (A starts B starts C…) before start_session refuses. */
const MAX_SESSION_SPAWN_DEPTH = 3
/** Most sessions one session may start with start_session, a backstop against runaway spawning. */
const MAX_SESSION_SPAWNS_PER_SESSION = 10
/** Failed return_result validation attempts before a typed sub-session fails `output-schema`. */
const MAX_RETURN_RESULT_RETRIES = 3
/**
 * Times a run will hand the turn back to the agent because it ended owing something — an
 * undelivered typed result, an unfinished plan, whatever obligations grow to cover next.
 *
 * ONE budget for the whole run, not one per kind of debt: a run that owes a result AND a finished
 * checklist is one agent failing to finish one job, and three chances to finish it is three
 * chances, not six.
 *
 * A run that PARKS and resumes starts the budget again, deliberately: its children have delivered
 * since, so it is being asked about a different world than the one it stalled in. Parking is itself
 * bounded (a session may spawn only so many children), so this cannot run away.
 */
const MAX_RUN_CONTINUATIONS = 3
/** Plan step statuses that can never move again: the work is done, written off, or given up on. */
const TERMINAL_PLAN_STEP_STATUSES: ReadonlyArray<runs.RunPlanState['steps'][number]['status']> = [
  'done',
  'failed',
  'skipped',
]
/**
 * Attempts an agent run gets before it is finally failed. Only RETRYABLE outcomes consume the extra
 * ones (the queue re-queues 5xx/provider-overload with exponential backoff); anything classified
 * non-retryable still fails on the first attempt. Three is what it takes to ride out a provider
 * that is briefly overloaded — the failure mode that stranded a parked parent in live testing.
 */
const AGENT_RUN_MAX_ATTEMPTS = 3
/** Workflow journal caps: replay cost is bounded by these; split bigger jobs into smaller workflows. */
const WORKFLOW_JOURNAL_MAX_ENTRIES = 5_000
const WORKFLOW_JOURNAL_MAX_BYTES = 8 * 1024 * 1024
const SECRET_KEY_CONFIG_KEY = 'secret_encryption_key_v1'
const SECRET_NONCE_BYTES = 12
const MAX_TOOL_RESULT_BYTES = 256 * 1024
const MAX_WRITE_CONTENT_BYTES = 256 * 1024
const DEFAULT_SESSION_PAGE_SIZE = 50
const MAX_SESSION_PAGE_SIZE = 200
const MAX_CONTEXT_LINES = 64
const MAX_CONTEXT_LINE_BYTES = 2 * 1024
const MAX_MESSAGE_ATTACHMENTS = 16
/** Largest single AppendFileUploadChunk payload. Small chunks keep client-side signing cheap. */
const MAX_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
/** Largest total chunked upload into agent memory. */
const MAX_UPLOAD_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
/** Staged uploads not touched for this long are discarded. */
const UPLOAD_TTL_MS = 60 * 60 * 1000
/** Concurrent staged uploads allowed per account. */
const MAX_ACTIVE_UPLOADS_PER_ACCOUNT = 8
/**
 * Largest attachment sent to a vision model as inline image content via `view_attachment`.
 * Anthropic caps images at ~5 MB; larger images degrade to metadata plus guidance to use
 * `attachment_to_memory` + `execute_code` (e.g. to downscale) instead.
 */
const MAX_INLINE_IMAGE_BYTES = 4_500_000

/** One chunked upload staged on disk until commit. */
type StagedFileUpload = {
  accountId: string
  target: api.FileUploadTarget
  size: number
  received: number
  partPath: string
  updatedAt: number
}

/** Result of evaluating one activity event against enabled triggers. */
export type TriggerProcessingResult = {
  checked: number
  matched: number
  fired: number
  skipped: number
  errors: number
}

/** Server event emitted after durable agent/session changes. */
export type ServiceEvent =
  | {type: 'agent-change'; accountId: string; agent: api.AgentInfo}
  | {type: 'session-change'; accountId: string; session: api.SessionInfo}
  | {type: 'session-event'; accountId: string; agentId: string; event: api.SessionEvent}
  | {
      type: 'session-partial'
      accountId: string
      agentId: string
      sessionId: string
      partialId: string
      textDelta?: string
      done?: boolean
      usage?: api.AgentRunUsage
      activity?: api.AgentRunActivity
    }
  | {type: 'account-change'; accountId: string; reason: string; agentId?: string; sessionId?: string}
  | {type: 'run-change'; accountId: string; run: api.RunInfo}
  | {type: 'run-append'; accountId: string; rootRunId: string; entry: api.RunJournalEntryInfo}
  | {
      type: 'run-partial'
      accountId: string
      rootRunId: string
      runId: string
      partialId: string
      patch: {
        progress?: {fraction?: number; label?: string}
        activity?: api.AgentRunActivity
        usage?: api.AgentRunUsage
      }
    }

/** Error with an HTTP status code for API responses. */
export class APIError extends Error {
  /** HTTP status code for the error response. */
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

class SessionStoppedError extends Error {
  constructor() {
    super('Agent run stopped')
  }
}

/** Thrown out of a Pi run when the turn parked on spawned sub-sessions instead of finishing. */
class SessionParkedError extends Error {
  constructor() {
    super('Agent run parked on sub-sessions')
  }
}

type RunningSession = {
  accountId: string
  abort?: () => Promise<void>
  stopped: boolean
  /** Sub-session tool calls of the current turn the run must park on (set by the sub_session executor). */
  parkToolCallIds?: string[]
  /** Validated `return_result` payload delivered by a typed sub-session child. */
  subResult?: {value: unknown}
  /** Failed `return_result` validation attempts (bounded; then the run fails `output-schema`). */
  subResultRetries?: number
  /** Set when the turn should end after the current tool batch (result delivered). */
  completeAfterTools?: boolean
}

/** Validated delegate tool input for a model child, embedded in the child run's `input` so the run is self-describing. */
type SubSessionSpec = {
  title?: string
  prompt?: string
  agentId?: string
  input: unknown
  tools?: string[]
  output?: JsonSchema
}

/**
 * Verbs and callable tools a script's ctx.call may reach: everything session-independent.
 * (delegate/plan have dedicated ctx.* forms; return_result is child-turn-only.)
 */
const WORKFLOW_CALLABLE_TOOLS = new Set([
  seedVerbRegistry.read.name,
  seedVerbRegistry.write.name,
  ...Object.keys(callableToolRegistry),
])

/**
 * The callable tools an agent may dispatch through `call`. `definition.tools` narrows the set
 * (unknown and legacy names are ignored); omitting it grants every service-runtime callable.
 * Execute drops out silently when this host cannot run sandboxes.
 */
/** Names of every callable tool the agent service can dispatch (excludes assistant-only tools). */
function serviceCallableNames(): string[] {
  return Object.values(callableToolRegistry as Record<string, SeedToolMetadata>)
    .filter((tool) => tool.runtimes.includes('agent-service'))
    .map((tool) => tool.name)
}

/**
 * Whether this agent may publish signed public content (hm:// documents/comments, IPFS uploads).
 * Memory writes are never gated. Grants are the pseudo-tool name 'publish' in definition.tools;
 * legacy write-group names count so a pre-verbs agent keeps exactly the publishing posture its
 * owner configured, and an undefined tools array (default agents) publishes.
 */
const LEGACY_PUBLISH_TOOL_NAMES = ['write', 'memory_publish_document', 'ipfs_write', 'attachment_to_ipfs']

function publishGrantEnabled(definition: api.AgentDefinition): boolean {
  if (definition.tools === undefined) return true
  return definition.tools.some((tool) => tool === 'publish' || LEGACY_PUBLISH_TOOL_NAMES.includes(tool))
}

function enabledCallableTools(definition: api.AgentDefinition, codeExecAvailable: boolean): string[] {
  const serviceCallables = serviceCallableNames()
  const requested = definition.tools?.map(normalizeSeedToolName)
  const enabled =
    requested === undefined ? serviceCallables : serviceCallables.filter((name) => requested.includes(name))
  return enabled.filter((name) => name !== callableToolRegistry.execute.name || codeExecAvailable)
}

/** Validates sub_session/ctx.agent input into the stored spec shape (shared by chat and workflows). */
export function normalizeSubSessionSpec(raw: unknown): SubSessionSpec {
  const input = isPlainRecord(raw) ? raw : {}
  // The model-facing field is `brief`; scripts' ctx.delegate may still pass `input`. Normalize to
  // the stored `input` slot so child runs stay self-describing.
  if (input.input === undefined && input.brief !== undefined) {
    input.input = input.brief
    delete input.brief
  }
  // Models often write the task brief into `prompt`. A prompt with no brief is meaningless as a
  // bare system prompt, so read it as the brief instead of bouncing the call for a retry.
  if (input.input === undefined && typeof input.prompt === 'string' && input.prompt) {
    input.input = input.prompt
    delete input.prompt
  }
  if (input.input === undefined) {
    throw new APIError(400, 'delegate requires a `brief` — the task briefing as human-readable markdown')
  }
  if (typeof input.prompt === 'string' && typeof input.agentId === 'string') {
    throw new APIError(400, 'Provide either prompt or agentId, not both')
  }
  const spec: SubSessionSpec = {
    ...(typeof input.title === 'string' && input.title ? {title: input.title} : {}),
    ...(typeof input.prompt === 'string' && input.prompt ? {prompt: input.prompt} : {}),
    ...(typeof input.agentId === 'string' && input.agentId ? {agentId: input.agentId} : {}),
    input: input.input,
    ...(Array.isArray(input.tools)
      ? {tools: input.tools.filter((tool): tool is string => typeof tool === 'string')}
      : {}),
  }
  if (input.output !== undefined) {
    const shapeErrors = validateJsonSchemaShape(input.output)
    if (shapeErrors.length > 0) {
      throw new APIError(
        400,
        `output schema is not supported: ${shapeErrors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
      )
    }
    spec.output = input.output as JsonSchema
  }
  return spec
}

/**
 * The child's first user message IS the parent's input, verbatim: sub-session transcripts must read
 * as the exact briefing the parent wrote (spawners are instructed to pass human-readable markdown).
 * Non-string inputs fall back to a bare fenced JSON block so nothing is ever hidden or reworded.
 */
function renderSubSessionInput(input: unknown): string {
  if (typeof input === 'string') return input
  return `\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``
}

/** Content of a durable assistant message event, for typed-less sub-session results. */
function assistantMessageText(event: api.SessionEvent): string {
  const payload = event.event as {type?: string; content?: string}
  return payload.type === 'message' && typeof payload.content === 'string' ? payload.content : ''
}

/**
 * Reads an unmet-obligation list back off a persisted run. Runs are decoded from CBOR written by
 * older builds, so anything unrecognized is dropped rather than trusted into the API surface.
 */
function normalizeUnmetObligations(raw: unknown): api.UnmetObligation[] {
  if (!Array.isArray(raw)) return []
  const obligations: api.UnmetObligation[] = []
  for (const entry of raw) {
    if (!isPlainRecord(entry)) continue
    if (entry.kind === 'typed-result') obligations.push({kind: 'typed-result'})
    else if (entry.kind === 'plan' && Array.isArray(entry.steps)) {
      obligations.push({kind: 'plan', steps: entry.steps.filter((step): step is string => typeof step === 'string')})
    }
  }
  return obligations
}

/**
 * What a finished agent turn hands back. A delegate child answers its parent with the text it
 * produced; a run driving a user's session answers the request with the event to render.
 */
function turnOutput(spec: SubSessionSpec | undefined, assistantEvent: api.SessionEvent): Record<string, unknown> {
  return spec ? {text: assistantMessageText(assistantEvent)} : {assistantEventId: assistantEvent.id}
}

/** One line per obligation, in the second person, as the agent will read it. */
function obligationLine(obligation: api.UnmetObligation): string {
  return obligation.kind === 'typed-result'
    ? '- You have not delivered the result yet. Call the return_result tool now with a payload matching the required schema; that is how this task completes.'
    : `- Your plan has unfinished steps: ${obligation.steps.join(
        ', ',
      )}. Continue that work now, or set every step to an honest terminal status — done, failed, or skipped.`
}

/**
 * The message a run hands itself when a turn ends with work still owed. It lists every open
 * obligation at once, so an agent that owes two things is asked once rather than nudged twice.
 */
function continuationPrompt(obligations: api.UnmetObligation[]): string {
  return [
    'This turn is ending with work you committed to still open:',
    ...obligations.map(obligationLine),
    '',
    "Finish it now, or say plainly why you are stopping and close it out honestly. Don't leave the record claiming something you did not do.",
  ].join('\n')
}

/** The notice a run leaves on the log when it runs out of chances with obligations still open. */
function unmetObligationsNotice(obligations: api.UnmetObligation[]): string {
  const lines = obligations.map((obligation) =>
    obligation.kind === 'typed-result'
      ? '- No result was delivered, so this task has no answer to hand back.'
      : `- Unfinished plan steps: ${obligation.steps.join(', ')}.`,
  )
  return [
    'This run ended with work still open:',
    ...lines,
    '',
    'Nothing was completed on the agent’s behalf — the record shows the work exactly as it was left.',
  ].join('\n')
}

/** Classifies an executor error into the persisted run-error shape with retryability. */
function classifyRunError(error: unknown): runs.RunErrorInfo {
  if (error instanceof APIError) {
    return {
      code: error.status >= 500 ? 'provider-error' : 'config-error',
      message: error.message,
      retryable: error.status >= 500,
      httpStatus: error.status,
    }
  }
  return {
    code: 'provider-error',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  }
}

/** Public run metadata derived from a run record. */
function runInfoFromRecord(run: runs.RunRecord): api.RunInfo {
  const inputRecord = isPlainRecord(run.input) ? run.input : undefined
  const stepLabel = typeof inputRecord?.planStepLabel === 'string' ? inputRecord.planStepLabel : undefined
  const planStepId = typeof inputRecord?.planStepId === 'string' ? inputRecord.planStepId : undefined
  // Runs written before the column existed carry the id only in their input payload.
  const parentToolCallId =
    run.parentToolCallId ??
    (typeof inputRecord?.parentToolCallId === 'string' ? inputRecord.parentToolCallId : undefined)
  const outputRecord = isPlainRecord(run.output) ? run.output : undefined
  const unmetObligations = normalizeUnmetObligations(outputRecord?.unmetObligations ?? run.error?.unmetObligations)
  return {
    id: run.id,
    account: run.accountId,
    rootRunId: run.rootRunId,
    ...(run.parentRunId ? {parentRunId: run.parentRunId} : {}),
    ...(parentToolCallId ? {parentToolCallId} : {}),
    ...(run.continuedFromRunId ? {continuedFromRunId: run.continuedFromRunId} : {}),
    depth: run.depth,
    kind: run.kind,
    ...(run.agentId ? {agentId: run.agentId} : {}),
    ...(run.sessionId ? {sessionId: run.sessionId} : {}),
    origin: run.origin,
    ...(run.title ? {title: run.title} : {}),
    ...(stepLabel ? {stepLabel} : {}),
    ...(planStepId ? {planStepId} : {}),
    ...(run.kind === 'workflow' && run.sourceText ? {sourceText: run.sourceText} : {}),
    status: run.status,
    ...(run.wait
      ? {
          wait: {
            reason: run.wait.reason,
            ...(run.wait.reason === 'timer' ? {wakeAt: run.wait.wakeAt} : {}),
            ...(run.wait.reason === 'children' ? {pendingChildren: run.wait.toolCallIds.length} : {}),
            ...(run.wait.reason === 'event'
              ? {
                  ...(run.wait.timeoutAt === undefined ? {} : {wakeAt: run.wait.timeoutAt}),
                  ...(run.wait.label ? {label: run.wait.label} : {}),
                  ...(run.wait.answerWith ? {answerWith: run.wait.answerWith} : {}),
                }
              : {}),
            ...(run.wait.reason === 'budget-pause' && run.wait.note ? {label: run.wait.note} : {}),
          },
        }
      : {}),
    ...(run.plan ? {plan: run.plan} : {}),
    ...(run.error ? {error: {code: run.error.code, message: run.error.message}} : {}),
    // A succeeded run carries its debts on its output, a failed one on its error; the surface says
    // "this run ended owing something" either way, so clients need only look in one place.
    ...(unmetObligations.length > 0 ? {unmetObligations} : {}),
    ...(run.usage ? {usage: run.usage} : {}),
    createdAt: run.createdAt,
    ...(run.startedAt !== undefined ? {startedAt: run.startedAt} : {}),
    ...(run.finishedAt !== undefined ? {finishedAt: run.finishedAt} : {}),
    updatedAt: run.updatedAt,
  }
}

/** Server-side implementation of the signed Agents action API. */
export class Service {
  readonly #db: Database
  readonly #dataDir: string
  readonly #onEvent?: (event: ServiceEvent) => void
  readonly #hmServerUrl: string
  readonly #web: WebToolsConfig
  readonly #codeExec: CodeExecutor
  readonly #runningSessions = new Map<string, RunningSession>()
  /** In-flight background dispatch setup (trigger prompt builds + enqueues); the runs themselves live in the queue. */
  readonly #pendingTriggerSessions = new Set<Promise<void>>()
  /** Sessions with a user verb mid-execution: agent runs must not start under them (reverse 409). */
  readonly #liveUserVerbs = new Map<string, number>()
  /** Whether subscription (OAuth) provider sign-in is offered (server opt-in). */
  readonly #subscriptionAuthEnabled: boolean
  /** Durable run records + dispatch queue; every agent execution goes through it. */
  readonly #runQueue: runs.RunQueue
  /** Resolvers awaiting a run's terminal status (workflow children), resolved in the finalizer. */
  readonly #runWaiters = new Map<string, Array<(run: runs.RunRecord) => void>>()
  /** Live workflow VMs whose cancellation was requested; their interrupt handlers check this. */
  readonly #workflowCancelFlags = new Set<string>()
  /** Whether untitled sessions get a dedicated model call to name them (server opt-in). */
  readonly #titleGenerationEnabled: boolean
  /** Sessions with a title generation in flight, so parks + finalizes do not double-spend. */
  readonly #namingSessions = new Set<string>()
  /** Chunked uploads staged on disk, keyed by upload id. Abandoned uploads expire after a TTL. */
  readonly #uploads = new Map<string, StagedFileUpload>()
  /** Pending provider OAuth sign-ins (StartProviderOAuth … GetProviderOAuthStatus). */
  readonly #providerOAuth: ProviderOAuthManager
  /**
   * Shared per-`account+secret` OAuth credential backends. Sharing one backend
   * across concurrent sessions serializes token refreshes (a refresh rotates the
   * refresh token, so parallel refreshes would strand each other) and keeps every
   * session on the freshest credentials.
   */
  readonly #oauthBackends = new Map<string, PersistedOAuthBackend>()

  constructor(
    db: Database,
    dataDir: string,
    options: {
      onEvent?: (event: ServiceEvent) => void
      hmServerUrl?: string
      web?: WebToolsConfig
      exec?: CodeExecConfig
      codeExecutor?: CodeExecutor
      providerOAuth?: ProviderOAuthManager
      /** Offer subscription (OAuth) provider sign-in. Explicit server opt-in; default off. */
      subscriptionAuth?: boolean
      /** Generate titles for untitled sessions with a dedicated model call (default off: tests mock providers). */
      titleGeneration?: boolean
    } = {},
  ) {
    this.#db = db
    this.#dataDir = dataDir
    this.#onEvent = options.onEvent
    this.#providerOAuth = options.providerOAuth ?? new ProviderOAuthManager()
    this.#hmServerUrl = options.hmServerUrl || 'https://hyper.media'
    this.#web = options.web ?? {}
    this.#codeExec = options.codeExecutor ?? createCodeExecutor(options.exec ?? defaultCodeExecConfig())
    this.#subscriptionAuthEnabled = options.subscriptionAuth ?? false
    this.#titleGenerationEnabled = options.titleGeneration ?? false
    this.#runQueue = new runs.RunQueue(db, {
      executors: {
        agent: (run) => this.#executeAgentRun(run),
        workflow: (run) => this.#executeWorkflowRun(run),
      },
      onRunChanged: (run) => this.#onRunChanged(run),
      onRunFinalized: (run) => this.#onRunFinalized(run),
      abortRun: (run) => {
        if (run.kind === 'workflow') this.#workflowCancelFlags.add(run.id)
        if (run.sessionId) void this.#abortLiveSessionRun(run.accountId, run.sessionId)
      },
    })
    // Crash recovery: runs a dead process left claimed/running go back to queued (the sweep wakes
    // the loop when it found any); their sessions' dangling tool calls are repaired on resume, and
    // parked parents whose children finalized before the crash get their resolutions replayed.
    this.#runQueue.sweepAtBoot()
    this.#reconcileWaitingRunsAtBoot()
  }

  /**
   * Boot pass closing the crash window between a child's terminal commit and its parent's
   * wait-resolution (separate transactions): any waiting-on-children run whose child already
   * finished gets the resolution replayed now, so no run stays `waiting` forever.
   */
  #reconcileWaitingRunsAtBoot(): void {
    const waiting = this.#db
      .query<{id: string; account_id: string}, []>(
        `SELECT id, account_id FROM runs WHERE status = 'waiting' AND not_before IS NULL`,
      )
      .all()
    for (const row of waiting) {
      const run = runs.getRun(this.#db, row.account_id, row.id)
      if (!run || run.wait?.reason !== 'children') continue
      const children = this.#db.query<{id: string}, [string]>(`SELECT id FROM runs WHERE parent_run_id = ?`).all(run.id)
      for (const childRow of children) {
        const child = runs.getRun(this.#db, run.accountId, childRow.id)
        if (!child || !runs.TERMINAL_RUN_STATUSES.includes(child.status)) continue
        const input = child.input as {parentToolCallId?: string; parentToolName?: string} | null
        if (typeof input?.parentToolCallId === 'string' && run.wait.toolCallIds.includes(input.parentToolCallId)) {
          console.info('[agents/runs] boot reconcile: replaying finished child into parked parent', {
            parentRunId: run.id,
            childRunId: child.id,
          })
          this.#resolveSubSessionResult(child, run.id, input.parentToolCallId, input.parentToolName)
        }
      }
      const refreshed = runs.getRun(this.#db, run.accountId, run.id)
      if (refreshed?.status === 'waiting') this.#reconcileParkedRun(refreshed)
    }
  }

  /** Stops queue timers so tests and graceful shutdown do not leak intervals. */
  stopRunQueue(): void {
    this.#runQueue.stop()
  }

  /** The Seed HM server this agent publishes to and reads from. Surfaced via health so desktop clients can
   * connect their local node to it for discovery. */
  get hmServerUrl(): string {
    return this.#hmServerUrl
  }

  /** Whether subscription provider sign-in is offered, for client capability display. */
  get subscriptionAuthEnabled(): boolean {
    return this.#subscriptionAuthEnabled
  }

  /** Reports which optional web-tool backends this server has configured, for client capability display. */
  webToolCapabilities(): {search: boolean; readBrowser: boolean} {
    return {search: Boolean(this.#web.searxngUrl), readBrowser: Boolean(this.#web.crawlerUrl)}
  }

  /** Whether this server offers sandboxed code execution, for client capability display. */
  async codeExecAvailability(): Promise<CodeExecAvailability> {
    return await this.#codeExec.availability()
  }

  /** Verifies and dispatches a signed action envelope. */
  async message(envelope: api.SignedActionEnvelope): Promise<api.AgentResponse> {
    let verified: auth.VerifiedEnvelope
    try {
      verified = auth.verifyEnvelope(this.#db, envelope)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid signed envelope'
      throw new APIError(401, message)
    }

    switch (envelope.action._) {
      case 'ListAgents':
        return this.#listAgents(verified.accountId)
      case 'CreateAgent':
        return this.#createAgent(verified.accountId, envelope.action.definition, envelope.action.clientRequestId)
      case 'ListModelProviders':
        return this.#listModelProviders(verified.accountId)
      case 'ListProviderModels':
        return this.#listProviderModels(verified.accountId, envelope.action.provider)
      case 'ListSigningIdentities':
        return this.#listSigningIdentities(verified.accountId)
      case 'CreateSigningIdentity':
        return this.#createSigningIdentity(verified.accountId, envelope.action.label, envelope.action.clientRequestId)
      case 'UpdateSigningIdentity':
        return this.#updateSigningIdentity(
          verified.accountId,
          envelope.action.name,
          envelope.action.label,
          envelope.action.icon,
        )
      case 'DeleteSigningIdentity':
        return this.#deleteSigningIdentity(verified.accountId, envelope.action.name)
      case 'SetModelProvider':
        return this.#setModelProvider(verified.accountId, envelope.action.name, envelope.action.provider)
      case 'DeleteModelProvider':
        return this.#deleteModelProvider(verified.accountId, envelope.action.name)
      case 'StartProviderOAuth':
        return this.#startProviderOAuth(verified.accountId, envelope.action.providerType)
      case 'SubmitProviderOAuthCode':
        return this.#submitProviderOAuthCode(verified.accountId, envelope.action.loginId, envelope.action.code)
      case 'GetProviderOAuthStatus':
        return this.#getProviderOAuthStatus(verified.accountId, envelope.action.loginId)
      case 'CancelProviderOAuth':
        return this.#cancelProviderOAuth(verified.accountId, envelope.action.loginId)
      case 'SetSecret':
        return this.#setSecret(
          verified.accountId,
          envelope.action.name,
          envelope.action.value,
          envelope.action.metadata,
        )
      case 'GetAgent':
        return this.#getAgent(verified.accountId, envelope.action.agentId)
      case 'UpdateAgent':
        return this.#updateAgent(verified.accountId, envelope.action.agentId, envelope.action.definition)
      case 'DeleteAgent':
        return this.#deleteAgent(verified.accountId, envelope.action.agentId)
      case 'ListAgentTriggers':
        return this.#listAgentTriggers(verified.accountId, envelope.action.agentId)
      case 'GetAgentTrigger':
        return this.#getAgentTrigger(verified.accountId, envelope.action.triggerId)
      case 'CreateAgentTrigger':
        return this.#createAgentTrigger(
          verified.accountId,
          envelope.action.agentId,
          envelope.action.trigger,
          envelope.action.clientRequestId,
        )
      case 'UpdateAgentTrigger':
        return this.#updateAgentTrigger(verified.accountId, envelope.action.triggerId, envelope.action.patch)
      case 'DeleteAgentTrigger':
        return this.#deleteAgentTrigger(verified.accountId, envelope.action.triggerId)
      case 'ListAgentMemory':
        return this.#listAgentMemory(verified.accountId, envelope.action.agentId)
      case 'ReadAgentMemoryFile':
        return this.#readAgentMemoryFile(verified.accountId, envelope.action.agentId, envelope.action.path)
      case 'WriteAgentMemoryFile':
        return this.#writeAgentMemoryFile(
          verified.accountId,
          envelope.action.agentId,
          envelope.action.path,
          envelope.action.content,
        )
      case 'DeleteAgentMemoryFile':
        return this.#deleteAgentMemoryFile(verified.accountId, envelope.action.agentId, envelope.action.path)
      case 'DownloadAgentMemoryFile':
        return this.#downloadAgentMemoryFile(
          verified.accountId,
          envelope.action.agentId,
          envelope.action.url,
          envelope.action.path,
        )
      case 'UploadAgentMemoryFileToIpfs':
        return this.#uploadAgentMemoryFileToIpfs(verified.accountId, envelope.action.agentId, envelope.action.path)
      case 'CreateSession':
        return this.#createSession(
          verified.accountId,
          envelope.action.agentId,
          envelope.action.title,
          envelope.action.clientRequestId,
        )
      case 'ListSessions':
        return this.#listSessions(
          verified.accountId,
          envelope.action.agentId,
          envelope.action.limit,
          envelope.action.cursor,
          envelope.action.parentSessionId,
          envelope.action.includeChildren,
        )
      case 'UpdateSession':
        return this.#updateSession(verified.accountId, envelope.action.sessionId, envelope.action.title)
      case 'DeleteSession':
        return this.#deleteSession(verified.accountId, envelope.action.sessionId)
      case 'GetSession':
        return await this.#getSession(verified.accountId, envelope.action.sessionId, envelope.action.afterSeq)
      case 'InvokeSessionTool':
        return this.#invokeSessionTool(
          verified.accountId,
          envelope.action.sessionId,
          envelope.action.verb,
          envelope.action.input,
        )
      case 'MessageSession':
        return this.#messageSession(
          verified.accountId,
          envelope.action.sessionId,
          envelope.action.content,
          envelope.action.clientMessageId,
        )
      case 'UploadSessionAttachment':
        return this.#uploadSessionAttachment(
          verified.accountId,
          envelope.action.sessionId,
          envelope.action.name,
          envelope.action.mimeType,
          envelope.action.content,
        )
      case 'ReadSessionAttachment':
        return this.#readSessionAttachment(verified.accountId, envelope.action.sessionId, envelope.action.attachmentId)
      case 'BeginFileUpload':
        return this.#beginFileUpload(verified.accountId, envelope.action.target, envelope.action.size)
      case 'AppendFileUploadChunk':
        return this.#appendFileUploadChunk(
          verified.accountId,
          envelope.action.uploadId,
          envelope.action.offset,
          envelope.action.content,
        )
      case 'CommitFileUpload':
        return this.#commitFileUpload(verified.accountId, envelope.action.uploadId)
      case 'AbortFileUpload':
        return this.#abortFileUpload(verified.accountId, envelope.action.uploadId)
      case 'StopSession':
        return this.#stopSession(verified.accountId, envelope.action.sessionId)
      case 'RetrySession':
        return this.#retrySession(verified.accountId, envelope.action.sessionId)
      case 'GetRun':
        return this.#getRun(verified.accountId, envelope.action.runId)
      case 'ListRuns':
        return this.#listRuns(verified.accountId, envelope.action)
      case 'CancelRun':
        return this.#cancelRun(verified.accountId, envelope.action.runId)
      case 'SignalRun':
        return this.#signalRun(
          verified.accountId,
          envelope.action.runId,
          envelope.action.signal,
          envelope.action.payload,
        )
      case 'GetRunJournal':
        return this.#getRunJournal(verified.accountId, envelope.action.runId, envelope.action.afterSeq)
      case 'Subscribe':
        throw new APIError(400, 'Subscribe is only supported over WebSocket')
      default:
        throw new APIError(400, `Unsupported action: ${(envelope.action as {_?: string})._}`)
    }
  }

  #listAgents(accountId: string): api.ListAgentsResponse {
    const rows = this.#db
      .query<AgentRow, [string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents
         WHERE account_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(accountId)

    return {
      _: 'ListAgentsResponse',
      agents: rows.map(agentRowToInfo),
    }
  }

  async #createAgent(
    accountId: string,
    rawDefinition: api.AgentDefinition,
    clientRequestId?: string,
  ): Promise<api.CreateAgentResponse> {
    return this.#withIdempotency(accountId, 'CreateAgent', clientRequestId, {definition: rawDefinition}, () =>
      this.#createAgentOnce(accountId, rawDefinition),
    )
  }

  #createAgentOnce(accountId: string, rawDefinition: api.AgentDefinition): api.CreateAgentResponse {
    const definition = normalizeDefinition(rawDefinition)
    const provider = this.#db
      .query<{name: string; type: string}, [string, string]>(
        `SELECT name, type FROM model_providers WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, definition.modelProvider)
    if (!provider) throw new APIError(400, 'Model provider not found')
    validateReasoningLevel(provider.type, definition)
    this.#validateSigningKeys(accountId, definition)

    const now = Date.now()
    const agentId = crypto.randomUUID()
    const stateDir = path.join(this.#dataDir, 'agents', agentId)

    this.#db.run(
      `INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      [accountId, now, now],
    )
    this.#db.run(
      `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [agentId, accountId, cbor.encode(definition), stateDir, 'idle', now, now],
    )
    fs.mkdirSync(stateDir, {recursive: true})
    this.#createDefaultMentionTrigger(accountId, agentId, definition)
    const agentInfo = this.#getAgentInfo(accountId, agentId)
    if (agentInfo) {
      this.#emit({type: 'agent-change', accountId, agent: agentInfo})
      this.#emit({type: 'account-change', accountId, reason: 'agent-created', agentId})
    }

    return {_: 'CreateAgentResponse', agentId}
  }

  /**
   * Gives a new agent a default trigger so that mentioning the agent's own HM account starts a
   * session in which it responds. The mention target is the agent's signing-identity account uid,
   * resolved from its primary signing key. Best-effort: a failure here never blocks agent creation.
   */
  #createDefaultMentionTrigger(accountId: string, agentId: string, definition: api.AgentDefinition): void {
    const signingKey = definition.signingKey ?? definition.signingKeys?.[0]
    if (!signingKey) return
    const mentionAccountId = this.#signingIdentityAccountId(accountId, signingKey)
    if (!mentionAccountId) return
    try {
      this.#createAgentTriggerOnce(accountId, agentId, {
        name: `Mentions of ${definition.name}`,
        enabled: true,
        source: {type: 'user-mention', mentionedAccounts: [mentionAccountId]},
        prompt: 'Respond to the mention, performing the action requested.',
      })
    } catch (error) {
      console.warn('[agents] failed to create default mention trigger', {agentId, error: errorMessage(error)})
    }
  }

  /** Resolves the HM account uid behind a signing-key secret name, or null if it is not an account key. */
  #signingIdentityAccountId(accountId: string, signingKey: string): string | null {
    const row = this.#db
      .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
        `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, signingKey)
    if (!row?.metadata_cbor) return null
    const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
    if (metadata.kind !== 'hm-account-key') return null
    return typeof metadata.accountId === 'string' ? metadata.accountId : null
  }

  #listModelProviders(accountId: string): api.ListModelProvidersResponse {
    const rows = this.#db
      .query<
        {id: string; name: string; type: string; config_cbor: Uint8Array; created_at: number; updated_at: number},
        [string]
      >(
        `SELECT id, name, type, config_cbor, created_at, updated_at FROM model_providers WHERE account_id = ? ORDER BY updated_at DESC`,
      )
      .all(accountId)
    return {
      _: 'ListModelProvidersResponse',
      providers: rows.map((row) => {
        const provider = cbor.decode<api.ModelProviderConfig>(row.config_cbor)
        return {
          id: row.id,
          name: row.name,
          type: row.type,
          hasSecrets: Object.keys(provider.secretRefs ?? {}).length > 0,
          ...this.#providerAuthInfo(accountId, provider),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      }),
    }
  }

  async #listProviderModels(accountId: string, rawProviderName: string): Promise<api.ListProviderModelsResponse> {
    const providerName = normalizeBoundedString(rawProviderName, 'Model provider', MAX_NAME_BYTES)
    const row = this.#db
      .query<{config_cbor: Uint8Array}, [string, string]>(
        `SELECT config_cbor FROM model_providers WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, providerName)
    if (!row) throw new APIError(404, 'Model provider not found')

    const provider = cbor.decode<api.ModelProviderConfig>(row.config_cbor)
    const spec = providerSpec(provider.type)
    if (provider.authMode === 'subscription') {
      // The ChatGPT backend has no models endpoint; serve Pi's static catalog of
      // models the Codex subscription backend accepts.
      return {_: 'ListProviderModelsResponse', models: subscriptionProviderModels()}
    }
    const apiKeySecretName = provider.secretRefs?.apiKey
    if (spec.requireApiKey && !apiKeySecretName) throw new APIError(400, `${provider.type} API key is not configured`)
    const apiKey = apiKeySecretName
      ? new TextDecoder().decode(await this.#getSecretPlaintext(accountId, apiKeySecretName))
      : undefined
    const baseUrl = resolveProviderBaseUrl(provider.type, provider.baseUrl)

    return {_: 'ListProviderModelsResponse', models: await fetchProviderModels(provider.type, baseUrl, apiKey)}
  }

  #listSigningIdentities(accountId: string): api.ListSigningIdentitiesResponse {
    const rows = this.#db
      .query<
        {id: string; name: string; metadata_cbor: Uint8Array | null; created_at: number; updated_at: number},
        [string]
      >(
        `SELECT id, name, metadata_cbor, created_at, updated_at FROM secrets WHERE account_id = ? ORDER BY created_at DESC`,
      )
      .all(accountId)

    return {
      _: 'ListSigningIdentitiesResponse',
      identities: rows.flatMap((row) => {
        if (!row.metadata_cbor) return []
        const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
        if (metadata.kind !== 'hm-account-key') return []
        return [
          {
            id: row.id,
            name: row.name,
            ...(typeof metadata.accountId === 'string' ? {accountId: metadata.accountId} : {}),
            ...(typeof metadata.label === 'string' ? {label: metadata.label} : {}),
            ...(typeof metadata.icon === 'string' ? {icon: metadata.icon} : {}),
            ...(typeof metadata.serverUrl === 'string' ? {serverUrl: metadata.serverUrl} : {}),
            ...(typeof metadata.dev === 'boolean' ? {dev: metadata.dev} : {}),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
        ]
      }),
    }
  }

  async #createSigningIdentity(
    accountId: string,
    rawLabel?: string,
    clientRequestId?: string,
  ): Promise<api.CreateSigningIdentityResponse> {
    return this.#withIdempotency(accountId, 'CreateSigningIdentity', clientRequestId, {label: rawLabel}, async () => {
      const label =
        rawLabel === undefined ? undefined : normalizeBoundedString(rawLabel, 'Signing identity label', MAX_NAME_BYTES)
      const keyPair = blobs.generateNobleKeyPair()
      const identityAccountId = blobs.principalToString(keyPair.principal)
      const name = `hm-account-${identityAccountId.slice(0, 16)}`
      const displayName = label || `Agent account ${identityAccountId.slice(0, 10)}`
      try {
        await publishSigningIdentityProfileAndHome(this.#hmServerUrl, keyPair, displayName)
      } catch (error) {
        throw new APIError(502, `Failed to publish agent account to ${this.#hmServerUrl}: ${errorMessage(error)}`)
      }
      const metadata: Record<string, unknown> = {
        kind: 'hm-account-key',
        accountId: identityAccountId,
        label: displayName,
        serverUrl: this.#hmServerUrl,
        generatedBy: 'seed-agents-server',
      }
      const now = Date.now()
      const ciphertext = await encryptSecret(this.#db, keyPair.seed)
      const id = crypto.randomUUID()

      this.#ensureAccount(accountId, now)
      this.#db.run(
        `INSERT INTO secrets (id, account_id, name, ciphertext, metadata_cbor, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, accountId, name, ciphertext, cbor.encode(metadata), now, now],
      )

      return {
        _: 'CreateSigningIdentityResponse',
        identity: {
          id,
          name,
          accountId: identityAccountId,
          label: String(metadata.label),
          serverUrl: this.#hmServerUrl,
          createdAt: now,
          updatedAt: now,
        },
      }
    })
  }

  async #updateSigningIdentity(
    accountId: string,
    rawName: string,
    rawLabel: string,
    icon?: api.SigningIdentityIcon,
  ): Promise<api.UpdateSigningIdentityResponse> {
    const name = normalizeBoundedString(rawName, 'Signing key', MAX_NAME_BYTES)
    const label = normalizeBoundedString(rawLabel, 'Signing identity label', MAX_NAME_BYTES)
    const row = this.#db
      .query<
        {id: string; ciphertext: Uint8Array; metadata_cbor: Uint8Array | null; created_at: number},
        [string, string]
      >(`SELECT id, ciphertext, metadata_cbor, created_at FROM secrets WHERE account_id = ? AND name = ?`)
      .get(accountId, name)
    if (!row?.metadata_cbor) throw new APIError(404, 'Signing identity not found')
    const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
    if (metadata.kind !== 'hm-account-key') throw new APIError(404, 'Signing identity not found')
    const seed = await decryptSecret(this.#db, row.ciphertext)
    const keyPair = blobs.nobleKeyPairFromSeed(seed)
    const accountIdFromKey = blobs.principalToString(keyPair.principal)
    // Upload a new avatar to our HM node when provided, otherwise keep the icon already on the profile.
    let iconUrl = typeof metadata.icon === 'string' ? metadata.icon : undefined
    if (icon) {
      try {
        iconUrl = await uploadIconToHmNode(this.#hmServerUrl, icon)
      } catch (error) {
        throw new APIError(502, `Failed to upload agent account icon to ${this.#hmServerUrl}: ${errorMessage(error)}`)
      }
    }
    try {
      await publishSigningIdentityProfile(this.#hmServerUrl, keyPair, label, iconUrl)
    } catch (error) {
      throw new APIError(502, `Failed to publish agent account profile to ${this.#hmServerUrl}: ${errorMessage(error)}`)
    }
    const nextMetadata = {
      ...metadata,
      accountId: accountIdFromKey,
      label,
      serverUrl: this.#hmServerUrl,
      ...(iconUrl ? {icon: iconUrl} : {}),
    }
    const now = Date.now()
    this.#db.run(`UPDATE secrets SET metadata_cbor = ?, updated_at = ? WHERE account_id = ? AND name = ?`, [
      cbor.encode(nextMetadata),
      now,
      accountId,
      name,
    ])
    return {
      _: 'UpdateSigningIdentityResponse',
      identity: {
        id: row.id,
        name,
        accountId: accountIdFromKey,
        label,
        ...(iconUrl ? {icon: iconUrl} : {}),
        serverUrl: this.#hmServerUrl,
        createdAt: row.created_at,
        updatedAt: now,
      },
    }
  }

  #deleteSigningIdentity(accountId: string, rawName: string): api.DeleteSigningIdentityResponse {
    const name = normalizeBoundedString(rawName, 'Signing key', MAX_NAME_BYTES)
    const row = this.#db
      .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
        `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, name)
    if (!row?.metadata_cbor) throw new APIError(404, 'Signing identity not found')
    const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
    if (metadata.kind !== 'hm-account-key') throw new APIError(404, 'Signing identity not found')
    this.#db.run(`DELETE FROM secrets WHERE account_id = ? AND name = ?`, [accountId, name])
    return {_: 'DeleteSigningIdentityResponse', name}
  }

  #setModelProvider(
    accountId: string,
    rawName: string,
    rawProvider: api.ModelProviderConfig,
  ): api.SetModelProviderResponse {
    const name = normalizeBoundedString(rawName, 'Provider name', MAX_NAME_BYTES)
    const provider = normalizeProvider(rawProvider)
    const now = Date.now()
    const existing = this.#db
      .query<{id: string; created_at: number}, [string, string]>(
        `SELECT id, created_at FROM model_providers WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, name)
    const id = existing?.id ?? crypto.randomUUID()
    const createdAt = existing?.created_at ?? now

    this.#ensureAccount(accountId, now)
    this.#db.run(
      `INSERT INTO model_providers (id, account_id, name, type, config_cbor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, name) DO UPDATE SET
         type = excluded.type,
         config_cbor = excluded.config_cbor,
         updated_at = excluded.updated_at`,
      [id, accountId, name, provider.type, cbor.encode(provider), createdAt, now],
    )

    return {
      _: 'SetModelProviderResponse',
      provider: {
        id,
        name,
        type: provider.type,
        hasSecrets: Object.keys(provider.secretRefs ?? {}).length > 0,
        ...this.#providerAuthInfo(accountId, provider),
        createdAt,
        updatedAt: now,
      },
    }
  }

  #deleteModelProvider(accountId: string, rawName: string): api.DeleteModelProviderResponse {
    const name = normalizeBoundedString(rawName, 'Provider name', MAX_NAME_BYTES)
    const row = this.#db
      .query<{config_cbor: Uint8Array}, [string, string]>(
        `SELECT config_cbor FROM model_providers WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, name)
    if (!row) throw new APIError(404, 'Model provider not found')

    const provider = cbor.decode<api.ModelProviderConfig>(row.config_cbor)
    this.#db.run(`DELETE FROM model_providers WHERE account_id = ? AND name = ?`, [accountId, name])
    // Remove the provider's secrets (API key or OAuth credentials) unless another
    // provider still references them — subscription providers share one OAuth
    // secret per provider type.
    const remaining = this.#db
      .query<{config_cbor: Uint8Array}, [string]>(`SELECT config_cbor FROM model_providers WHERE account_id = ?`)
      .all(accountId)
    const stillReferenced = new Set(
      remaining.flatMap((other) =>
        Object.values(cbor.decode<api.ModelProviderConfig>(other.config_cbor).secretRefs ?? {}),
      ),
    )
    for (const secretName of Object.values(provider.secretRefs ?? {})) {
      if (stillReferenced.has(secretName)) continue
      this.#db.run(`DELETE FROM secrets WHERE account_id = ? AND name = ?`, [accountId, secretName])
      this.#oauthBackends.delete(`${accountId} ${secretName}`)
    }
    return {_: 'DeleteModelProviderResponse', name}
  }

  async #startProviderOAuth(accountId: string, rawProviderType: string): Promise<api.StartProviderOAuthResponse> {
    if (!this.#subscriptionAuthEnabled) {
      throw new APIError(403, 'Subscription sign-in is not enabled on this server')
    }
    const providerType = normalizeBoundedString(rawProviderType, 'Provider type', MAX_NAME_BYTES)
    if (!(OAUTH_PROVIDER_TYPES as readonly string[]).includes(providerType)) {
      throw new APIError(400, `Provider type does not support subscription sign-in: ${providerType}`)
    }
    try {
      const snapshot = await this.#providerOAuth.start(accountId, providerType, async (credentials) => {
        const secretName = subscriptionOAuthSecretName(providerType)
        await this.#setSecret(accountId, secretName, new TextEncoder().encode(JSON.stringify(credentials)), {
          provider: providerType,
          kind: 'provider-oauth',
        })
        this.#emit({type: 'account-change', accountId, reason: 'model-provider-changed'})
        return secretName
      })
      return {
        _: 'StartProviderOAuthResponse',
        loginId: snapshot.loginId,
        authUrl: snapshot.authUrl,
        expiresAt: snapshot.expiresAt,
      }
    } catch (error) {
      throw new APIError(502, error instanceof Error ? error.message : 'Could not start provider sign-in')
    }
  }

  #submitProviderOAuthCode(
    accountId: string,
    rawLoginId: string,
    rawCode: string,
  ): api.SubmitProviderOAuthCodeResponse {
    const loginId = normalizeBoundedString(rawLoginId, 'Login id', MAX_NAME_BYTES)
    const code = normalizeBoundedString(rawCode, 'Authorization code', 8192)
    try {
      this.#providerOAuth.submitCode(accountId, loginId, code)
    } catch (error) {
      throw new APIError(400, error instanceof Error ? error.message : 'Could not submit authorization code')
    }
    return {_: 'SubmitProviderOAuthCodeResponse'}
  }

  #getProviderOAuthStatus(accountId: string, rawLoginId: string): api.ProviderOAuthStatusResponse {
    const loginId = normalizeBoundedString(rawLoginId, 'Login id', MAX_NAME_BYTES)
    try {
      const snapshot = this.#providerOAuth.status(accountId, loginId)
      return {
        _: 'ProviderOAuthStatusResponse',
        loginId: snapshot.loginId,
        status: snapshot.status,
        ...(snapshot.secretName ? {secretName: snapshot.secretName} : {}),
        ...(snapshot.error ? {error: snapshot.error} : {}),
      }
    } catch {
      throw new APIError(404, 'Sign-in not found')
    }
  }

  #cancelProviderOAuth(accountId: string, rawLoginId: string): api.CancelProviderOAuthResponse {
    const loginId = normalizeBoundedString(rawLoginId, 'Login id', MAX_NAME_BYTES)
    try {
      this.#providerOAuth.cancel(accountId, loginId)
    } catch {
      throw new APIError(404, 'Sign-in not found')
    }
    return {_: 'CancelProviderOAuthResponse', loginId}
  }

  /** Auth fields exposed on redacted provider listings; `{}` for api-key providers. */
  #providerAuthInfo(
    accountId: string,
    provider: api.ModelProviderConfig,
  ): Pick<api.RedactedModelProvider, 'authMode' | 'authStatus'> {
    if (provider.authMode !== 'subscription') return {}
    const secretName = provider.secretRefs?.oauth
    if (!secretName) return {authMode: 'subscription', authStatus: 'needs-login'}
    const row = this.#db
      .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
        `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, secretName)
    if (!row) return {authMode: 'subscription', authStatus: 'needs-login'}
    const metadata = row.metadata_cbor ? cbor.decode<Record<string, unknown>>(row.metadata_cbor) : {}
    return {authMode: 'subscription', authStatus: metadata.needsReauth ? 'needs-login' : 'ok'}
  }

  /**
   * Flags a subscription provider's stored OAuth credentials as unusable (the
   * refresh token was rejected — expired or revoked). Listings then report
   * `needs-login` until a new sign-in overwrites the secret.
   */
  #markOAuthSecretNeedsReauth(accountId: string, secretName: string): void {
    const row = this.#db
      .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
        `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, secretName)
    if (!row) return
    const metadata = row.metadata_cbor ? cbor.decode<Record<string, unknown>>(row.metadata_cbor) : {}
    if (metadata.needsReauth) return
    this.#db.run(`UPDATE secrets SET metadata_cbor = ?, updated_at = ? WHERE account_id = ? AND name = ?`, [
      cbor.encode({...metadata, needsReauth: true}),
      Date.now(),
      accountId,
      secretName,
    ])
    this.#emit({type: 'account-change', accountId, reason: 'model-provider-changed'})
  }

  /**
   * Shared credential backend for one stored OAuth secret. Loads the decrypted
   * credentials once and writes refreshed tokens back to the encrypted secret
   * (also clearing a stale `needsReauth` flag — a successful refresh proves the
   * credentials work again).
   */
  async #subscriptionAuthBackend(
    accountId: string,
    secretName: string,
    piProviderId: string,
  ): Promise<PersistedOAuthBackend> {
    const key = `${accountId} ${secretName}`
    const existing = this.#oauthBackends.get(key)
    if (existing) return existing
    const plaintext = await this.#getSecretPlaintext(accountId, secretName)
    let credentials: OAuthCredentials
    try {
      credentials = JSON.parse(new TextDecoder().decode(plaintext))
    } catch {
      throw new APIError(400, 'Stored OAuth credentials are corrupted; sign in again')
    }
    const backend = new PersistedOAuthBackend(
      JSON.stringify({[piProviderId]: {type: 'oauth', ...credentials}}),
      async (json) => {
        const data = JSON.parse(json) as Record<string, Record<string, unknown>>
        const stored = data[piProviderId]
        if (!stored) return
        const {type: _credType, ...rest} = stored
        const ciphertext = await encryptSecret(this.#db, new TextEncoder().encode(JSON.stringify(rest)))
        const row = this.#db
          .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
            `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
          )
          .get(accountId, secretName)
        if (!row) return // secret was deleted mid-session; nothing to persist into
        const metadata = row.metadata_cbor ? cbor.decode<Record<string, unknown>>(row.metadata_cbor) : {}
        delete metadata.needsReauth
        this.#db.run(
          `UPDATE secrets SET ciphertext = ?, metadata_cbor = ?, updated_at = ? WHERE account_id = ? AND name = ?`,
          [ciphertext, cbor.encode(metadata), Date.now(), accountId, secretName],
        )
      },
    )
    this.#oauthBackends.set(key, backend)
    return backend
  }

  async #setSecret(
    accountId: string,
    rawName: string,
    value: Uint8Array,
    rawMetadata?: Record<string, unknown>,
  ): Promise<api.SetSecretResponse> {
    const name = normalizeBoundedString(rawName, 'Secret name', MAX_NAME_BYTES)
    if (!(value instanceof Uint8Array)) throw new APIError(400, 'Secret value is required')
    if (value.byteLength > MAX_SECRET_BYTES) throw new APIError(400, 'Secret value is too large')
    // A rewritten secret invalidates any cached OAuth credential backend built from it.
    this.#oauthBackends.delete(`${accountId} ${name}`)
    const metadata = normalizeOptionalMetadata(rawMetadata)
    const ciphertext = await encryptSecret(this.#db, value)
    const now = Date.now()
    const existing = this.#db
      .query<{id: string; created_at: number}, [string, string]>(
        `SELECT id, created_at FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, name)
    const id = existing?.id ?? crypto.randomUUID()
    const createdAt = existing?.created_at ?? now

    this.#ensureAccount(accountId, now)
    this.#db.run(
      `INSERT INTO secrets (id, account_id, name, ciphertext, metadata_cbor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, name) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         metadata_cbor = excluded.metadata_cbor,
         updated_at = excluded.updated_at`,
      [id, accountId, name, ciphertext, metadata ? cbor.encode(metadata) : null, createdAt, now],
    )

    return {
      _: 'SetSecretResponse',
      secret: {id, name, ...(metadata ? {metadata} : {}), hasValue: true, createdAt, updatedAt: now},
    }
  }

  #validateSigningKeys(accountId: string, definition: api.AgentDefinition): void {
    const signingKeys = definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
    for (const signingKey of signingKeys) {
      const row = this.#db
        .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
          `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
        )
        .get(accountId, signingKey)
      if (!row?.metadata_cbor) throw new APIError(400, 'Signing key not found')
      const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
      if (metadata.kind !== 'hm-account-key') throw new APIError(400, 'Signing key not found')
    }
  }

  #getAgent(accountId: string, agentId: string): api.GetAgentResponse {
    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, agentId)
    if (!agent) throw new APIError(404, 'Agent not found')

    const sessions = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT id, account_id, agent_id, title, status, parent_session_id, run_id, plan_cbor,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = sessions.id) AS child_count,
                created_at, updated_at
         FROM sessions WHERE account_id = ? AND agent_id = ? ORDER BY updated_at DESC`,
      )
      .all(accountId, agentId)

    return {_: 'GetAgentResponse', agent: agentRowToInfo(agent), sessions: this.#sessionRowsToInfo(accountId, sessions)}
  }

  /**
   * Lists the account's sessions newest-first across every agent, or one agent when `agentId` is set.
   *
   * Returns the referenced agents alongside the sessions so a client rendering a merged, cross-agent
   * session list can label each row without a follow-up `GetAgent` per session.
   *
   * Pagination is keyset on the composite `(updated_at, id)` so that sessions sharing an `updated_at`
   * millisecond — which triggers produce when one activity batch fires several at once — are not
   * skipped at a page boundary.
   */
  #listSessions(
    accountId: string,
    agentId?: string,
    limit?: number,
    cursor?: api.SessionListCursor,
    parentSessionId?: string,
    includeChildren?: boolean,
  ): api.ListSessionsResponse {
    const pageSize = boundedInteger(limit, DEFAULT_SESSION_PAGE_SIZE, 1, MAX_SESSION_PAGE_SIZE)
    const conditions = ['account_id = ?']
    const params: (string | number)[] = [accountId]
    if (agentId !== undefined) {
      conditions.push('agent_id = ?')
      params.push(normalizeBoundedString(agentId, 'Agent ID', MAX_NAME_BYTES))
    }
    if (parentSessionId !== undefined) {
      // Children of one parent; the top-level exclusion below does not apply.
      conditions.push('parent_session_id = ?')
      params.push(normalizeBoundedString(parentSessionId, 'Parent session ID', MAX_NAME_BYTES))
    } else if (includeChildren === false) {
      // Top-level listing for lineage-aware clients (they nest children under parents themselves).
      // The default (field absent) keeps returning everything: older deployed desktops cannot send
      // this field, and hiding agent-started sessions from them would be a silent regression.
      conditions.push('parent_session_id IS NULL')
    }
    if (cursor !== undefined) {
      if (!isRecord(cursor)) throw new APIError(400, 'Session cursor must be an object')
      const updatedBefore = normalizeOptionalPositiveInteger(cursor.updatedBefore, 'Cursor updatedBefore')
      const idBefore = normalizeBoundedString(cursor.idBefore, 'Cursor idBefore', MAX_NAME_BYTES)
      conditions.push('(updated_at < ? OR (updated_at = ? AND id < ?))')
      params.push(updatedBefore, updatedBefore, idBefore)
    }
    // Over-fetch by one so we can report whether another page exists without a second COUNT query.
    params.push(pageSize + 1)

    const rows = this.#db
      .query<SessionRow, (string | number)[]>(
        `SELECT id, account_id, agent_id, title, status, parent_session_id, run_id, plan_cbor,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = sessions.id) AS child_count,
                created_at, updated_at
         FROM sessions WHERE ${conditions.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...params)

    const hasMore = rows.length > pageSize
    const page = hasMore ? rows.slice(0, pageSize) : rows
    const sessions = this.#sessionRowsToInfo(accountId, page)
    const referencedAgentIds = new Set(sessions.map((session) => session.agentId))
    const agents = this.#listAgents(accountId).agents.filter((agent) => referencedAgentIds.has(agent.id))
    const last = page[page.length - 1]

    return {
      _: 'ListSessionsResponse',
      sessions,
      agents,
      ...(hasMore && last ? {nextCursor: {updatedBefore: last.updated_at, idBefore: last.id}} : {}),
    }
  }

  #updateAgent(accountId: string, agentId: string, rawDefinition: api.AgentDefinition): api.GetAgentResponse {
    const definition = normalizeDefinition(rawDefinition)
    const existing = this.#db
      .query<{id: string}, [string, string]>(`SELECT id FROM agents WHERE account_id = ? AND id = ?`)
      .get(accountId, agentId)
    if (!existing) throw new APIError(404, 'Agent not found')
    const provider = this.#db
      .query<{name: string; type: string}, [string, string]>(
        `SELECT name, type FROM model_providers WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, definition.modelProvider)
    if (!provider) throw new APIError(400, 'Model provider not found')
    validateReasoningLevel(provider.type, definition)
    this.#validateSigningKeys(accountId, definition)

    const now = Date.now()
    this.#db.run(`UPDATE agents SET definition_cbor = ?, updated_at = ? WHERE account_id = ? AND id = ?`, [
      cbor.encode(definition),
      now,
      accountId,
      agentId,
    ])
    const response = this.#getAgent(accountId, agentId)
    this.#emit({type: 'agent-change', accountId, agent: response.agent})
    invalidateSpaceIndex(accountId, agentId)
    this.#emit({type: 'account-change', accountId, reason: 'agent-updated', agentId})
    return response
  }

  #deleteAgent(accountId: string, agentId: string): api.DeleteAgentResponse {
    const existing = this.#getAgentInfo(accountId, agentId)
    if (!existing) throw new APIError(404, 'Agent not found')

    const sessions = this.#db
      .query<{id: string}, [string, string]>(`SELECT id FROM sessions WHERE account_id = ? AND agent_id = ?`)
      .all(accountId, agentId)
    const sessionIds = sessions.map((session) => session.id)
    // Cancel live work first so no executor streams into rows the transaction is about to delete.
    const liveRuns = this.#db
      .query<{id: string}, [string, string]>(
        `SELECT id FROM runs WHERE account_id = ? AND agent_id = ?
         AND status IN ('queued', 'claimed', 'running', 'waiting')`,
      )
      .all(accountId, agentId)
    for (const liveRun of liveRuns) this.#runQueue.cancelTree(accountId, liveRun.id)
    const transaction = this.#db.transaction(() => {
      for (const sessionId of sessionIds) {
        this.#db.run(`DELETE FROM session_events WHERE session_id = ?`, [sessionId])
      }
      // Run history survives agent deletion detached; FK columns must be cleared before the
      // referenced rows go (runs.agent_id/session_id/trigger_firing_id are enforced FKs).
      this.#db.run(
        `UPDATE runs SET trigger_firing_id = NULL WHERE trigger_firing_id IN (
           SELECT id FROM trigger_firings WHERE account_id = ? AND agent_id = ?)`,
        [accountId, agentId],
      )
      this.#db.run(
        `UPDATE runs SET session_id = NULL WHERE session_id IN (
           SELECT id FROM sessions WHERE account_id = ? AND agent_id = ?)`,
        [accountId, agentId],
      )
      this.#db.run(`UPDATE runs SET agent_id = NULL WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      // Sub-sessions of OTHER agents may hang off this agent's sessions: promote them to top level.
      this.#db.run(
        `UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id IN (
           SELECT id FROM sessions WHERE account_id = ? AND agent_id = ?)`,
        [accountId, agentId],
      )
      this.#db.run(`DELETE FROM trigger_firings WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM sessions WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM agent_triggers WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM agent_drafts WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM tool_documents WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM agents WHERE account_id = ? AND id = ?`, [accountId, agentId])
    })
    transaction()

    try {
      fs.rmSync(existing.stateDir, {recursive: true, force: true})
    } catch (error) {
      console.warn('Failed to remove deleted agent state directory', {
        agentId,
        stateDir: existing.stateDir,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    invalidateSpaceIndex(accountId, agentId)
    this.#emit({type: 'account-change', accountId, reason: 'agent-deleted', agentId})
    return {_: 'DeleteAgentResponse', agentId}
  }

  /** Returns the memory state directory for an agent owned by the account, or throws 404. */
  #agentMemoryStateDir(accountId: string, agentId: string): string {
    const agent = this.#getAgentInfo(accountId, agentId)
    if (!agent) throw new APIError(404, 'Agent not found')
    return agent.stateDir
  }

  #listAgentMemory(accountId: string, agentId: string): api.ListAgentMemoryResponse {
    const stateDir = this.#agentMemoryStateDir(accountId, agentId)
    const {entries, totalBytes} = withMemoryErrors(() => agentMemory.listMemory(stateDir))
    return {_: 'ListAgentMemoryResponse', agentId, entries, totalBytes}
  }

  #readAgentMemoryFile(accountId: string, agentId: string, filePath: string): api.ReadAgentMemoryFileResponse {
    const stateDir = this.#agentMemoryStateDir(accountId, agentId)
    const file = withMemoryErrors(() => agentMemory.readMemoryFile(stateDir, filePath))
    return {_: 'ReadAgentMemoryFileResponse', agentId, file}
  }

  #writeAgentMemoryFile(
    accountId: string,
    agentId: string,
    filePath: string,
    content: string | Uint8Array,
  ): api.WriteAgentMemoryFileResponse {
    const stateDir = this.#agentMemoryStateDir(accountId, agentId)
    const entry = withMemoryErrors(() => agentMemory.writeMemoryFile(stateDir, filePath, content))
    invalidateSpaceIndex(accountId, agentId)
    this.#emit({type: 'account-change', accountId, reason: 'agent-memory-changed', agentId})
    return {_: 'WriteAgentMemoryFileResponse', agentId, entry}
  }

  async #downloadAgentMemoryFile(
    accountId: string,
    agentId: string,
    url: string,
    filePath?: string,
  ): Promise<api.DownloadAgentMemoryFileResponse> {
    const stateDir = this.#agentMemoryStateDir(accountId, agentId)
    const result = await withMemoryErrorsAsync(() => agentMemory.downloadToMemory(stateDir, url, filePath))
    invalidateSpaceIndex(accountId, agentId)
    this.#emit({type: 'account-change', accountId, reason: 'agent-memory-changed', agentId})
    return {
      _: 'DownloadAgentMemoryFileResponse',
      agentId,
      entry: result.entry,
      finalUrl: result.finalUrl,
      contentType: result.contentType,
    }
  }

  async #uploadAgentMemoryFileToIpfs(
    accountId: string,
    agentId: string,
    filePath: string,
  ): Promise<api.UploadAgentMemoryFileToIpfsResponse> {
    const stateDir = this.#agentMemoryStateDir(accountId, agentId)
    const file = withMemoryErrors(() => agentMemory.readMemoryFile(stateDir, filePath))
    const bytes =
      file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
    const fileName = file.path.split('/').at(-1) || 'file'
    const {cid, url} = await uploadBytesToHmIpfs(this.#hmServerUrl, bytes, file.mimeType, fileName)
    return {
      _: 'UploadAgentMemoryFileToIpfsResponse',
      agentId,
      path: file.path,
      cid,
      url,
      size: file.size,
      mimeType: file.mimeType,
    }
  }

  #deleteAgentMemoryFile(accountId: string, agentId: string, filePath: string): api.DeleteAgentMemoryFileResponse {
    const stateDir = this.#agentMemoryStateDir(accountId, agentId)
    const result = withMemoryErrors(() => agentMemory.deleteMemoryPath(stateDir, filePath))
    if (result.deleted) {
      invalidateSpaceIndex(accountId, agentId)
      this.#emit({type: 'account-change', accountId, reason: 'agent-memory-changed', agentId})
    }
    return {_: 'DeleteAgentMemoryFileResponse', agentId, path: result.path, deleted: result.deleted}
  }

  #listAgentTriggers(accountId: string, agentId: string): api.ListAgentTriggersResponse {
    this.#requireAgent(accountId, agentId)
    const rows = this.#db
      .query<AgentTriggerRow, [string, string]>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, continuation_cbor, created_at, updated_at,
                last_checked_at, last_fired_at, last_error
         FROM agent_triggers
         WHERE account_id = ? AND agent_id = ?
         ORDER BY updated_at DESC`,
      )
      .all(accountId, agentId)
    return {_: 'ListAgentTriggersResponse', triggers: rows.map(agentTriggerRowToInfo)}
  }

  #getAgentTrigger(accountId: string, triggerId: string): api.GetAgentTriggerResponse {
    const trigger = this.#getAgentTriggerInfo(accountId, triggerId)
    if (!trigger) throw new APIError(404, 'Agent trigger not found')
    const sessions = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT sessions.id, sessions.account_id, sessions.agent_id, sessions.title, sessions.status,
                sessions.created_at, sessions.updated_at
         FROM trigger_firings
         JOIN sessions ON sessions.id = trigger_firings.session_id
         WHERE trigger_firings.account_id = ? AND trigger_firings.trigger_id = ?
         ORDER BY trigger_firings.created_at DESC`,
      )
      .all(accountId, triggerId)
    return {_: 'GetAgentTriggerResponse', trigger, sessions: this.#sessionRowsToInfo(accountId, sessions)}
  }

  async #createAgentTrigger(
    accountId: string,
    agentId: string,
    rawTrigger: api.AgentTriggerInput,
    clientRequestId?: string,
  ): Promise<api.CreateAgentTriggerResponse> {
    return this.#withIdempotency(accountId, 'CreateAgentTrigger', clientRequestId, {agentId, trigger: rawTrigger}, () =>
      this.#createAgentTriggerOnce(accountId, agentId, rawTrigger),
    )
  }

  #createAgentTriggerOnce(
    accountId: string,
    agentId: string,
    rawTrigger: api.AgentTriggerInput,
  ): api.CreateAgentTriggerResponse {
    this.#requireAgent(accountId, agentId)
    const trigger = normalizeAgentTriggerInput(rawTrigger)
    const now = Date.now()
    const id = crypto.randomUUID()
    this.#db.run(
      `INSERT INTO agent_triggers (id, account_id, agent_id, name, enabled, source_cbor, prompt,
         continuation_cbor, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId,
        agentId,
        trigger.name,
        trigger.enabled ? 1 : 0,
        cbor.encode(trigger.source),
        serializePromptBlocksForStorage(trigger.prompt),
        trigger.continuation ? cbor.encode(trigger.continuation) : null,
        now,
        now,
      ],
    )
    const info = this.#getAgentTriggerInfo(accountId, id)
    if (!info) throw new APIError(500, 'Agent trigger was not created')
    invalidateSpaceIndex(accountId)
    this.#emit({type: 'account-change', accountId, reason: 'trigger-created', agentId})
    return {_: 'CreateAgentTriggerResponse', trigger: info}
  }

  #updateAgentTrigger(
    accountId: string,
    triggerId: string,
    rawPatch: api.AgentTriggerPatch,
  ): api.UpdateAgentTriggerResponse {
    const existing = this.#getAgentTriggerInfo(accountId, triggerId)
    if (!existing) throw new APIError(404, 'Agent trigger not found')
    const patch = normalizeAgentTriggerPatch(rawPatch)
    const next: api.AgentTriggerInfo = {...existing, ...patch, updatedAt: Date.now()}
    this.#db.run(
      `UPDATE agent_triggers
       SET name = ?, enabled = ?, source_cbor = ?, prompt = ?, continuation_cbor = ?, updated_at = ?,
           last_error = NULL
       WHERE account_id = ? AND id = ?`,
      [
        next.name,
        next.enabled ? 1 : 0,
        cbor.encode(next.source),
        serializePromptBlocksForStorage(next.prompt),
        next.continuation ? cbor.encode(next.continuation) : null,
        next.updatedAt,
        accountId,
        triggerId,
      ],
    )
    const trigger = this.#getAgentTriggerInfo(accountId, triggerId)
    if (!trigger) throw new APIError(404, 'Agent trigger not found')
    invalidateSpaceIndex(accountId)
    this.#emit({type: 'account-change', accountId, reason: 'trigger-updated', agentId: trigger.agentId})
    return {_: 'UpdateAgentTriggerResponse', trigger}
  }

  #deleteAgentTrigger(accountId: string, triggerId: string): api.DeleteAgentTriggerResponse {
    const existing = this.#getAgentTriggerInfo(accountId, triggerId)
    if (!existing) throw new APIError(404, 'Agent trigger not found')
    const transaction = this.#db.transaction(() => {
      // Run history survives trigger deletion detached from its firing rows.
      this.#db.run(
        `UPDATE runs SET trigger_firing_id = NULL WHERE trigger_firing_id IN (
           SELECT id FROM trigger_firings WHERE account_id = ? AND trigger_id = ?)`,
        [accountId, triggerId],
      )
      this.#db.run(`DELETE FROM trigger_firings WHERE account_id = ? AND trigger_id = ?`, [accountId, triggerId])
      this.#db.run(`DELETE FROM agent_triggers WHERE account_id = ? AND id = ?`, [accountId, triggerId])
    })
    transaction()
    invalidateSpaceIndex(accountId)
    this.#emit({type: 'account-change', accountId, reason: 'trigger-deleted', agentId: existing.agentId})
    return {_: 'DeleteAgentTriggerResponse', triggerId}
  }

  async #createSession(
    accountId: string,
    agentId: string,
    rawTitle?: string,
    clientRequestId?: string,
  ): Promise<api.CreateSessionResponse> {
    return this.#withIdempotency(accountId, 'CreateSession', clientRequestId, {agentId, title: rawTitle}, () =>
      this.#createSessionOnce(accountId, agentId, rawTitle),
    )
  }

  #createSessionOnce(
    accountId: string,
    agentId: string,
    rawTitle?: string,
    opts: {parentSessionId?: string; runId?: string} = {},
  ): api.CreateSessionResponse {
    const agent = this.#db
      .query<{id: string}, [string, string]>(`SELECT id FROM agents WHERE account_id = ? AND id = ?`)
      .get(accountId, agentId)
    if (!agent) throw new APIError(404, 'Agent not found')

    const now = Date.now()
    const sessionId = crypto.randomUUID()
    // Clients historically sent the UI display placeholder as a literal title, which made every
    // session look titled and defeated both naming paths. The placeholder means "no title".
    const normalizedTitle =
      rawTitle === undefined ? null : normalizeBoundedString(rawTitle, 'Session title', MAX_NAME_BYTES)
    const title =
      normalizedTitle && normalizedTitle.trim().toLowerCase() === 'untitled session' ? null : normalizedTitle
    this.#db.run(
      `INSERT INTO sessions (id, account_id, agent_id, title, title_source, status, parent_session_id, run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sessionId,
        accountId,
        agentId,
        title,
        'system',
        'idle',
        opts.parentSessionId ?? null,
        opts.runId ?? null,
        now,
        now,
      ],
    )
    const sessionInfo = this.#getSessionInfo(accountId, sessionId)
    if (sessionInfo) {
      this.#emit({type: 'session-change', accountId, session: sessionInfo})
      this.#emit({type: 'account-change', accountId, reason: 'session-created', agentId, sessionId})
    }
    return {_: 'CreateSessionResponse', sessionId}
  }

  #updateSession(accountId: string, sessionId: string, rawTitle: string): api.UpdateSessionResponse {
    const existing = this.#getSessionInfo(accountId, sessionId)
    if (!existing) throw new APIError(404, 'Session not found')
    const title = normalizeBoundedString(rawTitle, 'Session title', MAX_NAME_BYTES)
    const now = Date.now()
    this.#db.run(
      `UPDATE sessions SET title = ?, title_source = 'user', updated_at = ? WHERE account_id = ? AND id = ?`,
      [title, now, accountId, sessionId],
    )
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    this.#emit({type: 'session-change', accountId, session})
    this.#emit({type: 'account-change', accountId, reason: 'session-updated', agentId: session.agentId, sessionId})
    return {_: 'UpdateSessionResponse', session}
  }

  #deleteSession(accountId: string, sessionId: string): api.DeleteSessionResponse {
    const existing = this.#getSessionInfo(accountId, sessionId)
    if (!existing) throw new APIError(404, 'Session not found')
    // Cancel live run trees first: detaching a parked parent's session would otherwise strand it
    // in 'waiting' forever (its child resolutions early-return without a parent session), and a
    // streaming executor would crash appending to deleted rows.
    for (const liveRun of runs.listLiveSessionRuns(this.#db, accountId, sessionId)) {
      this.#runQueue.cancelTree(accountId, liveRun.id)
    }
    const transaction = this.#db.transaction(() => {
      this.#db.run(`UPDATE trigger_firings SET session_id = NULL WHERE account_id = ? AND session_id = ?`, [
        accountId,
        sessionId,
      ])
      this.#db.run(`DELETE FROM session_events WHERE session_id = ?`, [sessionId])
      // Run history survives session deletion detached; children promote to top level.
      this.#db.run(`UPDATE runs SET session_id = NULL WHERE session_id = ?`, [sessionId])
      this.#db.run(`UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id = ?`, [sessionId])
      this.#db.run(`DELETE FROM sessions WHERE account_id = ? AND id = ?`, [accountId, sessionId])
    })
    transaction()
    // Attachments are session-private: they die with the session. Cleanup failure (e.g. the agent
    // was already deleted along with its state dir) must not block the delete itself.
    try {
      sessionAttachments.deleteSessionAttachments(this.#agentMemoryStateDir(accountId, existing.agentId), sessionId)
    } catch {}
    this.#emit({type: 'account-change', accountId, reason: 'session-deleted', agentId: existing.agentId, sessionId})
    return {_: 'DeleteSessionResponse', sessionId, agentId: existing.agentId}
  }

  /** Resolves a session owned by the account to its agent's state dir, for attachment actions. */
  #sessionStateDir(accountId: string, sessionId: string): {agentId: string; stateDir: string} {
    const session = this.#db
      .query<{agent_id: string}, [string, string]>(`SELECT agent_id FROM sessions WHERE account_id = ? AND id = ?`)
      .get(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    return {agentId: session.agent_id, stateDir: this.#agentMemoryStateDir(accountId, session.agent_id)}
  }

  #uploadSessionAttachment(
    accountId: string,
    sessionId: string,
    name: string,
    mimeType: string | undefined,
    content: Uint8Array,
  ): api.UploadSessionAttachmentResponse {
    const {stateDir} = this.#sessionStateDir(accountId, sessionId)
    const attachment = withAttachmentErrors(() =>
      sessionAttachments.saveSessionAttachment(stateDir, sessionId, {name, mimeType, content}),
    )
    return {_: 'UploadSessionAttachmentResponse', attachment}
  }

  #readSessionAttachment(
    accountId: string,
    sessionId: string,
    attachmentId: string,
  ): api.ReadSessionAttachmentResponse {
    const {stateDir} = this.#sessionStateDir(accountId, sessionId)
    const {info, data} = withAttachmentErrors(() =>
      sessionAttachments.readSessionAttachment(stateDir, sessionId, attachmentId),
    )
    return {_: 'ReadSessionAttachmentResponse', attachment: info, data}
  }

  // ─── Chunked file uploads ──────────────────────────────────────────────────
  // Large files upload in bounded chunks so each signed action stays small: the client never
  // hashes hundreds of megabytes in one blocking call, and can report progress per chunk. Bytes
  // stage under <dataDir>/uploads until commit materializes them at the validated target.

  #cleanupExpiredUploads(): void {
    const now = Date.now()
    for (const [uploadId, upload] of this.#uploads) {
      if (now - upload.updatedAt > UPLOAD_TTL_MS) {
        this.#uploads.delete(uploadId)
        fs.rmSync(upload.partPath, {force: true})
      }
    }
  }

  #ownedUpload(accountId: string, uploadId: unknown): {uploadId: string; upload: StagedFileUpload} {
    if (typeof uploadId !== 'string' || !uploadId) throw new APIError(400, 'Upload id is required')
    const upload = this.#uploads.get(uploadId)
    if (!upload || upload.accountId !== accountId) throw new APIError(404, 'Upload not found')
    return {uploadId, upload}
  }

  #beginFileUpload(accountId: string, target: api.FileUploadTarget, size: number): api.BeginFileUploadResponse {
    this.#cleanupExpiredUploads()
    if (!Number.isInteger(size) || size <= 0) throw new APIError(400, 'Upload size must be a positive integer')
    if (!isRecord(target)) throw new APIError(400, 'Upload target is required')
    // Validate the target up front so a long upload cannot fail at the very end on a bad path.
    if (target.kind === 'memory') {
      const stateDir = this.#agentMemoryStateDir(accountId, target.agentId)
      withMemoryErrors(() => agentMemory.resolveMemoryPath(stateDir, target.path))
      if (size > MAX_UPLOAD_TOTAL_BYTES) throw new APIError(413, 'Upload exceeds the maximum file size')
    } else if (target.kind === 'session-attachment') {
      this.#sessionStateDir(accountId, target.sessionId)
      if (typeof target.name !== 'string' || !target.name.trim()) throw new APIError(400, 'Attachment name is required')
      if (size > sessionAttachments.MAX_SESSION_ATTACHMENT_BYTES) {
        throw new APIError(413, 'Upload exceeds the maximum attachment size')
      }
    } else {
      throw new APIError(400, 'Unsupported upload target')
    }
    const active = [...this.#uploads.values()].filter((upload) => upload.accountId === accountId).length
    if (active >= MAX_ACTIVE_UPLOADS_PER_ACCOUNT) throw new APIError(429, 'Too many uploads in progress')

    const uploadId = crypto.randomUUID()
    const partPath = path.join(this.#dataDir, 'uploads', `${uploadId}.part`)
    fs.mkdirSync(path.dirname(partPath), {recursive: true})
    fs.writeFileSync(partPath, new Uint8Array())
    this.#uploads.set(uploadId, {accountId, target, size, received: 0, partPath, updatedAt: Date.now()})
    return {_: 'BeginFileUploadResponse', uploadId, maxChunkBytes: MAX_UPLOAD_CHUNK_BYTES}
  }

  #appendFileUploadChunk(
    accountId: string,
    rawUploadId: unknown,
    offset: number,
    content: Uint8Array,
  ): api.AppendFileUploadChunkResponse {
    const {uploadId, upload} = this.#ownedUpload(accountId, rawUploadId)
    if (!(content instanceof Uint8Array) || content.byteLength === 0) {
      throw new APIError(400, 'Chunk content must be non-empty bytes')
    }
    if (content.byteLength > MAX_UPLOAD_CHUNK_BYTES) throw new APIError(413, 'Chunk is too large')
    if (offset !== upload.received) {
      throw new APIError(409, `Chunk offset ${offset} does not match ${upload.received} bytes received`)
    }
    if (upload.received + content.byteLength > upload.size) {
      throw new APIError(400, 'Upload exceeds its declared size')
    }
    fs.appendFileSync(upload.partPath, content)
    upload.received += content.byteLength
    upload.updatedAt = Date.now()
    return {_: 'AppendFileUploadChunkResponse', uploadId, received: upload.received}
  }

  #commitFileUpload(accountId: string, rawUploadId: unknown): api.CommitFileUploadResponse {
    const {uploadId, upload} = this.#ownedUpload(accountId, rawUploadId)
    if (upload.received !== upload.size) {
      throw new APIError(400, `Upload has ${upload.received} of ${upload.size} bytes; cannot commit`)
    }
    this.#uploads.delete(uploadId)
    const target = upload.target
    try {
      const bytes = new Uint8Array(fs.readFileSync(upload.partPath))
      if (target.kind === 'memory') {
        const stateDir = this.#agentMemoryStateDir(accountId, target.agentId)
        const entry = withMemoryErrors(() => agentMemory.writeMemoryFile(stateDir, target.path, bytes))
        invalidateSpaceIndex(accountId, target.agentId)
        this.#emit({type: 'account-change', accountId, reason: 'agent-memory-changed', agentId: target.agentId})
        return {_: 'CommitFileUploadResponse', entry}
      }
      const {stateDir} = this.#sessionStateDir(accountId, target.sessionId)
      const attachment = withAttachmentErrors(() =>
        sessionAttachments.saveSessionAttachment(stateDir, target.sessionId, {
          name: target.name,
          mimeType: target.mimeType,
          content: bytes,
        }),
      )
      return {_: 'CommitFileUploadResponse', attachment}
    } finally {
      fs.rmSync(upload.partPath, {force: true})
    }
  }

  #abortFileUpload(accountId: string, rawUploadId: unknown): api.AbortFileUploadResponse {
    const {uploadId, upload} = this.#ownedUpload(accountId, rawUploadId)
    this.#uploads.delete(uploadId)
    fs.rmSync(upload.partPath, {force: true})
    return {_: 'AbortFileUploadResponse', uploadId}
  }

  /** update_plan tool: stores the session's todo snapshot, rendered by the pinned progress card. */
  #setSessionPlanFromAgent(accountId: string, sessionId: string, raw: unknown): api.SessionInfo {
    const plan = this.#stampPlanSettledAt(accountId, sessionId, normalizeRunPlan(raw))
    const changes = this.#db.run(`UPDATE sessions SET plan_cbor = ?, updated_at = ? WHERE account_id = ? AND id = ?`, [
      cbor.encode(plan),
      Date.now(),
      accountId,
      sessionId,
    ]).changes
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    if (changes > 0) {
      this.#emit({type: 'session-change', accountId, session})
      this.#emit({type: 'account-change', accountId, reason: 'session-updated', agentId: session.agentId, sessionId})
    }
    return session
  }

  /**
   * Dates the moment a plan finished settling, carrying the old date forward while it stays settled.
   *
   * Plan edits leave no durable event — the checklist is session state, and the plan verb is
   * deliberately kept out of the transcript — so a client watching the snapshot can see THAT every
   * step is terminal but has no way to know WHEN that became true. Without a fixed moment the card
   * showing the plan can never freeze into the log at the right place; it can only float at the
   * bottom. So the one process that witnesses the transition writes it down.
   */
  #stampPlanSettledAt(accountId: string, sessionId: string, plan: runs.RunPlanState): runs.RunPlanState {
    const settled =
      plan.steps.length > 0 && plan.steps.every((step) => TERMINAL_PLAN_STEP_STATUSES.includes(step.status))
    if (!settled) {
      // Reopened (or never settled): the story is being told again, so the old moment is not it.
      const {settledAt: _cleared, ...rest} = plan
      return rest
    }
    const previous = this.#db
      .query<{plan_cbor: Uint8Array | null}, [string, string]>(
        `SELECT plan_cbor FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    const previousPlan = previous?.plan_cbor ? cbor.decode<runs.RunPlanState>(previous.plan_cbor) : undefined
    const previousSettledAt =
      previousPlan?.settledAt !== undefined &&
      previousPlan.steps.length > 0 &&
      previousPlan.steps.every((step) => TERMINAL_PLAN_STEP_STATUSES.includes(step.status))
        ? previousPlan.settledAt
        : undefined
    return {...plan, settledAt: previousSettledAt ?? Date.now()}
  }

  #setSessionTitleFromAgent(accountId: string, sessionId: string, rawTitle: string): api.SessionInfo {
    const title = normalizeBoundedString(rawTitle, 'Session title', MAX_NAME_BYTES)
    const existing = this.#db
      .query<{title_source: string}, [string, string]>(
        `SELECT title_source FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    if (!existing) throw new APIError(404, 'Session not found')

    const now = Date.now()
    const changes = this.#db.run(
      `UPDATE sessions
          SET title = ?, title_source = 'agent', updated_at = ?
        WHERE account_id = ? AND id = ? AND title_source <> 'user'`,
      [title, now, accountId, sessionId],
    ).changes
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    if (changes > 0) {
      console.info('[agents/runtime] agent updated session title', {sessionId, agentId: session.agentId})
      this.#emit({type: 'session-change', accountId, session})
      this.#emit({type: 'account-change', accountId, reason: 'session-updated', agentId: session.agentId, sessionId})
    } else {
      console.info('[agents/runtime] ignored agent session title update', {
        sessionId,
        agentId: session.agentId,
        reason: 'user-title-wins',
      })
    }
    return session
  }

  /**
   * start_session tool: creates a new session of the calling agent and starts its first run in
   * the background, detached from the calling session's run (same pattern as trigger sessions,
   * sharing {@link drainTriggerSessions}). Returns as soon as the session exists and the run is
   * dispatched — the caller never receives the new session's results. Chain depth and per-session
   * spawn counts are bounded so an agent cannot fork-bomb the server.
   */
  #startSessionFromAgent(
    accountId: string,
    parentSessionId: string,
    agentId: string,
    raw: unknown,
    parentRun?: runs.RunRecord,
  ): {sessionId: string; title: string} {
    const input = isPlainRecord(raw) ? raw : {}
    const prompt = normalizeBoundedString(input.prompt, 'Session prompt', MAX_MESSAGE_TEXT_BYTES)
    // Chain depth and fan-out are read from the durable session lineage, so restarts do not relax them.
    const depth = this.#sessionChainDepth(parentSessionId)
    if (depth >= MAX_SESSION_SPAWN_DEPTH) {
      throw new APIError(
        400,
        `Session spawn chain limit reached (${MAX_SESSION_SPAWN_DEPTH}); this session was itself started by a chain of agent-started sessions. Finish the work here instead.`,
      )
    }
    const spawned =
      this.#db
        .query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM sessions WHERE parent_session_id = ?`)
        .get(parentSessionId)?.n ?? 0
    if (spawned >= MAX_SESSION_SPAWNS_PER_SESSION) {
      throw new APIError(
        400,
        `This session already started ${MAX_SESSION_SPAWNS_PER_SESSION} sessions; finish the remaining work here instead.`,
      )
    }
    const title =
      input.title === undefined || input.title === null || input.title === ''
        ? sessionTitleFromPrompt(prompt)
        : normalizeBoundedString(input.title, 'Session title', MAX_NAME_BYTES)
    const session = this.#createSessionOnce(accountId, agentId, title, {parentSessionId})
    console.info('[agents/runtime] agent started session', {
      accountId,
      parentSessionId,
      sessionId: session.sessionId,
      agentId,
      depth: depth + 1,
    })
    const dispatch = (async () => {
      try {
        await this.#messageSessionOnce(accountId, session.sessionId, [{type: 'text', text: prompt}], {
          origin: 'agent',
          background: true,
          // Detached from the caller's TURN (no park, no result), but still a member of its run
          // TREE so the progress card shows it, cancel cascades, and usage rolls up.
          parentRunId: parentRun?.id,
          title,
        })
      } catch (error) {
        console.error('[agents/runtime] agent-started session run failed', {
          accountId,
          sessionId: session.sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
    this.#pendingTriggerSessions.add(dispatch)
    void dispatch.finally(() => this.#pendingTriggerSessions.delete(dispatch))
    return {sessionId: session.sessionId, title}
  }

  /**
   * Callables this session's transcript shows as expanded: a read of ~/tools/<name> or a call
   * whose result carried the contract. Scans durable tool_call events only, so the answer is
   * identical after resume, restart, or compaction — the transcript is the pin.
   */
  #expandedCallablesForSession(sessionId: string): string[] {
    return expandedCallablesFromEvents(this.#db, sessionId)
  }

  /** Number of parent links above a session in the spawn chain (durable replacement for the old in-memory map). */
  #sessionChainDepth(sessionId: string): number {
    return (
      this.#db
        .query<{depth: number}, [string]>(
          `WITH RECURSIVE chain(id, d) AS (
             SELECT parent_session_id, 1 FROM sessions WHERE id = ?1 AND parent_session_id IS NOT NULL
             UNION ALL
             SELECT s.parent_session_id, c.d + 1
             FROM sessions s JOIN chain c ON s.id = c.id
             WHERE s.parent_session_id IS NOT NULL AND c.d < 32
           )
           SELECT COALESCE(MAX(d), 0) AS depth FROM chain`,
        )
        .get(sessionId)?.depth ?? 0
    )
  }

  /**
   * Runs one verb AS THE USER on the session's shared log. The call and result append as
   * actor-'user' events, so the agent reads them on its next turn exactly as it reads its own —
   * the log is the interface, there is no side channel. Execution failures are themselves log
   * entries (the user's failed attempt is context too) and come back in the response; only
   * pre-execution validation rejects the request outright.
   */
  async #invokeSessionTool(
    accountId: string,
    sessionId: string,
    verb: string,
    input: unknown,
  ): Promise<api.InvokeSessionToolResponse> {
    if (verb !== 'read' && verb !== 'write' && verb !== 'call') {
      throw new APIError(400, 'verb must be read, write, or call')
    }
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    if (runs.sessionHasLiveRun(this.#db, sessionId)) {
      throw new APIError(409, 'The agent is working in this thread right now; wait for its turn to finish')
    }
    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, session.agentId)
    if (!agent) throw new APIError(404, 'Agent not found')
    const definition = cbor.decode<api.AgentDefinition>(agent.definition_cbor)
    const codeExecAvailable = (await this.#codeExec.availability()).available
    const context: AgentServicePiToolContext = {
      db: this.#db,
      accountId,
      agentId: session.agentId,
      definition,
      hmServerUrl: this.#hmServerUrl,
      web: this.#web,
      stateDir: this.#agentMemoryStateDir(accountId, session.agentId),
      sessionId,
      modelAcceptsImages: false,
      onMemoryChange: () => {
        invalidateSpaceIndex(accountId, session.agentId)
        this.#emit({type: 'account-change', accountId, reason: 'agent-memory-changed', agentId: session.agentId})
      },
      onToolProgress: () => {},
      codeExec: this.#codeExec,
      callableTools: enabledCallableTools(definition, codeExecAvailable),
      publishEnabled: publishGrantEnabled(definition),
      startSession: () => {
        throw new APIError(400, 'Delegation is a conversational ask; message the agent instead')
      },
    }
    const toolCallId = `user-${crypto.randomUUID()}`
    this.#liveUserVerbs.set(sessionId, (this.#liveUserVerbs.get(sessionId) ?? 0) + 1)
    this.#appendSessionEvent(
      accountId,
      session.agentId,
      sessionId,
      {type: 'tool_call', id: toolCallId, name: verb, input, actor: 'user'},
      Date.now(),
    )
    let output: Record<string, unknown> | undefined
    let error: string | undefined
    try {
      output =
        verb === 'read'
          ? await executeReadVerb(context, input)
          : verb === 'write'
            ? await executeWriteVerb(context, input)
            : await executeCallVerb(context, input, toolCallId)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
    } finally {
      const remaining = (this.#liveUserVerbs.get(sessionId) ?? 1) - 1
      if (remaining <= 0) this.#liveUserVerbs.delete(sessionId)
      else this.#liveUserVerbs.set(sessionId, remaining)
    }
    const safeOutput = jsonSafeToolOutput(output ?? {})
    const resultEvent = this.#appendSessionEvent(
      accountId,
      session.agentId,
      sessionId,
      {
        type: 'tool_result',
        toolCallId,
        name: verb,
        ...(error !== undefined ? {error} : {output: safeOutput}),
        actor: 'user',
      },
      Date.now(),
    )
    return {
      _: 'InvokeSessionToolResponse',
      sessionId,
      resultEventId: resultEvent.id,
      ...(error !== undefined ? {error} : {output: safeOutput}),
    }
  }

  async #messageSession(
    accountId: string,
    sessionId: string,
    content: api.MessageSession['content'],
    clientMessageId?: string,
  ): Promise<api.MessageSessionResponse> {
    const normalizedId =
      clientMessageId === undefined
        ? undefined
        : normalizeBoundedString(clientMessageId, 'Client message ID', MAX_NAME_BYTES)
    const requestCBOR = normalizedId === undefined ? undefined : cbor.encode({sessionId, content})
    if (normalizedId !== undefined && requestCBOR !== undefined) {
      const existing = this.#db
        .query<{request_cbor: Uint8Array; response_cbor: Uint8Array}, [string, string, string]>(
          `SELECT request_cbor, response_cbor FROM action_idempotency WHERE account_id = ? AND action = ? AND client_request_id = ?`,
        )
        .get(accountId, 'MessageSession', normalizedId)
      if (existing) {
        if (!bytesEqual(existing.request_cbor, requestCBOR))
          throw new APIError(409, 'Client message ID payload mismatch')
        return cbor.decode<api.MessageSessionResponse>(existing.response_cbor)
      }
    }

    const response = await this.#messageSessionOnce(accountId, sessionId, content)
    if (normalizedId !== undefined && requestCBOR !== undefined) {
      this.#db.run(
        `INSERT INTO action_idempotency (account_id, action, client_request_id, request_cbor, response_cbor, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [accountId, 'MessageSession', normalizedId, requestCBOR, cbor.encode(response), Date.now()],
      )
    }
    return response
  }

  async #messageSessionOnce(
    accountId: string,
    sessionId: string,
    rawContent: api.MessageSession['content'],
    opts: {
      origin?: runs.RunOrigin
      background?: boolean
      runId?: string
      triggerFiringId?: string
      /** Makes the new run a child in the caller's run tree (visible in the card, cancel-cascaded). */
      parentRunId?: string
      /** Human label for the run, shown in the progress card's children strip. */
      title?: string
    } = {},
  ): Promise<api.MessageSessionResponse> {
    const messages = normalizeMessageContent(rawContent)
    const session = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT id, account_id, agent_id, title, status, parent_session_id, run_id, plan_cbor,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = sessions.id) AS child_count,
                created_at, updated_at
         FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    // Liveness is lease-based (run rows), not the status column, so a crash can never wedge this guard.
    if (runs.sessionHasLiveRun(this.#db, sessionId)) throw new APIError(409, 'Session is already streaming')
    if (this.#liveUserVerbs.has(sessionId)) {
      throw new APIError(409, 'A user tool action is still running in this thread; wait for it to finish')
    }

    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, session.agent_id)
    if (!agent) throw new APIError(404, 'Agent not found')
    const definition = cbor.decode<api.AgentDefinition>(agent.definition_cbor)

    const now = Date.now()
    definition.systemPrompt = normalizeSystemPromptBlocks(definition.systemPrompt)
    // The stored `content` is what the model reads; rich messages resolve embeds
    // into inline markdown here while `blocks`/`rawMarkdown` keep the original
    // for transcript display.
    const modelTexts = await Promise.all(messages.map((message) => this.#resolveMessageText(message)))
    const firstMessage = messages[0]!
    // Attachment parts must reference files already uploaded to this session; resolve them to
    // metadata here so the durable message event (and the model-facing metadata) carry it.
    const attachments = (firstMessage.attachmentIds ?? []).map((attachmentId) => {
      const info = sessionAttachments.getSessionAttachmentInfo(agent.state_dir, sessionId, attachmentId)
      if (!info) throw new APIError(404, `Attachment not found: ${attachmentId}`)
      return info
    })
    this.#appendSessionEvent(
      accountId,
      session.agent_id,
      sessionId,
      {
        type: 'message',
        role: 'user',
        content: modelTexts[0]!,
        rawMarkdown: firstMessage.text,
        ...(firstMessage.blocks ? {blocks: firstMessage.blocks} : {}),
        ...(firstMessage.contextLines ? {contextLines: firstMessage.contextLines} : {}),
        ...(attachments.length > 0 ? {attachments} : {}),
      },
      now,
    )
    for (const [index, message] of messages.slice(1).entries()) {
      this.#appendSessionEvent(
        accountId,
        session.agent_id,
        sessionId,
        {
          type: 'message',
          role: 'user',
          content: modelTexts[index + 1]!,
          rawMarkdown: message.text,
          ...(message.blocks ? {blocks: message.blocks} : {}),
        },
        Date.now(),
      )
    }
    const origin = opts.origin ?? 'user'
    const run = this.#runQueue.enqueue({
      id: opts.runId,
      accountId,
      kind: 'agent',
      origin,
      agentId: session.agent_id,
      sessionId,
      triggerFiringId: opts.triggerFiringId,
      parentRunId: opts.parentRunId,
      title: opts.title,
      input: {kind: 'session-message'},
      queue: opts.background ? 'background' : 'interactive',
      // Background turns ride out a flaky provider; a turn the user is watching fails fast instead,
      // because retrying holds the session lock through the backoff — the error would never reach
      // them and their next message would bounce off "already streaming". They have Retry.
      maxAttempts: opts.background ? AGENT_RUN_MAX_ATTEMPTS : 1,
      dispatch: opts.background === true,
    })
    // Background callers (triggers, agent-started sessions) return as soon as the run is durably
    // queued; the dispatch loop picks it up and completion is observable via awaitQueueIdle/WS.
    if (opts.background) return {_: 'MessageSessionResponse', sessionId, assistantEventId: ''}

    const final = await this.#runQueue.runInline(run.id)
    if (final.status === 'queued') {
      // The inline claim was refused: another live run owns this session (a concurrent send won the
      // race while this request resolved message embeds). Withdraw our duplicate run and 409.
      this.#runQueue.cancelTree(accountId, run.id)
      throw new APIError(409, 'Session is already streaming')
    }
    if (final.status === 'succeeded' || final.status === 'canceled') {
      const output = (final.output ?? {}) as {assistantEventId?: string}
      return {_: 'MessageSessionResponse', sessionId, assistantEventId: output.assistantEventId ?? ''}
    }
    if (final.status === 'failed') {
      const error = final.error ?? {code: 'run-failed', message: 'Agent run failed'}
      throw new APIError(error.httpStatus ?? 502, error.message)
    }
    // Parked (waiting on children): the request returns and the client follows along over WS.
    return {_: 'MessageSessionResponse', sessionId, assistantEventId: ''}
  }

  /**
   * Executes one claimed agent run: repairs interrupted tool calls, then replays the transcript
   * into Pi. Sub-session child runs (a `spec` in the run input) get their definition overridden
   * (inline prompt, tool restriction).
   *
   * A turn that ends still owing something — an undelivered typed result, an unfinished plan — does
   * not simply end: the run hands the turn back with every open obligation named, up to
   * {@link MAX_RUN_CONTINUATIONS} times, and only then finishes and says what was left undone.
   */
  async #executeAgentRun(run: runs.RunRecord): Promise<runs.RunOutcome> {
    if (!run.sessionId || !run.agentId) {
      return {type: 'failed', error: {code: 'config-error', message: 'Agent run is missing session or agent'}}
    }
    const sessionId = run.sessionId
    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(run.accountId, run.agentId)
    if (!agent) return {type: 'failed', error: {code: 'config-error', message: 'Agent not found', httpStatus: 404}}
    const definition = cbor.decode<api.AgentDefinition>(agent.definition_cbor)
    definition.systemPrompt = normalizeSystemPromptBlocks(definition.systemPrompt)
    const spec = this.#spawnContextForRun(run).spec
    if (spec?.prompt) definition.systemPrompt = spec.prompt
    if (spec?.tools) {
      // Undefined parent tools means "all callables" — narrowing must intersect against that
      // full set, not a stale minimal default, or the child loses tools the parent granted.
      const base = (definition.tools ?? serviceCallableNames()).map(normalizeSeedToolName)
      const requested = spec.tools.map(normalizeSeedToolName)
      definition.tools = base.filter((tool) => requested.includes(tool))
    }
    this.#synthesizeInterruptedToolResults(run.accountId, run.agentId, sessionId)
    const runningSession: RunningSession = {accountId: run.accountId, stopped: false}
    this.#runningSessions.set(this.#runningSessionKey(run.accountId, sessionId), runningSession)
    let continuations = 0
    for (;;) {
      try {
        const assistantEvent = await this.#runPiAgent(run.accountId, definition, sessionId, runningSession, run)
        if (runningSession.stopped) return {type: 'canceled', output: {assistantEventId: assistantEvent.id}}
        // A delivered typed result IS the end of a typed child: its parent is waiting on that
        // payload and has it. Nothing else the child might still owe is worth another turn.
        if (spec?.output && runningSession.subResult) return {type: 'succeeded', output: runningSession.subResult.value}
        const obligations = this.#openObligations(run, sessionId, spec, runningSession)
        if (obligations.length > 0) {
          if (continuations < MAX_RUN_CONTINUATIONS) {
            // One prompt, every open obligation: the agent sees the whole debt at once instead of
            // being told about one thing, answering it, and being told about the next.
            continuations += 1
            this.#appendSessionEvent(
              run.accountId,
              run.agentId,
              sessionId,
              {type: 'message', role: 'user', actor: 'system', content: continuationPrompt(obligations)},
              Date.now(),
            )
            continue
          }
          // Budget spent. The run ends carrying the debt in the open — nothing is ticked off on the
          // agent's behalf, and the log says exactly what was left: a record that quietly disagrees
          // with reality is worse than one that admits it.
          this.#appendSessionEvent(
            run.accountId,
            run.agentId,
            sessionId,
            {type: 'message', role: 'user', actor: 'system', content: unmetObligationsNotice(obligations)},
            Date.now(),
          )
          // A typed child that never delivered FAILS: its parent is blocked on a result that is
          // never coming, and only a failure resolves that call. An unfinished plan is a lesser
          // thing — the work that did happen still happened — so the run succeeds owing it.
          if (obligations.some((obligation) => obligation.kind === 'typed-result')) {
            return {
              type: 'failed',
              error: {
                code: 'output-schema',
                message: 'Sub-session ended without delivering a valid return_result',
                unmetObligations: obligations,
              },
            }
          }
          return {type: 'succeeded', output: {...turnOutput(spec, assistantEvent), unmetObligations: obligations}}
        }
        return {type: 'succeeded', output: turnOutput(spec, assistantEvent)}
      } catch (error) {
        if (error instanceof SessionParkedError) {
          const pending = (runningSession.parkToolCallIds ?? []).filter(
            (toolCallId) => !this.#sessionHasToolResult(sessionId, toolCallId),
          )
          runningSession.parkToolCallIds = undefined
          runningSession.completeAfterTools = undefined
          if (pending.length === 0) continue // every child already resolved; pick results up now
          return {type: 'parked', wait: {reason: 'children', toolCallIds: pending}}
        }
        if (runningSession.subResult) return {type: 'succeeded', output: runningSession.subResult.value}
        if (spec?.output && (runningSession.subResultRetries ?? 0) >= MAX_RETURN_RESULT_RETRIES) {
          return {
            type: 'failed',
            error: {code: 'output-schema', message: 'Sub-session could not produce a schema-valid result'},
          }
        }
        if (error instanceof SessionStoppedError || runningSession.stopped) {
          const stoppedEvent = this.#appendSessionEvent(
            run.accountId,
            run.agentId,
            sessionId,
            {type: 'message', role: 'assistant', content: 'Stopped.'},
            Date.now(),
          )
          return {type: 'canceled', output: {assistantEventId: stoppedEvent.id}}
        }
        return {type: 'failed', error: classifyRunError(error)}
      }
    }
  }

  /**
   * Everything this run still owes, as one list.
   *
   * A run makes promises: a typed child promises its parent a schema-valid payload; a published plan
   * promises the user a checklist that will be finished or honestly closed. Both are the same kind
   * of thing — an obligation — so there is one place that knows what is open, one loop that asks for
   * it, and one ending that admits what was never delivered. Adding a third kind of promise means
   * adding a case here, and nothing else.
   *
   * Two things are deliberately NOT obligations. Steps left open while children are still working
   * are not abandoned — someone else is carrying them. And `failed` / `skipped` steps are terminal:
   * an agent that says it could not do something has kept the contract, and must never be nagged
   * into pretending otherwise.
   */
  #openObligations(
    run: runs.RunRecord,
    sessionId: string,
    spec: SubSessionSpec | undefined,
    runningSession: RunningSession,
  ): api.UnmetObligation[] {
    const obligations: api.UnmetObligation[] = []
    if (spec?.output && !runningSession.subResult) obligations.push({kind: 'typed-result'})
    const steps = this.#unfinishedPlanSteps(run.accountId, sessionId)
    if (steps.length > 0 && !this.#hasLiveChildRuns(run.id)) obligations.push({kind: 'plan', steps})
    return obligations
  }

  /**
   * Plan steps this session has neither finished nor written off. Sessions with no plan return
   * nothing, so a plain conversation is never touched by any of this.
   */
  #unfinishedPlanSteps(accountId: string, sessionId: string): string[] {
    const row = this.#db
      .query<{plan_cbor: Uint8Array | null}, [string, string]>(
        `SELECT plan_cbor FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    if (!row?.plan_cbor) return []
    const plan = cbor.decode<api.RunPlan>(row.plan_cbor)
    return (plan.steps ?? [])
      .filter((step) => !TERMINAL_PLAN_STEP_STATUSES.includes(step.status))
      .map((step) => step.label)
  }

  /** Whether this run still has children working — a step left open for them is not abandoned. */
  #hasLiveChildRuns(runId: string): boolean {
    const placeholders = runs.TERMINAL_RUN_STATUSES.map(() => '?').join(', ')
    return (
      this.#db
        .query<{id: string}, string[]>(
          `SELECT id FROM runs WHERE parent_run_id = ? AND status NOT IN (${placeholders}) LIMIT 1`,
        )
        .get(runId, ...runs.TERMINAL_RUN_STATUSES) !== null
    )
  }

  /** The sub_session/return_result slice of the Pi tool context, present only for run-backed turns. */
  #subSessionToolContext(
    accountId: string,
    sessionId: string,
    agentId: string,
    run: runs.RunRecord | undefined,
    runningSession: RunningSession | undefined,
    outputSchema: JsonSchema | undefined,
  ): Pick<AgentServicePiToolContext, 'spawnSubSession' | 'spawnWorkflow' | 'returnResultSchema' | 'deliverResult'> {
    if (!run || !runningSession) return {}
    const liveRun = run
    const live = runningSession
    const context: Pick<
      AgentServicePiToolContext,
      'spawnSubSession' | 'spawnWorkflow' | 'returnResultSchema' | 'deliverResult'
    > = {
      spawnSubSession: (toolCallId: string, input: unknown) =>
        this.#spawnSubSession(accountId, liveRun, sessionId, agentId, live, toolCallId, input),
      spawnWorkflow: (toolCallId: string, input: unknown) =>
        this.#spawnWorkflowFromChat(accountId, liveRun, sessionId, agentId, live, toolCallId, input),
    }
    if (outputSchema) {
      const schema = outputSchema
      context.returnResultSchema = schema
      context.deliverResult = (payload: unknown) => {
        const errors = validateJsonSchemaValue(schema, payload)
        if (errors.length > 0) {
          live.subResultRetries = (live.subResultRetries ?? 0) + 1
          const detail = errors.map((error) => `${error.path}: ${error.message}`).join('; ')
          if (live.subResultRetries >= MAX_RETURN_RESULT_RETRIES) {
            live.completeAfterTools = true
            throw new APIError(400, `Result rejected (attempt limit reached): ${detail}`)
          }
          throw new APIError(
            400,
            `Result does not match the required schema: ${detail}. Fix and call return_result again.`,
          )
        }
        live.subResult = {value: payload}
        live.completeAfterTools = true
        return {accepted: true}
      }
    }
    return context
  }

  #onRunChanged(run: runs.RunRecord): void {
    this.#emit({type: 'run-change', accountId: run.accountId, run: runInfoFromRecord(run)})
    if (run.kind === 'agent' && run.sessionId) this.#syncSessionStatusFromRuns(run.accountId, run.sessionId)
    // Titling races the turn, not follows it: the user message exists the moment the run starts,
    // so the title generates in parallel and lands while the answer is still streaming. The
    // waiting/finalize triggers below stay as the retry net (e.g. the provider hiccuped here).
    if (run.kind === 'agent' && run.sessionId && run.status === 'running') {
      this.#ensureSessionTitled(run.accountId, run.sessionId)
    }
    if (run.status === 'waiting') {
      this.#reconcileParkedRun(run)
      if (run.kind === 'agent' && run.sessionId) this.#ensureSessionTitled(run.accountId, run.sessionId)
    }
  }

  /**
   * Server-side fallback naming: sessions must never stay "Untitled" just because no model called
   * set_session_title (a parked first turn, an API-created session, a model that skipped the
   * housekeeping). Derives a bounded title from the first user message; keeps title_source
   * 'system' so both the agent and the user can still rename it.
   */
  /**
   * The agent names its own sessions — that is the feature, not a derived echo of the user's
   * words. The in-turn path is the set_session_title tool; this is the guarantee behind it: when a
   * turn parks or finalizes leaving the session untitled (parked first turns skip the model's
   * titling moment entirely), a dedicated minimal model call generates the title. Detached from
   * the run, tracked for drain determinism, in-flight-deduped per session, and disabled unless the
   * server opted in (`titleGeneration`) so mocked test providers never see surprise requests.
   */
  #ensureSessionTitled(accountId: string, sessionId: string): void {
    if (!this.#titleGenerationEnabled) return
    if (this.#namingSessions.has(sessionId)) return
    const row = this.#db
      .query<{title: string | null; title_source: string}, [string, string]>(
        `SELECT title, title_source FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    if (!row || row.title_source !== 'system') return
    // A stored literal placeholder counts as untitled (pre-normalization rows heal here).
    if (row.title && row.title.trim().toLowerCase() !== 'untitled session') return
    this.#namingSessions.add(sessionId)
    const pending = this.#nameSessionWithModel(accountId, sessionId)
      .catch((error) => {
        console.warn('[agents/runtime] session title generation failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => {
        this.#namingSessions.delete(sessionId)
        this.#pendingTriggerSessions.delete(pending)
      }) as Promise<void>
    this.#pendingTriggerSessions.add(pending)
  }

  /** Builds a conversation digest, asks the agent's own model for a title, and applies it guarded. */
  async #nameSessionWithModel(accountId: string, sessionId: string): Promise<void> {
    const session = this.#db
      .query<{agent_id: string}, [string, string]>(`SELECT agent_id FROM sessions WHERE account_id = ? AND id = ?`)
      .get(accountId, sessionId)
    if (!session) return
    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, session.agent_id)
    if (!agent) return
    const definition = cbor.decode<api.AgentDefinition>(agent.definition_cbor)
    const events = this.#db
      .query<SessionEventRow, [string]>(
        `SELECT id, session_id, seq, event_cbor, created_at FROM session_events
         WHERE session_id = ? ORDER BY seq ASC LIMIT 12`,
      )
      .all(sessionId)
      .map(sessionEventRowToInfo)
    const lines: string[] = []
    for (const event of events) {
      const value = event.event as {type?: string; role?: string; content?: string}
      if (value.type !== 'message' || typeof value.content !== 'string') continue
      if (value.role === 'user') lines.push(`User: ${value.content.slice(0, 1200)}`)
      else if (value.role === 'assistant') lines.push(`Assistant: ${value.content.slice(0, 600)}`)
    }
    if (lines.length === 0) return
    const title = await this.#generateSessionTitle(accountId, definition, lines.join('\n\n').slice(0, 4000))
    if (!title) return
    // Guarded exactly like the tool path: never overwrite a user title or a title that landed
    // meanwhile (the model may have called set_session_title on a resumed turn).
    this.#db.run(
      `UPDATE sessions SET title = ?, updated_at = ? WHERE account_id = ? AND id = ?
         AND (title IS NULL OR title = '' OR LOWER(TRIM(title)) = 'untitled session') AND title_source = 'system'`,
      [title, Date.now(), accountId, sessionId],
    )
    const info = this.#getSessionInfo(accountId, sessionId)
    if (info?.title === title) {
      console.info('[agents/runtime] session titled by model', {sessionId, title})
      this.#emit({type: 'session-change', accountId, session: info})
      this.#emit({type: 'account-change', accountId, reason: 'session-updated', agentId: session.agent_id, sessionId})
    }
  }

  /** One minimal, tool-less model call: the conversation digest in, one line out. */
  async #generateSessionTitle(
    accountId: string,
    definition: api.AgentDefinition,
    digest: string,
  ): Promise<string | null> {
    // The shared provider runtime, NOT an inline resolution: titling must honor the provider's
    // auth mode (subscription OAuth has no apiKey secret — the old inline path silently bailed
    // and left every subscription-provider session untitled).
    let runtime: Awaited<ReturnType<Service['piProviderRuntimeForTitle']>>
    try {
      runtime = await this.piProviderRuntimeForTitle(accountId, definition)
    } catch {
      return null
    }
    const {provider, authStorage, modelRegistry, model} = runtime
    const {session: piSession} = await pi.createAgentSession({
      cwd: this.#dataDir,
      agentDir: path.join(this.#dataDir, 'pi'),
      model,
      thinkingLevel: 'off',
      authStorage,
      modelRegistry,
      resourceLoader: createSeedPiResourceLoader(
        'You are a session-titling assistant. Reply with ONLY a concise one-line title (at most eight words) naming the purpose of the conversation you are shown. No quotes, no trailing punctuation, no explanation.',
      ),
      customTools: [],
      tools: [],
      noTools: 'builtin',
      sessionManager: pi.SessionManager.inMemory(this.#dataDir),
      settingsManager: pi.SettingsManager.inMemory({compaction: {enabled: false}}),
    })
    try {
      piSession.agent.onPayload = (payload) => {
        let next = restoreReasoningEffort(payload, definition)
        if (provider.modelDefaults) next = mergePiPayloadDefaults(next, provider.modelDefaults)
        return next
      }
      piSession.state.messages = [{role: 'user', content: digest, timestamp: Date.now()}] as never
      let text = ''
      const unsubscribe = piSession.subscribe((event) => {
        if (event.type === 'message_end' && event.message.role === 'assistant') {
          text = piAssistantText(event.message)
        }
      })
      await piSession.agent.continue()
      unsubscribe()
      const firstLine = text.split('\n')[0]?.trim() ?? ''
      const stripped = firstLine
        .replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '')
        .replace(/[.]+$/, '')
        .trim()
      if (!stripped) return null
      try {
        return normalizeBoundedString(stripped, 'Session title', MAX_NAME_BYTES)
      } catch {
        return null
      }
    } finally {
      piSession.dispose()
    }
  }

  #onRunFinalized(run: runs.RunRecord): void {
    this.#workflowCancelFlags.delete(run.id)
    if (run.kind === 'agent' && run.sessionId) {
      this.#ensureSessionTitled(run.accountId, run.sessionId)
      this.#settleSessionPlanAfterRun(run)
    }
    const waiters = this.#runWaiters.get(run.id)
    if (waiters) {
      this.#runWaiters.delete(run.id)
      for (const resolve of waiters) resolve(run)
    }
    // An automation can start where another finished; this is the one moment that knows a run is done.
    this.#fireRunCompletedTriggers(run)
    {
      // A run that continued as a new run is NOT finished work: its successor inherited the same
      // tool call and answers the parent when it is really done. Resolving here would hand the
      // parent a result while the work is still going.
      const continued = isPlainRecord(run.output) && typeof run.output.continuedAsRunId === 'string'
      // The parent link is read through the spawn context, so a RETRY of a delegated session can
      // still answer the call that spawned it — a retry run has no parentRunId of its own.
      const spawn = this.#spawnContextForRun(run)
      if (!continued && spawn.parentRunId && spawn.parentToolCallId) {
        this.#resolveSubSessionResult(run, spawn.parentRunId, spawn.parentToolCallId, spawn.parentToolName)
      }
    }
    if (run.kind === 'agent' && run.sessionId && run.status === 'failed' && run.error) {
      this.#appendSessionEvent(
        run.accountId,
        run.agentId ?? '',
        run.sessionId,
        {type: 'error', message: run.error.message},
        Date.now(),
      )
      this.#syncSessionStatusFromRuns(run.accountId, run.sessionId)
    }
    if (run.triggerFiringId && run.status === 'failed' && run.error) {
      const firing = this.#db
        .query<{trigger_id: string}, [string, string]>(
          `SELECT trigger_id FROM trigger_firings WHERE account_id = ? AND id = ?`,
        )
        .get(run.accountId, run.triggerFiringId)
      this.#db.run(`UPDATE trigger_firings SET status = ?, error = ? WHERE account_id = ? AND id = ?`, [
        'error',
        run.error.message,
        run.accountId,
        run.triggerFiringId,
      ])
      if (firing) {
        this.#db.run(`UPDATE agent_triggers SET last_error = ? WHERE account_id = ? AND id = ?`, [
          run.error.message,
          run.accountId,
          firing.trigger_id,
        ])
      }
    }
  }

  /**
   * A step can't still be "running" once the run that was running it is over. When a session-owning
   * run finalizes and nothing else is live on the session, settle the update_plan todo the same way
   * run plans settle: running→done on success, running→failed on failure. Pending steps are left
   * alone — a session todo list legitimately spans turns.
   */
  /**
   * The plan step a spawn is working on, or undefined when that is ambiguous.
   *
   * The model's `plan` verb maintains the SESSION plan (`sessions.plan_cbor`); `runs.plan_cbor` is
   * only ever written by the workflow host. Reading the run plan alone therefore stamped nothing on
   * model-spawned children, and step↔child attachment survived only by the coincidence of a child's
   * title matching a step label — which breaks precisely when one step is named for a whole batch.
   * So: session plan first, run plan as the fallback that still serves workflow children.
   *
   * Both the id and the label are returned. The id is the durable join: labels are display strings
   * the model rewrites freely between turns, so a stamped label goes stale and stops naming any
   * step in the plan it came from. Step ids are declared stable by the plan verb's own contract.
   */
  #runningPlanStep(
    accountId: string,
    parentRun: runs.RunRecord,
    sessionId: string,
  ): {id?: string; label: string} | undefined {
    const row = this.#db
      .query<{plan_cbor: Uint8Array | null}, [string, string]>(
        `SELECT plan_cbor FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    const sessionPlan = row?.plan_cbor ? cbor.decode<api.RunPlan>(row.plan_cbor) : undefined
    const plan = sessionPlan ?? runs.getRun(this.#db, accountId, parentRun.id)?.plan
    const running = (plan?.steps ?? []).filter((step) => step.status === 'running')
    if (running.length !== 1) return undefined
    const step = running[0]!
    return {...(step.id ? {id: step.id} : {}), label: step.label}
  }

  #settleSessionPlanAfterRun(run: runs.RunRecord): void {
    if (!run.sessionId) return
    if (run.status !== 'succeeded' && run.status !== 'failed') return
    if (runs.sessionHasLiveRun(this.#db, run.sessionId)) return
    const row = this.#db
      .query<{plan_cbor: Uint8Array | null}, [string, string]>(
        `SELECT plan_cbor FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(run.accountId, run.sessionId)
    if (!row?.plan_cbor) return
    const plan = cbor.decode<api.RunPlan>(row.plan_cbor)
    const settled: 'done' | 'failed' = run.status === 'succeeded' ? 'done' : 'failed'
    const steps = plan.steps.map((step) => (step.status === 'running' ? {...step, status: settled} : step))
    if (steps.every((step, index) => step === plan.steps[index])) return
    this.#setSessionPlanFromAgent(run.accountId, run.sessionId, {...plan, steps})
  }

  /**
   * Maintains the legacy `sessions.status` column as a mirror derived from run state: `streaming`
   * iff a non-terminal agent run references the session, `error` when the latest run failed, else
   * `idle`. Old clients keep working; liveness truth lives in the runs table.
   */
  #syncSessionStatusFromRuns(accountId: string, sessionId: string): void {
    const session = this.#db
      .query<{status: string}, [string, string]>(`SELECT status FROM sessions WHERE account_id = ? AND id = ?`)
      .get(accountId, sessionId)
    if (!session) return
    let derived: api.SessionInfo['status'] = 'idle'
    if (runs.sessionHasLiveRun(this.#db, sessionId)) {
      derived = 'streaming'
    } else {
      const latest = runs.latestSessionRun(this.#db, sessionId)
      if (latest?.status === 'failed') derived = 'error'
    }
    if (derived === session.status) return
    this.#updateSessionStatus(accountId, sessionId, derived, Date.now())
  }

  /**
   * A crash between a persisted `tool_call` and its `tool_result` leaves a transcript providers
   * reject. Before an agent run (re)enters the loop, synthesize an error result for every unmatched
   * call so the request is well-formed and the model decides whether to re-issue the tool.
   */
  #synthesizeInterruptedToolResults(accountId: string, agentId: string, sessionId: string): void {
    const events = this.#db
      .query<SessionEventRow, [string]>(
        `SELECT id, session_id, seq, event_cbor, created_at FROM session_events WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId)
      .map(sessionEventRowToInfo)
    const unmatched = new Map<string, string>()
    for (const event of events) {
      const value = event.event as {type?: string; id?: string; toolCallId?: string; name?: string}
      // User-run verbs are not the model's dangling work: synthesizing an actor-less result for
      // one creates a provider-illegal orphan on replay that permanently bricks the session.
      if (sessionEventActor(event.event as never) === 'user') continue
      if (value.type === 'tool_call') {
        const toolCallId = typeof value.id === 'string' ? value.id : value.toolCallId
        if (toolCallId) unmatched.set(toolCallId, typeof value.name === 'string' ? value.name : '')
      } else if (value.type === 'tool_result' && typeof value.toolCallId === 'string') {
        unmatched.delete(value.toolCallId)
      }
    }
    // Spawn calls a waiting run still parks on are pending, not interrupted: their real results
    // arrive from the child finalizer, and replay injects a synthetic pending result meanwhile.
    for (const pendingId of runs.pendingWaitToolCallIds(this.#db, sessionId)) {
      unmatched.delete(pendingId)
    }
    for (const [toolCallId, name] of unmatched) {
      this.#appendSessionEvent(
        accountId,
        agentId,
        sessionId,
        {
          type: 'tool_result',
          toolCallId,
          name,
          error:
            'Interrupted by a service restart before this tool finished; whether its side effects happened is unknown. Verify state before retrying.',
        },
        Date.now(),
      )
    }
  }

  async #abortLiveSessionRun(accountId: string, sessionId: string): Promise<void> {
    const running = this.#runningSessions.get(this.#runningSessionKey(accountId, sessionId))
    if (running) {
      running.stopped = true
      await running.abort?.()
    }
  }

  #getRun(accountId: string, runId: string): api.GetRunResponse {
    const run = runs.getRun(this.#db, accountId, normalizeBoundedString(runId, 'Run ID', MAX_NAME_BYTES))
    if (!run) throw new APIError(404, 'Run not found')
    return {_: 'GetRunResponse', run: this.#withChildRunCounts([run])[0]!}
  }

  /** Decorates run infos with how many children each spawned, in one grouped query. */
  #withChildRunCounts(records: runs.RunRecord[]): api.RunInfo[] {
    if (records.length === 0) return []
    const placeholders = records.map(() => '?').join(', ')
    const counts = new Map(
      this.#db
        .query<{parent_run_id: string; n: number}, string[]>(
          `SELECT parent_run_id, COUNT(*) AS n FROM runs WHERE parent_run_id IN (${placeholders}) GROUP BY parent_run_id`,
        )
        .all(...records.map((record) => record.id))
        .map((row) => [row.parent_run_id, row.n]),
    )
    return records.map((record) => {
      const info = runInfoFromRecord(record)
      const childRunCount = counts.get(record.id)
      return childRunCount ? {...info, childRunCount} : info
    })
  }

  #listRuns(accountId: string, action: api.ListRuns): api.ListRunsResponse {
    const limit = boundedInteger(action.limit, 50, 1, 200)
    let records: runs.RunRecord[]
    if (action.rootRunId !== undefined) {
      records = runs.listRunTree(
        this.#db,
        accountId,
        normalizeBoundedString(action.rootRunId, 'Root run ID', MAX_NAME_BYTES),
      )
    } else if (action.sessionId !== undefined) {
      records = runs.listSessionRootRuns(
        this.#db,
        accountId,
        normalizeBoundedString(action.sessionId, 'Session ID', MAX_NAME_BYTES),
        limit,
      )
    } else if (action.agentId !== undefined) {
      records = runs.listAgentRuns(
        this.#db,
        accountId,
        normalizeBoundedString(action.agentId, 'Agent ID', MAX_NAME_BYTES),
        limit,
      )
    } else {
      throw new APIError(400, 'ListRuns requires rootRunId, sessionId, or agentId')
    }
    if (action.status !== undefined) records = records.filter((run) => run.status === action.status)
    return {_: 'ListRunsResponse', runs: this.#withChildRunCounts(records.slice(0, limit))}
  }

  #cancelRun(accountId: string, runId: string): api.CancelRunResponse {
    const normalized = normalizeBoundedString(runId, 'Run ID', MAX_NAME_BYTES)
    const existing = runs.getRun(this.#db, accountId, normalized)
    if (!existing) throw new APIError(404, 'Run not found')
    const affected = this.#runQueue.cancelTree(accountId, normalized)
    return {_: 'CancelRunResponse', runId: normalized, canceled: affected.length > 0}
  }

  /**
   * Answers a run parked on `ctx.waitForEvent`: delivers the signal's payload into its journal and
   * puts it back in the queue. Not delivering is a normal outcome (the run finished, timed out, or
   * is listening for something else), so it reports rather than throws.
   */
  #signalRun(accountId: string, runId: string, signal: string, payload: unknown): api.SignalRunResponse {
    const normalized = normalizeBoundedString(runId, 'Run ID', MAX_NAME_BYTES)
    const signalName = normalizeBoundedString(signal, 'Signal', MAX_NAME_BYTES)
    const run = runs.getRun(this.#db, accountId, normalized)
    if (!run) throw new APIError(404, 'Run not found')
    // A budget-paused run is not listening for a payload — it is waiting for permission. Any
    // signal is that permission.
    if (run.status === 'waiting' && run.wait?.reason === 'budget-pause') {
      const resumed = this.#runQueue.resumeBudgetPause(normalized)
      return {_: 'SignalRunResponse', runId: normalized, delivered: !!resumed}
    }
    const target = runEvents
      .listRunEventWaits(this.#db, normalized)
      .find((wait) => runEvents.signalMatchesWait(wait.match, signalName))
    if (!target) return {_: 'SignalRunResponse', runId: normalized, delivered: false}
    const delivered = this.#deliverRunEvent(run, target.waitId, {
      source: 'signal',
      signal: signalName,
      ...(payload === undefined ? {} : {payload: jsonSafeToolOutput(payload)}),
    })
    return {_: 'SignalRunResponse', runId: normalized, delivered}
  }

  /**
   * Wakes one parked run with a payload, exactly once.
   *
   * The journal write and the requeue happen in a single transaction, so a signal that loses the
   * race — to a timeout wake, a cancellation, or another signal — leaves nothing behind at all;
   * there is no window where a run is woken without its payload, or handed two.
   */
  #deliverRunEvent(run: runs.RunRecord, waitId: string, delivery: runEvents.RunEventDelivery): boolean {
    const now = Date.now()
    let appended: {seq: number; entry: WorkflowJournalEntry} | null = null
    const commit = this.#db.transaction(() => {
      const current = runs.getRun(this.#db, run.accountId, run.id)
      if (!current || current.status !== 'waiting' || current.wait?.reason !== 'event') return false
      // The run's own journal says which call this wait belongs to, so the delivery files itself
      // under the exact ctx.waitForEvent the script is awaiting.
      const registration = this.#db
        .query<{entry_cbor: Uint8Array}, [string]>(
          `SELECT entry_cbor FROM run_journal WHERE run_id = ? ORDER BY seq ASC`,
        )
        .all(run.id)
        .map((row) => cbor.decode<WorkflowJournalEntry>(row.entry_cbor))
        .find((entry) => entry.kind === 'wait' && entry.waitId === waitId) as
        | Extract<WorkflowJournalEntry, {kind: 'wait'}>
        | undefined
      if (!registration) return false
      const seq =
        (this.#db.query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM run_journal WHERE run_id = ?`).get(run.id)
          ?.n ?? 0) + 1
      const entry: WorkflowJournalEntry = {
        kind: 'event',
        callSeq: registration.callSeq,
        ...(registration.key ? {key: registration.key} : {}),
        waitId,
        delivery,
      }
      this.#db.run(`INSERT INTO run_journal (run_id, seq, entry_cbor, created_at) VALUES (?, ?, ?, ?)`, [
        run.id,
        seq,
        cbor.encode(entry),
        now,
      ])
      this.#db.run(
        `UPDATE runs SET status = 'queued', wait_cbor = NULL, not_before = NULL, updated_at = ? WHERE id = ?`,
        [now, run.id],
      )
      this.#db.run(`DELETE FROM run_event_waits WHERE run_id = ?`, [run.id])
      appended = {seq, entry}
      return true
    })
    if (!commit()) return false
    const written = appended as {seq: number; entry: WorkflowJournalEntry} | null
    if (written) {
      this.#emit({
        type: 'run-append',
        accountId: run.accountId,
        rootRunId: run.rootRunId,
        entry: {
          runId: run.id,
          seq: written.seq,
          entry: written.entry as unknown as Record<string, unknown>,
          createdAt: now,
        },
      })
    }
    const woken = runs.getRun(this.#db, run.accountId, run.id)
    if (woken) this.#emit({type: 'run-change', accountId: run.accountId, run: runInfoFromRecord(woken)})
    this.#runQueue.wake()
    return true
  }

  /**
   * Delivers an activity-feed event to every run listening for it. Runs a script parked on
   * `ctx.waitForEvent({eventType, resource, author})` alongside the trigger machinery: a wait is
   * one run's private business, a trigger is the agent's standing configuration.
   */
  #deliverActivityToRunWaits(accountId: string, event: activityTriggers.ActivityFeedEvent): void {
    for (const wait of runEvents.listAccountEventWaits(this.#db, accountId)) {
      if (!runEvents.activityMatchesWait(wait.match, event)) continue
      const run = runs.getRun(this.#db, accountId, wait.runId)
      if (!run) continue
      const delivered = this.#deliverRunEvent(run, wait.waitId, {source: 'activity', payload: event})
      if (delivered) {
        console.info('[agents/runs] activity woke a waiting run', {
          accountId,
          runId: wait.runId,
          waitId: wait.waitId,
        })
      }
    }
  }

  #getRunJournal(accountId: string, runId: string, afterSeq?: number): api.GetRunJournalResponse {
    if (afterSeq !== undefined && (!Number.isInteger(afterSeq) || afterSeq < 0)) {
      throw new APIError(400, 'afterSeq must be a non-negative integer')
    }
    const normalized = normalizeBoundedString(runId, 'Run ID', MAX_NAME_BYTES)
    const run = runs.getRun(this.#db, accountId, normalized)
    if (!run) throw new APIError(404, 'Run not found')
    const entries = this.#db
      .query<{seq: number; entry_cbor: Uint8Array; created_at: number}, [string, number]>(
        `SELECT seq, entry_cbor, created_at FROM run_journal WHERE run_id = ? AND seq > ? ORDER BY seq ASC`,
      )
      .all(normalized, afterSeq ?? 0)
      .map((row) => ({
        runId: normalized,
        seq: row.seq,
        entry: cbor.decode<Record<string, unknown>>(row.entry_cbor),
        createdAt: row.created_at,
      }))
    return {_: 'GetRunJournalResponse', runId: normalized, entries}
  }

  /**
   * sub_session tool: spawns a child run + real session under the calling run and registers a park
   * intent on the calling turn. The tool "returns" only transiently to Pi — the durable tool_result
   * is appended later by {@link #resolveSubSessionResult} when the child reaches a terminal status.
   */
  #spawnSubSession(
    accountId: string,
    parentRun: runs.RunRecord,
    parentSessionId: string,
    parentAgentId: string,
    runningSession: RunningSession,
    toolCallId: string,
    raw: unknown,
  ): {status: string; sessionId: string; title: string} {
    const spec = normalizeSubSessionSpec(raw)
    if (parentRun.depth + 1 > MAX_SESSION_SPAWN_DEPTH) {
      throw new APIError(400, `Sub-session depth limit reached (${MAX_SESSION_SPAWN_DEPTH}); finish the work here.`)
    }
    const childCount =
      this.#db.query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM runs WHERE parent_run_id = ?`).get(parentRun.id)
        ?.n ?? 0
    if (childCount >= MAX_SESSION_SPAWNS_PER_SESSION) {
      throw new APIError(
        400,
        `This run already spawned ${MAX_SESSION_SPAWNS_PER_SESSION} sub-sessions; finish the remaining work here.`,
      )
    }
    const childAgentId = spec.agentId ?? parentAgentId
    if (spec.agentId) this.#requireAgent(accountId, spec.agentId)
    const title = spec.title ?? (typeof spec.input === 'string' ? sessionTitleFromPrompt(spec.input) : 'Sub-session')
    const childRunId = crypto.randomUUID()
    const session = this.#createSessionOnce(accountId, childAgentId, title, {
      parentSessionId,
      runId: childRunId,
    })
    const rendered = renderSubSessionInput(spec.input)
    this.#appendSessionEvent(
      accountId,
      childAgentId,
      session.sessionId,
      {type: 'message', role: 'user', content: rendered},
      Date.now(),
    )
    // If exactly one plan step is running right now, that step is what this spawn is working on —
    // record it so the progress card shows the step and its sub-agent as one item.
    const step = this.#runningPlanStep(accountId, parentRun, parentSessionId)
    this.#runQueue.enqueue({
      id: childRunId,
      accountId,
      kind: 'agent',
      origin: 'agent',
      parentRunId: parentRun.id,
      parentToolCallId: toolCallId,
      agentId: childAgentId,
      sessionId: session.sessionId,
      title,
      input: {
        spec,
        parentToolCallId: toolCallId,
        ...(step ? {planStepLabel: step.label} : {}),
        ...(step?.id ? {planStepId: step.id} : {}),
      },
      queue: 'background',
      maxAttempts: AGENT_RUN_MAX_ATTEMPTS,
    })
    runningSession.parkToolCallIds = [...(runningSession.parkToolCallIds ?? []), toolCallId]
    console.info('[agents/runtime] sub-session spawned', {
      accountId,
      parentRunId: parentRun.id,
      childRunId,
      sessionId: session.sessionId,
      depth: parentRun.depth + 1,
      typed: spec.output !== undefined,
    })
    return {status: 'spawned', sessionId: session.sessionId, title}
  }

  /**
   * Child terminal status → parent resolution: appends the durable sub_session tool_result on the
   * parent transcript and shrinks the parent's wait set, requeuing it when the set empties.
   */
  /**
   * The delegation contract a run is executing: the spec it must satisfy and the parent tool call
   * its result answers.
   *
   * A typed child's spec rides the input of the run that SPAWNED it. Any later run on the same
   * session — a user retry, a new message — carries no spec of its own, and before this inherited
   * nothing: the output schema, the return_result tool, the typed-completion semantics and the
   * parent link all vanished, so the child could not fulfil its contract and the parent parked
   * forever. `sessions.run_id` is the durable record of that spawn, so later runs inherit from it.
   */
  #spawnContextForRun(run: runs.RunRecord): {
    spec?: SubSessionSpec
    parentRunId?: string
    parentToolCallId?: string
    parentToolName?: string
    /** True when the contract came from the session's spawning run rather than this run's input. */
    inherited: boolean
  } {
    const readFrom = (input: unknown, parentRunId: string | undefined, inherited: boolean) => {
      const record = isPlainRecord(input) ? input : {}
      const spec = record.spec as SubSessionSpec | undefined
      const parentToolCallId = typeof record.parentToolCallId === 'string' ? record.parentToolCallId : undefined
      // Linkage alone is enough: workflow children carry a parent tool call and no spec at all.
      if (!spec && !parentToolCallId) return undefined
      return {
        ...(spec ? {spec} : {}),
        ...(parentRunId ? {parentRunId} : {}),
        ...(parentToolCallId ? {parentToolCallId} : {}),
        ...(typeof record.parentToolName === 'string' ? {parentToolName: record.parentToolName} : {}),
        inherited,
      }
    }
    const own = readFrom(run.input, run.parentRunId, false)
    if (own) return own
    if (!run.sessionId) return {inherited: false}
    const row = this.#db
      .query<{run_id: string | null}, [string, string]>(`SELECT run_id FROM sessions WHERE account_id = ? AND id = ?`)
      .get(run.accountId, run.sessionId)
    const spawningRunId = row?.run_id
    if (!spawningRunId || spawningRunId === run.id) return {inherited: false}
    const spawning = runs.getRun(this.#db, run.accountId, spawningRunId)
    if (!spawning) return {inherited: false}
    return readFrom(spawning.input, spawning.parentRunId, true) ?? {inherited: false}
  }

  #resolveSubSessionResult(
    child: runs.RunRecord,
    parentRunId: string,
    parentToolCallId: string,
    parentToolName?: string,
  ): void {
    const parent = runs.getRun(this.#db, child.accountId, parentRunId)
    if (!parent || parent.kind !== 'agent' || !parent.sessionId) return
    const toolName = parentToolName ?? seedVerbRegistry.delegate.name
    let result: Record<string, unknown>
    if (child.status === 'succeeded') {
      result = {status: 'succeeded', runId: child.id, sessionId: child.sessionId, output: child.output ?? null}
    } else if (child.status === 'canceled') {
      result = {status: 'canceled', runId: child.id, sessionId: child.sessionId}
    } else {
      result = {
        status: 'failed',
        runId: child.id,
        sessionId: child.sessionId,
        error: {code: child.error?.code ?? 'run-failed', message: child.error?.message ?? 'Sub-session failed'},
      }
    }
    // Append the durable result at most once, but ALWAYS resolve the wait: a crash (or double
    // resolution) can leave the tool_result written while the parent still parks on the call.
    const alreadyAnswered = this.#sessionHasToolResult(parent.sessionId, parentToolCallId)
    if (!alreadyAnswered) {
      this.#appendSessionEvent(
        child.accountId,
        parent.agentId ?? '',
        parent.sessionId,
        {type: 'tool_result', toolCallId: parentToolCallId, name: toolName, output: result},
        Date.now(),
      )
    } else if (child.status === 'succeeded' && child.sessionId) {
      // A late delivery: the child finally satisfied its contract, but the parent's call already
      // has an answer (typically this child's own earlier failure). Say so in the child's log —
      // silently dropping a valid result is how a session looks finished and changes nothing. It is
      // a runtime-authored message, not an error: the agent did nothing wrong, and it should read
      // this on its next turn the same way it reads anything else the system tells it.
      this.#appendSessionEvent(
        child.accountId,
        child.agentId ?? '',
        child.sessionId,
        {
          type: 'message',
          role: 'user',
          actor: 'system',
          content:
            'Result accepted, but the task that delegated this one had already stopped waiting for it — nothing was delivered upstream.',
        },
        Date.now(),
      )
    }
    const resolution = this.#runQueue.resolveChildWait(parent.id, parentToolCallId)
    console.info('[agents/runtime] sub-session resolved', {
      childRunId: child.id,
      parentRunId: parent.id,
      status: child.status,
      resolution,
    })
  }

  #sessionHasToolResult(sessionId: string, toolCallId: string): boolean {
    const rows = this.#db
      .query<SessionEventRow, [string]>(
        `SELECT id, session_id, seq, event_cbor, created_at FROM session_events WHERE session_id = ? ORDER BY seq ASC`,
      )
      .all(sessionId)
      .map(sessionEventRowToInfo)
    return rows.some((row) => {
      const value = row.event as {type?: string; toolCallId?: string}
      return value.type === 'tool_result' && value.toolCallId === toolCallId
    })
  }

  /**
   * Closes the park/resolve race: a fast child can finalize between the parent's park decision and
   * the `waiting` status commit. After every waiting-on-children transition, drop wait entries whose
   * durable tool_result already exists and requeue when none remain.
   */
  #reconcileParkedRun(run: runs.RunRecord): void {
    if (run.status !== 'waiting' || run.wait?.reason !== 'children' || !run.sessionId) return
    for (const toolCallId of run.wait.toolCallIds) {
      if (this.#sessionHasToolResult(run.sessionId, toolCallId)) {
        this.#runQueue.resolveChildWait(run.id, toolCallId)
      }
    }
  }

  /** Resolves when the run reaches a terminal status (resolved by the finalizer, race-safe). */
  #awaitRunTerminal(accountId: string, runId: string): Promise<runs.RunRecord> {
    return new Promise((resolve) => {
      const waiters = this.#runWaiters.get(runId) ?? []
      waiters.push(resolve)
      this.#runWaiters.set(runId, waiters)
      // Check AFTER registering so a finalization between check and register cannot be missed.
      const current = runs.getRun(this.#db, accountId, runId)
      if (current && runs.TERMINAL_RUN_STATUSES.includes(current.status)) {
        const pending = this.#runWaiters.get(runId)
        if (pending) {
          this.#runWaiters.delete(runId)
          for (const waiter of pending) waiter(current)
        }
      }
    })
  }

  /** run_workflow tool: lints and spawns a workflow child run, parking the calling turn on it. */
  #spawnWorkflowFromChat(
    accountId: string,
    parentRun: runs.RunRecord,
    parentSessionId: string,
    parentAgentId: string,
    runningSession: RunningSession,
    toolCallId: string,
    raw: unknown,
  ): {status: string; runId: string; title: string} {
    const input = isPlainRecord(raw) ? raw : {}
    const source = typeof input.source === 'string' ? input.source : ''
    const title = normalizeBoundedString(input.title, 'Workflow title', MAX_NAME_BYTES)
    const lintErrors = lintWorkflowSource(source)
    if (lintErrors.length > 0) {
      throw new APIError(400, `Workflow source rejected:\n- ${lintErrors.join('\n- ')}`)
    }
    if (parentRun.depth + 1 > MAX_SESSION_SPAWN_DEPTH) {
      throw new APIError(400, `Workflow depth limit reached (${MAX_SESSION_SPAWN_DEPTH})`)
    }
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(source)
    const sourceCid = `sha256:${hasher.digest('hex')}`
    const childRunId = crypto.randomUUID()
    this.#runQueue.enqueue({
      id: childRunId,
      accountId,
      kind: 'workflow',
      origin: 'agent',
      parentRunId: parentRun.id,
      parentToolCallId: toolCallId,
      agentId: parentAgentId,
      title,
      sourceCid,
      sourceText: source,
      input: {input: input.input ?? null, parentToolCallId: toolCallId, parentToolName: seedVerbRegistry.delegate.name},
      queue: 'background',
      maxAttempts: 1,
    })
    runningSession.parkToolCallIds = [...(runningSession.parkToolCallIds ?? []), toolCallId]
    console.info('[agents/workflow] workflow spawned from chat', {
      accountId,
      parentRunId: parentRun.id,
      childRunId,
      parentSessionId,
      title,
      sourceBytes: source.length,
    })
    return {status: 'spawned', runId: childRunId, title}
  }

  /** ctx.agent inside a workflow: spawns a child agent run + session under the workflow run. */
  #spawnWorkflowChildAgent(
    workflowRun: runs.RunRecord,
    rawSpec: unknown,
    stepLabel?: string,
  ): {childRunId: string; sessionId?: string} {
    const spec = normalizeSubSessionSpec(rawSpec)
    if (workflowRun.depth + 1 > MAX_SESSION_SPAWN_DEPTH) {
      throw new APIError(400, `Sub-session depth limit reached (${MAX_SESSION_SPAWN_DEPTH})`)
    }
    const currentPlan = runs.getRun(this.#db, workflowRun.accountId, workflowRun.id)?.plan ?? workflowRun.plan
    const stepId = stepLabel ? currentPlan?.steps.find((step) => step.label === stepLabel)?.id : undefined
    const childCount =
      this.#db
        .query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM runs WHERE parent_run_id = ?`)
        .get(workflowRun.id)?.n ?? 0
    if (childCount >= MAX_SESSION_SPAWNS_PER_SESSION) {
      throw new APIError(400, `This workflow already spawned ${MAX_SESSION_SPAWNS_PER_SESSION} sub-sessions`)
    }
    const accountId = workflowRun.accountId
    const childAgentId = spec.agentId ?? workflowRun.agentId
    if (!childAgentId) throw new APIError(400, 'Workflow run has no agent to run sub-sessions as')
    if (spec.agentId) this.#requireAgent(accountId, spec.agentId)
    // Nest the child session under the chat session that (transitively) launched the workflow.
    let ancestorSessionId: string | undefined
    for (let cursor: runs.RunRecord | null = workflowRun; cursor; ) {
      if (cursor.sessionId) {
        ancestorSessionId = cursor.sessionId
        break
      }
      cursor = cursor.parentRunId ? runs.getRun(this.#db, accountId, cursor.parentRunId) : null
    }
    const title = spec.title ?? (typeof spec.input === 'string' ? sessionTitleFromPrompt(spec.input) : 'Sub-session')
    const childRunId = crypto.randomUUID()
    const session = this.#createSessionOnce(accountId, childAgentId, title, {
      ...(ancestorSessionId ? {parentSessionId: ancestorSessionId} : {}),
      runId: childRunId,
    })
    const rendered = renderSubSessionInput(spec.input)
    this.#appendSessionEvent(
      accountId,
      childAgentId,
      session.sessionId,
      {type: 'message', role: 'user', content: rendered},
      Date.now(),
    )
    this.#runQueue.enqueue({
      id: childRunId,
      accountId,
      kind: 'agent',
      origin: 'workflow',
      parentRunId: workflowRun.id,
      agentId: childAgentId,
      sessionId: session.sessionId,
      title,
      input: {
        spec,
        ...(stepLabel ? {planStepLabel: stepLabel} : {}),
        // ctx.delegate({step}) names the step by label; the workflow's own plan (which IS written to
        // runs.plan_cbor) is where that label has an id, so resolve it here for the same durable join.
        ...(stepId ? {planStepId: stepId} : {}),
      },
      queue: 'background',
      maxAttempts: AGENT_RUN_MAX_ATTEMPTS,
    })
    return {childRunId, sessionId: session.sessionId}
  }

  /** Executes one claimed workflow run in the QuickJS engine against journaled adapters. */
  async #executeWorkflowRun(run: runs.RunRecord): Promise<runs.RunOutcome> {
    if (!run.sourceText) {
      return {type: 'failed', error: {code: 'config-error', message: 'Workflow run is missing its source'}}
    }
    // A run that has used up its wall-clock budget PAUSES rather than fails: the work so far is
    // journaled and correct, and a person can look at it and let it continue. Failing here would
    // throw that away over a limit that is a policy, not an error.
    const budgetPause = budgetPauseFor(run)
    if (budgetPause) {
      console.info('[agents/workflow] run paused on its time budget', {runId: run.id, note: budgetPause.note})
      return {type: 'parked', wait: budgetPause}
    }
    if (!run.agentId) {
      return {type: 'failed', error: {code: 'config-error', message: 'Workflow run is missing its agent'}}
    }
    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(run.accountId, run.agentId)
    if (!agent) return {type: 'failed', error: {code: 'config-error', message: 'Agent not found'}}
    const definition = cbor.decode<api.AgentDefinition>(agent.definition_cbor)
    const codeExecAvailable = (await this.#codeExec.availability()).available
    // Scripts always hold the read/write verbs; definition.tools narrows only the callable set.
    const allowedTools = new Set([
      seedVerbRegistry.read.name,
      seedVerbRegistry.write.name,
      ...enabledCallableTools(definition, codeExecAvailable),
    ])
    const stateDir = this.#agentMemoryStateDir(run.accountId, run.agentId)
    const partialId = crypto.randomUUID()
    const emitRunPartial = (patch: {
      progress?: {fraction?: number; label?: string}
      activity?: api.AgentRunActivity
    }): void => {
      this.#emit({
        type: 'run-partial',
        accountId: run.accountId,
        rootRunId: run.rootRunId,
        runId: run.id,
        partialId,
        patch,
      })
    }
    const piToolContext: AgentServicePiToolContext = {
      db: this.#db,
      accountId: run.accountId,
      agentId: run.agentId,
      definition,
      hmServerUrl: this.#hmServerUrl,
      web: this.#web,
      stateDir,
      sessionId: '',
      modelAcceptsImages: false,
      codeExec: this.#codeExec,
      onMemoryChange: () => {
        invalidateSpaceIndex(run.accountId, run.agentId)
        this.#emit({
          type: 'account-change',
          accountId: run.accountId,
          reason: 'agent-memory-changed',
          agentId: run.agentId,
        })
      },
      onToolProgress: (toolName, progress) =>
        emitRunPartial({
          activity: {
            phase: 'tool',
            toolName,
            toolCallId: progress.toolCallId,
            detail: progress.detail,
            outputTail: progress.outputTail,
          },
        }),
      callableTools: enabledCallableTools(definition, codeExecAvailable),
      publishEnabled: publishGrantEnabled(definition),
      startSession: () => {
        throw new APIError(400, 'Detached delegation is not available in scripts; use ctx.delegate')
      },
    }
    const toolDefs = createAgentServicePiTools(piToolContext)
    const toolsByName = new Map(toolDefs.map((def) => [def.name, def]))

    // Journal adapter with caps, backed by run_journal and streamed to runs/<root> subscribers.
    let journalCount =
      this.#db.query<{n: number}, [string]>(`SELECT COUNT(*) AS n FROM run_journal WHERE run_id = ?`).get(run.id)?.n ??
      0
    let journalBytes =
      this.#db
        .query<{b: number | null}, [string]>(`SELECT SUM(LENGTH(entry_cbor)) AS b FROM run_journal WHERE run_id = ?`)
        .get(run.id)?.b ?? 0
    let toolCallCounter = 0

    const outcome = await runWorkflowVM({
      runId: run.id,
      input: (run.input as {input?: unknown} | null)?.input ?? null,
      source: run.sourceText,
      journal: {
        load: () =>
          this.#db
            .query<{entry_cbor: Uint8Array}, [string]>(
              `SELECT entry_cbor FROM run_journal WHERE run_id = ? ORDER BY seq ASC`,
            )
            .all(run.id)
            .map((row) => cbor.decode<WorkflowJournalEntry>(row.entry_cbor)),
        append: (entry) => {
          const encoded = cbor.encode(entry)
          if (
            journalCount + 1 > WORKFLOW_JOURNAL_MAX_ENTRIES ||
            journalBytes + encoded.byteLength > WORKFLOW_JOURNAL_MAX_BYTES
          ) {
            throw {code: 'journal-cap'}
          }
          journalCount += 1
          journalBytes += encoded.byteLength
          const seq = journalCount
          const createdAt = Date.now()
          this.#db.run(`INSERT INTO run_journal (run_id, seq, entry_cbor, created_at) VALUES (?, ?, ?, ?)`, [
            run.id,
            seq,
            encoded,
            createdAt,
          ])
          this.#emit({
            type: 'run-append',
            accountId: run.accountId,
            rootRunId: run.rootRunId,
            entry: {runId: run.id, seq, entry: entry as unknown as Record<string, unknown>, createdAt},
          })
        },
      },
      effects: {
        callTool: async (rawTool, input, description) => {
          // Models occasionally leak the provider's function namespace into tool names
          // (`functions.memory_write`); accept it rather than failing a real workflow over it.
          const tool = rawTool.replace(/^functions\./, '')
          if (!allowedTools.has(normalizeSeedToolName(tool))) {
            const error = new Error(
              `Tool "${tool}" is not available in this workflow. Available: ${[...allowedTools].join(
                ', ',
              )}. Chat-session tools are not callable here — use ctx.plan/ctx.step for progress and ctx.agent for delegation.`,
            ) as Error & {code: string}
            error.code = 'unknown-tool'
            throw error
          }
          const name = normalizeSeedToolName(tool)
          const metadata = getSeedTool(name)
          if (metadata) {
            const inputErrors = validateJsonSchemaValue(metadata.inputSchema, input ?? {})
            if (inputErrors.length > 0) {
              const error = new Error(
                `Invalid input for ${tool}: ${inputErrors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
              ) as Error & {code: string}
              error.code = 'invalid-input'
              throw error
            }
          }
          toolCallCounter += 1
          emitRunPartial({activity: {phase: 'tool', toolName: tool, ...(description ? {detail: description} : {})}})
          try {
            // Callable tools (search, web_search, execute, …) have no standalone provider tool —
            // scripts reach them through the same call-verb dispatch the model uses.
            if (piToolContext.callableTools.includes(name)) {
              const result = await executeCallVerb(
                piToolContext,
                {tool: name, input},
                `wf-${run.id}-${toolCallCounter}`,
              )
              return result
            }
            const def = toolsByName.get(name)
            if (!def) {
              const error = new Error(`Tool "${tool}" has no workflow executor`) as Error & {code: string}
              error.code = 'unknown-tool'
              throw error
            }
            const execute = def.execute as unknown as (
              toolCallId: string,
              params: unknown,
            ) => Promise<{details?: unknown}>
            const result = await execute(`wf-${run.id}-${toolCallCounter}`, input)
            return result.details ?? null
          } finally {
            emitRunPartial({activity: {phase: 'thinking'}})
          }
        },
        spawnAgent: (spec, stepLabel) => this.#spawnWorkflowChildAgent(run, spec, stepLabel),
        awaitChild: async (childRunId): Promise<WorkflowChildResolution> => {
          const child = await this.#awaitRunTerminal(run.accountId, childRunId)
          if (child.status === 'succeeded') {
            return {status: 'succeeded', output: child.output ?? null, sessionId: child.sessionId}
          }
          if (child.status === 'canceled') return {status: 'canceled', sessionId: child.sessionId}
          return {
            status: 'failed',
            error: {code: child.error?.code ?? 'run-failed', message: child.error?.message ?? 'Sub-agent failed'},
            sessionId: child.sessionId,
          }
        },
        updatePlan: (plan) => {
          this.#runQueue.updatePlan(run.id, plan)
        },
        progress: (patch) => emitRunPartial({progress: patch}),
        registerEventWait: (wait) =>
          runEvents.putRunEventWait(this.#db, {
            runId: run.id,
            waitId: wait.waitId,
            accountId: run.accountId,
            match: (isPlainRecord(wait.match) ? wait.match : {}) as runEvents.RunEventMatch,
            ...(wait.timeoutAt === undefined ? {} : {timeoutAt: wait.timeoutAt}),
          }),
      },
      isCanceled: () => this.#workflowCancelFlags.has(run.id),
    })

    if (outcome.type === 'parked') return {type: 'parked', wait: outcome.wait}
    if (outcome.type === 'continued') {
      // The plan settles as a success: this generation finished what it set out to do, and the
      // successor brings its own plan.
      this.#finalizeWorkflowPlan(run, 'succeeded')
      const continuedAsRunId = this.#continueWorkflowAsNew(run, outcome.state)
      return {type: 'succeeded', output: {continued: true, continuedAsRunId}}
    }
    this.#finalizeWorkflowPlan(run, outcome.type)
    if (outcome.type === 'succeeded') return {type: 'succeeded', output: outcome.output}
    if (outcome.type === 'canceled') return {type: 'canceled'}
    return {type: 'failed', error: outcome.error}
  }

  /**
   * Starts the successor of a run that called `ctx.continueAsNew`.
   *
   * The successor is the SAME work, not a child: it keeps the predecessor's place in the run tree
   * (same parent, same session, same tool call to answer) and carries only the state the script
   * declared. What it does not keep is the journal — a fresh run id means a fresh journal, which is
   * the whole point: a loop that runs for weeks never grows an unbounded replay log. Parent linkage
   * is deliberately NOT reused for the chain (nesting each generation under the last would grow the
   * tree without bound and eventually hit the depth limit); the link is `continuedFromRunId` here
   * and `continuedAsRunId` on the predecessor's output.
   */
  #continueWorkflowAsNew(run: runs.RunRecord, state: unknown): string {
    const previousInput = isPlainRecord(run.input) ? run.input : {}
    const successorId = crypto.randomUUID()
    this.#runQueue.enqueue({
      id: successorId,
      accountId: run.accountId,
      kind: 'workflow',
      origin: run.origin,
      ...(run.parentRunId ? {parentRunId: run.parentRunId} : {}),
      ...(run.parentToolCallId ? {parentToolCallId: run.parentToolCallId} : {}),
      continuedFromRunId: run.id,
      ...(run.agentId ? {agentId: run.agentId} : {}),
      ...(run.sessionId ? {sessionId: run.sessionId} : {}),
      ...(run.title ? {title: run.title} : {}),
      ...(run.sourceCid ? {sourceCid: run.sourceCid} : {}),
      ...(run.sourceText ? {sourceText: run.sourceText} : {}),
      input: {
        input: state ?? null,
        ...(typeof previousInput.parentToolCallId === 'string'
          ? {parentToolCallId: previousInput.parentToolCallId}
          : {}),
        ...(typeof previousInput.parentToolName === 'string' ? {parentToolName: previousInput.parentToolName} : {}),
      },
      queue: run.queue,
      ...(run.budget ? {budget: run.budget} : {}),
      maxAttempts: run.maxAttempts,
    })
    console.info('[agents/workflow] continued as new run', {
      runId: run.id,
      successorId,
      accountId: run.accountId,
    })
    return successorId
  }

  /**
   * A terminal run must not advertise live work: steps still 'running' when the workflow ends
   * (a script that returned or died mid-step) coerce to the outcome's truth, and never-started
   * steps become 'skipped'. Without this the progress card spins forever on a finished run.
   */
  #finalizeWorkflowPlan(run: runs.RunRecord, outcomeType: 'succeeded' | 'failed' | 'canceled'): void {
    const current = runs.getRun(this.#db, run.accountId, run.id)
    const plan = current?.plan
    if (!plan || plan.steps.length === 0) return
    let changed = false
    const steps = plan.steps.map((step) => {
      if (step.status === 'running') {
        changed = true
        return {...step, status: outcomeType === 'succeeded' ? ('done' as const) : ('failed' as const)}
      }
      if (step.status === 'pending') {
        changed = true
        return {...step, status: 'skipped' as const}
      }
      return step
    })
    if (changed) this.#runQueue.updatePlan(run.id, {...plan, steps})
  }

  async #stopSession(accountId: string, sessionId: string): Promise<api.StopSessionResponse> {
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')

    // Cancel every live run rooted at this session AND its descendants (spawned sub-sessions),
    // then abort the in-memory Pi run if one is streaming right now.
    const liveRuns = runs.listLiveSessionRuns(this.#db, accountId, sessionId)
    let canceledAny = false
    for (const run of liveRuns) {
      const affected = this.#runQueue.cancelTree(accountId, run.id)
      canceledAny = canceledAny || affected.length > 0
    }
    const running = this.#runningSessions.get(this.#runningSessionKey(accountId, sessionId))
    if (running) {
      running.stopped = true
      await running.abort?.()
      return {_: 'StopSessionResponse', sessionId, stopped: true}
    }
    if (canceledAny) return {_: 'StopSessionResponse', sessionId, stopped: true}

    if (session.status === 'streaming') {
      // Stale mirror with no live run (should not happen post-sweep); re-derive.
      this.#syncSessionStatusFromRuns(accountId, sessionId)
      return {_: 'StopSessionResponse', sessionId, stopped: true}
    }

    return {_: 'StopSessionResponse', sessionId, stopped: false}
  }

  /**
   * Re-runs a failed turn without a new user message: enqueues a fresh interactive run whose
   * transcript replay re-enters from the durable events (error events never reach the provider,
   * and interrupted tool calls were already repaired with synthesized results).
   */
  async #retrySession(accountId: string, sessionId: string): Promise<api.RetrySessionResponse> {
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    if (runs.sessionHasLiveRun(this.#db, sessionId)) throw new APIError(409, 'Session is already streaming')
    const latest = runs.latestSessionRun(this.#db, sessionId)
    if (!latest || latest.status !== 'failed') {
      throw new APIError(400, 'Nothing to retry: the latest run did not fail')
    }
    const run = this.#runQueue.enqueue({
      accountId,
      kind: 'agent',
      origin: 'user',
      agentId: session.agentId,
      sessionId,
      input: {kind: 'session-retry', retryOfRunId: latest.id},
      queue: 'interactive',
      maxAttempts: 1,
      dispatch: false,
    })
    const final = await this.#runQueue.runInline(run.id)
    if (final.status === 'queued') {
      this.#runQueue.cancelTree(accountId, run.id)
      throw new APIError(409, 'Session is already streaming')
    }
    if (final.status === 'succeeded' || final.status === 'canceled') {
      const output = (final.output ?? {}) as {assistantEventId?: string}
      return {_: 'RetrySessionResponse', sessionId, assistantEventId: output.assistantEventId ?? ''}
    }
    if (final.status === 'failed') {
      const error = final.error ?? {code: 'run-failed', message: 'Agent run failed'}
      throw new APIError(error.httpStatus ?? 502, error.message)
    }
    // Parked on sub-sessions: the retried turn continues over WS like any parked turn.
    return {_: 'RetrySessionResponse', sessionId, assistantEventId: ''}
  }

  #runningSessionKey(accountId: string, sessionId: string): string {
    return `${accountId}/${sessionId}`
  }

  /**
   * Model-facing text for a user message. When the client sent rich blocks,
   * embeds resolve to the referenced hypermedia content inlined as markdown;
   * otherwise (or when the blocks are malformed) the flattened text is used.
   */
  async #resolveMessageText(message: {text: string; blocks?: api.AgentMessageBlock[]}): Promise<string> {
    if (!message.blocks?.length) return message.text
    try {
      const resolved = await promptBlocksToResolvedMarkdown(
        message.blocks as HMBlockNode[],
        createSeedClient(this.#hmServerUrl),
      )
      return resolved || message.text
    } catch {
      return message.text
    }
  }

  /** Builds the model-facing system prompt; `stateDir` enables the automatic memory listing. */
  async #agentSystemPrompt(
    accountId: string,
    agentId: string,
    definition: api.AgentDefinition,
    stateDir?: string,
  ): Promise<string> {
    const signingKeys = definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
    const systemPrompt = await promptBlocksToResolvedMarkdown(
      normalizeSystemPromptBlocks(definition.systemPrompt),
      createSeedClient(this.#hmServerUrl),
    )
    const sharedPrompt = seedAssistantSystemPrompt({
      currentTime: new Date().toISOString(),
    })
    const memoryPrompt =
      '\n\nYou have a private persistent memory filesystem shared across all of your sessions, addressed as ~/memory/ through your read and write verbs. Your user can also browse and edit these files. At the start of a task, check memory for relevant notes. Store durable learnings, preferences, and ongoing state as small, well-organized text files (for example ~/memory/notes/topic.md); update files by reading them and writing back the full revised content. `write` with {fromUrl} downloads web files (including binary media) into memory; `read ipfs://<cid>` fetches by CID; `write ipfs://` with {fromPath} publishes a memory file to IPFS and returns an ipfs:// URL you can reference from Hypermedia content. Files your user attaches to a chat message are session-private and are NOT in memory: their metadata appears on the message, and you can read one with `read attachment:<id>` or save it with `write ~/memory/<path>` and {fromAttachment}.'
    const codeExecAvailable = (await this.#codeExec.availability()).available
    const callables = enabledCallableTools(definition, codeExecAvailable)
    const spaceIndex = stateDir
      ? `\n\n${buildSpaceIndex({db: this.#db, accountId, agentId, stateDir, callableTools: callables})}`
      : ''
    const userActionsPrompt =
      '\n\nYour user holds the same verbs you do, on this same conversation log. Entries tagged <user_action>/<user_action_result> are actions the user ran themselves — read their results as shared ground truth you can build on without re-running them.'
    const basePrompt = `${systemPrompt}\n\n${sharedPrompt}${memoryPrompt}${userActionsPrompt}${spaceIndex}`
    if (!signingKeys.length) return basePrompt
    const identities = signingKeys.flatMap((name) => {
      const row = this.#db
        .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
          `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
        )
        .get(accountId, name)
      if (!row?.metadata_cbor) return []
      const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
      if (metadata.kind !== 'hm-account-key') return []
      return [
        {
          name: typeof metadata.label === 'string' ? metadata.label : name,
          publicKey: typeof metadata.accountId === 'string' ? metadata.accountId : name,
        },
      ]
    })
    if (!identities.length) return basePrompt
    return `${basePrompt}\n\n<available_signing_identities>\n${safeJSONStringify(
      identities,
      2,
    )}\n</available_signing_identities>\nWhen signing or creating Seed content, use the publicKey value as the signing identity ID. Users may refer to these identities by profile name.\n\nTo publish a hypermedia document: write {address: "hm://<account>/<path>", content: "<markdown body>", options: {title: "Visible Title", signer: {publicKey: "..."}}}. The title option sets the visible document title — a markdown # heading is body content only. Do not create a document at a nested path unless its parent path already exists as a published document (create "/team" before "/team/notes"; top-level paths are always allowed). To move a document, write the existing hm:// address with options {action: "move", toPath: "/new-path"} ("/" moves it to the account home).`
  }

  /**
   * Resolves an agent definition's provider into a ready-to-use Pi runtime:
   * stored provider config, auth storage (API key, or auto-refreshing OAuth
   * credentials for subscription providers), model registry, and the resolved
   * model. Shared by agent runs and the session-titling call so both honor the
   * provider's auth mode.
   */
  /** Internal alias so helper signatures can name the runtime type (private #-methods cannot be referenced in types). */
  piProviderRuntimeForTitle(accountId: string, definition: api.AgentDefinition) {
    return this.#piProviderRuntime(accountId, definition)
  }

  async #piProviderRuntime(
    accountId: string,
    definition: api.AgentDefinition,
  ): Promise<{
    provider: api.ModelProviderConfig
    authStorage: pi.AuthStorage
    modelRegistry: pi.ModelRegistry
    model: NonNullable<ReturnType<pi.ModelRegistry['find']>>
  }> {
    const providerRow = this.#db
      .query<{config_cbor: Uint8Array}, [string, string]>(
        `SELECT config_cbor FROM model_providers WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, definition.modelProvider)
    if (!providerRow) throw new APIError(400, 'Model provider not found')
    const provider = cbor.decode<api.ModelProviderConfig>(providerRow.config_cbor)
    const spec = providerSpec(provider.type)
    const subscription = provider.authMode === 'subscription'
    const providerName = subscription ? SUBSCRIPTION_PI_PROVIDER_ID : provider.type
    let authStorage: pi.AuthStorage
    let baseUrl: string
    let registerAuth: {apiKey: string} | {oauth: typeof openaiCodexOAuthProvider}
    if (subscription) {
      const oauthSecretName = provider.secretRefs?.oauth
      if (!oauthSecretName) throw new APIError(400, `${provider.type} subscription sign-in is not configured`)
      baseUrl = SUBSCRIPTION_CODEX_BASE_URL
      // Credentials live in AuthStorage (not a runtime api key): Pi re-resolves
      // them per request and auto-refreshes expired access tokens through the
      // shared persisted backend, so rotated tokens are saved for future runs.
      authStorage = pi.AuthStorage.fromStorage(
        await this.#subscriptionAuthBackend(accountId, oauthSecretName, providerName),
      )
      registerAuth = {oauth: openaiCodexOAuthProvider}
      // Resolve (and if needed refresh) the access token up front: an expired or
      // revoked sign-in should fail the run with a clear re-auth message, not a
      // cryptic provider 401 mid-stream.
      const accessToken = await authStorage.getApiKey(providerName)
      if (!accessToken) {
        this.#markOAuthSecretNeedsReauth(accountId, oauthSecretName)
        throw new APIError(
          401,
          'Your OpenAI subscription sign-in has expired or was revoked. Open model provider settings and sign in with ChatGPT again.',
        )
      }
    } else {
      const apiKeySecretName = provider.secretRefs?.apiKey
      if (spec.requireApiKey && !apiKeySecretName) throw new APIError(400, `${providerName} API key is not configured`)
      // Pi's registerProvider expects a non-empty apiKey when models are defined; local
      // servers (Ollama/custom without a key) ignore the value, so pass a placeholder.
      const apiKey = apiKeySecretName
        ? new TextDecoder().decode(await this.#getSecretPlaintext(accountId, apiKeySecretName))
        : 'local'
      baseUrl = resolveProviderBaseUrl(provider.type, provider.baseUrl)
      authStorage = pi.AuthStorage.inMemory()
      authStorage.setRuntimeApiKey(providerName, apiKey)
      registerAuth = {apiKey}
    }
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(providerName, {
      baseUrl,
      ...registerAuth,
      api: subscription ? 'openai-codex-responses' : spec.api,
      models: [piModelForDefinition(provider.type, baseUrl, definition, {subscription})],
    })
    const model = modelRegistry.find(providerName, definition.model)
    if (!model) throw new APIError(400, `Model not found: ${providerName}/${definition.model}`)
    return {provider, authStorage, modelRegistry, model}
  }

  async #runPiAgent(
    accountId: string,
    definition: api.AgentDefinition,
    sessionId: string,
    runningSession?: RunningSession,
    run?: runs.RunRecord,
  ): Promise<api.SessionEvent> {
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    const subSessionOutputSchema = run ? this.#spawnContextForRun(run).spec?.output : undefined
    const {provider, authStorage, modelRegistry, model} = await this.#piProviderRuntime(accountId, definition)

    const cwd = this.#dataDir
    const settingsManager = pi.SettingsManager.inMemory({compaction: {enabled: false}})
    const agentStateDir = this.#agentMemoryStateDir(accountId, session.agentId)
    const resourceLoader = createSeedPiResourceLoader(
      await this.#agentSystemPrompt(accountId, session.agentId, definition, agentStateDir),
    )
    // Agents list execute_code by default; drop it silently when this host cannot run sandboxes
    // (unsupported platform, missing runtime) so the model never sees a tool that can only fail.
    const codeExecAvailable = (await this.#codeExec.availability()).available
    // Touch-expand is durable: any transcript read of ~/tools/<name> (or a call-miss that returned
    // the contract) promotes that callable to a first-class provider tool for the rest of the
    // thread — resume, park, and restart reconstruct the same set from the same events.
    const enabledCallables = enabledCallableTools(definition, codeExecAvailable)
    // SECURITY: promotion must never exceed the enabled callable set — a hallucinated
    // `call {tool: 'bash'}` durably stores that name, and an unfiltered allowlist would hand it
    // to Pi, activating Pi's own host bash/edit builtins outside the sandbox.
    const expandedCallables = this.#expandedCallablesForSession(sessionId)
      .map(normalizeSeedToolName)
      .filter((name) => enabledCallables.includes(name))
    const {session: piSession} = await pi.createAgentSession({
      cwd,
      agentDir: path.join(this.#dataDir, 'pi'),
      model,
      thinkingLevel: definition.reasoningLevel ?? 'off',
      authStorage,
      modelRegistry,
      resourceLoader,
      customTools: createAgentServicePiTools({
        db: this.#db,
        accountId,
        agentId: session.agentId,
        definition,
        hmServerUrl: this.#hmServerUrl,
        web: this.#web,
        stateDir: agentStateDir,
        sessionId,
        modelAcceptsImages: model.input.includes('image'),
        codeExec: this.#codeExec,
        onMemoryChange: () => {
          invalidateSpaceIndex(accountId, session.agentId)
          this.#emit({type: 'account-change', accountId, reason: 'agent-memory-changed', agentId: session.agentId})
        },
        // emitProgress is declared below in this scope; tools only call this mid-run, after it exists.
        onToolProgress: (toolName, progress) =>
          emitProgress({
            activity: {
              phase: 'tool',
              toolName,
              toolCallId: progress.toolCallId,
              detail: progress.detail,
              outputTail: progress.outputTail,
            },
          }),
        setSessionPlan: (plan) => this.#setSessionPlanFromAgent(accountId, sessionId, plan),
        startSession: (input) => this.#startSessionFromAgent(accountId, sessionId, session.agentId, input, run),
        callableTools: enabledCallables,
        publishEnabled: publishGrantEnabled(definition),
        expandedCallables,
        ...this.#subSessionToolContext(
          accountId,
          sessionId,
          session.agentId,
          run,
          runningSession,
          subSessionOutputSchema,
        ),
      }),
      // The verbs are the provider-facing surface; expanded callables are promoted beside them.
      tools: [
        ...expandedCallables,
        seedVerbRegistry.read.name,
        seedVerbRegistry.write.name,
        seedVerbRegistry.call.name,
        // Delegation needs a run to park on; the rare runless invocation simply omits it.
        ...(run !== undefined ? [seedVerbRegistry.delegate.name] : []),
        seedVerbRegistry.plan.name,
        // Typed delegate children must deliver their result through this tool.
        ...(subSessionOutputSchema ? [seedVerbRegistry.return_result.name] : []),
      ],
      noTools: 'builtin',
      sessionManager: pi.SessionManager.inMemory(cwd),
      settingsManager,
    })

    const mergeModelDefaults = provider.modelDefaults
    piSession.agent.onPayload = (payload) => {
      // The next provider request is the tool batch's end: if this turn spawned sub-sessions (park)
      // or delivered its typed result, the turn is over — refuse to send another provider request.
      // Throwing here (caught below as a designed ending) guarantees the request never leaves.
      if (runningSession && (runningSession.parkToolCallIds?.length || runningSession.completeAfterTools)) {
        console.info('[agents/runtime] ending turn after tool batch', {
          sessionId,
          parked: runningSession.parkToolCallIds?.length ?? 0,
          resultDelivered: runningSession.subResult !== undefined,
        })
        throw new SessionParkedError()
      }
      const payloadTools = isRecord(payload) && Array.isArray(payload.tools) ? payload.tools.length : undefined
      console.info('[agents/runtime] sending provider request', {
        sessionId,
        agentId: session.agentId,
        provider: model.provider,
        model: definition.model,
        reasoningLevel: definition.reasoningLevel,
        activeTools: piSession.getActiveToolNames(),
        payloadTools,
      })
      let next = restoreReasoningEffort(payload, definition)
      if (mergeModelDefaults) next = mergePiPayloadDefaults(next, mergeModelDefaults)
      return next
    }
    const replayMessages = this.#piMessages(sessionId)
    // A park-resume after interleaved conversation can end on an assistant message (the late tool
    // results attach adjacent to their calls, earlier in the transcript). Pi cannot continue from
    // an assistant turn, and the model needs direction anyway: hand it back the floor explicitly.
    // In-memory only — never persisted to the transcript.
    const lastReplayed = replayMessages.at(-1) as {role?: string} | undefined
    if (lastReplayed?.role === 'assistant') {
      replayMessages.push({
        role: 'user',
        content:
          '<background_work_update>\nThe background sub-sessions/workflows you were waiting on have finished; their results are attached to their tool calls above. Continue now: act on those results and reply to the user, including anything you promised to deliver once they completed.\n</background_work_update>',
        timestamp: Date.now(),
      })
    }
    piSession.state.messages = replayMessages as never
    let partialId = crypto.randomUUID()
    let partialText = ''
    let currentAssistantHadDelta = false
    let suppressCurrentAssistantEndFallback = false
    let finalError: string | undefined
    let assistantEvent: api.SessionEvent | undefined
    const appendedToolCalls = new Set<string>()
    const toolStartedAt = new Map<string, number>()

    const runStartedAt = Date.now()
    let turnCount = 0
    let streamingLogOpen = false
    const runUsage: api.AgentRunUsage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}
    const logRun = (message: string, fields: Record<string, unknown> = {}): void => {
      console.info(`[agents/runtime] ${message}`, {
        sessionId,
        agentId: session.agentId,
        provider: model.provider,
        model: definition.model,
        ...fields,
      })
    }
    const logRunError = (message: string, fields: Record<string, unknown> = {}): void => {
      console.error(`[agents/runtime] ${message}`, {
        sessionId,
        agentId: session.agentId,
        provider: model.provider,
        model: definition.model,
        ...fields,
      })
    }
    const endStreamingLog = (): void => {
      if (!streamingLogOpen) return
      process.stdout.write('\n')
      streamingLogOpen = false
    }
    /** Emits a non-text progress patch (activity and/or cumulative token usage) for the current partial. */
    const emitProgress = (patch: {activity?: api.AgentRunActivity; usage?: api.AgentRunUsage}): void => {
      this.#emit({type: 'session-partial', accountId, agentId: session.agentId, sessionId, partialId, ...patch})
    }

    // Provenance for the messages this turn produces. The run knows what model answered, on which
    // provider, what the turn cost and how long it took — none of which is recoverable later, so it
    // is stamped on the event as it is written and the transcript stays able to explain itself.
    let turnStartedAt = Date.now()
    let turnUsageForMeta: api.AgentRunUsage | undefined
    const messageMeta = (): api.SessionEventMeta => ({
      ...(definition.model ? {model: definition.model} : {}),
      ...(model.provider ? {provider: model.provider} : {}),
      ...(turnUsageForMeta ? {usage: {...turnUsageForMeta}} : {}),
      durationMs: Math.max(0, Date.now() - turnStartedAt),
    })

    const appendAssistantMessage = (content: string): void => {
      if (!content.trim()) return
      this.#emit({type: 'session-partial', accountId, agentId: session.agentId, sessionId, partialId, done: true})
      assistantEvent = this.#appendSessionEvent(
        accountId,
        session.agentId,
        sessionId,
        {type: 'message', role: 'assistant', content, meta: messageMeta()},
        Date.now(),
      )
      // Text flushed mid-turn (before a tool batch) already spent its share of the clock; the next
      // message is timed from here so no stretch of wall time is counted twice.
      turnStartedAt = Date.now()
      turnUsageForMeta = undefined
      partialId = crypto.randomUUID()
    }

    const flushPartialAssistantMessage = (): void => {
      appendAssistantMessage(partialText)
      partialText = ''
      currentAssistantHadDelta = false
    }

    const unsubscribe = piSession.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        const delta = event.assistantMessageEvent.delta
        if (!currentAssistantHadDelta) {
          logRun('assistant text streaming', {partialId})
          emitProgress({activity: {phase: 'responding'}})
          streamingLogOpen = true
        }
        process.stdout.write(delta)
        partialText += delta
        currentAssistantHadDelta = true
        this.#emit({
          type: 'session-partial',
          accountId,
          agentId: session.agentId,
          sessionId,
          partialId,
          textDelta: delta,
        })
        return
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        endStreamingLog()
        const assistantMessage = event.message as {
          stopReason?: string
          errorMessage?: string
          usage?: {input?: number; output?: number; cacheRead?: number; cacheWrite?: number}
        }
        turnCount += 1
        const turnUsage = assistantMessage.usage
        if (turnUsage) {
          turnUsageForMeta = {
            input: turnUsage.input ?? 0,
            output: turnUsage.output ?? 0,
            cacheRead: turnUsage.cacheRead ?? 0,
            cacheWrite: turnUsage.cacheWrite ?? 0,
            total:
              (turnUsage.input ?? 0) +
              (turnUsage.output ?? 0) +
              (turnUsage.cacheRead ?? 0) +
              (turnUsage.cacheWrite ?? 0),
          }
          runUsage.input += turnUsage.input ?? 0
          runUsage.output += turnUsage.output ?? 0
          runUsage.cacheRead += turnUsage.cacheRead ?? 0
          runUsage.cacheWrite += turnUsage.cacheWrite ?? 0
          runUsage.total = runUsage.input + runUsage.output + runUsage.cacheRead + runUsage.cacheWrite
        }
        logRun('assistant turn complete', {
          turn: turnCount,
          stopReason: assistantMessage.stopReason,
          textChars: partialText.length || piAssistantText(event.message).length,
          tokens: {...runUsage},
        })
        // Usage persists at every turn boundary so a crash loses at most one turn's accounting.
        if (run) this.#runQueue.updateUsage(run.id, {...runUsage})
        emitProgress({usage: {...runUsage}, activity: {phase: 'thinking'}})
        if (assistantMessage.stopReason === 'error' || assistantMessage.stopReason === 'aborted') {
          finalError = assistantMessage.errorMessage || 'Agent run failed'
          logRunError('assistant turn reported error', {stopReason: assistantMessage.stopReason, error: finalError})
          return
        }
        if (currentAssistantHadDelta) flushPartialAssistantMessage()
        else if (!suppressCurrentAssistantEndFallback) appendAssistantMessage(piAssistantText(event.message))
        suppressCurrentAssistantEndFallback = false
        return
      }
      if (event.type === 'tool_execution_start') {
        // Plan updates are session state, not conversation: they render as the checklist, not as tool rows.
        if (event.toolName === seedVerbRegistry.plan.name) return
        endStreamingLog()
        if (currentAssistantHadDelta) {
          flushPartialAssistantMessage()
          suppressCurrentAssistantEndFallback = true
        }
        toolStartedAt.set(event.toolCallId, Date.now())
        logRun('tool call start', {
          tool: event.toolName,
          toolCallId: event.toolCallId,
          input: summarizeForLog(event.args),
        })
        emitProgress({
          activity: {
            phase: 'tool',
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            detail: summarizeToolArgs(event.args),
          },
        })
        appendedToolCalls.add(event.toolCallId)
        this.#appendSessionEvent(
          accountId,
          session.agentId,
          sessionId,
          {type: 'tool_call', id: event.toolCallId, name: event.toolName, input: event.args},
          Date.now(),
        )
        return
      }
      if (event.type === 'tool_execution_end') {
        if (event.toolName === seedVerbRegistry.plan.name) return
        // Parked sub_session calls keep their durable tool_call unanswered: the real tool_result is
        // appended by the child's finalizer, and the resumed turn replays it from there.
        if (runningSession?.parkToolCallIds?.includes(event.toolCallId)) {
          emitProgress({activity: {phase: 'thinking'}})
          return
        }
        const startedAt = toolStartedAt.get(event.toolCallId)
        toolStartedAt.delete(event.toolCallId)
        logRun(event.isError ? 'tool call failed' : 'tool call end', {
          tool: event.toolName,
          toolCallId: event.toolCallId,
          durationMs: startedAt ? Date.now() - startedAt : undefined,
          result: summarizeForLog(event.isError ? piToolResultText(event.result) : piToolResultOutput(event.result)),
        })
        emitProgress({activity: {phase: 'thinking'}})
        if (!appendedToolCalls.has(event.toolCallId)) {
          this.#appendSessionEvent(
            accountId,
            session.agentId,
            sessionId,
            {type: 'tool_call', id: event.toolCallId, name: event.toolName, input: {}},
            Date.now(),
          )
        }
        // How long the tool actually ran, stamped while the start time is still in hand: the pair of
        // event timestamps is a decent guess, but only the executor knows the real span.
        const toolMeta: api.SessionEventMeta | undefined =
          startedAt === undefined ? undefined : {durationMs: Math.max(0, Date.now() - startedAt)}
        this.#appendSessionEvent(
          accountId,
          session.agentId,
          sessionId,
          event.isError
            ? {
                type: 'tool_result',
                toolCallId: event.toolCallId,
                name: event.toolName,
                error: piToolResultText(event.result),
                ...(toolMeta ? {meta: toolMeta} : {}),
              }
            : {
                type: 'tool_result',
                toolCallId: event.toolCallId,
                name: event.toolName,
                output: piToolResultOutput(event.result),
                ...(toolMeta ? {meta: toolMeta} : {}),
              },
          Date.now(),
        )
        return
      }
      if (event.type === 'agent_end') {
        endStreamingLog()
        const lastAssistant = [...event.messages].reverse().find((message) => message.role === 'assistant') as
          | {stopReason?: string; errorMessage?: string}
          | undefined
        if (lastAssistant?.stopReason === 'error' || lastAssistant?.stopReason === 'aborted') {
          finalError = lastAssistant.errorMessage || 'Agent run failed'
          return
        }
      }
    })

    const runningSessionKey = this.#runningSessionKey(accountId, sessionId)
    runningSession ??= {accountId, stopped: false}
    runningSession.abort = () => piSession.abort()
    this.#runningSessions.set(runningSessionKey, runningSession)

    logRun('agent run starting', {activeTools: piSession.getActiveToolNames()})
    emitProgress({activity: {phase: 'starting'}, usage: {...runUsage}})

    try {
      if (runningSession.stopped) throw new SessionStoppedError()
      await piSession.agent.continue()
    } catch (error) {
      endStreamingLog()
      // A park or delivered typed result ends the loop by throwing from onPayload; that (and any
      // error Pi wraps it in) is a designed ending, not a failure — fall through to the end checks.
      const endedByDesign = runningSession.parkToolCallIds?.length || runningSession.completeAfterTools
      if (!endedByDesign) {
        logRunError('agent run threw', {error: error instanceof Error ? error.message : String(error)})
        throw error
      }
      logRun('turn ended after tool batch', {parked: runningSession.parkToolCallIds?.length ?? 0})
    } finally {
      endStreamingLog()
      this.#runningSessions.delete(runningSessionKey)
      unsubscribe()
      piSession.dispose()
      if (run && runUsage.total > 0) this.#runQueue.updateUsage(run.id, {...runUsage})
      logRun('agent run finished', {
        durationMs: Date.now() - runStartedAt,
        turns: turnCount,
        tokens: {...runUsage},
        stopped: runningSession.stopped,
        error: finalError,
      })
    }

    if (runningSession.parkToolCallIds?.length) {
      // The turn ended by design: sub-sessions were spawned and the run parks on them.
      if (partialText.trim()) flushPartialAssistantMessage()
      throw new SessionParkedError()
    }
    if (runningSession.completeAfterTools && runningSession.subResult) {
      // Typed result delivered; the abort that ended the loop is success, not an error.
      if (partialText.trim()) flushPartialAssistantMessage()
      if (assistantEvent) return assistantEvent
      throw new SessionStoppedError()
    }
    if (runningSession.stopped) {
      if (partialText.trim()) flushPartialAssistantMessage()
      if (assistantEvent) return assistantEvent
      throw new SessionStoppedError()
    }
    if (finalError) throw new APIError(502, finalError)
    if (!assistantEvent) throw new APIError(502, 'Pi response did not include assistant text')
    return assistantEvent
  }

  #piMessages(sessionId: string): unknown[] {
    const events = this.#db
      .query<SessionEventRow, [string, number]>(
        `SELECT id, session_id, seq, event_cbor, created_at FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC`,
      )
      .all(sessionId, 0)
      .map(sessionEventRowToInfo)

    // Pass 1 — index every durable tool_result by call id. Providers require tool results to sit
    // DIRECTLY after the assistant message that made the calls, but the durable event order
    // interleaves once a parked parent converses (user turns land between a spawn's tool_call and
    // its late-arriving tool_result). Results are therefore attached at flush time, not replayed
    // positionally.
    type ToolResultEvent = {toolCallId: string; name?: string; output?: unknown; error?: string; createdAt: number}
    const resultsByCallId = new Map<string, ToolResultEvent>()
    const knownCallIds = new Set<string>()
    const userToolCallIds = new Set<string>()
    for (const event of events) {
      const value = event.event as {
        type?: string
        id?: string
        toolCallId?: string
        name?: string
        output?: unknown
        error?: string
      }
      const eventActor = sessionEventActor(event.event as never)
      if (eventActor === 'user') {
        // Track user calls so a stray actor-less result for one (e.g. a pre-fix synthetic) can be
        // recognized and dropped instead of replaying as a provider-illegal orphan.
        if (value.type === 'tool_call') {
          const callId = typeof value.id === 'string' ? value.id : value.toolCallId
          if (callId) userToolCallIds.add(callId)
        }
        continue
      }
      if (value.type === 'tool_call') {
        const callId = typeof value.id === 'string' ? value.id : value.toolCallId
        if (callId) knownCallIds.add(callId)
      }
      if (value.type === 'tool_result' && typeof value.toolCallId === 'string' && value.toolCallId) {
        resultsByCallId.set(value.toolCallId, {
          toolCallId: value.toolCallId,
          name: value.name,
          output: value.output,
          error: value.error,
          createdAt: event.createdAt,
        })
      }
    }
    // Spawn calls whose children are still running: replayed with a synthetic pending result so a
    // new turn on a parked session is provider-legal and the model knows work is in flight. The
    // REAL result is appended durably by the child's finalizer and replayed on later turns.
    const pendingSpawnIds = runs.pendingWaitToolCallIds(this.#db, sessionId)

    const messages: unknown[] = []
    let pendingAssistant: {content: Record<string, unknown>[]; timestamp: number} | undefined
    const appendPendingAssistantContent = (part: Record<string, unknown>, timestamp: number): void => {
      pendingAssistant ??= {content: [], timestamp}
      pendingAssistant.content.push(part)
    }
    const flushPendingAssistant = (): void => {
      if (!pendingAssistant) return
      const hasToolCall = pendingAssistant.content.some((part) => part.type === 'toolCall')
      const toolCalls = pendingAssistant.content.filter((part) => part.type === 'toolCall')
      messages.push({
        role: 'assistant',
        content: pendingAssistant.content,
        api: 'openai-completions',
        provider: 'seed',
        model: 'seed',
        usage: emptyPiUsage(),
        stopReason: hasToolCall ? 'toolUse' : 'stop',
        timestamp: pendingAssistant.timestamp,
      })
      // Results ride directly behind their calls, wherever their durable events actually landed.
      for (const call of toolCalls) {
        const callId = String(call.id)
        const result = resultsByCallId.get(callId)
        if (result) {
          messages.push({
            role: 'toolResult',
            toolCallId: callId,
            toolName: result.name || String(call.name) || seedToolRegistry.read.name,
            content: [{type: 'text', text: result.error ?? JSON.stringify(result.output ?? {})}],
            details: result.output,
            isError: typeof result.error === 'string',
            timestamp: result.createdAt,
          })
        } else if (pendingSpawnIds.has(callId)) {
          messages.push({
            role: 'toolResult',
            toolCallId: callId,
            toolName: String(call.name) || seedToolRegistry.read.name,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'running',
                  note: 'Still running in the background. Its real result will arrive in a later turn as this tool call’s result; do not wait for it — respond to the user now.',
                }),
              },
            ],
            isError: false,
            timestamp: pendingAssistant?.timestamp ?? Date.now(),
          })
        }
      }
      pendingAssistant = undefined
    }

    for (const event of events) {
      const value = event.event as {
        type?: string
        role?: string
        content?: string
        id?: string
        toolCallId?: string
        name?: string
        input?: unknown
        output?: unknown
        error?: string
        contextLines?: unknown
        attachments?: unknown
      }
      const eventActor = sessionEventActor(value as never)
      // Poison guard: an actor-less result answering a USER call (a synthetic from before the
      // synthesizer learned about actors) must not replay as an orphan provider toolResult.
      if (
        value.type === 'tool_result' &&
        eventActor !== 'user' &&
        typeof value.toolCallId === 'string' &&
        userToolCallIds.has(value.toolCallId)
      ) {
        continue
      }
      if (eventActor === 'user' && (value.type === 'tool_call' || value.type === 'tool_result')) {
        // The user acted on the shared log with their own verbs. Provider transcripts have no
        // notion of user-made tool calls, so these replay as tagged user messages the model reads
        // as ground truth.
        flushPendingAssistant()
        if (value.type === 'tool_call') {
          messages.push({
            role: 'user',
            content: `<user_action verb="${value.name ?? ''}">\n${escapeActionFraming(
              ensureToolResultSize(safeJSONStringify(value.input ?? {})),
            )}\n</user_action>`,
            timestamp: event.createdAt,
          })
        } else {
          messages.push({
            role: 'user',
            content: `<user_action_result verb="${value.name ?? ''}">\n${escapeActionFraming(
              ensureToolResultSize(
                value.error !== undefined ? String(value.error) : safeJSONStringify(value.output ?? {}),
              ),
            )}\n</user_action_result>`,
            timestamp: event.createdAt,
          })
        }
        continue
      }
      if (value.type === 'message' && value.role === 'user' && typeof value.content === 'string') {
        flushPendingAssistant()
        // Client context (e.g. the desktop's current window) rides along to the model inside a
        // tagged block, mirroring how trigger context reaches it — but stays out of `content`, so
        // transcripts never render it.
        const contextLines = Array.isArray(value.contextLines)
          ? value.contextLines.filter((line): line is string => typeof line === 'string')
          : []
        let content =
          contextLines.length > 0
            ? `${value.content}\n\n<window_context>\n${contextLines.join('\n')}\n</window_context>`
            : value.content
        // Attachments reach the model as cheap metadata only; content is pulled on demand via the
        // view_attachment tool so images never flood the context uninvited.
        const attachmentBlock = formatAttachmentMetadata(value.attachments)
        if (attachmentBlock) content = `${content}\n\n${attachmentBlock}`
        messages.push({role: 'user', content, timestamp: event.createdAt})
      } else if (value.type === 'message' && value.role === 'assistant' && typeof value.content === 'string') {
        appendPendingAssistantContent({type: 'text', text: value.content}, event.createdAt)
      } else if (value.type === 'tool_call') {
        const toolCallId = typeof value.id === 'string' ? value.id : value.toolCallId
        if (!toolCallId) continue
        appendPendingAssistantContent(
          {
            type: 'toolCall',
            id: toolCallId,
            name: value.name || seedToolRegistry.read.name,
            arguments: isPlainRecord(value.input) ? value.input : {},
          },
          event.createdAt,
        )
      } else if (value.type === 'tool_result') {
        flushPendingAssistant()
        if (typeof value.toolCallId !== 'string' || !value.toolCallId) continue
        // Results with a known call are emitted adjacent to that call at flush time; only orphans
        // (a result whose call event never persisted) keep the legacy inline placement.
        if (knownCallIds.has(value.toolCallId)) continue
        messages.push({
          role: 'toolResult',
          toolCallId: value.toolCallId,
          toolName: value.name || seedToolRegistry.read.name,
          content: [{type: 'text', text: value.error ?? JSON.stringify(value.output ?? {})}],
          details: value.output,
          isError: typeof value.error === 'string',
          timestamp: event.createdAt,
        })
      }
    }
    flushPendingAssistant()
    return messages
  }

  async #getSecretPlaintext(accountId: string, name: string): Promise<Uint8Array> {
    const row = this.#db
      .query<{ciphertext: Uint8Array}, [string, string]>(
        `SELECT ciphertext FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, name)
    if (!row) throw new APIError(400, 'Required secret is not configured')
    return decryptSecret(this.#db, row.ciphertext)
  }

  #appendSessionEvent(
    accountId: string,
    agentId: string,
    sessionId: string,
    event: api.SessionEventPayload,
    now: number,
  ): api.SessionEvent {
    const seq =
      this.#db
        .query<{seq: number}, [string]>(
          `SELECT COALESCE(MAX(seq), 0) + 1 as seq FROM session_events WHERE session_id = ?`,
        )
        .get(sessionId)?.seq ?? 1
    const id = crypto.randomUUID()
    this.#db.run(`INSERT INTO session_events (id, session_id, seq, event_cbor, created_at) VALUES (?, ?, ?, ?, ?)`, [
      id,
      sessionId,
      seq,
      cbor.encode(event),
      now,
    ])
    const info = {id, sessionId, seq, event, createdAt: now}
    this.#emit({type: 'session-event', accountId, agentId, event: info})
    this.#emit({type: 'account-change', accountId, reason: 'session-event', agentId, sessionId})
    return info
  }

  #updateSessionStatus(accountId: string, sessionId: string, status: api.SessionInfo['status'], now: number): void {
    this.#db.run(`UPDATE sessions SET status = ?, updated_at = ? WHERE account_id = ? AND id = ?`, [
      status,
      now,
      accountId,
      sessionId,
    ])
    const session = this.#getSessionInfo(accountId, sessionId)
    if (session) this.#emit({type: 'session-change', accountId, session})
  }

  #emit(event: ServiceEvent): void {
    this.#onEvent?.(event)
  }

  async #getSession(accountId: string, sessionId: string, afterSeq?: number): Promise<api.GetSessionResponse> {
    if (afterSeq !== undefined && (!Number.isInteger(afterSeq) || afterSeq < 0)) {
      throw new APIError(400, 'afterSeq must be a non-negative integer')
    }
    const session = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT id, account_id, agent_id, title, status, parent_session_id, run_id, plan_cbor,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = sessions.id) AS child_count,
                created_at, updated_at
         FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')

    const events = this.#db
      .query<SessionEventRow, [string, number]>(
        `SELECT id, session_id, seq, event_cbor, created_at
         FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC`,
      )
      .all(sessionId, afterSeq ?? 0)

    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, session.agent_id)
    if (!agent) throw new APIError(404, 'Agent not found')
    const definition = normalizeDefinition(cbor.decode<api.AgentDefinition>(agent.definition_cbor))
    const triggerContext = this.#getSessionTriggerContext(accountId, sessionId)
    return {
      _: 'GetSessionResponse',
      session: sessionRowToInfo(session, triggerContext ?? undefined),
      events: events.map(sessionEventRowToInfo),
      systemPromptMarkdown: await this.#agentSystemPrompt(accountId, agent.id, definition, agent.state_dir),
      ...(triggerContext ? {triggerContext} : {}),
    }
  }

  async #withIdempotency<T extends api.AgentResponse>(
    accountId: string,
    action: string,
    clientRequestId: string | undefined,
    request: unknown,
    create: () => T | Promise<T>,
  ): Promise<T> {
    const normalizedId =
      clientRequestId === undefined
        ? undefined
        : normalizeBoundedString(clientRequestId, 'Client request ID', MAX_NAME_BYTES)
    const requestCBOR = normalizedId === undefined ? undefined : cbor.encode(request)

    this.#db.run('BEGIN IMMEDIATE')
    try {
      if (normalizedId !== undefined && requestCBOR !== undefined) {
        const existing = this.#db
          .query<{request_cbor: Uint8Array; response_cbor: Uint8Array}, [string, string, string]>(
            `SELECT request_cbor, response_cbor FROM action_idempotency WHERE account_id = ? AND action = ? AND client_request_id = ?`,
          )
          .get(accountId, action, normalizedId)
        if (existing) {
          if (!bytesEqual(existing.request_cbor, requestCBOR))
            throw new APIError(409, 'Client request ID payload mismatch')
          this.#db.run('COMMIT')
          return cbor.decode<T>(existing.response_cbor)
        }
      }

      const response = await create()
      if (normalizedId !== undefined && requestCBOR !== undefined) {
        this.#db.run(
          `INSERT INTO action_idempotency (account_id, action, client_request_id, request_cbor, response_cbor, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [accountId, action, normalizedId, requestCBOR, cbor.encode(response), Date.now()],
        )
      }
      this.#db.run('COMMIT')
      return response
    } catch (error) {
      this.#db.run('ROLLBACK')
      throw error
    }
  }

  /** Verifies a signed Subscribe envelope and returns replay data for the subscribed key. */
  async verifySubscription(envelope: api.SignedActionEnvelope): Promise<{
    accountId: string
    key: string
    replay?: api.GetSessionResponse
    /** Snapshot + durable journal replay for `runs/<rootRunId>` subscriptions. */
    runsReplay?: {runs: api.RunInfo[]; entries: api.RunJournalEntryInfo[]}
  }> {
    let verified: auth.VerifiedEnvelope
    try {
      verified = auth.verifyEnvelope(this.#db, envelope)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid signed envelope'
      throw new APIError(401, message)
    }
    if (envelope.action._ !== 'Subscribe') throw new APIError(400, 'Expected Subscribe action')
    const key = envelope.action.key
    if (key === `account/${verified.accountId}`) return {accountId: verified.accountId, key}
    const agentMatch = /^agents\/([^/]+)$/.exec(key)
    if (agentMatch) {
      const agentId = agentMatch[1]
      if (!agentId) throw new APIError(400, 'Subscription key is invalid')
      const agent = this.#getAgentInfo(verified.accountId, agentId)
      if (!agent) throw new APIError(404, 'Agent not found')
      return {accountId: verified.accountId, key}
    }
    const sessionMatch = /^sessions\/([^/]+)$/.exec(key)
    if (sessionMatch) {
      const sessionId = sessionMatch[1]
      if (!sessionId) throw new APIError(400, 'Subscription key is invalid')
      const replay = await this.#getSession(verified.accountId, sessionId, envelope.action.afterSeq)
      return {accountId: verified.accountId, key, replay}
    }
    const runMatch = /^runs\/([^/]+)$/.exec(key)
    if (runMatch) {
      const rootRunId = runMatch[1]
      if (!rootRunId) throw new APIError(400, 'Subscription key is invalid')
      const root = runs.getRun(this.#db, verified.accountId, rootRunId)
      if (!root) throw new APIError(404, 'Run not found')
      const tree = runs.listRunTree(this.#db, verified.accountId, root.rootRunId)
      const afterSeq = envelope.action.afterSeq
      const entries: api.RunJournalEntryInfo[] = []
      for (const run of tree) {
        entries.push(...this.#getRunJournal(verified.accountId, run.id, afterSeq).entries)
      }
      return {
        accountId: verified.accountId,
        key,
        runsReplay: {runs: tree.map(runInfoFromRecord), entries},
      }
    }
    throw new APIError(400, 'Subscription key is not authorized')
  }

  #getAgentInfo(accountId: string, agentId: string): api.AgentInfo | null {
    const agent = this.#db
      .query<AgentRow, [string, string]>(
        `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
         FROM agents WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, agentId)
    return agent ? agentRowToInfo(agent) : null
  }

  #getAgentTriggerInfo(accountId: string, triggerId: string): api.AgentTriggerInfo | null {
    const trigger = this.#db
      .query<AgentTriggerRow, [string, string]>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, continuation_cbor, created_at, updated_at,
                last_checked_at, last_fired_at, last_error
         FROM agent_triggers WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, triggerId)
    return trigger ? agentTriggerRowToInfo(trigger) : null
  }

  #getSessionInfo(accountId: string, sessionId: string): api.SessionInfo | null {
    const session = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT id, account_id, agent_id, title, status, parent_session_id, run_id, plan_cbor,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = sessions.id) AS child_count,
                created_at, updated_at
         FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    return session ? sessionRowToInfo(session, this.#getSessionTriggerContext(accountId, sessionId) ?? undefined) : null
  }

  #sessionRowsToInfo(accountId: string, sessions: SessionRow[]): api.SessionInfo[] {
    return sessions.map((session) =>
      sessionRowToInfo(session, this.#getSessionTriggerContext(accountId, session.id) ?? undefined),
    )
  }

  #getSessionTriggerContext(accountId: string, sessionId: string): api.AgentSessionTriggerContext | null {
    const row = this.#db
      .query<SessionTriggerRow, [string, string]>(
        `SELECT f.id AS firing_id, f.trigger_id, f.activity_key, f.activity_cbor, f.status, f.error,
                f.created_at AS fired_at, t.name AS trigger_name, t.source_cbor, t.prompt
         FROM trigger_firings f
         JOIN agent_triggers t ON t.id = f.trigger_id
         WHERE f.account_id = ? AND f.session_id = ?
         ORDER BY f.created_at ASC
         LIMIT 1`,
      )
      .get(accountId, sessionId)
    if (!row) return null
    const activity = cbor.decode<activityTriggers.ActivityFeedEvent>(row.activity_cbor)
    return {
      triggerId: row.trigger_id,
      triggerName: row.trigger_name,
      firingId: row.firing_id,
      activityKey: row.activity_key,
      activitySummary: activityTriggers.activitySummary(activity),
      source: cbor.decode<api.AgentTriggerSource>(row.source_cbor),
      firedAt: row.fired_at,
      prompt: promptBlocksToMarkdown(parseStoredPromptBlocks(row.prompt)),
      promptBlocks: parseStoredPromptBlocks(row.prompt),
      activity,
      status: row.status,
      ...(row.error ? {error: row.error} : {}),
    }
  }

  #requireAgent(accountId: string, agentId: string): void {
    const agent = this.#db
      .query<{id: string}, [string, string]>(`SELECT id FROM agents WHERE account_id = ? AND id = ?`)
      .get(accountId, agentId)
    if (!agent) throw new APIError(404, 'Agent not found')
  }

  /** Evaluates due schedule triggers and creates matching sessions. */
  async processScheduledTriggers(now = Date.now()): Promise<TriggerProcessingResult> {
    const rows = this.#db
      .query<AgentTriggerRow, []>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, continuation_cbor, created_at, updated_at,
                last_checked_at, last_fired_at, last_error
         FROM agent_triggers
         WHERE enabled = 1
         ORDER BY created_at ASC`,
      )
      .all()
    let checked = 0
    let matched = 0
    let fired = 0
    let skipped = 0
    let errors = 0
    for (const row of rows) {
      const trigger = agentTriggerRowToInfo(row)
      if (trigger.source.type !== 'schedule') continue
      checked += 1
      this.#db.run(`UPDATE agent_triggers SET last_checked_at = ? WHERE account_id = ? AND id = ?`, [
        now,
        trigger.account,
        trigger.id,
      ])
      const occurrence = scheduleTriggers.dueOccurrence(trigger, now)
      if (!occurrence) continue
      matched += 1
      const firingId = crypto.randomUUID()
      const inserted = this.#db.run(
        `INSERT OR IGNORE INTO trigger_firings
           (id, account_id, agent_id, trigger_id, activity_key, activity_cbor, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          firingId,
          trigger.account,
          trigger.agentId,
          trigger.id,
          occurrence.activityKey,
          cbor.encode(occurrence.activity),
          'created',
          now,
        ],
      )
      if (inserted.changes === 0) {
        skipped += 1
        continue
      }
      try {
        if (trigger.continuation?.kind === 'wake') {
          if (this.#wakeFromTrigger(trigger.account, trigger, firingId, occurrence.activity)) fired += 1
          else skipped += 1
          continue
        }
        const session = this.#createSessionOnce(
          trigger.account,
          trigger.agentId,
          `${trigger.name} — ${occurrence.summary}`,
        )
        this.#db.run(`UPDATE trigger_firings SET session_id = ? WHERE account_id = ? AND id = ?`, [
          session.sessionId,
          trigger.account,
          firingId,
        ])
        // Disable a 'once' schedule at fire time (session created), not after the run, so a slow run
        // can't let the same occurrence fire twice.
        this.#db.run(
          `UPDATE agent_triggers SET last_fired_at = ?, last_error = NULL, enabled = CASE WHEN ? THEN 0 ELSE enabled END WHERE account_id = ? AND id = ?`,
          // The caller's clock, not Date.now(): mixing the injected timestamp with the wall clock
          // makes a firing in the same millisecond as trigger creation eligible to re-match.
          [
            Math.max(now, occurrence.scheduledAt),
            trigger.source.schedule.kind === 'once' ? 1 : 0,
            trigger.account,
            trigger.id,
          ],
        )
        fired += 1
        // Run the agent in the background; the session already exists for this occurrence.
        this.#dispatchTriggerSession(trigger.account, trigger, firingId, session.sessionId, occurrence.activity)
      } catch (error) {
        errors += 1
        const message = error instanceof Error ? error.message : 'Trigger firing failed'
        this.#db.run(`UPDATE trigger_firings SET status = ?, error = ? WHERE account_id = ? AND id = ?`, [
          'error',
          message,
          trigger.account,
          firingId,
        ])
        this.#db.run(`UPDATE agent_triggers SET last_error = ? WHERE account_id = ? AND id = ?`, [
          message,
          trigger.account,
          trigger.id,
        ])
      }
    }
    return {checked, matched, fired, skipped, errors}
  }

  /** Evaluates one HM activity event against enabled triggers for an account and creates matching sessions. */
  async processActivityEvent(
    accountId: string,
    event: activityTriggers.ActivityFeedEvent,
  ): Promise<TriggerProcessingResult> {
    // A parked run listening for this event is woken first: it is work already underway, and it
    // does not care whether the event also fires somebody's trigger.
    this.#deliverActivityToRunWaits(accountId, event)
    const activityKey = activityTriggers.activityEventKey(event)
    if (!activityKey) {
      console.log('[Agents Trigger] Skipping activity without stable key', {
        accountId,
        activity: activityTriggers.activityDebugInfo(event),
      })
      return {checked: 0, matched: 0, fired: 0, skipped: 1, errors: 0}
    }
    // Deduplicate firings on the comment's origin CID so the comment event and its citation twin (the
    // two feed events HM emits for one @mention) collapse to a single firing. See activityFiringKey.
    const firingKey = activityTriggers.activityFiringKey(event) ?? activityKey
    const rows = this.#db
      .query<AgentTriggerRow, [string]>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, continuation_cbor, created_at, updated_at,
                last_checked_at, last_fired_at, last_error
         FROM agent_triggers
         WHERE account_id = ? AND enabled = 1
         ORDER BY created_at ASC`,
      )
      .all(accountId)
    const now = Date.now()
    let checked = 0
    let matched = 0
    let fired = 0
    let skipped = 0
    let errors = 0
    for (const row of rows) {
      const trigger = agentTriggerRowToInfo(row)
      if (trigger.source.type === 'schedule') continue
      checked += 1
      this.#db.run(`UPDATE agent_triggers SET last_checked_at = ? WHERE account_id = ? AND id = ?`, [
        now,
        accountId,
        trigger.id,
      ])
      const matches = activityTriggers.activityMatchesTriggerSource(trigger.source, event)
      console.log('[Agents Trigger] Checked activity against trigger', {
        accountId,
        triggerId: trigger.id,
        triggerName: trigger.name,
        source: trigger.source,
        activity: activityTriggers.activityDebugInfo(event),
        matches,
      })
      if (!matches) continue
      matched += 1
      const firingId = crypto.randomUUID()
      const inserted = this.#db.run(
        `INSERT OR IGNORE INTO trigger_firings
           (id, account_id, agent_id, trigger_id, activity_key, activity_cbor, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [firingId, accountId, trigger.agentId, trigger.id, firingKey, cbor.encode(event), 'created', now],
      )
      if (inserted.changes === 0) {
        console.log('[Agents Trigger] Skipping duplicate trigger firing', {
          accountId,
          triggerId: trigger.id,
          activityKey,
          firingKey,
        })
        skipped += 1
        continue
      }
      try {
        if (trigger.continuation?.kind === 'wake') {
          if (this.#wakeFromTrigger(accountId, trigger, firingId, event)) fired += 1
          else skipped += 1
          continue
        }
        const session = this.#createSessionOnce(
          accountId,
          trigger.agentId,
          `${trigger.name} — ${activityTriggers.activitySummary(event)}`,
        )
        this.#db.run(`UPDATE trigger_firings SET session_id = ? WHERE account_id = ? AND id = ?`, [
          session.sessionId,
          accountId,
          firingId,
        ])
        this.#db.run(`UPDATE agent_triggers SET last_fired_at = ?, last_error = NULL WHERE account_id = ? AND id = ?`, [
          Date.now(),
          accountId,
          trigger.id,
        ])
        fired += 1
        console.log('[Agents Trigger] Fired trigger and created session', {
          accountId,
          triggerId: trigger.id,
          activityKey,
          sessionId: session.sessionId,
        })
        // Run the agent in the background: the session already exists (so every matching trigger has a
        // session), and a slow/hung agent run must not block the poll loop or other triggers.
        this.#dispatchTriggerSession(accountId, trigger, firingId, session.sessionId, event)
      } catch (error) {
        errors += 1
        const message = error instanceof Error ? error.message : 'Trigger firing failed'
        this.#db.run(`UPDATE trigger_firings SET status = ?, error = ? WHERE account_id = ? AND id = ?`, [
          'error',
          message,
          accountId,
          firingId,
        ])
        this.#db.run(`UPDATE agent_triggers SET last_error = ? WHERE account_id = ? AND id = ?`, [
          message,
          accountId,
          trigger.id,
        ])
        console.error('[Agents Trigger] Trigger firing failed', {
          accountId,
          triggerId: trigger.id,
          activityKey,
          error: message,
        })
      }
    }
    return {checked, matched, fired, skipped, errors}
  }

  /**
   * A trigger whose continuation is `wake`: instead of starting a thread, it answers a run that is
   * already parked on `ctx.waitForEvent`.
   *
   * This rides the SignalRun delivery path unchanged, so a trigger-sent signal has exactly the
   * properties a hand-sent one does — one transaction, exactly once, and "nobody was listening" as
   * a normal outcome rather than an error. Without an explicit `runId` it looks for any parked run
   * of this account whose wait this signal satisfies, which is what makes "when the doc changes,
   * unblock whoever is waiting on it" expressible without knowing run ids in advance.
   */
  #wakeFromTrigger(
    accountId: string,
    trigger: api.AgentTriggerInfo,
    firingId: string,
    event: activityTriggers.ActivityFeedEvent,
  ): boolean {
    const continuation = trigger.continuation
    if (continuation?.kind !== 'wake') return false
    const delivery: runEvents.RunEventDelivery = {
      source: 'trigger',
      signal: continuation.signal,
      payload: continuation.payload === undefined ? event : continuation.payload,
    }
    const candidates = continuation.runId
      ? runEvents.listRunEventWaits(this.#db, continuation.runId)
      : runEvents.listAccountEventWaits(this.#db, accountId)
    for (const wait of candidates) {
      if (!runEvents.signalMatchesWait(wait.match, continuation.signal)) continue
      const run = runs.getRun(this.#db, accountId, wait.runId)
      if (!run) continue
      if (!this.#deliverRunEvent(run, wait.waitId, delivery)) continue
      this.#db.run(`UPDATE trigger_firings SET status = ?, session_id = NULL WHERE account_id = ? AND id = ?`, [
        'delivered',
        accountId,
        firingId,
      ])
      this.#db.run(`UPDATE agent_triggers SET last_fired_at = ?, last_error = NULL WHERE account_id = ? AND id = ?`, [
        Date.now(),
        accountId,
        trigger.id,
      ])
      console.info('[Agents Trigger] Trigger woke a parked run', {
        accountId,
        triggerId: trigger.id,
        runId: wait.runId,
        signal: continuation.signal,
      })
      return true
    }
    // Nobody was listening. The firing row records that honestly rather than being deleted, so the
    // history shows the trigger fired and found no one — which is what a user needs to debug it.
    this.#db.run(`UPDATE trigger_firings SET status = ? WHERE account_id = ? AND id = ?`, [
      'no-listener',
      accountId,
      firingId,
    ])
    console.info('[Agents Trigger] Trigger fired with no run listening', {
      accountId,
      triggerId: trigger.id,
      signal: continuation.signal,
    })
    return false
  }

  /**
   * Fires `run-completed` triggers for a run that just reached a terminal status — the source that
   * lets one automation start the next.
   *
   * Runs inline on the finalize path (no new monitor, no new poll): finalization is already the one
   * moment that knows a run is done. Every firing is deduped on the run id, so a replayed or
   * re-finalized run cannot fire the same trigger twice.
   */
  #fireRunCompletedTriggers(run: runs.RunRecord): void {
    if (!runs.TERMINAL_RUN_STATUSES.includes(run.status)) return
    const rows = this.#db
      .query<AgentTriggerRow, [string]>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, continuation_cbor, created_at, updated_at,
                last_checked_at, last_fired_at, last_error
         FROM agent_triggers WHERE account_id = ? AND enabled = 1 ORDER BY created_at ASC`,
      )
      .all(run.accountId)
    const event: activityTriggers.ActivityFeedEvent = {
      type: 'run-completed',
      runId: run.id,
      runTitle: run.title ?? '',
      runStatus: run.status,
      agentId: run.agentId ?? '',
      ...(run.sessionId ? {sessionId: run.sessionId} : {}),
    }
    for (const row of rows) {
      const trigger = agentTriggerRowToInfo(row)
      if (trigger.source.type !== 'run-completed') continue
      if (!matchesRunCompleted(trigger.source, run)) continue
      if (this.#triggerAlreadyInChain(run, trigger.id)) {
        console.info('[Agents Trigger] Skipping run-completed trigger already in this chain', {
          accountId: run.accountId,
          triggerId: trigger.id,
          runId: run.id,
        })
        continue
      }
      const firingId = crypto.randomUUID()
      const inserted = this.#db.run(
        `INSERT OR IGNORE INTO trigger_firings
           (id, account_id, agent_id, trigger_id, activity_key, activity_cbor, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          firingId,
          run.accountId,
          trigger.agentId,
          trigger.id,
          `run:${run.id}`,
          cbor.encode(event),
          'created',
          Date.now(),
        ],
      )
      if (inserted.changes === 0) continue
      try {
        if (trigger.continuation?.kind === 'wake') {
          this.#wakeFromTrigger(run.accountId, trigger, firingId, event)
          continue
        }
        const session = this.#createSessionOnce(
          run.accountId,
          trigger.agentId,
          `${trigger.name} — ${activityTriggers.activitySummary(event)}`,
        )
        this.#db.run(`UPDATE trigger_firings SET session_id = ? WHERE account_id = ? AND id = ?`, [
          session.sessionId,
          run.accountId,
          firingId,
        ])
        this.#db.run(`UPDATE agent_triggers SET last_fired_at = ?, last_error = NULL WHERE account_id = ? AND id = ?`, [
          Date.now(),
          run.accountId,
          trigger.id,
        ])
        this.#dispatchTriggerSession(run.accountId, trigger, firingId, session.sessionId, event)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Trigger firing failed'
        this.#db.run(`UPDATE trigger_firings SET status = ?, error = ? WHERE account_id = ? AND id = ?`, [
          'error',
          message,
          run.accountId,
          firingId,
        ])
        this.#db.run(`UPDATE agent_triggers SET last_error = ? WHERE account_id = ? AND id = ?`, [
          message,
          run.accountId,
          trigger.id,
        ])
      }
    }
  }

  /**
   * Has this trigger already fired somewhere in the chain that produced this run?
   *
   * Two run-completed triggers can otherwise feed each other forever: A finishes, B fires, B's run
   * finishes, A fires. Walking back through the firings that caused each run catches that cycle at
   * any length up to the cap, and the cap catches anything longer — a chain deeper than this is a
   * loop whether or not it repeats a trigger id.
   */
  #triggerAlreadyInChain(run: runs.RunRecord, triggerId: string): boolean {
    let current: runs.RunRecord | null = run
    for (let hop = 0; hop < TRIGGER_CHAIN_MAX_HOPS && current?.triggerFiringId; hop += 1) {
      const firing = this.#db
        .query<{trigger_id: string; activity_cbor: Uint8Array}, [string]>(
          `SELECT trigger_id, activity_cbor FROM trigger_firings WHERE id = ?`,
        )
        .get(current.triggerFiringId)
      if (!firing) return false
      if (firing.trigger_id === triggerId) return true
      // A run-completed firing names the run that caused it, which is how the walk continues.
      const activity = cbor.decode<{runId?: unknown}>(firing.activity_cbor)
      const sourceRunId = typeof activity?.runId === 'string' ? activity.runId : undefined
      current = sourceRunId ? runs.getRun(this.#db, run.accountId, sourceRunId) : null
    }
    // Ran out of hops with the trigger not yet seen: treat a chain this deep as a loop.
    return !!current?.triggerFiringId
  }

  /**
   * Builds the trigger prompt and runs the agent for an already-created session, in the BACKGROUND.
   *
   * Never awaited by the poll loop, so a slow or hung agent run (a "session taking a long time to
   * respond") can't stall trigger polling or other triggers. It runs at most once per firing: the
   * caller only reaches here after winning the firing's `INSERT OR IGNORE`, and {@link #messageSessionOnce}
   * rejects a second concurrent run of the same session — so we never create duplicate work for one
   * matching trigger. A failure records the error on the firing/trigger but leaves the already-created
   * session in place.
   */
  #dispatchTriggerSession(
    accountId: string,
    trigger: api.AgentTriggerInfo,
    firingId: string,
    sessionId: string,
    activity: activityTriggers.ActivityFeedEvent,
  ): void {
    const dispatch = (async () => {
      try {
        const content = await triggerPromptMessage(trigger, firingId, activity, createSeedClient(this.#hmServerUrl))
        // Exactly-once: the run id derives from the firing id, so a duplicate dispatch is a no-op insert.
        await this.#messageSessionOnce(accountId, sessionId, content, {
          origin: 'trigger',
          background: true,
          runId: `firing-${firingId}`,
          triggerFiringId: firingId,
        })
        console.log('[Agents Trigger] Trigger session run enqueued', {
          accountId,
          triggerId: trigger.id,
          sessionId,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Trigger session run failed'
        this.#db.run(`UPDATE trigger_firings SET status = ?, error = ? WHERE account_id = ? AND id = ?`, [
          'error',
          message,
          accountId,
          firingId,
        ])
        this.#db.run(`UPDATE agent_triggers SET last_error = ? WHERE account_id = ? AND id = ?`, [
          message,
          accountId,
          trigger.id,
        ])
        console.error('[Agents Trigger] Trigger session dispatch failed', {
          accountId,
          triggerId: trigger.id,
          sessionId,
          error: message,
        })
      }
    })()
    this.#pendingTriggerSessions.add(dispatch)
    void dispatch.finally(() => this.#pendingTriggerSessions.delete(dispatch))
  }

  /**
   * Awaits in-flight background dispatch setup AND the run queue going idle, so tests and graceful
   * shutdown observe every enqueued run's completion. Runs enqueued after the snapshot are covered
   * by the queue-idle wait as long as they were enqueued before it resolves.
   */
  async drainTriggerSessions(): Promise<void> {
    await Promise.allSettled([...this.#pendingTriggerSessions])
    await this.#runQueue.awaitIdle()
  }

  /** Alias for {@link drainTriggerSessions} under the name the runs feature documents. */
  async awaitQueueIdle(): Promise<void> {
    await this.drainTriggerSessions()
  }

  #ensureAccount(accountId: string, now: number): void {
    this.#db.run(
      `INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      [accountId, now, now],
    )
  }
}

type AgentRow = {
  id: string
  account_id: string
  definition_cbor: Uint8Array
  state_dir: string
  status: api.AgentInfo['status']
  created_at: number
  updated_at: number
}

type AgentTriggerRow = {
  id: string
  account_id: string
  agent_id: string
  name: string
  enabled: number
  source_cbor: Uint8Array
  prompt: string
  continuation_cbor: Uint8Array | null
  created_at: number
  updated_at: number
  last_checked_at: number | null
  last_fired_at: number | null
  last_error: string | null
}

type SessionRow = {
  id: string
  account_id: string
  agent_id: string
  title: string | null
  status: api.SessionInfo['status']
  parent_session_id: string | null
  run_id: string | null
  plan_cbor: Uint8Array | null
  child_count: number
  created_at: number
  updated_at: number
}

type SessionEventRow = {
  id: string
  session_id: string
  seq: number
  event_cbor: Uint8Array
  created_at: number
}

type SessionTriggerRow = {
  firing_id: string
  trigger_id: string
  activity_key: string
  activity_cbor: Uint8Array
  status: string
  error: string | null
  fired_at: number
  trigger_name: string
  source_cbor: Uint8Array
  prompt: string
}

async function publishSigningIdentityProfile(
  hmServerUrl: string,
  keyPair: blobs.NobleKeyPair,
  name: string,
  avatar?: string,
): Promise<void> {
  const profile = await blobs.createProfile(keyPair, {name, avatar}, Date.now())
  await createSeedClient(hmServerUrl).publish({blobs: [{cid: profile.cid.toString(), data: profile.data}]})
}

/** Extracts a bare CID from a bare CID, an ipfs://<cid> URI, or a gateway URL containing /ipfs/<cid>. */
function parseIpfsCid(raw: unknown): string {
  const input = typeof raw === 'string' ? raw.trim() : ''
  if (!input) throw new APIError(400, 'An IPFS CID or ipfs:// URL is required')
  let cid = input
  if (cid.startsWith('ipfs://')) cid = cid.slice('ipfs://'.length)
  else {
    const gatewayMatch = cid.match(/\/ipfs\/([^/?#]+)/)
    if (gatewayMatch?.[1]) cid = gatewayMatch[1]
  }
  cid = cid.split(/[/?#]/, 1)[0] ?? ''
  if (!/^[A-Za-z0-9]{32,}$/.test(cid)) throw new APIError(400, `Not a valid IPFS CID: ${input}`)
  return cid
}

/**
 * Uploads raw bytes to the HM node's public IPFS file-upload endpoint and returns the resulting
 * CID plus its `ipfs://<cid>` URI for use in Hypermedia content.
 */
async function uploadBytesToHmIpfs(
  hmServerUrl: string,
  data: Uint8Array,
  mimeType?: string,
  fileName?: string,
): Promise<{cid: string; url: string}> {
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(data)], mimeType ? {type: mimeType} : undefined)
  formData.append('file', blob, fileName || 'file')
  const response = await fetch(`${hmServerUrl.replace(/\/$/, '')}/ipfs/file-upload`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw new APIError(502, `IPFS upload failed with status ${response.status}`)
  }
  const cid = (await response.text()).trim()
  if (!cid) throw new APIError(502, 'IPFS upload returned an empty CID')
  return {cid, url: `ipfs://${cid}`}
}

/**
 * Uploads raw avatar bytes to the HM node's public IPFS file-upload endpoint and
 * returns the resulting `ipfs://<cid>` URI for use as a profile avatar.
 */
async function uploadIconToHmNode(hmServerUrl: string, icon: api.SigningIdentityIcon): Promise<string> {
  const {url} = await uploadBytesToHmIpfs(
    hmServerUrl,
    new Uint8Array(icon.data),
    icon.mimeType,
    icon.fileName || 'icon',
  )
  return url
}

async function publishSigningIdentityProfileAndHome(
  hmServerUrl: string,
  keyPair: blobs.NobleKeyPair,
  name: string,
): Promise<void> {
  const now = Date.now()
  const accountId = blobs.principalToString(keyPair.principal)
  const signer: HMSigner = {
    getPublicKey: async () => keyPair.principal,
    sign: (data) => keyPair.sign(data),
  }
  const profile = await blobs.createProfile(keyPair, {name}, now)
  const {tree} = parseMarkdown('This is an agentic account.')
  const ops = metadataToWriteSetAttributes({name}).concat(flattenToOperations(tree))
  const genesisBlock = await createGenesisChange(signer)
  const {unsignedBytes, ts} = createChangeOps({ops, genesisCid: genesisBlock.cid, deps: [genesisBlock.cid], depth: 1})
  const changeBlock = await createChange(unsignedBytes, signer)
  const refInput = await createVersionRef(
    {
      space: accountId,
      path: '',
      genesis: genesisBlock.cid.toString(),
      version: changeBlock.cid.toString(),
      generation: Number(ts),
    },
    signer,
  )
  await createSeedClient(hmServerUrl).publish({
    blobs: [
      {cid: profile.cid.toString(), data: profile.data},
      {data: new Uint8Array(genesisBlock.bytes), cid: genesisBlock.cid.toString()},
      {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
      ...refInput.blobs,
    ],
  })
}

/**
 * The Space index: the always-present, byte-budgeted summary of everything the agent could
 * expand — callable tools (one line each, from tool documents), the memory top level, the live
 * plan, and active triggers. Cached per agent and invalidated by memory/tool/trigger changes so
 * long sessions stop paying a recursive tree walk on every turn.
 */
const SPACE_INDEX_BUDGET_BYTES = 2048

type SpaceIndexInput = {
  db: Database
  accountId: string
  agentId: string
  stateDir: string
  callableTools: string[]
}

const spaceIndexCache = new Map<string, string>()

export function invalidateSpaceIndex(accountId: string, agentId?: string): void {
  for (const key of spaceIndexCache.keys()) {
    if (key.startsWith(agentId ? `${accountId}/${agentId}#` : `${accountId}/`)) {
      spaceIndexCache.delete(key)
    }
  }
}

export function buildSpaceIndex(input: SpaceIndexInput): string {
  const cacheKey = `${input.accountId}/${input.agentId}#${[...input.callableTools].sort().join(',')}`
  const cached = spaceIndexCache.get(cacheKey)
  if (cached !== undefined) return cached

  toolDocs.ensureBuiltinToolDocuments(input.db, input.accountId, input.agentId)
  const tools = toolDocs
    .listToolDocuments(input.db, input.accountId, input.agentId)
    .filter((row) => row.enabled && (row.doc.kind !== 'builtin' || input.callableTools.includes(row.doc.name)))
  const toolLines = tools.map(
    (row) => `- ${row.doc.name} — ${row.doc.summary}${row.doc.kind === 'lambda' ? ' (authored)' : ''}`,
  )

  let memoryLine = 'memory/ — empty'
  try {
    const summary = agentMemory.summarizeMemoryTopLevel(input.stateDir)
    if (summary.entries.length) {
      const top = summary.entries
        .slice(0, 12)
        .map((entry) => (entry.type === 'dir' ? `${entry.name}/(${entry.fileCount ?? 0})` : entry.name))
        .join(' · ')
      memoryLine = `memory/ — ${summary.totalFiles} file${summary.totalFiles === 1 ? '' : 's'}: ${top}${
        summary.entries.length > 12 ? ' · …' : ''
      }`
    }
  } catch {}

  const triggers = input.db
    .query<{name: string}, [string, string]>(
      `SELECT name FROM agent_triggers WHERE account_id = ? AND agent_id = ? AND enabled = 1 ORDER BY name LIMIT 8`,
    )
    .all(input.accountId, input.agentId)

  const parts = [
    '<space>',
    'tools/ (read ~/tools/<name> for a contract; call runs one; write ~/tools/<name> authors one)',
    ...toolLines,
    memoryLine,
    ...(triggers.length ? [`triggers/ — active: ${triggers.map((row) => row.name).join(' · ')}`] : []),
    '</space>',
  ]
  let index = parts.join('\n')
  if (index.length > SPACE_INDEX_BUDGET_BYTES) {
    // Over budget: drop the per-tool lines for a count, keeping the index honest but tiny.
    index = [
      '<space>',
      `tools/ — ${tools.length} callable tools (read ~/tools/ to list them)`,
      memoryLine,
      ...(triggers.length ? [`triggers/ — ${triggers.length} active`] : []),
      '</space>',
    ].join('\n')
  }
  spaceIndexCache.set(cacheKey, index)
  return index
}

/** Reraises agent-memory errors as API errors so they carry an HTTP status. */
function withMemoryErrors<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof agentMemory.AgentMemoryError) throw new APIError(error.status, error.message)
    throw error
  }
}

/**
 * Renders stored message attachments as a model-facing metadata block. Returns null when the
 * message has none. Content stays out of context until the model asks via `view_attachment`.
 */
function formatAttachmentMetadata(attachments: unknown): string | null {
  if (!Array.isArray(attachments) || attachments.length === 0) return null
  const lines = attachments
    .filter(
      (item): item is api.SessionAttachmentInfo => isRecord(item) && typeof (item as {id?: unknown}).id === 'string',
    )
    .map(
      (item) => `- "${item.name}" (${item.mimeType || 'unknown type'}, ${item.size} bytes) — attachment id ${item.id}`,
    )
  if (lines.length === 0) return null
  return `<attachments>\nThe user attached these session-private files. Use view_attachment with an id to see an image or read a text file; use attachment_to_memory to keep one across sessions or attachment_to_ipfs to publish one for Hypermedia content. Only view what you need.\n${lines.join(
    '\n',
  )}\n</attachments>`
}

/** Whether an attachment MIME type is text the model can read directly from a tool result. */
function isTextMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return false
  if (mimeType.startsWith('text/')) return true
  return ['application/json', 'application/xml', 'application/x-yaml', 'application/javascript'].includes(
    mimeType.split(';')[0]?.trim() ?? '',
  )
}

/** Maps attachment-store errors to API errors, like {@link withMemoryErrors} for memory. */
function withAttachmentErrors<T>(run: () => T): T {
  try {
    return run()
  } catch (error) {
    if (error instanceof sessionAttachments.SessionAttachmentError) throw new APIError(error.status, error.message)
    throw error
  }
}

/** Async variant of {@link withMemoryErrors} for downloads. */
async function withMemoryErrorsAsync<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof agentMemory.AgentMemoryError) throw new APIError(error.status, error.message)
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function agentRowToInfo(row: AgentRow): api.AgentInfo {
  return {
    id: row.id,
    account: row.account_id,
    definition: normalizeDefinition(cbor.decode<api.AgentDefinition>(row.definition_cbor)),
    stateDir: row.state_dir,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** How far back a run-completed chain is followed before it is called a loop. */
const TRIGGER_CHAIN_MAX_HOPS = 8

/** Does a finished run match what a `run-completed` trigger is watching for? */
function matchesRunCompleted(
  source: Extract<api.AgentTriggerSource, {type: 'run-completed'}>,
  run: runs.RunRecord,
): boolean {
  if (source.agentId !== undefined && source.agentId !== run.agentId) return false
  if (source.status !== undefined && source.status !== run.status) return false
  if (source.titleMatch !== undefined) {
    const title = (run.title ?? '').toLowerCase()
    if (!title.includes(source.titleMatch.toLowerCase())) return false
  }
  return true
}

function agentTriggerRowToInfo(row: AgentTriggerRow): api.AgentTriggerInfo {
  return {
    id: row.id,
    account: row.account_id,
    agentId: row.agent_id,
    name: row.name,
    enabled: row.enabled !== 0,
    source: cbor.decode<api.AgentTriggerSource>(row.source_cbor),
    prompt: parseStoredPromptBlocks(row.prompt),
    ...(row.continuation_cbor ? {continuation: cbor.decode<api.TriggerContinuation>(row.continuation_cbor)} : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_checked_at === null ? {} : {lastCheckedAt: row.last_checked_at}),
    ...(row.last_fired_at === null ? {} : {lastFiredAt: row.last_fired_at}),
    ...(row.last_error === null ? {} : {lastError: row.last_error}),
  }
}

function sessionRowToInfo(row: SessionRow, triggerContext?: api.AgentSessionTriggerContext): api.SessionInfo {
  return {
    id: row.id,
    account: row.account_id,
    agentId: row.agent_id,
    ...(row.title ? {title: row.title} : {}),
    status: row.status,
    ...(row.parent_session_id ? {parentSessionId: row.parent_session_id} : {}),
    ...(row.run_id ? {runId: row.run_id} : {}),
    ...(row.plan_cbor ? {plan: cbor.decode<api.RunPlan>(row.plan_cbor)} : {}),
    ...(row.child_count > 0 ? {childSessionCount: row.child_count} : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(triggerContext
      ? {
          startedByTrigger: {
            triggerId: triggerContext.triggerId,
            triggerName: triggerContext.triggerName,
            firingId: triggerContext.firingId,
            activityKey: triggerContext.activityKey,
            activitySummary: triggerContext.activitySummary,
            source: triggerContext.source,
            firedAt: triggerContext.firedAt,
          },
        }
      : {}),
  }
}

function sessionEventRowToInfo(row: SessionEventRow): api.SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    event: cbor.decode(row.event_cbor),
    createdAt: row.created_at,
  }
}

/** Collapses any value into a short single-line string for verbose server logs. */
function summarizeForLog(value: unknown, maxLength = 600): string {
  let text: string
  if (typeof value === 'string') text = value
  else if (value === undefined) text = ''
  else {
    try {
      text = JSON.stringify(value)
    } catch {
      text = String(value)
    }
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength)}…(+${text.length - maxLength} chars)` : text
}

/** Builds a compact one-line description of tool arguments for the live activity indicator. */
function summarizeToolArgs(args: unknown): string | undefined {
  if (!isRecord(args)) return typeof args === 'string' ? summarizeForLog(args, 80) : undefined
  for (const key of ['id', 'url', 'query', 'path', 'command', 'name', 'title']) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return summarizeForLog(value, 80)
  }
  return undefined
}

async function triggerPromptMessage(
  trigger: api.AgentTriggerInfo,
  firingId: string,
  event: activityTriggers.ActivityFeedEvent,
  client: Parameters<typeof contentToResolvedMarkdown>[1]['client'],
): Promise<api.MessageSession['content']> {
  return [
    {
      type: 'text',
      text: [
        await promptBlocksToResolvedMarkdown(normalizePromptBlocks(trigger.prompt, 'Trigger prompt'), client),
        '',
        '<trigger_context>',
        safeJSONStringify(
          {
            triggerId: trigger.id,
            firingId,
            activityKey: activityTriggers.activityEventKey(event),
            activitySummary: activityTriggers.activitySummary(event),
            activity: event,
          },
          2,
        ),
        '</trigger_context>',
        '',
        '<trigger_instructions>',
        'When responding to a comment activity, reply with the write verb as a THREADED reply, not a new top-level comment: write {address: <target document id>, content: <your reply>, options: {action: "comment", replyTo: <parent comment id>}}. Take the target document id from trigger_context.activity.target.id.id or the activity comment target fields, and replyTo from trigger_context.activity.comment.id when present, or trigger_context.activity.commentId.id as a fallback. Do not omit replyTo when the user was mentioned in a comment.',
        '</trigger_instructions>',
      ].join('\n'),
    },
  ]
}

function safeJSONStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item), space)
}

function jsonSafeToolOutput(value: unknown): unknown {
  return JSON.parse(safeJSONStringify(value))
}

function normalizeSystemPromptBlocks(raw: api.AgentDefinition['systemPrompt']): HMBlockNode[] {
  return normalizePromptBlocks(raw, 'System prompt')
}

function normalizePromptBlocks(raw: string | api.AgentPromptBlock[], label: string): HMBlockNode[] {
  let blocks: HMBlockNode[]
  if (typeof raw === 'string') {
    const prompt = normalizeBoundedString(raw, label, MAX_PROMPT_BYTES)
    blocks = markdownBlockNodesToHMBlockNodes(parseMarkdown(prompt).tree)
  } else if (Array.isArray(raw)) {
    blocks = raw.map((block) => normalizePromptBlockNode(block, label))
  } else {
    throw new APIError(400, `${label} must be blocks`)
  }

  const markdown = promptBlocksToMarkdown(blocks)
  if (!markdown.trim()) throw new APIError(400, `${label} is required`)
  const byteLength = new TextEncoder().encode(markdown).byteLength
  if (byteLength > MAX_PROMPT_BYTES) throw new APIError(400, `${label} is too large`)
  return blocks
}

function normalizePromptBlockNode(raw: unknown, label: string): HMBlockNode {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new APIError(400, `${label} blocks are invalid`)
  }
  const node = raw as {block?: unknown; children?: unknown}
  if (!node.block || typeof node.block !== 'object' || Array.isArray(node.block)) {
    throw new APIError(400, `${label} blocks are invalid`)
  }
  const block = node.block as Record<string, unknown>
  if (typeof block.id !== 'string' || !block.id || typeof block.type !== 'string' || !block.type) {
    throw new APIError(400, `${label} blocks are invalid`)
  }
  if (node.children != null && !Array.isArray(node.children)) {
    throw new APIError(400, `${label} block children are invalid`)
  }
  return {
    block: block as HMBlockNode['block'],
    ...(node.children == null ? {} : {children: node.children.map((child) => normalizePromptBlockNode(child, label))}),
  }
}

function serializePromptBlocksForStorage(prompt: string | api.AgentPromptBlock[]): string {
  const blocks = normalizePromptBlocks(prompt, 'Prompt')
  return JSON.stringify({type: 'seed-prompt-blocks', blocks})
}

function parseStoredPromptBlocks(value: string): HMBlockNode[] {
  try {
    const parsed = JSON.parse(value) as {type?: unknown; blocks?: unknown}
    if (parsed?.type === 'seed-prompt-blocks' && Array.isArray(parsed.blocks)) {
      return normalizePromptBlocks(parsed.blocks as api.AgentPromptBlock[], 'Prompt')
    }
  } catch {
    // Legacy plain-text trigger prompt.
  }
  return normalizePromptBlocks(value, 'Prompt')
}

async function promptBlocksToResolvedMarkdown(
  blocks: HMBlockNode[],
  client: Parameters<typeof contentToResolvedMarkdown>[1]['client'],
): Promise<string> {
  const markdown = await contentToResolvedMarkdown(blocks, {client, maxDepth: 2})
  return stripPromptMarkdownArtifacts(markdown)
}

function promptBlocksToMarkdown(blocks: HMBlockNode[]): string {
  const markdown = blocksToMarkdown({metadata: {}, content: blocks} as HMDocument, {ipfsGateway: true})
  return stripPromptMarkdownArtifacts(markdown)
}

function stripPromptMarkdownArtifacts(markdown: string): string {
  return markdown
    .replace(/^---\n---\n\n?/, '')
    .replace(/[ \t]*<!-- id:[^>]+ -->/g, '')
    .trim()
}

function normalizeDefinition(raw: api.AgentDefinition): api.AgentDefinition {
  if (!raw || typeof raw !== 'object') throw new APIError(400, 'Agent definition is required')

  const name = normalizeBoundedString(raw.name, 'Agent name', MAX_NAME_BYTES)
  const systemPrompt = normalizeSystemPromptBlocks(raw.systemPrompt)
  const modelProvider = normalizeBoundedString(raw.modelProvider, 'Model provider', MAX_NAME_BYTES)
  const model = normalizeBoundedString(raw.model, 'Model', MAX_MODEL_BYTES)

  const definition: api.AgentDefinition = {name, systemPrompt, modelProvider, model}

  if (raw.reasoningLevel !== undefined) {
    if (!isReasoningLevel(raw.reasoningLevel)) throw new APIError(400, 'Reasoning level is invalid')
    definition.reasoningLevel = raw.reasoningLevel
  }

  if (raw.signingKey !== undefined) {
    definition.signingKey = normalizeBoundedString(raw.signingKey, 'Signing key', MAX_NAME_BYTES)
  }

  if (raw.signingKeys !== undefined) {
    if (!Array.isArray(raw.signingKeys)) throw new APIError(400, 'Signing keys must be an array')
    definition.signingKeys = raw.signingKeys.map((key) => normalizeBoundedString(key, 'Signing key', MAX_NAME_BYTES))
  }

  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      throw new APIError(400, 'Tools must be an array')
    }
    if (raw.tools.length > MAX_TOOL_COUNT) {
      throw new APIError(400, 'Too many tools')
    }

    let totalBytes = 0
    const tools = raw.tools.map((tool) => {
      if (typeof tool !== 'string' || tool.trim() !== tool || !tool) {
        throw new APIError(400, 'Tools must be non-empty trimmed strings')
      }
      const byteLength = new TextEncoder().encode(tool).byteLength
      if (byteLength > MAX_TOOL_NAME_BYTES) {
        throw new APIError(400, 'Tool name is too large')
      }
      totalBytes += byteLength
      if (totalBytes > MAX_TOOLS_TOTAL_BYTES) {
        throw new APIError(400, 'Tools are too large')
      }
      return tool
    })
    definition.tools = tools
  }

  if (raw.metadata !== undefined) {
    if (!raw.metadata || typeof raw.metadata !== 'object' || Array.isArray(raw.metadata)) {
      throw new APIError(400, 'Metadata must be an object')
    }
    const encoded = cbor.encode(raw.metadata)
    if (encoded.byteLength > MAX_METADATA_CBOR_BYTES) {
      throw new APIError(400, 'Metadata is too large')
    }
    definition.metadata = raw.metadata
  }

  return definition
}

/**
 * Rejects a reasoning level the target model does not accept. Providers gate
 * levels per model generation (e.g. gpt-5 takes `minimal` but not `xhigh`,
 * gpt-5.2+ the reverse), so this needs the provider type, which callers resolve
 * from the stored provider record.
 */
function validateReasoningLevel(providerType: string, definition: api.AgentDefinition): void {
  if (!definition.reasoningLevel) return
  const support = modelReasoningSupport(providerType, definition.model)
  if (!support) {
    throw new APIError(400, `Model ${definition.model} does not support a reasoning level`)
  }
  if (!support.levels.includes(definition.reasoningLevel)) {
    throw new APIError(
      400,
      `Model ${definition.model} does not support reasoning level '${
        definition.reasoningLevel
      }' (valid: ${support.levels.join(', ')})`,
    )
  }
}

function normalizeAgentTriggerInput(
  raw: api.AgentTriggerInput,
): Omit<api.AgentTriggerInput, 'prompt'> & {enabled: boolean; prompt: HMBlockNode[]} {
  if (!raw || typeof raw !== 'object') throw new APIError(400, 'Agent trigger is required')
  const source = normalizeAgentTriggerSource(raw.source)
  return {
    name: normalizeBoundedString(raw.name, 'Trigger name', MAX_NAME_BYTES),
    enabled: raw.enabled === undefined ? true : normalizeBoolean(raw.enabled, 'Trigger enabled'),
    source,
    prompt: normalizePromptBlocks(raw.prompt, 'Trigger prompt'),
    ...(raw.continuation === undefined ? {} : {continuation: normalizeTriggerContinuation(raw.continuation)}),
  }
}

function normalizeAgentTriggerPatch(
  raw: api.AgentTriggerPatch,
): Omit<api.AgentTriggerPatch, 'prompt'> & {prompt?: HMBlockNode[]} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new APIError(400, 'Agent trigger patch is required')
  const patch: Omit<api.AgentTriggerPatch, 'prompt'> & {prompt?: HMBlockNode[]} = {}
  if (raw.name !== undefined) patch.name = normalizeBoundedString(raw.name, 'Trigger name', MAX_NAME_BYTES)
  if (raw.enabled !== undefined) patch.enabled = normalizeBoolean(raw.enabled, 'Trigger enabled')
  if (raw.source !== undefined) patch.source = normalizeAgentTriggerSource(raw.source)
  if (raw.prompt !== undefined) patch.prompt = normalizePromptBlocks(raw.prompt, 'Trigger prompt')
  if (raw.continuation !== undefined) patch.continuation = normalizeTriggerContinuation(raw.continuation)
  if (Object.keys(patch).length === 0) throw new APIError(400, 'Agent trigger patch is empty')
  return patch
}

function normalizeAgentTriggerSource(raw: api.AgentTriggerSource): api.AgentTriggerSource {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new APIError(400, 'Trigger source is required')
  if (raw.type === 'document-comment') {
    return {
      type: 'document-comment',
      resource: normalizeBoundedString(raw.resource, 'Trigger document resource', 2048),
      ...(raw.author === undefined
        ? {}
        : {author: normalizeBoundedString(raw.author, 'Trigger author', MAX_NAME_BYTES)}),
    }
  }
  if (raw.type === 'user-mention') {
    const legacy = (raw as {mentionedAccount?: unknown}).mentionedAccount
    const rawAccounts = raw.mentionedAccounts ?? (legacy === undefined ? undefined : [legacy])
    if (!Array.isArray(rawAccounts)) throw new APIError(400, 'Trigger mentioned accounts must be an array')
    if (rawAccounts.length > MAX_TOOL_COUNT) throw new APIError(400, 'Too many trigger mentioned accounts')
    const mentionedAccounts: string[] = []
    for (const account of rawAccounts) {
      const normalized = normalizeBoundedString(account, 'Trigger mentioned account', MAX_NAME_BYTES)
      if (!mentionedAccounts.includes(normalized)) mentionedAccounts.push(normalized)
    }
    if (mentionedAccounts.length === 0) throw new APIError(400, 'Trigger mentioned account is required')
    return {
      type: 'user-mention',
      mentionedAccounts,
      ...(raw.resourcePrefix === undefined
        ? {}
        : {resourcePrefix: normalizeBoundedString(raw.resourcePrefix, 'Trigger resource prefix', 2048)}),
    }
  }
  if (raw.type === 'site-update') {
    const source: api.AgentTriggerSource = {
      type: 'site-update',
      resourcePrefix: activityTriggers.canonicalizeResourceId(
        normalizeBoundedString(raw.resourcePrefix, 'Trigger resource prefix', 2048),
      ),
    }
    if (raw.eventTypes !== undefined) {
      if (!Array.isArray(raw.eventTypes)) throw new APIError(400, 'Trigger event types must be an array')
      if (raw.eventTypes.length > MAX_TOOL_COUNT) throw new APIError(400, 'Too many trigger event types')
      source.eventTypes = raw.eventTypes.map((eventType) =>
        normalizeBoundedString(eventType, 'Trigger event type', MAX_NAME_BYTES),
      )
    }
    return source
  }
  if (raw.type === 'schedule') {
    return {type: 'schedule', schedule: normalizeScheduleTrigger(raw.schedule)}
  }
  if (raw.type === 'run-completed') {
    if (raw.status !== undefined && !runs.TERMINAL_RUN_STATUSES.includes(raw.status)) {
      throw new APIError(400, 'Trigger run status must be succeeded, failed, or canceled')
    }
    return {
      type: 'run-completed',
      ...(raw.agentId === undefined
        ? {}
        : {agentId: normalizeBoundedString(raw.agentId, 'Trigger agent ID', MAX_NAME_BYTES)}),
      ...(raw.status === undefined ? {} : {status: raw.status}),
      ...(raw.titleMatch === undefined
        ? {}
        : {titleMatch: normalizeBoundedString(raw.titleMatch, 'Trigger title match', MAX_NAME_BYTES)}),
    }
  }
  throw new APIError(400, 'Trigger source type is unsupported')
}

function normalizeTriggerContinuation(raw: api.TriggerContinuation): api.TriggerContinuation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new APIError(400, 'Trigger continuation is required')
  if (raw.kind === 'newThread') return {kind: 'newThread'}
  if (raw.kind === 'wake') {
    return {
      kind: 'wake',
      signal: normalizeBoundedString(raw.signal, 'Trigger signal', MAX_NAME_BYTES),
      ...(raw.runId === undefined ? {} : {runId: normalizeBoundedString(raw.runId, 'Trigger run ID', MAX_NAME_BYTES)}),
      ...(raw.payload === undefined ? {} : {payload: jsonSafeToolOutput(raw.payload)}),
    }
  }
  throw new APIError(400, 'Trigger continuation kind is unsupported')
}

function normalizeScheduleTrigger(raw: api.AgentScheduleTrigger): api.AgentScheduleTrigger {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new APIError(400, 'Trigger schedule is required')
  if (raw.kind === 'interval') {
    const every = normalizeOptionalPositiveInteger(raw.every, 'Schedule interval')
    if (raw.unit !== 'minutes' && raw.unit !== 'hours') throw new APIError(400, 'Schedule interval unit is unsupported')
    return {kind: 'interval', every, unit: raw.unit}
  }
  if (raw.kind === 'weekly') {
    if (!Array.isArray(raw.daysOfWeek) || raw.daysOfWeek.length === 0) {
      throw new APIError(400, 'Schedule days of week are required')
    }
    const daysOfWeek = Array.from(new Set(raw.daysOfWeek)).map((day) => {
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) {
        throw new APIError(400, 'Schedule day of week is invalid')
      }
      return day
    })
    const timeOfDay = normalizeBoundedString(raw.timeOfDay, 'Schedule time of day', 5)
    if (!/^\d{2}:\d{2}$/.test(timeOfDay)) throw new APIError(400, 'Schedule time of day is invalid')
    const [hour, minute] = timeOfDay.split(':').map(Number)
    if (hour === undefined || minute === undefined || hour > 23 || minute > 59) {
      throw new APIError(400, 'Schedule time of day is invalid')
    }
    const timezone = normalizeBoundedString(raw.timezone, 'Schedule timezone', MAX_NAME_BYTES)
    try {
      new Intl.DateTimeFormat('en-US', {timeZone: timezone}).format(new Date())
    } catch {
      throw new APIError(400, 'Schedule timezone is invalid')
    }
    return {kind: 'weekly', daysOfWeek, timeOfDay, timezone}
  }
  if (raw.kind === 'once') {
    if (typeof raw.runAt !== 'number' || !Number.isSafeInteger(raw.runAt) || raw.runAt <= 0) {
      throw new APIError(400, 'Schedule run time is invalid')
    }
    if (raw.timezone === undefined) return {kind: 'once', runAt: raw.runAt}
    const timezone = normalizeBoundedString(raw.timezone, 'Schedule timezone', MAX_NAME_BYTES)
    try {
      new Intl.DateTimeFormat('en-US', {timeZone: timezone}).format(new Date())
    } catch {
      throw new APIError(400, 'Schedule timezone is invalid')
    }
    return {kind: 'once', runAt: raw.runAt, timezone}
  }
  throw new APIError(400, 'Schedule kind is unsupported')
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new APIError(400, `${label} must be a boolean`)
  return value
}

function normalizeOptionalPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new APIError(400, `${label} must be a positive integer`)
  }
  return value
}

function normalizeProvider(raw: api.ModelProviderConfig): api.ModelProviderConfig {
  if (!raw || typeof raw !== 'object') throw new APIError(400, 'Provider config is required')
  const type = normalizeBoundedString(raw.type, 'Provider type', MAX_NAME_BYTES)
  const provider: api.ModelProviderConfig = {type}

  if (raw.authMode !== undefined) {
    if (raw.authMode !== 'api-key' && raw.authMode !== 'subscription') {
      throw new APIError(400, "Provider auth mode must be 'api-key' or 'subscription'")
    }
    if (raw.authMode === 'subscription') {
      if (!(OAUTH_PROVIDER_TYPES as readonly string[]).includes(type)) {
        throw new APIError(400, `Provider type does not support subscription auth: ${type}`)
      }
      if (!raw.secretRefs?.oauth) {
        throw new APIError(400, 'Subscription providers require a secretRefs.oauth credential reference')
      }
    }
    provider.authMode = raw.authMode
  }

  if (raw.baseUrl !== undefined) {
    const baseUrl = normalizeBoundedString(raw.baseUrl, 'Provider base URL', 2048)
    try {
      new URL(baseUrl)
    } catch {
      throw new APIError(400, 'Provider base URL is invalid')
    }
    provider.baseUrl = baseUrl
  }

  if (raw.modelDefaults !== undefined) {
    if (!raw.modelDefaults || typeof raw.modelDefaults !== 'object' || Array.isArray(raw.modelDefaults)) {
      throw new APIError(400, 'Model defaults must be an object')
    }
    if (cbor.encode(raw.modelDefaults).byteLength > MAX_METADATA_CBOR_BYTES) {
      throw new APIError(400, 'Model defaults are too large')
    }
    provider.modelDefaults = raw.modelDefaults
  }

  if (raw.secretRefs !== undefined) {
    if (!raw.secretRefs || typeof raw.secretRefs !== 'object' || Array.isArray(raw.secretRefs)) {
      throw new APIError(400, 'Secret refs must be an object')
    }
    const secretRefs: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw.secretRefs)) {
      secretRefs[normalizeBoundedString(key, 'Secret ref key', MAX_NAME_BYTES)] = normalizeBoundedString(
        value,
        'Secret ref value',
        MAX_NAME_BYTES,
      )
    }
    provider.secretRefs = secretRefs
  }

  return provider
}

function normalizeOptionalMetadata(raw: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new APIError(400, 'Metadata must be an object')
  if (cbor.encode(raw).byteLength > MAX_METADATA_CBOR_BYTES) throw new APIError(400, 'Metadata is too large')
  return raw
}

/** Pi streaming API a provider is routed through. */
type PiProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'

/** Shape of the upstream model-list endpoint a provider exposes. */
type ProviderModelListStrategy = 'openai' | 'anthropic' | 'google'

/**
 * Static, code-owned configuration for each supported model-provider type. Most
 * providers are OpenAI-compatible and differ only by base URL, so adding one is
 * usually a single entry here. `openai`/`anthropic`/`google` use their own model
 * list + Pi API; everything else rides the OpenAI-compatible path.
 */
type ProviderSpec = {
  /** Pi streaming API used to execute requests for this provider. */
  api: PiProviderApi
  /** Endpoint used when the provider record does not (or may not) override baseUrl. */
  defaultBaseUrl: string
  /** Which upstream model-list endpoint shape to query for `ListProviderModels`. */
  modelList: ProviderModelListStrategy
  /** Whether a stored provider record may override the base URL (self-hosted/custom). */
  allowCustomBaseUrl: boolean
  /** Whether an API key is required. False for local servers like Ollama. */
  requireApiKey: boolean
}

const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  openai: {
    // Default path for models without reasoning control. Models that need
    // reasoning (or whose reasoning must be explicitly disabled, gpt-5.1+) are
    // rerouted to 'openai-responses' in piModelForDefinition.
    api: 'openai-completions',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelList: 'openai',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  anthropic: {
    api: 'anthropic-messages',
    defaultBaseUrl: 'https://api.anthropic.com',
    modelList: 'anthropic',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  google: {
    api: 'google-generative-ai',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelList: 'google',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  openrouter: {
    api: 'openai-completions',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    modelList: 'openai',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  deepseek: {
    api: 'openai-completions',
    defaultBaseUrl: 'https://api.deepseek.com',
    modelList: 'openai',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  groq: {
    api: 'openai-completions',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    modelList: 'openai',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  xai: {
    api: 'openai-completions',
    defaultBaseUrl: 'https://api.x.ai/v1',
    modelList: 'openai',
    allowCustomBaseUrl: false,
    requireApiKey: true,
  },
  ollama: {
    api: 'openai-completions',
    defaultBaseUrl: 'http://localhost:11434/v1',
    modelList: 'openai',
    allowCustomBaseUrl: true,
    requireApiKey: false,
  },
  custom: {
    api: 'openai-completions',
    defaultBaseUrl: '',
    modelList: 'openai',
    allowCustomBaseUrl: true,
    requireApiKey: false,
  },
}

function providerSpec(type: string): ProviderSpec {
  const spec = PROVIDER_SPECS[type]
  if (!spec) throw new APIError(400, `Unsupported model provider type: ${type}`)
  return spec
}

/**
 * Subscription ("Sign in with ChatGPT") auth for the `openai` provider type
 * rides Pi's `openai-codex` provider: OAuth access tokens as bearer auth
 * against the ChatGPT Codex backend instead of an API key against
 * api.openai.com. The Pi provider id doubles as the OAuth provider id that
 * `AuthStorage` uses to auto-refresh expired tokens.
 */
const SUBSCRIPTION_PI_PROVIDER_ID = 'openai-codex'
const SUBSCRIPTION_CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

/** Stable per-account secret name for a provider type's OAuth credentials; re-login overwrites in place. */
function subscriptionOAuthSecretName(providerType: string): string {
  return `${providerType}-subscription-oauth`
}

/**
 * Static catalog of models the ChatGPT Codex backend accepts (it has no list
 * endpoint). Mirrors the current Codex CLI's model picker rather than pi-ai's
 * `openai-codex` catalog, which lags behind: the backend rejects its
 * gpt-5.1…5.3-era ids outright ("model is not supported when using Codex with
 * a ChatGPT account") and it misses the current generation entirely.
 */
const SUBSCRIPTION_CODEX_MODELS: api.ProviderModelInfo[] = [
  {id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol'},
  {id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra'},
  {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna'},
  {id: 'gpt-5.5', name: 'GPT-5.5'},
  {id: 'gpt-5.4', name: 'GPT-5.4'},
]

function subscriptionProviderModels(): api.ProviderModelInfo[] {
  return SUBSCRIPTION_CODEX_MODELS
}

/**
 * Resolves the effective base URL for a provider record. A stored `baseUrl`
 * override is honored only for provider types that allow it (self-hosted/custom);
 * for pinned providers the spec default always wins, which keeps a stored API key
 * from being redirected to an arbitrary host.
 */
function resolveProviderBaseUrl(type: string, configuredBaseUrl: string | undefined): string {
  const spec = providerSpec(type)
  const baseUrl = spec.allowCustomBaseUrl ? configuredBaseUrl?.trim() || spec.defaultBaseUrl : spec.defaultBaseUrl
  if (!baseUrl) throw new APIError(400, `Base URL is required for provider type: ${type}`)
  return baseUrl
}

async function fetchProviderModels(
  type: string,
  baseUrl: string,
  apiKey: string | undefined,
): Promise<api.ProviderModelInfo[]> {
  switch (providerSpec(type).modelList) {
    case 'openai':
      return fetchOpenAIModels(baseUrl, apiKey)
    case 'anthropic':
      return fetchAnthropicModels(baseUrl, apiKey ?? '')
    case 'google':
      return fetchGoogleModels(baseUrl, apiKey ?? '')
  }
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string | undefined): Promise<api.ProviderModelInfo[]> {
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const response = await fetch(joinUrlPath(baseUrl, 'models'), {headers})
  const body = await readJsonResponse(response, 'OpenAI models')
  if (!isRecord(body) || !Array.isArray(body.data)) throw new APIError(502, 'OpenAI models response is invalid')
  return body.data.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== 'string') return []
    return [{id: model.id, name: model.id}]
  })
}

async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<api.ProviderModelInfo[]> {
  const response = await fetch(joinUrlPath(baseUrl, 'v1/models'), {
    headers: {'x-api-key': apiKey, 'anthropic-version': '2023-06-01'},
  })
  const body = await readJsonResponse(response, 'Anthropic models')
  if (!isRecord(body) || !Array.isArray(body.data)) throw new APIError(502, 'Anthropic models response is invalid')
  return body.data.flatMap((model) => {
    if (!isRecord(model) || typeof model.id !== 'string') return []
    return [{id: model.id, name: typeof model.display_name === 'string' ? model.display_name : model.id}]
  })
}

async function fetchGoogleModels(baseUrl: string, apiKey: string): Promise<api.ProviderModelInfo[]> {
  const url = new URL(joinUrlPath(baseUrl, 'models'))
  url.searchParams.set('key', apiKey)
  const response = await fetch(url)
  const body = await readJsonResponse(response, 'Google models')
  if (!isRecord(body) || !Array.isArray(body.models)) throw new APIError(502, 'Google models response is invalid')
  return body.models.flatMap((model) => {
    if (!isRecord(model) || typeof model.name !== 'string') return []
    if (
      Array.isArray(model.supportedGenerationMethods) &&
      !model.supportedGenerationMethods.includes('generateContent')
    ) {
      return []
    }
    const id = model.name.replace(/^models\//, '')
    return [{id, name: typeof model.displayName === 'string' ? model.displayName : id}]
  })
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  if (!response.ok) throw new APIError(502, `${label} request failed: HTTP ${response.status}`)
  return response.json()
}

function joinUrlPath(baseUrl: string, pathPart: string): string {
  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${pathPart.replace(/^\/+/, '')}`
  url.search = ''
  url.hash = ''
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function piModelForDefinition(
  type: string,
  baseUrl: string,
  definition: api.AgentDefinition,
  options: {subscription?: boolean} = {},
): NonNullable<Parameters<pi.ModelRegistry['registerProvider']>[1]['models']>[number] {
  if (options.subscription) {
    // Subscription runs go through the ChatGPT Codex backend. Prefer Pi's
    // catalog entry (accurate context window, image support, cost); synthesize a
    // sane default for ids the catalog does not know yet. Codex models are all
    // reasoning models.
    const catalogModel = getModels(SUBSCRIPTION_PI_PROVIDER_ID).find((model) => model.id === definition.model)
    if (catalogModel) return catalogModel
    return {
      id: definition.model,
      name: definition.model,
      api: 'openai-codex-responses',
      baseUrl,
      reasoning: true,
      input: ['text', 'image'],
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: 272000,
      maxTokens: 128000,
    }
  }
  const support = modelReasoningSupport(type, definition.model)
  // Pi only sends reasoning parameters for models flagged `reasoning`. The flag
  // goes on when a level is selected, and also when the model needs an explicit
  // "no reasoning" value (Pi's openai-responses path sends `effort: 'none'` for
  // reasoning-flagged models with no level, which such models require before
  // they accept function tools).
  const reasoning = Boolean(support && (definition.reasoningLevel || support.supportsEffortNone))
  // OpenAI's newest chat models (gpt-5.1+) reject function tools on
  // /v1/chat/completions unless reasoning is explicitly disabled, and reject
  // tools entirely once a reasoning effort is set there. The Responses API is
  // OpenAI's supported path for tools + reasoning, so reasoning-flagged OpenAI
  // models ride it while everything else keeps the plain completions path.
  const api = type === 'openai' && reasoning ? 'openai-responses' : providerSpec(type).api
  return {
    id: definition.model,
    name: definition.model,
    api,
    baseUrl,
    reasoning,
    // Image input gates whether view_attachment returns actual image content to the model.
    input: modelSupportsImageInput(type, definition.model) ? ['text', 'image'] : ['text'],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow: 128000,
    maxTokens: 16384,
  }
}

function createSeedPiResourceLoader(systemPrompt: string): pi.ResourceLoader {
  return {
    getExtensions: () => ({extensions: [], errors: [], runtime: pi.createExtensionRuntime()}),
    getSkills: () => ({skills: [], diagnostics: []}),
    getPrompts: () => ({prompts: [], diagnostics: []}),
    getThemes: () => ({themes: [], diagnostics: []}),
    getAgentsFiles: () => ({agentsFiles: []}),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

type WriteToolContext = {
  db: Database
  accountId: string
  agentId: string
  definition: api.AgentDefinition
  hmServerUrl: string
}

export type AgentServicePiToolContext = WriteToolContext & {
  web: WebToolsConfig
  /** Agent state directory holding the private memory filesystem. */
  stateDir: string
  /** Session this run belongs to, scoping attachment addresses. */
  sessionId: string
  /** Whether the session's model accepts image content, gating attachment image output. */
  modelAcceptsImages: boolean
  /** Called after a write mutates memory files, so clients watching the Memory tab refresh. */
  onMemoryChange: () => void
  /** Reports live mid-call progress from a long-running tool, surfaced as run activity to clients. */
  onToolProgress: (toolName: string, progress: {toolCallId?: string; detail?: string; outputTail?: string}) => void
  /** Sandboxed code execution against the memory workspace. */
  codeExec: CodeExecutor
  /** Callable tool names this agent may dispatch through the call verb. */
  callableTools: string[]
  /** Whether signed public publishing (hm://, ipfs://) is granted; memory writes are never gated. */
  publishEnabled: boolean
  /**
   * Callables the transcript shows the model has expanded (read the contract / hit touch-expand).
   * Promoted to first-class provider tools so later turns get provider-side schema validation.
   * Derived from durable events, so resume and compaction reconstruct the same set.
   */
  expandedCallables?: string[]
  /** delegate {await: false}: creates a detached session of this agent and dispatches its first run. */
  startSession: (input: unknown) => {sessionId: string; title: string}
  /** plan verb: stores the session's live checklist snapshot. Absent in session-less (script) contexts. */
  setSessionPlan?: (plan: unknown) => api.SessionInfo
  /** delegate (model child): spawns an awaited child run + session and parks the calling turn on it. */
  spawnSubSession?: (toolCallId: string, input: unknown) => unknown
  /** delegate {script}: lints + spawns a script child run and parks the calling turn on it. */
  spawnWorkflow?: (toolCallId: string, input: unknown) => unknown
  /** When set, this run is a typed delegate child: return_result uses this schema as its parameters. */
  returnResultSchema?: JsonSchema
  /** return_result tool: validates and records the typed result, ending the turn after the tool batch. */
  deliverResult?: (payload: unknown) => unknown
}

type ResolvedAgentSigner = {
  secretName: string
  profileName: string
  publicKey: string
  keyPair: blobs.NobleKeyPair
  signer: HMSigner
}

type ParsedWriteDocumentContent = {
  ops: DocumentOperation[]
  metadata: HMMetadata
  blocks: HMBlockNode[]
}

/**
 * Rich model-facing content a tool can return alongside its structured output. Used by
 * `view_attachment` to put image bytes in front of vision models on demand — the image rides the
 * tool result to the model only, while the durable event and UI keep just the structured output.
 */
type PiToolRichOutput = {
  piContent: Array<{type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string}>
}

function hasPiContent(value: unknown): value is PiToolRichOutput & Record<string, unknown> {
  return isRecord(value) && Array.isArray((value as PiToolRichOutput).piContent)
}

function defineSeedPiTool(
  metadata: SeedToolMetadata,
  execute: (params: unknown, toolCallId: string) => Promise<unknown> | unknown,
): pi.ToolDefinition {
  return pi.defineTool({
    name: metadata.name,
    label: metadata.label,
    description: metadata.description,
    parameters: metadata.inputSchema as never,
    execute: async (toolCallId, params) => {
      const raw = await execute(params, toolCallId)
      if (hasPiContent(raw)) {
        const {piContent, ...rest} = raw
        const output = jsonSafeToolOutput(rest)
        return {content: piContent, details: output}
      }
      const output = jsonSafeToolOutput(raw)
      return {content: [{type: 'text', text: safeJSONStringify(output)}], details: output}
    },
  })
}

type AgentSearchType = 'keyword' | 'semantic' | 'hybrid'

const AGENT_SEARCH_TYPES: Record<AgentSearchType, number> = {
  keyword: 0,
  semantic: 1,
  hybrid: 2,
}

function getAgentSearchType(value: unknown): AgentSearchType {
  return value === 'keyword' || value === 'semantic' || value === 'hybrid' ? value : 'hybrid'
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

async function executeAgentServiceSearch(
  context: AgentServicePiToolContext,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {}
  const query = typeof input.query === 'string' ? input.query.trim() : ''
  if (!query) throw new APIError(400, 'Search query is required')

  const searchType = getAgentSearchType(input.searchType)
  const includeBody = typeof input.includeBody === 'boolean' ? input.includeBody : false
  const pageSize = boundedInteger(input.pageSize, query.length < 3 ? 30 : 20, 1, 50)
  const client = createSeedClient(context.hmServerUrl)
  const output = await client.request('Search', {
    query,
    accountUid: typeof input.accountUid === 'string' ? input.accountUid : undefined,
    includeBody,
    contextSize: boundedInteger(input.contextSize, 48, 0, 512),
    perspectiveAccountUid: context.accountId,
    searchType: AGENT_SEARCH_TYPES[searchType],
    pageSize,
  })

  const results = Array.isArray(output.entities)
    ? output.entities.slice(0, pageSize).map((entity) => {
        const id = isRecord(entity) ? entity.id : undefined
        const url = id ? packHmId(id as never) : ''
        return {
          title: isRecord(entity) && typeof entity.title === 'string' && entity.title ? entity.title : url,
          url,
          type: isRecord(entity) && typeof entity.type === 'string' ? entity.type : '',
          parentNames: isRecord(entity) && Array.isArray(entity.parentNames) ? entity.parentNames : [],
          versionTime: isRecord(entity) && typeof entity.versionTime === 'string' ? entity.versionTime : undefined,
        }
      })
    : []

  const markdown = results.length
    ? [
        `Search results for "${query}" (${results.length} result${
          results.length === 1 ? '' : 's'
        }, search type: ${searchType}, include body: ${includeBody ? 'yes' : 'no'})`,
        '',
        ...results.flatMap((result, index) => [
          `${index + 1}. [${result.title}](${result.url})`,
          `   - Type: ${result.type}`,
          ...(result.parentNames.length ? [`   - Parents: ${result.parentNames.join(' / ')}`] : []),
          ...(result.versionTime ? [`   - Updated: ${result.versionTime}`] : []),
          `   - URL: ${result.url}`,
          '',
        ]),
      ].join('\n')
    : `No results found for "${query}" (search type: ${searchType}, include body: ${includeBody ? 'yes' : 'no'}).`

  return {
    summary: results.length
      ? `Found ${results.length} result${results.length === 1 ? '' : 's'} for "${query}".`
      : `No results found for "${query}".`,
    markdown,
    query,
    searchType,
    includeBody,
    results,
  }
}

// ---------------------------------------------------------------------------------------------
// Verb dispatch: address parsing shared by read and write
// ---------------------------------------------------------------------------------------------

/** `~/memory/...` → relative memory path ('' = root); null when the address is not a memory address. */
function memoryPathFromAddress(address: string): string | null {
  if (address === '~/memory' || address === '~/memory/') return ''
  if (address.startsWith('~/memory/')) return address.slice('~/memory/'.length)
  return null
}

/** hm://<account>[/path] → {account, path}; null when not an hm address. */
function parseHmAddress(address: string): {account: string; path: string} | null {
  const match = /^hm:\/\/([^/?#]+)(\/[^?#]*)?/.exec(address)
  if (!match) return null
  const path = match[2] && match[2] !== '/' ? match[2].replace(/\/+$/, '') : '/'
  return {account: match[1]!, path}
}

/** Renders the ~/tools listing from the agent's tool documents, one summary line each. */
function toolsListing(context: AgentServicePiToolContext): Record<string, unknown> {
  const verbs = Object.values(seedVerbRegistry as Record<string, SeedToolMetadata>).filter(
    (tool) => !tool.hidden && tool.name !== 'return_result',
  )
  toolDocs.ensureBuiltinToolDocuments(context.db, context.accountId, context.agentId)
  const rows = toolDocs
    .listToolDocuments(context.db, context.accountId, context.agentId)
    .filter((row) => row.enabled && (row.doc.kind !== 'builtin' || context.callableTools.includes(row.doc.name)))
  const lines = [
    '# ~/tools',
    '',
    '## Verbs (always available)',
    ...verbs.map((tool) => `- ${toolSummaryLine(tool)}`),
    '',
    '## Callable with the call verb',
    ...rows.map((row) => `- ${row.doc.name} — ${row.doc.summary}${row.doc.kind === 'lambda' ? ' (authored)' : ''}`),
    '',
    'Write a document to ~/tools/<name> ({description, input, output?, source, runtime?}) to author a new tool, then call it by name.',
    'Its source runs in the execute sandbox and receives the validated input: TypeScript (default) `export default (input) => result`; python `def main(input): return result`. Whatever it returns is the tool result; anything it prints comes back as logs.',
  ]
  return {
    summary: `${verbs.length} verbs and ${rows.length} callable tools.`,
    markdown: lines.join('\n'),
    tools: rows.map((row) => row.doc.name),
  }
}

/** Reads a memory address: file content, or a directory listing for dir addresses. */
function readMemoryAddress(context: AgentServicePiToolContext, memoryPath: string): Record<string, unknown> {
  const list = (path: string): Record<string, unknown> => {
    const level = withMemoryErrors(() => agentMemory.listMemoryDir(context.stateDir, path))
    const fileCount = level.entries.filter((entry) => entry.type === 'file').length
    const dirCount = level.entries.length - fileCount
    const where = level.path ? `${level.path}/` : 'Memory root'
    const dirNote = dirCount
      ? ` and ${dirCount} director${dirCount === 1 ? 'y' : 'ies'} (read a directory address to see inside)`
      : ''
    return {
      summary: level.entries.length
        ? `${where} holds ${fileCount} file${fileCount === 1 ? '' : 's'} (${level.totalBytes} bytes)${dirNote}.`
        : `${where} is empty.`,
      ...level,
    }
  }
  if (memoryPath === '' || memoryPath.endsWith('/')) return list(memoryPath.replace(/\/+$/, ''))
  try {
    const file = withMemoryErrors(() => agentMemory.readMemoryFile(context.stateDir, memoryPath))
    const {data: _data, ...meta} = file
    if (file.encoding === 'binary') {
      return {
        summary: `${file.path} is a binary file (${file.size} bytes${
          file.mimeType ? `, ${file.mimeType}` : ''
        }); content not shown. Use write ipfs:// with {fromPath} to publish it for Hypermedia content.`,
        ...meta,
      }
    }
    return {summary: `Read ${file.path} (${file.size} bytes).`, ...meta}
  } catch (error) {
    // A directory read without a trailing slash is a natural mistake; answer with the listing.
    try {
      return list(memoryPath)
    } catch {
      throw error
    }
  }
}

/** Reads an attachment address, inlining images for image-capable models. */
function readAttachmentAddress(context: AgentServicePiToolContext, attachmentId: string): Record<string, unknown> {
  const {info, data} = withAttachmentErrors(() =>
    sessionAttachments.readSessionAttachment(context.stateDir, context.sessionId, attachmentId),
  )
  const meta = {id: info.id, name: info.name, mimeType: info.mimeType, size: info.size}
  const isImage = !!info.mimeType?.startsWith('image/')
  if (isImage && context.modelAcceptsImages && info.size <= MAX_INLINE_IMAGE_BYTES) {
    return {
      summary: `Viewed ${info.name} (${info.mimeType}, ${info.size} bytes).`,
      ...meta,
      shownAsImage: true,
      piContent: [
        {type: 'text', text: `Attachment "${info.name}" (${info.mimeType}, ${info.size} bytes):`},
        {type: 'image', data: Buffer.from(data).toString('base64'), mimeType: info.mimeType!},
      ],
    }
  }
  if (isTextMimeType(info.mimeType) && data.byteLength <= MAX_TOOL_RESULT_BYTES) {
    const text = new TextDecoder('utf-8', {fatal: false}).decode(data)
    return {summary: `Read ${info.name} (${info.size} bytes).`, ...meta, shownAsImage: false, content: text}
  }
  const reason = isImage
    ? context.modelAcceptsImages
      ? 'the image is too large to view inline'
      : 'this model does not support image input'
    : 'the content is not viewable inline'
  return {
    summary: `${info.name} (${info.mimeType || 'unknown type'}, ${
      info.size
    } bytes); ${reason}. Save it to memory with write and process it with the execute tool.`,
    ...meta,
    shownAsImage: false,
  }
}

/** Reads a thread address: a compact transcript of one of this account's sessions. */
function readThreadAddress(context: AgentServicePiToolContext, sessionId: string): Record<string, unknown> {
  const session = context.db
    .query<{id: string; title: string | null; agent_id: string}, [string, string]>(
      `SELECT id, title, agent_id FROM sessions WHERE account_id = ? AND id = ?`,
    )
    .get(context.accountId, sessionId)
  if (!session) throw new APIError(404, `No thread ${sessionId}`)
  const rows = context.db
    .query<SessionEventRow, [string]>(
      `SELECT id, session_id, seq, event_cbor, created_at FROM session_events WHERE session_id = ? ORDER BY seq DESC LIMIT 200`,
    )
    .all(sessionId)
    .reverse()
    .map(sessionEventRowToInfo)
  const lines = rows.map((row) => {
    const event = row.event as {type?: string; role?: string; content?: unknown; name?: string; message?: string}
    if (event.type === 'message') {
      const content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content)
      return `**${event.role ?? 'unknown'}**: ${content}`
    }
    if (event.type === 'tool_call') return `→ tool call ${event.name ?? ''}`
    if (event.type === 'tool_result') return `← tool result ${event.name ?? ''}`
    if (event.type === 'error') return `⚠ error: ${event.message ?? ''}`
    return `(${event.type ?? 'event'})`
  })
  const markdown = lines.join('\n\n')
  const bounded =
    markdown.length > MAX_TOOL_RESULT_BYTES
      ? `[earlier events truncated]\n\n${markdown.slice(-MAX_TOOL_RESULT_BYTES)}`
      : markdown
  return {
    summary: `Thread "${session.title ?? sessionId}": ${rows.length} recent events.`,
    sessionId,
    title: session.title,
    markdown: bounded,
  }
}

/** Reads a run address: the run's public record. */
function readRunAddress(context: AgentServicePiToolContext, runId: string): Record<string, unknown> {
  const run = runs.getRun(context.db, context.accountId, runId)
  if (!run) throw new APIError(404, `No run ${runId}`)
  return {
    summary: `Run ${run.id} (${run.kind}) is ${run.status}.`,
    ...runInfoFromRecord(run),
    ...(run.sourceText ? {sourceText: run.sourceText} : {}),
  }
}

/**
 * Callables a session's transcript shows as expanded: a read of ~/tools/<name> or any call by
 * name. Scans durable tool_call events only, so the answer is identical after resume, restart,
 * or compaction — the transcript is the pin.
 */
export function expandedCallablesFromEvents(db: Database, sessionId: string): string[] {
  const rows = db
    .query<SessionEventRow, [string]>(
      `SELECT id, session_id, seq, event_cbor, created_at FROM session_events WHERE session_id = ? ORDER BY seq ASC`,
    )
    .all(sessionId)
  const expanded = new Set<string>()
  for (const row of rows) {
    const event = sessionEventRowToInfo(row).event as {
      type?: string
      name?: string
      input?: {address?: unknown; tool?: unknown}
    }
    if (event.type !== 'tool_call' || !isRecord(event.input)) continue
    // Only the AGENT's own touches expand its provider toolset; a user's palette call replays as
    // a text block, not a tool exchange, and must not silently reshape the agent's active tools.
    if (sessionEventActor(event as never) === 'user') continue
    if (event.name === seedVerbRegistry.read.name && typeof event.input.address === 'string') {
      const address = event.input.address.trim()
      if (address.startsWith('~/tools/')) expanded.add(address.slice('~/tools/'.length).replace(/\/+$/, ''))
    }
    if (event.name === seedVerbRegistry.call.name && typeof event.input.tool === 'string') {
      expanded.add(event.input.tool.trim())
    }
  }
  return [...expanded]
}

/** Executes the read verb: one dispatcher over every address form. */
export async function executeReadVerb(
  context: AgentServicePiToolContext,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {}
  const address = typeof input.address === 'string' ? input.address.trim() : ''
  if (!address) throw new APIError(400, 'read requires an address')
  const options = isRecord(input.options) ? input.options : {}
  const format = input.format === 'json' ? 'json' : 'markdown'

  const memoryPath = memoryPathFromAddress(address)
  if (memoryPath !== null) return readMemoryAddress(context, memoryPath)

  if (address === '~/tools' || address === '~/tools/') return toolsListing(context)
  if (address.startsWith('~/tools/')) {
    const name = address.slice('~/tools/'.length).replace(/\/+$/, '')
    const verb = (seedVerbRegistry as Record<string, SeedToolMetadata>)[name]
    if (verb) return {summary: `Contract for ${name}.`, name, markdown: toolContractMarkdown(verb)}
    toolDocs.ensureBuiltinToolDocuments(context.db, context.accountId, context.agentId)
    const row = toolDocs.getToolDocument(context.db, context.accountId, context.agentId, name)
    if (!row || (row.doc.kind === 'builtin' && !context.callableTools.includes(name))) {
      return {...toolsListing(context), summary: `No tool named ${name}.`}
    }
    return {
      summary: `Contract for ${name} (${row.cid}).`,
      name,
      cid: row.cid,
      kind: row.doc.kind,
      markdown: contractMarkdownForThisServer(context, row),
    }
  }

  if (address.startsWith('ipfs://')) {
    const cid = parseIpfsCid(address)
    const gatewayUrl = `${context.hmServerUrl.replace(/\/$/, '')}/ipfs/${cid}`
    const targetPath = typeof options.path === 'string' && options.path.trim() ? options.path : `ipfs/${cid}`
    const result = await withMemoryErrorsAsync(() =>
      agentMemory.downloadToMemory(context.stateDir, gatewayUrl, targetPath),
    )
    context.onMemoryChange()
    const file = withMemoryErrors(() => agentMemory.readMemoryFile(context.stateDir, result.entry.path))
    const base = {path: file.path, cid, size: file.size, mimeType: file.mimeType}
    if (file.encoding === 'binary') {
      return {
        summary: `Fetched ipfs://${cid} to ${file.path} (${file.size} bytes${
          file.mimeType ? `, ${file.mimeType}` : ''
        }); binary content not shown.`,
        ...base,
      }
    }
    return {summary: `Fetched ipfs://${cid} to ${file.path} (${file.size} bytes).`, ...base, content: file.content}
  }

  if (address === 'activity:' || address.startsWith('activity:')) {
    const client = createSeedClient(context.hmServerUrl)
    const output = await client.request('ListEvents', {
      pageSize:
        typeof options.pageSize === 'number' ? Math.max(1, Math.min(50, Math.floor(options.pageSize))) : undefined,
      pageToken: typeof options.pageToken === 'string' ? options.pageToken : undefined,
      trustedOnly: typeof options.trustedOnly === 'boolean' ? options.trustedOnly : undefined,
      filterAuthors: Array.isArray(options.authors)
        ? options.authors.filter((author): author is string => typeof author === 'string')
        : undefined,
      filterEventType: Array.isArray(options.eventTypes)
        ? options.eventTypes.filter((eventType): eventType is string => typeof eventType === 'string')
        : undefined,
      filterResource: typeof options.resource === 'string' ? options.resource : undefined,
      currentAccount: context.accountId,
    })
    return {
      summary: `Loaded ${Array.isArray(output.events) ? output.events.length : 0} activity feed event${
        Array.isArray(output.events) && output.events.length === 1 ? '' : 's'
      }.`,
      ...output,
    }
  }

  if (address.startsWith('attachment:')) return readAttachmentAddress(context, address.slice('attachment:'.length))
  if (address.startsWith('thread:')) return readThreadAddress(context, address.slice('thread:'.length))
  if (address.startsWith('run:')) return readRunAddress(context, address.slice('run:'.length))

  if (address.startsWith('hm://')) return readHypermedia({id: address, format})
  if (/^https?:\/\//.test(address)) {
    // Seed sites and gateway URLs resolve as hypermedia first; anything else is a web page.
    // Fall through to the web reader ONLY when the URL is established as not-hypermedia (the
    // resolver's explicit marker) or the document is absent (404 on a real Seed site can still be
    // an ordinary web page). Every other failure — transient daemon errors, too-large, network —
    // surfaces instead of being silently replaced by scraped page HTML the model would mistake
    // for the document's real content.
    try {
      return await readHypermedia({id: address, format})
    } catch (error) {
      const notHypermedia =
        error instanceof Error && error.message.includes('does not appear to be a Seed Hypermedia resource')
      const notFound = error instanceof APIError && error.status === 404
      if (!notHypermedia && !notFound) throw error
      return executeWebRead(context.web, {url: address, ...options})
    }
  }

  throw new APIError(
    400,
    `Unrecognized address: ${address}. Supported: ~/memory/…, ~/tools/…, hm://…, ipfs://…, https://…, activity:, attachment:<id>, thread:<id>, run:<id>.`,
  )
}

/** Executes the write verb: memory, ipfs publishing, and hypermedia documents. */
export async function executeWriteVerb(
  context: AgentServicePiToolContext,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {}
  const address = typeof input.address === 'string' ? input.address.trim() : ''
  if (!address) throw new APIError(400, 'write requires an address')
  const options = isRecord(input.options) ? input.options : {}
  const content = typeof input.content === 'string' ? input.content : undefined

  if (address.startsWith('~/tools/')) {
    const name = address.slice('~/tools/'.length).replace(/\/+$/, '')
    try {
      if (options.delete === true) {
        const deleted = toolDocs.deleteToolDocument(context.db, context.accountId, context.agentId, name)
        context.onMemoryChange()
        return {summary: deleted ? `Deleted tool ${name}.` : `No tool named ${name}.`, name, deleted}
      }
      const parsed = content !== undefined ? (JSON.parse(content) as unknown) : options.tool
      const row = toolDocs.saveLambdaToolDocument(context.db, context.accountId, context.agentId, {
        ...(isRecord(parsed) ? parsed : {}),
        name,
      })
      context.onMemoryChange()
      return {
        summary: `Saved tool ${name} (${row.cid}). Call it by name with the call verb; its contract is live in ~/tools now.`,
        name,
        cid: row.cid,
        kind: row.doc.kind,
      }
    } catch (error) {
      if (error instanceof toolDocs.ToolDocumentError) throw new APIError(error.status, error.message)
      if (error instanceof SyntaxError) {
        throw new APIError(
          400,
          'write ~/tools/<name> expects JSON content: {description, input, output?, source, runtime?}',
        )
      }
      throw error
    }
  }

  const memoryPath = memoryPathFromAddress(address)
  if (memoryPath !== null) {
    if (options.delete === true) {
      const result = withMemoryErrors(() => agentMemory.deleteMemoryPath(context.stateDir, memoryPath))
      if (result.deleted) context.onMemoryChange()
      return {
        summary: result.deleted ? `Deleted ${result.path}.` : `Nothing existed at ${result.path}.`,
        ...result,
      }
    }
    if (typeof options.fromUrl === 'string' && options.fromUrl) {
      const fromUrl = options.fromUrl
      const result = await withMemoryErrorsAsync(() =>
        agentMemory.downloadToMemory(context.stateDir, fromUrl, memoryPath),
      )
      context.onMemoryChange()
      return {
        summary: `Downloaded ${result.finalUrl} to ${result.entry.path} (${result.entry.size} bytes${
          result.entry.mimeType ? `, ${result.entry.mimeType}` : ''
        }).`,
        path: result.entry.path,
        size: result.entry.size,
        mimeType: result.entry.mimeType,
        finalUrl: result.finalUrl,
        contentType: result.contentType,
      }
    }
    if (typeof options.fromAttachment === 'string' && options.fromAttachment) {
      const fromAttachment = options.fromAttachment
      const {info, data} = withAttachmentErrors(() =>
        sessionAttachments.readSessionAttachment(context.stateDir, context.sessionId, fromAttachment),
      )
      const targetPath = memoryPath || `attachments/${info.name}`
      const entry = withMemoryErrors(() => agentMemory.writeMemoryFile(context.stateDir, targetPath, data))
      context.onMemoryChange()
      return {
        summary: `Saved attachment ${info.name} to memory at ${entry.path} (${entry.size} bytes).`,
        id: info.id,
        path: entry.path,
        size: entry.size,
        mimeType: entry.mimeType,
      }
    }
    if (content === undefined) {
      throw new APIError(
        400,
        'write to ~/memory requires content (or options.delete / options.fromUrl / options.fromAttachment)',
      )
    }
    const entry = withMemoryErrors(() => agentMemory.writeMemoryFile(context.stateDir, memoryPath, content))
    context.onMemoryChange()
    return {summary: `Wrote ${entry.path} (${entry.size} bytes).`, ...entry}
  }

  if (address.startsWith('ipfs:')) {
    if (!context.publishEnabled) {
      throw new APIError(
        403,
        'Publishing is not enabled for this agent. The owner can grant "Publish Seed content" in its tool settings.',
      )
    }
    if (typeof options.fromAttachment === 'string' && options.fromAttachment) {
      const fromAttachment = options.fromAttachment
      const {info, data} = withAttachmentErrors(() =>
        sessionAttachments.readSessionAttachment(context.stateDir, context.sessionId, fromAttachment),
      )
      const {cid, url} = await uploadBytesToHmIpfs(context.hmServerUrl, data, info.mimeType, info.name)
      return {
        summary: `Published attachment ${info.name} to IPFS as ${url}.`,
        id: info.id,
        name: info.name,
        cid,
        url,
        size: info.size,
        mimeType: info.mimeType,
      }
    }
    const fromPath =
      typeof options.fromPath === 'string' && options.fromPath
        ? memoryPathFromAddress(options.fromPath) ?? options.fromPath
        : undefined
    if (!fromPath)
      throw new APIError(400, 'write ipfs:// requires options.fromPath (a memory path) or options.fromAttachment')
    const file = withMemoryErrors(() => agentMemory.readMemoryFile(context.stateDir, fromPath))
    const bytes =
      file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
    const fileName = file.path.split('/').at(-1) || 'file'
    const {cid, url} = await uploadBytesToHmIpfs(context.hmServerUrl, bytes, file.mimeType, fileName)
    return {
      summary: `Uploaded ${file.path} to IPFS as ${url}.`,
      path: file.path,
      cid,
      url,
      size: file.size,
      mimeType: file.mimeType,
    }
  }

  const hm = parseHmAddress(address)
  if (hm) {
    if (!context.publishEnabled) {
      throw new APIError(
        403,
        'Publishing is not enabled for this agent. The owner can grant "Publish Seed content" in its tool settings.',
      )
    }
    // Publishing a memory markdown file (frontmatter + resolved images) keeps its dedicated pipeline.
    const fromPath = typeof options.fromPath === 'string' && options.fromPath ? options.fromPath : undefined
    if (fromPath) {
      return publishMemoryDocument(context as AgentServicePiToolContext, {
        path: memoryPathFromAddress(fromPath) ?? fromPath,
        // '/' means "derive the path from the file's frontmatter title", matching the old tool.
        ...(hm.path !== '/' ? {documentPath: hm.path} : {}),
        account: hm.account,
        signer: options.signer,
        dryRun: options.dryRun === true,
      })
    }
    const action = typeof options.action === 'string' ? options.action : 'document'
    // Extra command fields ride ONLY in options.input, never as loose option keys: the command
    // handlers accept aliases (reply, commentId, name, …), so a stray key silently changing the
    // operation is a real hazard. Dotted raw commands get the same explicit envelope.
    const passthrough = isRecord(options.input) ? options.input : {}
    const envelope = (command: string, commandInput: Record<string, unknown>): Record<string, unknown> => ({
      command,
      signer: options.signer,
      dryRun: options.dryRun === true,
      input: {...passthrough, ...commandInput},
    })
    switch (action) {
      case 'document':
        return writeHypermedia(
          context,
          envelope('document.create', {
            account: hm.account,
            path: hm.path,
            ...(typeof options.title === 'string' ? {name: options.title} : {}),
            ...(content !== undefined ? {content, format: 'markdown'} : {}),
          }),
        )
      case 'update':
        return writeHypermedia(
          context,
          envelope('document.update', {
            account: hm.account,
            path: hm.path,
            ...(typeof options.title === 'string' ? {name: options.title} : {}),
            ...(content !== undefined ? {content, format: 'markdown'} : {}),
          }),
        )
      case 'comment':
        return writeHypermedia(
          context,
          envelope('comment.create', {
            target: typeof options.target === 'string' ? options.target : address,
            ...(typeof options.replyTo === 'string' ? {replyTo: options.replyTo} : {}),
            ...(content !== undefined ? {content} : {}),
          }),
        )
      case 'move':
        return writeHypermedia(
          context,
          envelope('document.move', {
            source: address,
            ...(typeof options.toPath === 'string' ? {path: options.toPath} : {}),
          }),
        )
      case 'redirect':
        return writeHypermedia(
          context,
          envelope('document.redirect', {
            source: address,
            ...(typeof options.toUrl === 'string' ? {destination: options.toUrl} : {}),
          }),
        )
      case 'delete':
        return writeHypermedia(context, envelope('document.delete', {account: hm.account, path: hm.path}))
      case 'fork':
        return writeHypermedia(
          context,
          envelope('document.fork', {
            account: hm.account,
            path: hm.path,
            ...(typeof options.fromUrl === 'string' ? {source: options.fromUrl} : {}),
          }),
        )
      default:
        // Dotted actions pass through as raw hypermedia commands (profile.update, draft.create,
        // contact.create, capability.grant, …) with the address filling account/path and options
        // spread into the command input — full envelope fidelity behind one verb.
        if (action.includes('.')) {
          return writeHypermedia(
            context,
            envelope(action, {
              account: hm.account,
              ...(hm.path !== '/' ? {path: hm.path} : {}),
              ...(typeof options.title === 'string' ? {name: options.title} : {}),
              ...(content !== undefined ? {content, format: 'markdown'} : {}),
            }),
          )
        }
        throw new APIError(
          400,
          `Unknown write action "${action}". Supported: document (default), update, comment, move, redirect, delete, fork, or a raw command like draft.create / profile.update.`,
        )
    }
  }

  throw new APIError(
    400,
    `Unrecognized write address: ${address}. Supported: ~/memory/…, ipfs://, hm://<account>/<path>.`,
  )
}

/**
 * The execute contract as THIS server can honor it: the runtime enum lists only the runtimes it
 * can actually run, so the model never reads an option that would fail inside the sandbox (the
 * `ts` runtime needs an image with bun, which is an operator opt-in).
 */
function executeToolForRuntimes(runtimes: readonly string[]): SeedToolMetadata {
  const base = callableToolRegistry.execute as SeedToolMetadata
  const runtimeProperty = base.inputSchema.properties?.runtime
  if (!runtimeProperty?.enum) return base
  const offered = runtimeProperty.enum.filter((value) => runtimes.includes(value))
  if (offered.length === 0 || offered.length === runtimeProperty.enum.length) return base
  return {
    ...base,
    inputSchema: {
      ...base.inputSchema,
      properties: {...base.inputSchema.properties, runtime: {...runtimeProperty, enum: offered}},
    },
  }
}

/**
 * A stored contract as THIS server can honor it.
 *
 * The document is the shipped contract, identical everywhere, which is what its CID means. The
 * execute tool is the one place where a server can offer less than the document promises (the `ts`
 * runtime needs an image with bun), so a read of it shows the narrowed enum and says so — the
 * contract a model reads is then exactly the one it can call.
 */
function contractMarkdownForThisServer(context: AgentServicePiToolContext, row: toolDocs.ToolDocumentRow): string {
  if (row.doc.name !== callableToolRegistry.execute.name) return toolDocs.toolDocumentContractMarkdown(row)
  const offered = executeToolForRuntimes(context.codeExec.runtimes)
  if (offered === (callableToolRegistry.execute as SeedToolMetadata)) {
    return toolDocs.toolDocumentContractMarkdown(row)
  }
  const narrowed = {...row, doc: {...row.doc, input: offered.inputSchema}}
  return `${toolDocs.toolDocumentContractMarkdown(narrowed)}\n\n> This server runs ${context.codeExec.runtimes.join(
    ', ',
  )}; the runtime list above is narrowed to what it can actually run.`
}

/**
 * Runs an authored lambda tool: its stored source, executed in the same sandbox the execute tool
 * uses, with the call's validated input handed in and its return value handed back. See
 * tool-documents.ts for the ABI, and code-exec.ts for how the program is assembled.
 *
 * Failures are thrown rather than returned: a lambda that crashes, returns nothing, or returns
 * something its own output schema rejects is a broken tool, and the model that authored it is the
 * one who can fix it — so it gets the error, not a plausible-looking empty result.
 */
async function executeLambdaTool(
  context: AgentServicePiToolContext,
  row: toolDocs.ToolDocumentRow,
  rawInput: unknown,
  toolCallId: string | undefined,
): Promise<Record<string, unknown>> {
  const doc = row.doc
  const toolInput = isRecord(rawInput) ? rawInput : {}
  const validationErrors = validateJsonSchemaValue(doc.input, toolInput)
  if (validationErrors.length > 0) {
    // Same touch-expand contract as builtins: a miss answers with the contract, not an error.
    return {
      summary: `Input for ${doc.name} did not match its contract — here it is; call again with valid input.`,
      contract: toolDocs.toolDocumentContractMarkdown(row),
      validationErrors: validationErrors.map((error) => `${error.path}: ${error.message}`),
    }
  }
  const source = typeof doc.source === 'string' ? doc.source : ''
  if (!source.trim()) throw new APIError(400, `Tool ${doc.name} has no source to run`)
  const runtime: LambdaRuntime = doc.runtime === 'python' ? 'python' : 'ts'
  // What the HOST can do comes first: when the server cannot run this runtime at all, saying the
  // owner should grant something would send the user off to fix the wrong thing.
  if (!context.codeExec.runtimes.includes(runtime)) {
    throw new APIError(
      400,
      `Tool ${doc.name} is written in ${doc.runtime ?? 'typescript'}, which this server cannot run: ${
        runtime === 'ts'
          ? 'TypeScript tools need a sandbox image with bun on PATH.'
          : 'code execution is unavailable here.'
      }`,
    )
  }
  // An authored tool is code in the sandbox, so it rides on the SAME grant the execute tool needs.
  // Without this, writing a lambda would be a way around an owner who turned code execution off.
  if (!context.callableTools.includes(callableToolRegistry.execute.name)) {
    throw new APIError(
      403,
      `Tool ${doc.name} runs code in the sandbox, which is not enabled for this agent. Its owner can grant code execution in the agent's tool settings.`,
    )
  }

  let execution: CodeExecResult
  try {
    execution = await context.codeExec.execute({
      stateDir: context.stateDir,
      runtime,
      code: buildLambdaProgram(runtime, source, toolInput),
      onProgress: (progress) =>
        context.onToolProgress(seedVerbRegistry.call.name, {
          toolCallId,
          detail: progress.stage === 'starting' ? 'Starting sandbox…' : `Running ${doc.name}…`,
          outputTail: progress.outputTail,
        }),
    })
  } catch (error) {
    if (error instanceof CodeExecError) throw new APIError(error.status, error.message)
    throw error
  }
  if (execution.changedFiles.length) context.onMemoryChange()

  const {result, hasResult, logs} = parseLambdaResult(execution.stdout)
  if (!execution.success) {
    const detail = (execution.stderr.trim() || logs || '').split('\n').slice(-8).join('\n')
    throw new APIError(400, `Tool ${doc.name} failed (exit ${execution.exitCode})${detail ? `:\n${detail}` : ''}`)
  }
  if (!hasResult) {
    throw new APIError(
      400,
      `Tool ${doc.name} finished without returning a value. ${
        runtime === 'python'
          ? 'Its main(input) function must return the result.'
          : 'Its default export must return the result.'
      }`,
    )
  }
  if (doc.output) {
    const outputErrors = validateJsonSchemaValue(doc.output, result)
    if (outputErrors.length > 0) {
      throw new APIError(
        400,
        `Tool ${doc.name} returned a value its own output schema rejects: ${outputErrors
          .map((error) => `${error.path}: ${error.message}`)
          .join('; ')}`,
      )
    }
  }
  const changeSummary = execution.changedFiles.length
    ? `, ${execution.changedFiles.length} memory file${execution.changedFiles.length === 1 ? '' : 's'} changed`
    : ''
  return {
    summary: `Ran ${doc.name} (${execution.durationMs}ms${changeSummary}).`,
    result,
    ...(logs ? {logs} : {}),
    ...(execution.changedFiles.length ? {changedFiles: execution.changedFiles} : {}),
    durationMs: execution.durationMs,
  }
}

/**
 * The pause a run has earned by outliving its wall-clock budget, or nothing when it still has time.
 * Measured from when the run was created, so sleeps and parks count — the budget is about how long
 * a piece of work may stay open, not how much CPU it burns.
 */
function budgetPauseFor(run: runs.RunRecord): {reason: 'budget-pause'; note: string} | null {
  const maxWallMs = run.budget?.maxWallMs
  if (maxWallMs === undefined || maxWallMs <= 0) return null
  const elapsed = Date.now() - run.createdAt
  if (elapsed < maxWallMs) return null
  return {
    reason: 'budget-pause',
    note: `Paused after ${formatDurationForHumans(elapsed)}: its time budget was ${formatDurationForHumans(maxWallMs)}`,
  }
}

/** Rough, readable duration for parked-state copy: "40 minutes", "3 hours", "2 days". */
function formatDurationForHumans(ms: number): string {
  const units: Array<[number, string]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ]
  for (const [size, name] of units) {
    if (ms >= size) {
      const count = Math.round(ms / size)
      return `${count} ${name}${count === 1 ? '' : 's'}`
    }
  }
  return 'less than a second'
}

/** Executes the call verb: contract-on-miss dispatch into the callable tool set. */
export async function executeCallVerb(
  context: AgentServicePiToolContext,
  raw: unknown,
  toolCallId: string | undefined,
): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {}
  const toolName = typeof input.tool === 'string' ? normalizeSeedToolName(input.tool.trim()) : ''
  const registryTool = toolName ? getSeedTool(toolName) : undefined
  const tool =
    registryTool && toolName === callableToolRegistry.execute.name
      ? executeToolForRuntimes(context.codeExec.runtimes)
      : registryTool
  if (!tool || !context.callableTools.includes(toolName)) {
    const lambda = toolName
      ? toolDocs.getToolDocument(context.db, context.accountId, context.agentId, toolName)
      : undefined
    if (lambda && lambda.doc.kind === 'lambda' && lambda.enabled) {
      return executeLambdaTool(context, lambda, input.input, toolCallId)
    }
    return {
      ...toolsListing(context),
      summary: toolName
        ? `No callable tool named ${toolName}. Here is what you can call.`
        : 'call requires a tool name. Here is what you can call.',
    }
  }
  const toolInput = isRecord(input.input) ? input.input : {}
  const validationErrors = validateJsonSchemaValue(tool.inputSchema, toolInput)
  if (validationErrors.length > 0) {
    // Touch-expand: a miss returns the contract instead of failing; the retry executes.
    return {
      summary: `Input for ${toolName} did not match its contract — here it is; call again with valid input.`,
      contract: toolContractMarkdown(tool),
      validationErrors: validationErrors.map((error) => `${error.path}: ${error.message}`),
    }
  }
  switch (toolName) {
    case 'search':
      return executeAgentServiceSearch(context, toolInput)
    case 'web_search':
      return executeWebSearch(context.web, toolInput)
    case 'execute': {
      const runtime = typeof toolInput.runtime === 'string' ? toolInput.runtime : 'code'
      let result
      try {
        result = await context.codeExec.execute({
          stateDir: context.stateDir,
          runtime: toolInput.runtime as never,
          code: typeof toolInput.code === 'string' ? toolInput.code : '',
          timeoutSecs: typeof toolInput.timeout_secs === 'number' ? toolInput.timeout_secs : undefined,
          onProgress: (progress) =>
            context.onToolProgress(seedVerbRegistry.call.name, {
              toolCallId,
              detail: progress.stage === 'starting' ? 'Starting sandbox…' : `Running ${runtime} code…`,
              outputTail: progress.outputTail,
            }),
        })
      } catch (error) {
        if (error instanceof CodeExecError) throw new APIError(error.status, error.message)
        throw error
      }
      if (result.changedFiles.length) context.onMemoryChange()
      const changeSummary = result.changedFiles.length
        ? `, ${result.changedFiles.length} memory file${result.changedFiles.length === 1 ? '' : 's'} changed`
        : ''
      return {
        summary: `Ran ${runtime} code (exit ${result.exitCode}, ${result.durationMs}ms${changeSummary}).`,
        ...result,
      }
    }
    default:
      throw new APIError(400, `Tool ${toolName} has no executor in this runtime`)
  }
}

function createAgentServicePiTools(context: AgentServicePiToolContext): pi.ToolDefinition[] {
  const promoted = (context.expandedCallables ?? [])
    .filter((name) => context.callableTools.includes(name))
    .flatMap((name) => {
      const registryTool = getSeedTool(name)
      if (!registryTool) return []
      // The promoted schema must say what this server can run, exactly like the call verb's does.
      const tool =
        name === callableToolRegistry.execute.name ? executeToolForRuntimes(context.codeExec.runtimes) : registryTool
      return [
        defineSeedPiTool(tool, (params, toolCallId) =>
          executeCallVerb(context, {tool: name, input: params}, toolCallId),
        ),
      ]
    })
  return [
    ...promoted,
    defineSeedPiTool(seedVerbRegistry.read, (params) => executeReadVerb(context, params)),
    defineSeedPiTool(seedVerbRegistry.write, (params) => executeWriteVerb(context, params)),
    defineSeedPiTool(seedVerbRegistry.call, (params, toolCallId) => executeCallVerb(context, params, toolCallId)),
    defineSeedPiTool(seedVerbRegistry.delegate, (params, toolCallId) => {
      const input = isPlainRecord(params) ? params : {}
      if (typeof input.script === 'string' && input.script) {
        if (input.await === false) {
          throw new APIError(
            400,
            'Detached script children are not supported: scripts are awaited. Drop `await: false`, or delegate a model child instead.',
          )
        }
        if (!context.spawnWorkflow) throw new APIError(400, 'Script delegation is not available in this run context')
        return context.spawnWorkflow(toolCallId, {
          ...(typeof input.title === 'string' ? {title: input.title} : {title: 'Script'}),
          source: input.script,
          input: input.input,
        })
      }
      if (input.await === false) {
        // Detached children run as this agent with the brief as their first message; the other
        // model-child fields have no meaning without an awaited result, so reject them loudly
        // instead of silently discarding what the model asked for.
        for (const field of ['agentId', 'output', 'tools'] as const) {
          if (input[field] !== undefined) {
            throw new APIError(
              400,
              `delegate {await: false} does not support \`${field}\` — a detached child runs as this agent and returns nothing. Await the child, or drop ${field}.`,
            )
          }
        }
        const brief = input.brief ?? input.input ?? input.prompt
        if (brief === undefined)
          throw new APIError(400, 'delegate requires a `brief` — the task briefing as human-readable markdown')
        const started = context.startSession({
          prompt: renderSubSessionInput(brief),
          ...(typeof input.title === 'string' ? {title: input.title} : {}),
        })
        return {
          summary: `Started detached child "${started.title}"; it is now running in the background.`,
          status: 'detached',
          ...started,
        }
      }
      if (!context.spawnSubSession) throw new APIError(400, 'delegate is not available in this run context')
      return context.spawnSubSession(toolCallId, params)
    }),
    defineSeedPiTool(seedVerbRegistry.plan, (params) => {
      if (!context.setSessionPlan) throw new APIError(400, 'plan is not available in this context')
      const session = context.setSessionPlan(params)
      return {ok: true, steps: session.plan?.steps.length ?? 0}
    }),
    defineSeedPiTool(
      context.returnResultSchema
        ? {...seedVerbRegistry.return_result, inputSchema: context.returnResultSchema}
        : seedVerbRegistry.return_result,
      (params) => {
        if (!context.deliverResult)
          throw new APIError(400, 'return_result is only available in typed delegate children')
        return context.deliverResult(params)
      },
    ),
  ]
}

async function writeHypermedia(context: WriteToolContext, raw: unknown): Promise<Record<string, unknown>> {
  const request = normalizeWriteToolRequest(raw)
  if (request.server || request.dev) {
    const requestedServerUrl = optionsToServerUrl({server: request.server, dev: request.dev})
    if (canonicalServerUrl(requestedServerUrl) !== canonicalServerUrl(context.hmServerUrl)) {
      throw new APIError(400, 'write publishes only to the configured agent HM server')
    }
  }
  const serverUrl = context.hmServerUrl
  const client = createSeedClient(serverUrl)

  if (request.command.startsWith('draft.') && request.command !== 'draft.publish') {
    return writeDraftCommand(context, request)
  }

  const signer = await resolveWriteSigner(context, request.signer)

  switch (request.command) {
    case 'profile.update':
      return writeProfileUpdate(context, client, signer, request)
    case 'profile.alias':
      return writeProfileAlias(client, signer, request)
    case 'capability.create':
    case 'capability.grant':
      return writeCapabilityCreate(client, signer, request)
    case 'contact.create':
      return writeContactCreate(client, signer, request)
    case 'contact.delete':
      return writeContactDelete(client, signer, request)
    case 'comment.create':
      return writeCommentCreate(client, signer, request)
    case 'comment.update':
      return writeCommentUpdate(client, signer, request)
    case 'comment.delete':
      return writeCommentDelete(client, signer, request)
    case 'document.create':
      return writeDocumentCreate(client, signer, request)
    case 'document.update':
      return writeDocumentUpdate(client, signer, request)
    case 'document.delete':
      return writeDocumentDelete(client, signer, request)
    case 'document.fork':
    case 'document.ref':
      return writeDocumentRef(client, signer, request)
    case 'document.move':
      return writeDocumentMove(client, signer, request)
    case 'document.redirect':
      return writeDocumentRedirect(client, signer, request)
    case 'draft.publish':
      return writeDraftPublish(context, client, signer, request)
    default:
      return writeToolError(request.command, `Unsupported write command: ${request.command}`)
  }
}

function normalizeWriteToolRequest(raw: unknown): {
  command: string
  signer?: {profileName?: string; publicKey?: string}
  server?: string
  dev?: boolean
  dryRun: boolean
  input: Record<string, unknown>
} {
  if (!isPlainRecord(raw)) throw new APIError(400, 'Write tool input must be an object')
  const command = normalizeBoundedString(raw.command, 'Write command', MAX_NAME_BYTES)
  const signer = raw.signer
  if (signer !== undefined && !isPlainRecord(signer)) throw new APIError(400, 'Write signer must be an object')
  const server = raw.server
  if (server !== undefined && typeof server !== 'string') throw new APIError(400, 'Write server must be a string')
  const dev = raw.dev
  if (dev !== undefined && typeof dev !== 'boolean') throw new APIError(400, 'Write dev must be a boolean')
  const dryRun = raw.dryRun === undefined ? false : normalizeBoolean(raw.dryRun, 'Write dryRun')
  const explicitInput = raw.input === undefined ? {} : raw.input
  if (!isPlainRecord(explicitInput)) throw new APIError(400, 'Write input must be an object')
  const rootInput = Object.fromEntries(
    Object.entries(raw).filter(([key]) => !['command', 'signer', 'server', 'dev', 'dryRun', 'input'].includes(key)),
  )
  return {
    command,
    ...(signer ? {signer: signer as {profileName?: string; publicKey?: string}} : {}),
    server,
    dev,
    dryRun,
    input: {...rootInput, ...explicitInput},
  }
}

async function resolveWriteSigner(
  context: WriteToolContext,
  selector: {profileName?: string; publicKey?: string} | undefined,
): Promise<ResolvedAgentSigner> {
  const allowed =
    context.definition.signingKeys || (context.definition.signingKey ? [context.definition.signingKey] : [])
  const identities = await listWriteSigningIdentities(context.db, context.accountId, allowed)
  if (identities.length === 0) throw new APIError(400, 'No signing identities are enabled for this agent')

  let matches = identities
  if (selector?.publicKey !== undefined) {
    const publicKey = normalizeBoundedString(selector.publicKey, 'Signer public key', MAX_NAME_BYTES)
    matches = identities.filter((identity) => identity.publicKey === publicKey)
    if (matches.length === 0) throw new APIError(400, 'Signer public key is not enabled for this agent')
  } else if (selector?.profileName !== undefined) {
    const profileName = normalizeBoundedString(selector.profileName, 'Signer profile name', MAX_NAME_BYTES)
    matches = identities.filter((identity) => identity.profileName === profileName)
    if (matches.length === 0) throw new APIError(400, 'Signer profile name is not enabled for this agent')
  } else if (matches.length > 1) {
    throw new APIError(400, 'Multiple signing identities are enabled; choose a signer by profileName or publicKey')
  }
  if (matches.length > 1) throw new APIError(400, 'Signing profile name is ambiguous; choose by publicKey')

  const selected = matches[0]
  if (!selected) throw new APIError(400, 'Signing identity not found')
  const row = context.db
    .query<{ciphertext: Uint8Array}, [string, string]>(
      `SELECT ciphertext FROM secrets WHERE account_id = ? AND name = ?`,
    )
    .get(context.accountId, selected.secretName)
  if (!row) throw new APIError(400, 'Signing identity secret not found')
  const keyPair = blobs.nobleKeyPairFromSeed(await decryptSecret(context.db, row.ciphertext))
  return {
    ...selected,
    keyPair,
    signer: {
      getPublicKey: async () => keyPair.principal,
      sign: (data) => keyPair.sign(data),
    },
  }
}

async function listWriteSigningIdentities(
  db: Database,
  accountId: string,
  allowedSecretNames: string[],
): Promise<Array<{secretName: string; profileName: string; publicKey: string}>> {
  const deduped = Array.from(new Set(allowedSecretNames))
  const identities = []
  for (const secretName of deduped) {
    const row = db
      .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
        `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
      )
      .get(accountId, secretName)
    if (!row?.metadata_cbor) continue
    const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
    if (metadata.kind !== 'hm-account-key') continue
    const publicKey = typeof metadata.accountId === 'string' ? metadata.accountId : secretName
    const profileName = typeof metadata.label === 'string' ? metadata.label : secretName
    identities.push({secretName, publicKey, profileName})
  }
  return identities
}

async function writeProfileUpdate(
  context: WriteToolContext,
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const name = normalizeOptionalBoundedString(request.input.name, 'Profile name', MAX_NAME_BYTES) || signer.profileName
  const description = normalizeOptionalBoundedString(request.input.description, 'Profile description', MAX_PROMPT_BYTES)
  const avatar = normalizeOptionalBoundedString(request.input.icon ?? request.input.avatar, 'Profile avatar', 2048)
  if (request.dryRun)
    return writeToolResult(request.command, signer, {profile: {name, publicKey: signer.publicKey}, dryRun: true})
  const profile = await blobs.createProfile(signer.keyPair, {name, description, avatar}, Date.now())
  const published = await client.publish({blobs: [{cid: profile.cid.toString(), data: profile.data}]})
  const now = Date.now()
  const row = context.db
    .query<{metadata_cbor: Uint8Array | null}, [string, string]>(
      `SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`,
    )
    .get(context.accountId, signer.secretName)
  if (row?.metadata_cbor) {
    const metadata = cbor.decode<Record<string, unknown>>(row.metadata_cbor)
    if (metadata.kind === 'hm-account-key') {
      context.db.run(`UPDATE secrets SET metadata_cbor = ?, updated_at = ? WHERE account_id = ? AND name = ?`, [
        cbor.encode({...metadata, label: name, accountId: signer.publicKey}),
        now,
        context.accountId,
        signer.secretName,
      ])
    }
  }
  return writeToolResult(request.command, signer, {profile: {name, publicKey: signer.publicKey}, cids: published.cids})
}

async function writeProfileAlias(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const alias = normalizeBoundedString(request.input.alias, 'Profile alias', MAX_NAME_BYTES)
  if (request.dryRun) return writeToolResult(request.command, signer, {alias, dryRun: true})
  const profile = await blobs.createProfileAlias(signer.keyPair, blobs.principalFromString(alias), Date.now())
  const published = await client.publish({blobs: [{cid: profile.cid.toString(), data: profile.data}]})
  return writeToolResult(request.command, signer, {alias, cids: published.cids})
}

async function writeCapabilityCreate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const delegateUid = normalizeBoundedString(
    request.input.delegate ?? request.input.delegateUid,
    'Capability delegate',
    MAX_NAME_BYTES,
  )
  const role = normalizeBoundedString(request.input.role, 'Capability role', MAX_NAME_BYTES).toUpperCase()
  if (role !== 'WRITER' && role !== 'AGENT') throw new APIError(400, 'Capability role must be WRITER or AGENT')
  const path = normalizeOptionalBoundedString(request.input.path, 'Capability path', 2048)
  const label = normalizeOptionalBoundedString(request.input.label, 'Capability label', MAX_NAME_BYTES)
  if (request.dryRun)
    return writeToolResult(request.command, signer, {delegate: delegateUid, role, path, label, dryRun: true})
  const published = await client.publish(await createCapability({delegateUid, role, path, label}, signer.signer))
  return writeToolResult(request.command, signer, {delegate: delegateUid, role, cids: published.cids})
}

async function writeContactCreate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const subjectUid = normalizeBoundedString(
    request.input.subject ?? request.input.subjectUid,
    'Contact subject',
    MAX_NAME_BYTES,
  )
  const name = normalizeBoundedString(request.input.name, 'Contact name', MAX_NAME_BYTES)
  if (request.dryRun) return writeToolResult(request.command, signer, {subject: subjectUid, name, dryRun: true})
  const input = await createContact({subjectUid, name}, signer.signer)
  const published = await client.publish(input)
  return writeToolResult(request.command, signer, {contactId: input.recordId, cids: published.cids})
}

async function writeContactDelete(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const contactId = normalizeBoundedString(request.input.contact ?? request.input.contactId, 'Contact ID', 2048)
  if (request.dryRun) return writeToolResult(request.command, signer, {contactId, dryRun: true})
  const published = await client.publish(await deleteContact({contactId}, signer.signer))
  return writeToolResult(request.command, signer, {contactId, cids: published.cids})
}

function normalizeCommentId(value: unknown, label: string): string {
  const raw = normalizeBoundedString(value, label, 2048)
  const id = unpackHmId(raw)
  if (!id) return raw
  return `${id.uid}${hmIdPathToEntityQueryPath(id.path)}`
}

async function writeCommentCreate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const body = normalizeWriteContent(request.input.body ?? request.input.content ?? request.input.text, 'Comment body')
  const reply =
    request.input.replyCommentId ??
    request.input.replyComment ??
    request.input.reply ??
    request.input.replyTo ??
    request.input.commentId
  const parentComment =
    reply === undefined ? undefined : await client.request('Comment', normalizeCommentId(reply, 'Reply comment'))
  const target =
    normalizeOptionalBoundedString(
      request.input.target ?? request.input.targetId ?? request.input.id,
      'Comment target',
      2048,
    ) ||
    (parentComment
      ? `hm://${parentComment.targetAccount}${
          parentComment.targetPath ? `/${parentComment.targetPath.replace(/^\/+/, '')}` : ''
        }`
      : undefined)
  if (!target) throw new APIError(400, 'Comment target is required')
  const {id} = await resolveIdWithClient(target, {serverUrl: client.baseUrl})
  const resourceId = {...id, blockRef: null}
  const resource = await client.request('Resource', resourceId)
  if (resource.type !== 'document') throw new APIError(400, `Comment target is ${resource.type}, not a document`)
  const blocks = commentMarkdownToBlocks(body)
  const replyCommentVersion = parentComment?.version || undefined
  const rootReplyCommentVersion = parentComment
    ? parentComment.threadRootVersion || parentComment.version || undefined
    : undefined
  const docVersion = parentComment?.targetVersion || resource.document.version
  const visibility = (parentComment?.visibility || resource.document.visibility) === 'PRIVATE' ? 'Private' : ''
  if (request.dryRun)
    return writeToolResult(request.command, signer, {
      target: packHmId(id),
      ...(parentComment ? {replyCommentId: parentComment.id} : {}),
      blockCount: blocks.length,
      dryRun: true,
    })
  const publishInput = await createComment(
    {
      content: blocks,
      docId: {...id, blockRef: null, version: null},
      docVersion,
      blobs: [],
      replyCommentVersion,
      rootReplyCommentVersion,
      visibility,
    },
    signer.signer,
  )
  const commentBlob = publishInput.blobs[0]?.data
  if (!commentBlob) throw new APIError(500, 'Failed to create comment blob')
  const commentId = await commentRecordIdFromBlob(commentBlob)
  const published = await client.publish(publishInput)
  const targetUrl = packHmId(resourceId)
  return writeToolResult(request.command, signer, {
    commentId,
    commentRecordId: commentId,
    commentUrl: appendCommentViewToTargetUrl(targetUrl, commentId),
    commentCid: published.cids[0],
    target: targetUrl,
    targetUrl,
    targetName: resource.document.metadata?.name || targetUrl,
    authorUrl: `hm://${signer.publicKey}`,
    authorName: signer.profileName || signer.publicKey,
    markdown: body,
    ...(parentComment ? {replyCommentId: parentComment.id} : {}),
    cids: published.cids,
  })
}

async function writeCommentUpdate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const commentId = normalizeCommentId(request.input.comment ?? request.input.commentId, 'Comment ID')
  const body = normalizeWriteContent(request.input.body ?? request.input.content ?? request.input.text, 'Comment body')
  const existing = await client.request('Comment', commentId)
  if (request.dryRun) return writeToolResult(request.command, signer, {commentId, dryRun: true})
  const published = await client.publish(
    await updateComment(
      {
        commentId,
        targetAccount: existing.targetAccount,
        targetPath: existing.targetPath || '',
        targetVersion: existing.targetVersion,
        content: commentMarkdownToBlocks(body),
        replyParentVersion: existing.replyParentVersion || null,
        rootReplyCommentVersion: existing.threadRootVersion || null,
        visibility: existing.visibility === 'PRIVATE' ? 'Private' : '',
      },
      signer.signer,
    ),
  )
  return writeToolResult(request.command, signer, {commentId, cids: published.cids})
}

async function writeCommentDelete(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const commentId = normalizeCommentId(request.input.comment ?? request.input.commentId, 'Comment ID')
  const existing = await client.request('Comment', commentId)
  if (request.dryRun) return writeToolResult(request.command, signer, {commentId, dryRun: true})
  const published = await client.publish(
    await deleteComment(
      {
        commentId,
        targetAccount: existing.targetAccount,
        targetPath: existing.targetPath || '',
        targetVersion: existing.targetVersion,
        visibility: existing.visibility === 'PRIVATE' ? 'Private' : '',
      },
      signer.signer,
    ),
  )
  return writeToolResult(request.command, signer, {commentId, cids: published.cids})
}

/**
 * Refuses document creation under a parent path that does not yet exist. A nested document such as
 * `/team/notes` requires `/team` to already be a published document. Top-level documents (whose parent
 * is the account home/root) are always allowed.
 */
async function ensureParentDocumentExists(
  client: ReturnType<typeof createSeedClient>,
  account: string,
  path: string,
): Promise<void> {
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 1) return // root/home document, or a top-level document whose parent is the account home
  const parentPath = `/${segments.slice(0, -1).join('/')}`
  const {id} = await resolveIdWithClient(`hm://${account}${parentPath}`, {serverUrl: client.baseUrl})
  const resource = await client.request('Resource', id).catch(() => undefined)
  if (resource?.type !== 'document') {
    throw new APIError(
      400,
      `Cannot create document at ${path}: parent path ${parentPath} does not exist. Create the parent document first.`,
    )
  }
}

async function writeDocumentCreate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
  extraBlobs: CollectedBlob[] = [],
): Promise<Record<string, unknown>> {
  const parsed = parseWriteDocumentContent(request.input)
  const metadata = mergeWriteMetadata(parsed.metadata, request.input, {name: 'Untitled'})
  const account =
    normalizeOptionalBoundedString(request.input.account, 'Document account', MAX_NAME_BYTES) || signer.publicKey
  const path = normalizeDocumentPath(request.input.path, metadata.name || 'Untitled')
  await ensureParentDocumentExists(client, account, path)
  const ops = metadataToWriteSetAttributes(metadata).concat(parsed.ops)
  if (request.dryRun)
    return writeToolResult(request.command, signer, {
      id: `hm://${account}${path}`,
      metadata,
      blockCount: parsed.blocks.length,
      dryRun: true,
    })
  const capability = await resolveCapability(client, account, signer.publicKey)
  const genesisBlock = await createGenesisChange(signer.signer)
  const {unsignedBytes, ts} = createChangeOps({ops, genesisCid: genesisBlock.cid, deps: [genesisBlock.cid], depth: 1})
  const changeBlock = await createChange(unsignedBytes, signer.signer)
  const refInput = await createVersionRef(
    {
      space: account,
      path,
      genesis: genesisBlock.cid.toString(),
      version: changeBlock.cid.toString(),
      generation: Number(ts),
      capability,
    },
    signer.signer,
  )
  const published = await client.publish({
    blobs: [
      {data: new Uint8Array(genesisBlock.bytes), cid: genesisBlock.cid.toString()},
      {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
      ...refInput.blobs,
      ...extraBlobs,
    ],
  })
  return writeToolResult(request.command, signer, {
    id: `hm://${account}${path}`,
    version: changeBlock.cid.toString(),
    cids: published.cids,
  })
}

async function writeDocumentUpdate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
  extraBlobs: CollectedBlob[] = [],
): Promise<Record<string, unknown>> {
  const edit = normalizeBoundedString(request.input.edit ?? request.input.id, 'Document edit target', 2048)
  const {id} = await resolveIdWithClient(edit, {serverUrl: client.baseUrl})
  const resource = await client.request('Resource', id)
  if (resource.type !== 'document') throw new APIError(400, `Resource is ${resource.type}, not a document`)
  if (
    typeof request.input.expectedVersion === 'string' &&
    resource.document.version !== request.input.expectedVersion
  ) {
    return writeToolError(request.command, 'Document version conflict', {currentVersion: resource.document.version})
  }
  const parsed = parseWriteDocumentContent(request.input)
  const metadata = mergeWriteMetadata(parsed.metadata, request.input)
  const oldMap = createBlocksMap((resource.document.content || []).map((node) => hmBlockNodeToBlockNode(node)) as never)
  const contentOps = computeReplaceOps(oldMap, parsed.blocks.map((node) => hmBlockNodeToBlockNode(node)) as never)
  const ops = metadataToWriteSetAttributes(metadata).concat(contentOps)
  if (ops.length === 0) throw new APIError(400, 'No document updates specified')
  if (request.dryRun)
    return writeToolResult(request.command, signer, {id: packHmId(id), blockCount: parsed.blocks.length, dryRun: true})
  const state = await resolveDocumentState(client, edit)
  const capability = await resolveCapability(client, resource.document.account, signer.publicKey)
  const {unsignedBytes, ts} = createChangeOps({
    ops,
    genesisCid: CID.parse(state.genesis),
    deps: state.heads.map((head) => CID.parse(head)),
    depth: state.headDepth + 1,
  })
  const changeBlock = await createChange(unsignedBytes, signer.signer)
  const refInput = await createVersionRef(
    {
      space: resource.document.account,
      path: resource.document.path || '',
      genesis: state.genesis,
      version: changeBlock.cid.toString(),
      generation: Number(ts),
      capability,
    },
    signer.signer,
  )
  const published = await client.publish({
    blobs: [
      {data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()},
      ...refInput.blobs,
      ...extraBlobs,
    ],
  })
  return writeToolResult(request.command, signer, {
    id: packHmId(id),
    version: changeBlock.cid.toString(),
    cids: published.cids,
  })
}

async function writeDocumentDelete(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const target = normalizeBoundedString(request.input.id ?? request.input.target, 'Document ID', 2048)
  const {id} = await resolveIdWithClient(target, {serverUrl: client.baseUrl})
  const resource = await client.request('Resource', id)
  if (resource.type !== 'document') throw new APIError(400, `Cannot delete ${resource.type}`)
  if (request.dryRun) return writeToolResult(request.command, signer, {id: packHmId(id), dryRun: true})
  const capability = await resolveCapability(client, id.uid, signer.publicKey)
  const refInput = await createTombstoneRef(
    {
      space: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      genesis: resource.document.genesis,
      generation: resource.document.generationInfo ? Number(resource.document.generationInfo.generation) : 0,
      capability,
    },
    signer.signer,
  )
  const published = await client.publish(refInput)
  return writeToolResult(request.command, signer, {id: packHmId(id), cids: published.cids})
}

async function writeDocumentRef(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const source = request.input.source ?? request.input.sourceId
  if (typeof source === 'string') {
    const destination = normalizeBoundedString(
      request.input.destination ?? request.input.destinationId,
      'Destination ID',
      2048,
    )
    const {id: sourceId} = await resolveIdWithClient(source, {serverUrl: client.baseUrl})
    const {id: destId} = await resolveIdWithClient(destination, {serverUrl: client.baseUrl})
    const resource = await client.request('Resource', sourceId)
    if (resource.type !== 'document') throw new APIError(400, 'Source is not a document')
    if (!resource.document.generationInfo) throw new APIError(400, 'Source document has no generation info')
    if (request.dryRun) return writeToolResult(request.command, signer, {id: packHmId(destId), dryRun: true})
    const refInput = await createVersionRef(
      {
        space: destId.uid,
        path: hmIdPathToEntityQueryPath(destId.path),
        genesis: resource.document.generationInfo.genesis,
        version: resource.document.version,
        generation: Number(resource.document.generationInfo.generation),
      },
      signer.signer,
    )
    const published = await client.publish(refInput)
    return writeToolResult(request.command, signer, {id: packHmId(destId), cids: published.cids})
  }
  const space = normalizeBoundedString(request.input.space, 'Ref space', MAX_NAME_BYTES)
  const path = normalizeDocumentPath(request.input.path, '')
  const genesis = normalizeBoundedString(request.input.genesis, 'Ref genesis', 2048)
  const version = normalizeBoundedString(request.input.version, 'Ref version', 2048)
  const generation = normalizeOptionalNumber(request.input.generation, 'Ref generation') ?? Date.now()
  const capability = normalizeOptionalBoundedString(request.input.capability, 'Ref capability', 2048)
  if (request.dryRun)
    return writeToolResult(request.command, signer, {id: `hm://${space}${path}`, genesis, version, dryRun: true})
  const refInput = await createVersionRef({space, path, genesis, version, generation, capability}, signer.signer)
  const published = await client.publish(refInput)
  return writeToolResult(request.command, signer, {id: `hm://${space}${path}`, version, cids: published.cids})
}

async function writeDocumentMove(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const source = normalizeBoundedString(
    request.input.source ??
      request.input.sourceId ??
      request.input.id ??
      request.input.target ??
      request.input.targetId,
    'Source ID',
    2048,
  )
  const destination = await resolveMoveDestination(client, source, request.input)
  const {id: sourceId} = await resolveIdWithClient(source, {serverUrl: client.baseUrl})
  const {id: destId} = await resolveIdWithClient(destination, {serverUrl: client.baseUrl})
  const sourceResource = await client.request('Resource', sourceId)
  if (sourceResource.type !== 'document') throw new APIError(400, 'Source is not a document')
  const destinationAlreadyMatches = await destinationMatchesDocument(client, destId, sourceResource.document).catch(
    () => false,
  )
  const ref = destinationAlreadyMatches
    ? writeToolResult('document.fork', signer, {
        id: packHmId(destId),
        status: 'already_exists',
        version: sourceResource.document.version,
      })
    : await writeDocumentRef(client, signer, {
        ...request,
        command: 'document.fork',
        input: {source, destination},
        dryRun: request.dryRun,
      })
  if (request.dryRun) return ref
  try {
    const redirect = await writeDocumentRedirect(client, signer, {...request, input: {id: source, to: destination}})
    return writeToolResult(request.command, signer, {destination: packHmId(destId), ref, redirect})
  } catch (error) {
    return writeToolResult(request.command, signer, {
      destination: packHmId(destId),
      ref,
      warning: `Destination was created, but source redirect failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  }
}

async function destinationMatchesDocument(
  client: ReturnType<typeof createSeedClient>,
  destId: ReturnType<typeof unpackHmId> extends infer T ? NonNullable<T> : never,
  source: HMDocument,
): Promise<boolean> {
  const resource = await client.request('Resource', destId)
  return (
    resource.type === 'document' &&
    resource.document.version === source.version &&
    resource.document.generationInfo?.genesis === source.generationInfo?.genesis
  )
}

async function resolveMoveDestination(
  client: ReturnType<typeof createSeedClient>,
  source: string,
  input: Record<string, unknown>,
): Promise<string> {
  const explicit = input.destination ?? input.destinationId ?? input.to
  if (explicit !== undefined) return normalizeBoundedString(explicit, 'Destination ID', 2048)

  if (input.path === undefined) throw new APIError(400, 'Destination ID or path is required')
  const {id: sourceId} = await resolveIdWithClient(source, {serverUrl: client.baseUrl})
  const path = normalizeDocumentPath(input.path, '')
  return `hm://${sourceId.uid}${path === '/' ? '' : path}`
}

async function writeDocumentRedirect(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const source = normalizeBoundedString(request.input.id ?? request.input.source, 'Source ID', 2048)
  const to = normalizeBoundedString(request.input.to ?? request.input.target, 'Redirect target', 2048)
  const {id: sourceId} = await resolveIdWithClient(source, {serverUrl: client.baseUrl})
  const {id: targetId} = await resolveIdWithClient(to, {serverUrl: client.baseUrl})
  const resource = await client.request('Resource', sourceId)
  if (resource.type !== 'document') throw new APIError(400, 'Redirect source is not a document')
  if (request.dryRun)
    return writeToolResult(request.command, signer, {id: packHmId(sourceId), target: packHmId(targetId), dryRun: true})
  const capability = await resolveCapability(client, sourceId.uid, signer.publicKey)
  const refInput = await createRedirectRef(
    {
      space: sourceId.uid,
      path: hmIdPathToEntityQueryPath(sourceId.path),
      genesis: resource.document.genesis,
      generation: resource.document.generationInfo ? Number(resource.document.generationInfo.generation) : 1,
      targetSpace: targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(targetId.path),
      capability,
      republish: request.input.republish === true,
    },
    signer.signer,
  )
  const published = await client.publish(refInput)
  return writeToolResult(request.command, signer, {
    id: packHmId(sourceId),
    target: packHmId(targetId),
    cids: published.cids,
  })
}

function writeDraftCommand(
  context: WriteToolContext,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Record<string, unknown> {
  switch (request.command) {
    case 'draft.create':
      return writeDraftCreate(context, request)
    case 'draft.update':
      return writeDraftUpdate(context, request)
    case 'draft.get':
      return writeDraftGet(context, request)
    case 'draft.list':
      return writeDraftList(context, request)
    case 'draft.delete':
      return writeDraftDelete(context, request)
    default:
      return writeToolError(request.command, `Unsupported draft command: ${request.command}`)
  }
}

function writeDraftCreate(
  context: WriteToolContext,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Record<string, unknown> {
  const parsed = parseWriteDocumentContent(request.input)
  const metadata = mergeWriteMetadata(parsed.metadata, request.input)
  const title =
    normalizeOptionalBoundedString(request.input.name, 'Draft name', MAX_NAME_BYTES) || metadata.name || 'Untitled'
  const draftId = crypto.randomUUID()
  if (request.dryRun) return writeToolResult(request.command, undefined, {draftId, title, metadata, dryRun: true})
  const now = Date.now()
  context.db.run(
    `INSERT INTO agent_drafts (id, account_id, agent_id, signer_secret_name, title, content_format, content_cbor, metadata_cbor, edit_target, location_target, path_name, visibility, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      draftId,
      context.accountId,
      context.agentId,
      null,
      title,
      'json',
      cbor.encode(parsed.blocks),
      cbor.encode(metadata),
      nullableString(request.input.edit),
      nullableString(request.input.location),
      nullableString(request.input.path),
      nullableString(request.input.visibility),
      'idle',
      now,
      now,
    ],
  )
  return writeToolResult(request.command, undefined, {draftId, title, metadata})
}

function writeDraftUpdate(
  context: WriteToolContext,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Record<string, unknown> {
  const draftId = normalizeBoundedString(request.input.draft ?? request.input.draftId, 'Draft ID', MAX_NAME_BYTES)
  const existing = getDraftRow(context, draftId)
  const hasContent = request.input.content !== undefined
  const blocks = hasContent
    ? parseWriteDocumentContent(request.input).blocks
    : cbor.decode<HMBlockNode[]>(existing.content_cbor)
  const existingMetadata = existing.metadata_cbor ? cbor.decode<HMMetadata>(existing.metadata_cbor) : {}
  const metadata = hasContent
    ? mergeWriteMetadata(parseWriteDocumentContent(request.input).metadata, request.input)
    : mergeWriteMetadata(existingMetadata, request.input)
  const title =
    normalizeOptionalBoundedString(request.input.name, 'Draft name', MAX_NAME_BYTES) ||
    metadata.name ||
    existing.title ||
    'Untitled'
  if (request.dryRun) return writeToolResult(request.command, undefined, {draftId, title, metadata, dryRun: true})
  context.db.run(
    `UPDATE agent_drafts SET title = ?, content_cbor = ?, metadata_cbor = ?, edit_target = COALESCE(?, edit_target), location_target = COALESCE(?, location_target), path_name = COALESCE(?, path_name), visibility = COALESCE(?, visibility), updated_at = ? WHERE account_id = ? AND agent_id = ? AND id = ?`,
    [
      title,
      cbor.encode(blocks),
      cbor.encode(metadata),
      undefinedToNull(request.input.edit) ?? null,
      undefinedToNull(request.input.location) ?? null,
      undefinedToNull(request.input.path) ?? null,
      undefinedToNull(request.input.visibility) ?? null,
      Date.now(),
      context.accountId,
      context.agentId,
      draftId,
    ],
  )
  return writeToolResult(request.command, undefined, {draftId, title, metadata})
}

function writeDraftGet(
  context: WriteToolContext,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Record<string, unknown> {
  const draftId = normalizeBoundedString(request.input.draft ?? request.input.draftId, 'Draft ID', MAX_NAME_BYTES)
  const row = getDraftRow(context, draftId)
  const blocks = cbor.decode<HMBlockNode[]>(row.content_cbor)
  const metadata = row.metadata_cbor ? cbor.decode<HMMetadata>(row.metadata_cbor) : {}
  const doc = {content: blocks, metadata, version: '', authors: []} as unknown as HMDocument
  const markdown = blocksToMarkdown(doc)
  return writeToolResult(request.command, undefined, {
    draftId,
    title: row.title,
    metadata,
    markdown: ensureToolResultSize(markdown),
    status: row.status,
    edit: row.edit_target,
    location: row.location_target,
    path: row.path_name,
    visibility: row.visibility,
  })
}

function writeDraftList(
  context: WriteToolContext,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Record<string, unknown> {
  const limit = Math.min(normalizeOptionalNumber(request.input.limit, 'Draft list limit') ?? 50, 100)
  const rows = context.db
    .query<
      {
        id: string
        title: string | null
        status: string
        edit_target: string | null
        location_target: string | null
        updated_at: number
      },
      [string, string, number]
    >(
      `SELECT id, title, status, edit_target, location_target, updated_at FROM agent_drafts WHERE account_id = ? AND agent_id = ? AND status <> 'deleted' ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(context.accountId, context.agentId, limit)
  return writeToolResult(request.command, undefined, {drafts: rows})
}

function writeDraftDelete(
  context: WriteToolContext,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Record<string, unknown> {
  const draftId = normalizeBoundedString(request.input.draft ?? request.input.draftId, 'Draft ID', MAX_NAME_BYTES)
  getDraftRow(context, draftId)
  if (request.dryRun) return writeToolResult(request.command, undefined, {draftId, dryRun: true})
  context.db.run(
    `UPDATE agent_drafts SET status = ?, updated_at = ? WHERE account_id = ? AND agent_id = ? AND id = ?`,
    ['deleted', Date.now(), context.accountId, context.agentId, draftId],
  )
  return writeToolResult(request.command, undefined, {draftId, status: 'deleted'})
}

async function writeDraftPublish(
  context: WriteToolContext,
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const draftId = normalizeBoundedString(request.input.draft ?? request.input.draftId, 'Draft ID', MAX_NAME_BYTES)
  const row = getDraftRow(context, draftId)
  const blocks = cbor.decode<HMBlockNode[]>(row.content_cbor)
  const metadata = row.metadata_cbor ? cbor.decode<HMMetadata>(row.metadata_cbor) : {}
  const content = {blocks, metadata, ops: hmBlockNodesToOperations(blocks)}
  const command = row.edit_target ? 'document.update' : 'document.create'
  const publishRequest = {
    ...request,
    command,
    input: row.edit_target
      ? {
          edit: row.edit_target,
          content: blocks,
          format: 'json',
          metadata,
          expectedVersion: request.input.expectedVersion,
        }
      : {content: blocks, format: 'json', metadata, path: row.path_name || undefined},
  }
  if (request.dryRun) return writeToolResult(request.command, signer, {draftId, title: row.title, dryRun: true})
  const result = row.edit_target
    ? await writeDocumentUpdate(client, signer, publishRequest)
    : await writeDocumentCreate(client, signer, publishRequest)
  context.db.run(
    `UPDATE agent_drafts SET status = ?, published_at = ?, published_id = ?, published_version = ?, updated_at = ? WHERE account_id = ? AND agent_id = ? AND id = ?`,
    [
      'published',
      Date.now(),
      typeof result.id === 'string' ? result.id : null,
      typeof result.version === 'string' ? result.version : null,
      Date.now(),
      context.accountId,
      context.agentId,
      draftId,
    ],
  )
  return {...result, command: request.command, draftId}
}

/**
 * memory_publish_document: publish one markdown memory file as a Seed document.
 *
 * Mirrors `seed-cli document create`: frontmatter becomes document metadata, and relative
 * image links (parsed into file:// links by the shared markdown parser) are read from memory,
 * chunked into UnixFS blobs, and rewritten to ipfs:// URLs published alongside the change.
 * When a document already exists at the target path it is updated in place so its history,
 * comments, and citations survive; otherwise a new document is created.
 */
async function publishMemoryDocument(
  context: WriteToolContext & {stateDir: string},
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = isRecord(raw) ? raw : {}
  const dryRun = input.dryRun === undefined ? false : normalizeBoolean(input.dryRun, 'dryRun')
  const signerSelector = input.signer as {profileName?: string; publicKey?: string} | undefined
  if (signerSelector !== undefined && !isRecord(signerSelector)) throw new APIError(400, 'Signer must be an object')

  const file = withMemoryErrors(() => agentMemory.readMemoryFile(context.stateDir, input.path))
  if (file.encoding !== 'utf8')
    throw new APIError(400, `Memory file ${file.path} is not UTF-8 text; only markdown files can be published`)
  if (file.size > MAX_WRITE_CONTENT_BYTES) throw new APIError(400, `Memory file ${file.path} is too large to publish`)

  const {tree, metadata: frontmatter} = parseMarkdown(file.content ?? '')
  const parsedNodes = markdownBlockNodesToHMBlockNodes(tree)
  const imagesUploaded = countFileLinkBlocks(parsedNodes)
  const baseDir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''
  const {nodes, blobs: fileBlobs} = await resolveFileLinksInBlocks(parsedNodes, (linkPath) =>
    readMemoryLinkBytes(context.stateDir, baseDir, linkPath),
  )
  // Frontmatter media (icon, cover, logo) referencing memory files gets the same treatment
  // as body images: read from memory, chunk to UnixFS, and rewrite to ipfs://.
  for (const key of ['icon', 'cover', 'seedExperimentalLogo'] as const) {
    const value = frontmatter[key]
    if (typeof value !== 'string' || !value) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('file://')) continue
    const bytes = readMemoryLinkBytes(context.stateDir, baseDir, value.replace(/^file:\/\//, ''))
    const chunked = await fileToIpfsBlobs(bytes)
    frontmatter[key] = `ipfs://${chunked.cid}`
    fileBlobs.push(...chunked.blobs)
  }

  const signer = await resolveWriteSigner(context, signerSelector)
  const account = normalizeOptionalBoundedString(input.account, 'Document account', MAX_NAME_BYTES) || signer.publicKey
  const nameOverride = normalizeOptionalBoundedString(input.name, 'Document name', MAX_NAME_BYTES)
  const title = nameOverride || frontmatter.name || titleFromMemoryPath(file.path)
  const docPath = normalizeDocumentPath(input.documentPath, title)
  const target = `hm://${account}${docPath}`

  const client = createSeedClient(context.hmServerUrl)
  const {id: targetId} = await resolveIdWithClient(target, {serverUrl: client.baseUrl})
  const existingResource = await client.request('Resource', targetId).catch(() => undefined)
  const existing = existingResource?.type === 'document'

  const command = existing ? 'document.update' : 'document.create'
  const publishRequest = {
    command,
    server: undefined,
    dev: undefined,
    dryRun,
    input: existing
      ? {
          edit: target,
          content: nodes,
          format: 'json',
          metadata: frontmatter,
          ...(nameOverride ? {name: nameOverride} : {}),
        }
      : {
          account,
          path: docPath || '/',
          content: nodes,
          format: 'json',
          metadata: frontmatter,
          name: title,
        },
  }
  const result = existing
    ? await writeDocumentUpdate(client, signer, publishRequest, fileBlobs)
    : await writeDocumentCreate(client, signer, publishRequest, fileBlobs)

  const imagesNote = imagesUploaded ? ` with ${imagesUploaded} image${imagesUploaded === 1 ? '' : 's'}` : ''
  const summary = dryRun
    ? `Validated ${file.path} for publishing to ${target}${imagesNote}.`
    : `${existing ? 'Updated' : 'Published'} ${file.path} ${existing ? 'at' : 'as'} ${target}${imagesNote}.`
  return {
    ...result,
    summary,
    memoryPath: file.path,
    url: `${context.hmServerUrl.replace(/\/+$/, '')}/hm/${account}${docPath}`,
    ...(imagesUploaded ? {imagesUploaded} : {}),
  }
}

/** Counts blocks whose link points at a local file, for reporting how many images get uploaded. */
function countFileLinkBlocks(nodes: HMBlockNode[]): number {
  let count = 0
  for (const node of nodes) {
    const link = (node.block as Record<string, unknown>).link
    if (typeof link === 'string' && link.startsWith('file://')) count += 1
    if (node.children?.length) count += countFileLinkBlocks(node.children)
  }
  return count
}

/**
 * Reads bytes for a file link inside a published markdown file. Relative links resolve against
 * the markdown file's own directory first, then the memory root; `..` segments are collapsed
 * but never allowed to escape the memory root.
 */
function readMemoryLinkBytes(stateDir: string, baseDir: string, linkPath: string): Uint8Array {
  const rootRelative = linkPath.startsWith('/')
  const candidates = (
    rootRelative || !baseDir
      ? [collapseMemoryPath(linkPath)]
      : [collapseMemoryPath(`${baseDir}/${linkPath}`), collapseMemoryPath(linkPath)]
  ).filter((candidate, index, all): candidate is string => !!candidate && all.indexOf(candidate) === index)
  for (const candidate of candidates) {
    let file: agentMemory.AgentMemoryFileData
    try {
      file = agentMemory.readMemoryFile(stateDir, candidate)
    } catch {
      continue
    }
    return file.encoding === 'binary' ? file.data ?? new Uint8Array() : new TextEncoder().encode(file.content ?? '')
  }
  throw new APIError(400, `Linked file not found in memory: ${linkPath}`)
}

/** Collapses `.` and `..` segments; returns undefined when the path escapes the memory root. */
function collapseMemoryPath(rawPath: string): string | undefined {
  const segments: string[] = []
  for (const segment of rawPath.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) return undefined
      segments.pop()
    } else {
      segments.push(segment)
    }
  }
  return segments.length ? segments.join('/') : undefined
}

/** Derives a human-readable document title from a memory file name, e.g. notes/weekly-update.md → "Weekly update". */
/** Derives a session title from the first line of a start_session prompt. */
function sessionTitleFromPrompt(prompt: string): string {
  const firstLine = prompt.split('\n', 1)[0]!.replace(/\s+/g, ' ').trim()
  if (!firstLine) return 'Agent-started session'
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
}

function titleFromMemoryPath(memoryPath: string): string {
  const base = memoryPath.split('/').at(-1) ?? memoryPath
  const stem = base.replace(/\.[a-z0-9]+$/i, '')
  const words = stem.replace(/[-_]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Untitled'
}

function getDraftRow(context: WriteToolContext, draftId: string) {
  const row = context.db
    .query<
      {
        id: string
        title: string | null
        content_cbor: Uint8Array
        metadata_cbor: Uint8Array | null
        edit_target: string | null
        location_target: string | null
        path_name: string | null
        visibility: string | null
        status: string
      },
      [string, string, string]
    >(
      `SELECT id, title, content_cbor, metadata_cbor, edit_target, location_target, path_name, visibility, status FROM agent_drafts WHERE account_id = ? AND agent_id = ? AND id = ?`,
    )
    .get(context.accountId, context.agentId, draftId)
  if (!row || row.status === 'deleted') throw new APIError(404, 'Draft not found')
  return row
}

function parseWriteDocumentContent(input: Record<string, unknown>): ParsedWriteDocumentContent {
  const rawContent = input.content ?? input.body ?? input.text
  const format =
    input.format === undefined
      ? typeof rawContent === 'string'
        ? detectWriteContentFormat(rawContent)
        : 'json'
      : input.format
  if (format !== 'markdown' && format !== 'json') throw new APIError(400, 'Document format must be markdown or json')
  if (format === 'markdown') {
    const content = normalizeWriteContent(rawContent, 'Document content')
    const {tree, metadata} = parseMarkdown(content)
    const blocks = markdownBlockNodesToHMBlockNodes(tree)
    return {ops: flattenToOperations(tree), metadata, blocks}
  }
  const blocks = parseWriteJsonBlocks(rawContent)
  return {ops: hmBlockNodesToOperations(blocks), metadata: normalizeMetadataInput(input.metadata), blocks}
}

function parseWriteJsonBlocks(rawContent: unknown): HMBlockNode[] {
  const parsed =
    typeof rawContent === 'string' ? JSON.parse(normalizeWriteContent(rawContent, 'Document content')) : rawContent
  return z.array(HMBlockNodeSchema).parse(parsed) as HMBlockNode[]
}

function hmBlockNodesToOperations(nodes: HMBlockNode[], parentId = ''): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const blockIds: string[] = []
  for (const node of nodes) {
    ops.push({type: 'ReplaceBlock', block: node.block} as DocumentOperation)
    blockIds.push(node.block.id)
    if (node.children?.length) ops.push(...hmBlockNodesToOperations(node.children, node.block.id))
  }
  if (blockIds.length > 0) ops.push({type: 'MoveBlocks', blocks: blockIds, parent: parentId} as DocumentOperation)
  return ops
}

function commentMarkdownToBlocks(content: string): HMBlockNode[] {
  if (!content.trim())
    return [
      {block: {id: crypto.randomUUID(), type: 'Paragraph', text: '', attributes: {}, annotations: []}, children: []},
    ]
  return markdownBlockNodesToHMBlockNodes(parseMarkdown(content).tree)
}

function detectWriteContentFormat(content: string): 'markdown' | 'json' {
  const first = content.trimStart()[0]
  return first === '[' || first === '{' ? 'json' : 'markdown'
}

function normalizeWriteContent(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new APIError(400, `${label} is required`)
  if (new TextEncoder().encode(value).byteLength > MAX_WRITE_CONTENT_BYTES)
    throw new APIError(400, `${label} is too large`)
  return value
}

function normalizeMetadataInput(value: unknown): HMMetadata {
  if (value === undefined) return {}
  if (!isPlainRecord(value)) throw new APIError(400, 'Document metadata must be an object')
  const encoded = cbor.encode(value)
  if (encoded.byteLength > MAX_METADATA_CBOR_BYTES) throw new APIError(400, 'Document metadata is too large')
  return value as HMMetadata
}

function mergeWriteMetadata(
  inputMetadata: HMMetadata,
  input: Record<string, unknown>,
  defaults: HMMetadata = {},
): HMMetadata {
  const metadata: HMMetadata = {...defaults, ...inputMetadata, ...normalizeMetadataInput(input.metadata)}
  if (metadata.name === undefined && input.name === undefined && input.title !== undefined) {
    metadata.name = input.title as HMMetadata['name']
  }
  for (const key of [
    'name',
    'summary',
    'displayAuthor',
    'displayPublishTime',
    'icon',
    'cover',
    'siteUrl',
    'layout',
    'showOutline',
    'showActivity',
    'contentWidth',
    'seedExperimentalLogo',
    'seedExperimentalHomeOrder',
    'importCategories',
    'importTags',
  ]) {
    if (input[key] !== undefined) {
      ;(metadata as Record<string, unknown>)[key] = input[key]
    }
  }
  const encoded = cbor.encode(metadata)
  if (encoded.byteLength > MAX_METADATA_CBOR_BYTES) throw new APIError(400, 'Document metadata is too large')
  return metadata
}

function metadataToWriteSetAttributes(metadata: HMMetadata): DocumentOperation[] {
  const attrs = Object.entries(metadata)
    .filter((entry) => entry[1] !== undefined)
    .map(([key, value]) => ({key: [key], value}))
  return attrs.length ? ([{type: 'SetAttributes', attrs}] as DocumentOperation[]) : []
}

function normalizeDocumentPath(value: unknown, fallbackName: string): string {
  const raw =
    value === undefined || value === null || value === ''
      ? slugifyLocal(fallbackName)
      : normalizeBoundedString(value, 'Document path', 2048)
  if (raw === '/') return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

function slugifyLocal(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  )
}

function appendCommentViewToTargetUrl(targetUrl: string, commentId: string): string {
  const hashIndex = targetUrl.indexOf('#')
  const withoutHash = hashIndex === -1 ? targetUrl : targetUrl.slice(0, hashIndex)
  const queryIndex = withoutHash.indexOf('?')
  if (queryIndex === -1) return `${withoutHash}/:comments/${commentId}`
  return `${withoutHash.slice(0, queryIndex)}/:comments/${commentId}${withoutHash.slice(queryIndex)}`
}

function writeToolResult(
  command: string,
  signer: Pick<ResolvedAgentSigner, 'profileName' | 'publicKey'> | undefined,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'hypermedia_write_result',
    command,
    ...(signer ? {signer: {profileName: signer.profileName, publicKey: signer.publicKey}} : {}),
    message: `${command} completed`,
    ...extra,
  }
}

function writeToolError(command: string, message: string, details?: Record<string, unknown>): Record<string, unknown> {
  return {type: 'hypermedia_write_error', command, message, ...(details ? {details} : {})}
}

/**
 * Neutralizes tag-framing inside user-action payloads: fetched content must not be able to close
 * the <user_action_result> frame and forge trusted user actions (\u003c stays valid in JSON and
 * renders as '<' to humans, but can never form a tag).
 */
function escapeActionFraming(text: string): string {
  return text.replace(/</g, '\\u003c')
}

function ensureToolResultSize(text: string): string {
  if (new TextEncoder().encode(text).byteLength > MAX_TOOL_RESULT_BYTES)
    return text.slice(0, MAX_TOOL_RESULT_BYTES) + '\n[truncated]'
  return text
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function undefinedToNull(value: unknown): string | null | undefined {
  return value === undefined ? undefined : nullableString(value)
}

function normalizeOptionalBoundedString(value: unknown, label: string, maxBytes: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return normalizeBoundedString(value, label, maxBytes)
}

function normalizeOptionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new APIError(400, `${label} must be a number`)
  return value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function piAssistantText(message: {content?: unknown} | undefined): string {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .flatMap((part) => {
      if (part && typeof part === 'object' && (part as {type?: unknown}).type === 'text') {
        const text = (part as {text?: unknown}).text
        return typeof text === 'string' ? [text] : []
      }
      return []
    })
    .join('')
}

function piToolResultText(result: {content?: unknown}): string {
  if (!Array.isArray(result.content)) return 'Tool failed'
  const text = result.content
    .flatMap((part) => {
      if (part && typeof part === 'object' && (part as {type?: unknown}).type === 'text') {
        const value = (part as {text?: unknown}).text
        return typeof value === 'string' ? [value] : []
      }
      return []
    })
    .join('\n')
  return text || 'Tool failed'
}

function piToolResultOutput(result: {content?: unknown; details?: unknown}): unknown {
  return result.details ?? piToolResultText(result)
}

function mergePiPayloadDefaults(payload: unknown, defaults: Record<string, unknown>): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  return {...(payload as Record<string, unknown>), ...defaults}
}

/**
 * Reasserts the agent's validated reasoning level on an OpenAI Responses
 * payload. Pi clamps levels for models its bundled catalog does not know
 * (e.g. it downgrades xhigh to high for gpt-5.6+), but the definition's level
 * was validated against the live per-model matrix and is authoritative.
 * Exported for tests.
 */
export function restoreReasoningEffort(payload: unknown, definition: api.AgentDefinition): unknown {
  if (!definition.reasoningLevel) return payload
  if (!isRecord(payload) || !isRecord(payload.reasoning) || typeof payload.reasoning.effort !== 'string') {
    return payload
  }
  if (payload.reasoning.effort === definition.reasoningLevel) return payload
  return {...payload, reasoning: {...payload.reasoning, effort: definition.reasoningLevel}}
}

function emptyPiUsage(): {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
  cost: {input: number; output: number; cacheRead: number; cacheWrite: number; total: number}
} {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
  }
}

/**
 * Detects a trailing `:attributes` view term (or its legacy `:metadata` spelling) on a resolved id
 * and strips it, so the underlying document can be fetched. The caller then returns only the
 * document's metadata — the same thing the desktop's attributes tab shows.
 */
function stripAttributesViewTerm(id: UnpackedHypermediaId): {
  id: UnpackedHypermediaId
  attributesOnly: boolean
} {
  const lastTerm = id.path?.[id.path.length - 1]
  if (lastTerm !== ':attributes' && lastTerm !== ':metadata') return {id, attributesOnly: false}
  return {id: {...id, path: id.path!.slice(0, -1)}, attributesOnly: true}
}

/** Exported for tests. Implements the agent `read` tool. */
export async function readHypermedia(input: unknown): Promise<Record<string, unknown>> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new APIError(400, 'Tool input must be an object')
  const requestedId = normalizeBoundedString((input as {id?: unknown}).id, 'Hypermedia ID', 2048)
  const server = (input as {server?: unknown}).server
  const dev = (input as {dev?: unknown}).dev
  const format = (input as {format?: unknown}).format
  if (server !== undefined && typeof server !== 'string') throw new APIError(400, 'Tool server must be a string')
  if (dev !== undefined && typeof dev !== 'boolean') throw new APIError(400, 'Tool dev must be a boolean')
  if (format !== undefined && format !== 'markdown' && format !== 'json')
    throw new APIError(400, 'Tool format is invalid')
  if (
    !requestedId.startsWith('hm://') &&
    !requestedId.startsWith('hm:') &&
    !requestedId.startsWith('https://') &&
    !requestedId.startsWith('http://')
  ) {
    throw new APIError(400, 'Tool id must be an hm:// or web URL')
  }
  if (requestedId.startsWith('-')) throw new APIError(400, 'Tool id is invalid')

  const defaultServerUrl = optionsToServerUrl({server, dev})
  let {id, client, serverUrl} = await resolveIdWithClient(requestedId, {
    serverUrl: defaultServerUrl,
    domainResolver: async (hostname) => {
      const domain = await createSeedClient(defaultServerUrl).request('GetDomain', {domain: hostname})
      return domain.registeredAccountUid
    },
  })
  if (id.path?.[0] === ':profile') {
    return readProfileHypermedia({requestedId, id, client, serverUrl, server, dev})
  }
  const stripped = stripAttributesViewTerm(id)
  id = stripped.id
  const attributesOnly = stripped.attributesOnly
  let resource = await client.request('Resource', id)
  if (
    (resource.type === 'not-found' || resource.type === 'error') &&
    !server &&
    !dev &&
    requestedId.startsWith('hm:')
  ) {
    const devResolved = await resolveIdWithClient(requestedId, {serverUrl: 'https://dev.hyper.media'})
    const devId = stripAttributesViewTerm(devResolved.id).id
    const devResource = await devResolved.client.request('Resource', devId)
    if (devResource.type !== 'not-found' && devResource.type !== 'error') {
      id = devId
      serverUrl = devResolved.serverUrl
      resource = devResource
    }
  }
  const outputFormat = format || 'markdown'
  const result: Record<string, unknown> = {
    type: 'hypermedia_document',
    requestedId,
    id: packHmId(id),
    server: serverUrl,
    format: outputFormat,
  }
  if (dev) result.dev = true

  if (resource.type === 'document') {
    result.title = resource.document.metadata?.name
    result.version = resource.document.version
    result.metadata = resource.document.metadata
    if (attributesOnly) {
      // The :attributes view is exactly the metadata — never the document content.
      result.view = 'attributes'
      return result
    }
    if (outputFormat === 'json') {
      result.resource = resource
    } else {
      const markdown = await documentToResolvedMarkdown(resource.document, {client})
      if (new TextEncoder().encode(markdown).byteLength > MAX_TOOL_RESULT_BYTES) {
        throw new APIError(502, 'Hypermedia document is too large for this agent tool')
      }
      result.markdown = markdown
    }
    return result
  }

  if (resource.type === 'comment') {
    result.version = resource.comment.version
    if (outputFormat === 'json') {
      result.resource = resource
    } else {
      const markdown = await commentToResolvedMarkdown(resource.comment, {client})
      if (new TextEncoder().encode(markdown).byteLength > MAX_TOOL_RESULT_BYTES) {
        throw new APIError(502, 'Hypermedia document is too large for this agent tool')
      }
      result.markdown = markdown
    }
    return result
  }

  result.resource = resource
  return result
}

async function readProfileHypermedia(input: {
  requestedId: string
  id: ReturnType<typeof unpackHmId> & {}
  client: ReturnType<typeof createSeedClient>
  serverUrl: string
  server: unknown
  dev: unknown
}): Promise<Record<string, unknown>> {
  const accountUid = input.id.path?.[1] || input.id.uid
  let client = input.client
  let serverUrl = input.serverUrl
  let account = await client.request('Account', accountUid)
  if (
    account.type === 'account-not-found' &&
    !input.server &&
    !input.dev &&
    (input.requestedId.startsWith('hm:') || input.requestedId.includes('hyper.media'))
  ) {
    const devResolved = await resolveIdWithClient(input.requestedId, {serverUrl: 'https://dev.hyper.media'})
    const devAccountUid = devResolved.id.path?.[1] || devResolved.id.uid
    const devAccount = await devResolved.client.request('Account', devAccountUid)
    if (devAccount.type !== 'account-not-found') {
      client = devResolved.client
      serverUrl = devResolved.serverUrl
      account = devAccount
    }
  }
  const profileId = `hm://${accountUid}/:profile`
  const targetId = unpackHmId(`hm://${accountUid}`) || input.id
  const [activity, contacts, capabilities] = await Promise.all([
    client
      .request('ListEvents', {pageSize: 10, filterAuthors: [accountUid], currentAccount: accountUid})
      .catch((error) => ({error: error instanceof Error ? error.message : 'Could not load activity'})),
    client
      .request('AccountContacts', accountUid)
      .catch((error) => ({error: error instanceof Error ? error.message : 'Could not load contacts'})),
    client
      .request('ListCapabilities', {targetId})
      .catch((error) => ({error: error instanceof Error ? error.message : 'Could not load capabilities'})),
  ])
  const name = account.type === 'account' ? account.metadata?.name || accountUid : accountUid
  const activityRecord: Record<string, unknown> = isRecord(activity) ? activity : {}
  const capabilityRecord: Record<string, unknown> = isRecord(capabilities) ? capabilities : {}
  return {
    type: 'hypermedia_profile',
    requestedId: input.requestedId,
    id: profileId,
    accountUid,
    server: serverUrl,
    format: 'markdown',
    ...(input.dev ? {dev: true} : {}),
    title: name,
    account,
    activity,
    contacts,
    capabilities,
    markdown: [
      `# ${name}`,
      '',
      `Profile: [${name}](${profileId})`,
      `Account UID: \`${accountUid}\``,
      Array.isArray(contacts) ? `Contacts/related contact keys: ${contacts.length}` : undefined,
      Array.isArray(capabilityRecord.capabilities)
        ? `Capabilities/related access keys: ${capabilityRecord.capabilities.length}`
        : undefined,
      `Recent activity events loaded: ${Array.isArray(activityRecord.events) ? activityRecord.events.length : 0}`,
    ]
      .filter((line): line is string => typeof line === 'string')
      .join('\n'),
  }
}

function optionsToServerUrl(options: {server?: unknown; dev?: unknown}): string {
  if (options.dev) return 'https://dev.hyper.media'
  if (typeof options.server === 'string') return options.server
  return 'https://hyper.media'
}

function canonicalServerUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return rawUrl.replace(/\/+$/, '')
  }
}

/** Validates the `lines` of a `context` content part. Empty lines are allowed as separators. */
function normalizeContextLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new APIError(400, 'Context lines must be an array of strings')
  if (raw.length > MAX_CONTEXT_LINES) throw new APIError(400, 'Too many context lines')
  return raw.map((line) => {
    if (typeof line !== 'string') throw new APIError(400, 'Context lines must be an array of strings')
    if (new TextEncoder().encode(line).byteLength > MAX_CONTEXT_LINE_BYTES) {
      throw new APIError(400, 'Context line is too large')
    }
    return line
  })
}

function normalizeMessageContent(content: api.MessageSession['content']): Array<{
  text: string
  blocks?: api.AgentMessageBlock[]
  contextLines?: string[]
  attachmentIds?: string[]
}> {
  if (!Array.isArray(content) || content.length === 0) throw new APIError(400, 'Message content is required')
  const contextLines: string[] = []
  const attachmentIds: string[] = []
  const messages = content.flatMap<{text: string; blocks?: api.AgentMessageBlock[]; contextLines?: string[]}>(
    (part) => {
      if (!part || typeof part !== 'object') throw new APIError(400, 'Only text message content is supported')
      if (part.type === 'context') {
        contextLines.push(...normalizeContextLines(part.lines))
        return []
      }
      if (part.type === 'attachment') {
        if (typeof part.id !== 'string' || !/^[0-9a-f]{64}$/.test(part.id)) {
          throw new APIError(400, 'Invalid attachment id')
        }
        if (!attachmentIds.includes(part.id)) attachmentIds.push(part.id)
        if (attachmentIds.length > MAX_MESSAGE_ATTACHMENTS) {
          throw new APIError(400, `A message can reference at most ${MAX_MESSAGE_ATTACHMENTS} attachments`)
        }
        return []
      }
      if (part.type !== 'text' || typeof part.text !== 'string') {
        throw new APIError(400, 'Only text message content is supported')
      }
      const text = part.text.trim()
      return [
        {
          text,
          ...(Array.isArray(part.blocks) && part.blocks.length > 0 ? {blocks: part.blocks} : {}),
        },
      ]
    },
  )
  if (messages.length === 0) throw new APIError(400, 'Message content is required')
  if (messages.some((message) => !message.text)) throw new APIError(400, 'Message content is required')
  if (
    new TextEncoder().encode(messages.map((message) => message.text).join('\n')).byteLength > MAX_MESSAGE_TEXT_BYTES
  ) {
    throw new APIError(400, 'Message content is too large')
  }
  // Context describes the sending window as a whole, so all context parts collapse onto the first
  // message of the request — the turn the model reads them with. Attachments do the same.
  if (contextLines.length > 0) messages[0]!.contextLines = contextLines
  if (attachmentIds.length > 0) (messages[0] as {attachmentIds?: string[]}).attachmentIds = attachmentIds
  return messages
}

async function encryptSecret(db: Database, plaintext: Uint8Array): Promise<Uint8Array> {
  const keyBytes = getOrCreateSecretEncryptionKey(db)
  const nonce = crypto.getRandomValues(new Uint8Array(SECRET_NONCE_BYTES))
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['encrypt'])
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({name: 'AES-GCM', iv: toArrayBuffer(nonce)}, key, toArrayBuffer(plaintext)),
  )
  const out = new Uint8Array(nonce.byteLength + encrypted.byteLength)
  out.set(nonce)
  out.set(encrypted, nonce.byteLength)
  return out
}

async function decryptSecret(db: Database, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (ciphertext.byteLength <= SECRET_NONCE_BYTES) throw new APIError(500, 'Stored secret is invalid')
  const keyBytes = getOrCreateSecretEncryptionKey(db)
  const nonce = ciphertext.slice(0, SECRET_NONCE_BYTES)
  const encrypted = ciphertext.slice(SECRET_NONCE_BYTES)
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, ['decrypt'])
  return new Uint8Array(
    await crypto.subtle.decrypt({name: 'AES-GCM', iv: toArrayBuffer(nonce)}, key, toArrayBuffer(encrypted)),
  )
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function getOrCreateSecretEncryptionKey(db: Database): Uint8Array {
  const row = db
    .query<{value: Uint8Array | ArrayBuffer}, [string]>(`SELECT value FROM server_config WHERE key = ?`)
    .get(SECRET_KEY_CONFIG_KEY)
  if (row) return row.value instanceof Uint8Array ? row.value : new Uint8Array(row.value)

  const key = crypto.getRandomValues(new Uint8Array(32))
  db.run(`INSERT INTO server_config (key, value) VALUES (?, ?)`, [SECRET_KEY_CONFIG_KEY, key])
  return key
}

function normalizeBoundedString(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== 'string') throw new APIError(400, `${label} is required`)
  const normalized = value.trim()
  if (!normalized) throw new APIError(400, `${label} is required`)
  if (new TextEncoder().encode(normalized).byteLength > maxBytes) throw new APIError(400, `${label} is too large`)
  return normalized
}

/** Creates a signed envelope for tests and future local clients. */
export async function createSignedEnvelope(
  signer: blobs.Signer,
  input: {account?: blobs.Principal; action: api.UnsignedAgentAction; ts?: number},
): Promise<api.SignedActionEnvelope> {
  const envelope: api.SignedActionEnvelope = {
    type: 'AgentsAction',
    signer: signer.principal,
    sig: new Uint8Array(blobs.ED25519_SIGNATURE_SIZE),
    account: input.account ?? signer.principal,
    action: {...input.action, ts: input.ts ?? Date.now()} as api.AgentAction,
  }
  return (await blobs.sign(signer, envelope as unknown as blobs.Blob)) as unknown as api.SignedActionEnvelope
}
