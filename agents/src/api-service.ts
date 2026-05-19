import type {Database} from 'bun:sqlite'
import type * as api from '@/api'
import {seedAssistantSystemPrompt, seedToolRegistry, type SeedToolMetadata} from '@seed-hypermedia/agents-protocol'
import * as activityTriggers from '@/activity-triggers'
import * as scheduleTriggers from '@/schedule-triggers'
import * as auth from '@/auth'
import * as cbor from '@/cbor'
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
  resolveCapability,
  resolveDocumentState,
  resolveIdWithClient,
  updateComment,
  documentToResolvedMarkdown,
  contentToResolvedMarkdown,
} from '@seed-hypermedia/client'
import type {DocumentOperation} from '@seed-hypermedia/client'
import {HMBlockNodeSchema} from '@seed-hypermedia/client/hm-types'
import type {HMSigner, HMBlockNode, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath, unpackHmId} from '@seed-hypermedia/client/hm-types'
import * as pi from '@mariozechner/pi-coding-agent'
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
const SECRET_KEY_CONFIG_KEY = 'secret_encryption_key_v1'
const SECRET_NONCE_BYTES = 12
const MAX_TOOL_RESULT_BYTES = 256 * 1024
const MAX_WRITE_CONTENT_BYTES = 256 * 1024

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
    }
  | {type: 'account-change'; accountId: string; reason: string; agentId?: string; sessionId?: string}

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

type RunningSession = {accountId: string; abort?: () => Promise<void>; stopped: boolean}

/** Server-side implementation of the signed Agents action API. */
export class Service {
  readonly #db: Database
  readonly #dataDir: string
  readonly #onEvent?: (event: ServiceEvent) => void
  readonly #hmServerUrl: string
  readonly #runningSessions = new Map<string, RunningSession>()

  constructor(
    db: Database,
    dataDir: string,
    options: {onEvent?: (event: ServiceEvent) => void; hmServerUrl?: string} = {},
  ) {
    this.#db = db
    this.#dataDir = dataDir
    this.#onEvent = options.onEvent
    this.#hmServerUrl = options.hmServerUrl || 'https://hyper.media'
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
        return this.#updateSigningIdentity(verified.accountId, envelope.action.name, envelope.action.label)
      case 'DeleteSigningIdentity':
        return this.#deleteSigningIdentity(verified.accountId, envelope.action.name)
      case 'SetModelProvider':
        return this.#setModelProvider(verified.accountId, envelope.action.name, envelope.action.provider)
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
      case 'CreateSession':
        return this.#createSession(
          verified.accountId,
          envelope.action.agentId,
          envelope.action.title,
          envelope.action.clientRequestId,
        )
      case 'UpdateSession':
        return this.#updateSession(verified.accountId, envelope.action.sessionId, envelope.action.title)
      case 'DeleteSession':
        return this.#deleteSession(verified.accountId, envelope.action.sessionId)
      case 'GetSession':
        return await this.#getSession(verified.accountId, envelope.action.sessionId, envelope.action.afterSeq)
      case 'MessageSession':
        return this.#messageSession(
          verified.accountId,
          envelope.action.sessionId,
          envelope.action.content,
          envelope.action.clientMessageId,
        )
      case 'StopSession':
        return this.#stopSession(verified.accountId, envelope.action.sessionId)
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
      .query<{name: string}, [string, string]>(`SELECT name FROM model_providers WHERE account_id = ? AND name = ?`)
      .get(accountId, definition.modelProvider)
    if (!provider) throw new APIError(400, 'Model provider not found')
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
    const agentInfo = this.#getAgentInfo(accountId, agentId)
    if (agentInfo) {
      this.#emit({type: 'agent-change', accountId, agent: agentInfo})
      this.#emit({type: 'account-change', accountId, reason: 'agent-created', agentId})
    }

    return {_: 'CreateAgentResponse', agentId}
  }

  #listModelProviders(accountId: string): api.ListModelProvidersResponse {
    const rows = this.#db
      .query<
        {id: string; name: string; type: string; config_cbor: Uint8Array; created_at: number; updated_at: number},
        [string]
      >(`SELECT id, name, type, config_cbor, created_at, updated_at FROM model_providers WHERE account_id = ? ORDER BY updated_at DESC`)
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
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      }),
    }
  }

  async #listProviderModels(accountId: string, rawProviderName: string): Promise<api.ListProviderModelsResponse> {
    const providerName = normalizeBoundedString(rawProviderName, 'Model provider', MAX_NAME_BYTES)
    const row = this.#db
      .query<
        {config_cbor: Uint8Array},
        [string, string]
      >(`SELECT config_cbor FROM model_providers WHERE account_id = ? AND name = ?`)
      .get(accountId, providerName)
    if (!row) throw new APIError(404, 'Model provider not found')

    const provider = cbor.decode<api.ModelProviderConfig>(row.config_cbor)
    const type = normalizePiProviderName(provider.type)
    const apiKeySecretName = provider.secretRefs?.apiKey
    if (!apiKeySecretName) throw new APIError(400, `${type} API key is not configured`)
    const apiKey = new TextDecoder().decode(await this.#getSecretPlaintext(accountId, apiKeySecretName))
    const baseUrl = provider.baseUrl || defaultPiBaseUrl(type)
    if (type === 'openai' && provider.baseUrl && !isTrustedOpenAIBaseUrl(provider.baseUrl)) {
      throw new APIError(400, 'OpenAI base URL is not allowed')
    }

    return {_: 'ListProviderModelsResponse', models: await fetchProviderModels(type, baseUrl, apiKey)}
  }

  #listSigningIdentities(accountId: string): api.ListSigningIdentitiesResponse {
    const rows = this.#db
      .query<
        {id: string; name: string; metadata_cbor: Uint8Array | null; created_at: number; updated_at: number},
        [string]
      >(`SELECT id, name, metadata_cbor, created_at, updated_at FROM secrets WHERE account_id = ? ORDER BY updated_at DESC`)
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
      await publishSigningIdentityProfileAndHome(this.#hmServerUrl, keyPair, displayName)
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
    await publishSigningIdentityProfile(this.#hmServerUrl, keyPair, label)
    const nextMetadata = {...metadata, accountId: accountIdFromKey, label, serverUrl: this.#hmServerUrl}
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
        serverUrl: this.#hmServerUrl,
        createdAt: row.created_at,
        updatedAt: now,
      },
    }
  }

  #deleteSigningIdentity(accountId: string, rawName: string): api.DeleteSigningIdentityResponse {
    const name = normalizeBoundedString(rawName, 'Signing key', MAX_NAME_BYTES)
    const row = this.#db
      .query<
        {metadata_cbor: Uint8Array | null},
        [string, string]
      >(`SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`)
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
      .query<
        {id: string; created_at: number},
        [string, string]
      >(`SELECT id, created_at FROM model_providers WHERE account_id = ? AND name = ?`)
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
        createdAt,
        updatedAt: now,
      },
    }
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
    const metadata = normalizeOptionalMetadata(rawMetadata)
    const ciphertext = await encryptSecret(this.#db, value)
    const now = Date.now()
    const existing = this.#db
      .query<
        {id: string; created_at: number},
        [string, string]
      >(`SELECT id, created_at FROM secrets WHERE account_id = ? AND name = ?`)
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
        .query<
          {metadata_cbor: Uint8Array | null},
          [string, string]
        >(`SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`)
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
        `SELECT id, account_id, agent_id, title, status, created_at, updated_at
         FROM sessions WHERE account_id = ? AND agent_id = ? ORDER BY updated_at DESC`,
      )
      .all(accountId, agentId)

    return {_: 'GetAgentResponse', agent: agentRowToInfo(agent), sessions: this.#sessionRowsToInfo(accountId, sessions)}
  }

  #updateAgent(accountId: string, agentId: string, rawDefinition: api.AgentDefinition): api.GetAgentResponse {
    const definition = normalizeDefinition(rawDefinition)
    const existing = this.#db
      .query<{id: string}, [string, string]>(`SELECT id FROM agents WHERE account_id = ? AND id = ?`)
      .get(accountId, agentId)
    if (!existing) throw new APIError(404, 'Agent not found')
    const provider = this.#db
      .query<{name: string}, [string, string]>(`SELECT name FROM model_providers WHERE account_id = ? AND name = ?`)
      .get(accountId, definition.modelProvider)
    if (!provider) throw new APIError(400, 'Model provider not found')
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
    const transaction = this.#db.transaction(() => {
      for (const sessionId of sessionIds) {
        this.#db.run(`DELETE FROM session_events WHERE session_id = ?`, [sessionId])
      }
      this.#db.run(`DELETE FROM trigger_firings WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM sessions WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM agent_triggers WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
      this.#db.run(`DELETE FROM agent_drafts WHERE account_id = ? AND agent_id = ?`, [accountId, agentId])
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

    this.#emit({type: 'account-change', accountId, reason: 'agent-deleted', agentId})
    return {_: 'DeleteAgentResponse', agentId}
  }

  #listAgentTriggers(accountId: string, agentId: string): api.ListAgentTriggersResponse {
    this.#requireAgent(accountId, agentId)
    const rows = this.#db
      .query<AgentTriggerRow, [string, string]>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, cooldown_ms, created_at, updated_at,
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
      `INSERT INTO agent_triggers (id, account_id, agent_id, name, enabled, source_cbor, prompt, cooldown_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        accountId,
        agentId,
        trigger.name,
        trigger.enabled ? 1 : 0,
        cbor.encode(trigger.source),
        serializePromptBlocksForStorage(trigger.prompt),
        trigger.cooldownMs ?? null,
        now,
        now,
      ],
    )
    const info = this.#getAgentTriggerInfo(accountId, id)
    if (!info) throw new APIError(500, 'Agent trigger was not created')
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
    const nextSource = patch.source ?? existing.source
    const cooldownMs =
      nextSource.type === 'schedule'
        ? undefined
        : patch.cooldownMs === null
          ? undefined
          : (patch.cooldownMs ?? existing.cooldownMs)
    const next: api.AgentTriggerInfo = {...existing, ...patch, cooldownMs, updatedAt: Date.now()}
    this.#db.run(
      `UPDATE agent_triggers
       SET name = ?, enabled = ?, source_cbor = ?, prompt = ?, cooldown_ms = ?, updated_at = ?, last_error = NULL
       WHERE account_id = ? AND id = ?`,
      [
        next.name,
        next.enabled ? 1 : 0,
        cbor.encode(next.source),
        serializePromptBlocksForStorage(next.prompt),
        next.cooldownMs ?? null,
        next.updatedAt,
        accountId,
        triggerId,
      ],
    )
    const trigger = this.#getAgentTriggerInfo(accountId, triggerId)
    if (!trigger) throw new APIError(404, 'Agent trigger not found')
    this.#emit({type: 'account-change', accountId, reason: 'trigger-updated', agentId: trigger.agentId})
    return {_: 'UpdateAgentTriggerResponse', trigger}
  }

  #deleteAgentTrigger(accountId: string, triggerId: string): api.DeleteAgentTriggerResponse {
    const existing = this.#getAgentTriggerInfo(accountId, triggerId)
    if (!existing) throw new APIError(404, 'Agent trigger not found')
    const transaction = this.#db.transaction(() => {
      this.#db.run(`DELETE FROM trigger_firings WHERE account_id = ? AND trigger_id = ?`, [accountId, triggerId])
      this.#db.run(`DELETE FROM agent_triggers WHERE account_id = ? AND id = ?`, [accountId, triggerId])
    })
    transaction()
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

  #createSessionOnce(accountId: string, agentId: string, rawTitle?: string): api.CreateSessionResponse {
    const agent = this.#db
      .query<{id: string}, [string, string]>(`SELECT id FROM agents WHERE account_id = ? AND id = ?`)
      .get(accountId, agentId)
    if (!agent) throw new APIError(404, 'Agent not found')

    const now = Date.now()
    const sessionId = crypto.randomUUID()
    const title = rawTitle === undefined ? null : normalizeBoundedString(rawTitle, 'Session title', MAX_NAME_BYTES)
    this.#db.run(
      `INSERT INTO sessions (id, account_id, agent_id, title, title_source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, accountId, agentId, title, 'system', 'idle', now, now],
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
    const transaction = this.#db.transaction(() => {
      this.#db.run(`UPDATE trigger_firings SET session_id = NULL WHERE account_id = ? AND session_id = ?`, [
        accountId,
        sessionId,
      ])
      this.#db.run(`DELETE FROM session_events WHERE session_id = ?`, [sessionId])
      this.#db.run(`DELETE FROM sessions WHERE account_id = ? AND id = ?`, [accountId, sessionId])
    })
    transaction()
    this.#emit({type: 'account-change', accountId, reason: 'session-deleted', agentId: existing.agentId, sessionId})
    return {_: 'DeleteSessionResponse', sessionId, agentId: existing.agentId}
  }

  #setSessionTitleFromAgent(accountId: string, sessionId: string, rawTitle: string): api.SessionInfo {
    const title = normalizeBoundedString(rawTitle, 'Session title', MAX_NAME_BYTES)
    const existing = this.#db
      .query<
        {title_source: string},
        [string, string]
      >(`SELECT title_source FROM sessions WHERE account_id = ? AND id = ?`)
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
        .query<
          {request_cbor: Uint8Array; response_cbor: Uint8Array},
          [string, string, string]
        >(`SELECT request_cbor, response_cbor FROM action_idempotency WHERE account_id = ? AND action = ? AND client_request_id = ?`)
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
  ): Promise<api.MessageSessionResponse> {
    const messages = normalizeMessageContent(rawContent)
    const session = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT id, account_id, agent_id, title, status, created_at, updated_at
         FROM sessions WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    if (session.status === 'streaming') throw new APIError(409, 'Session is already streaming')

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
    const firstMessage = messages[0]!
    this.#appendSessionEvent(
      accountId,
      session.agent_id,
      sessionId,
      {
        type: 'message',
        role: 'user',
        content: firstMessage.text,
        rawMarkdown: firstMessage.text,
        ...(firstMessage.blocks ? {blocks: firstMessage.blocks} : {}),
      },
      now,
    )
    for (const message of messages.slice(1)) {
      this.#appendSessionEvent(
        accountId,
        session.agent_id,
        sessionId,
        {
          type: 'message',
          role: 'user',
          content: message.text,
          rawMarkdown: message.text,
          ...(message.blocks ? {blocks: message.blocks} : {}),
        },
        Date.now(),
      )
    }
    this.#updateSessionStatus(accountId, sessionId, 'streaming', now)

    try {
      const runningSessionKey = this.#runningSessionKey(accountId, sessionId)
      const runningSession: RunningSession = {accountId, stopped: false}
      this.#runningSessions.set(runningSessionKey, runningSession)
      const assistantEvent = await this.#runPiAgent(accountId, definition, sessionId, runningSession)
      const doneAt = Date.now()
      this.#updateSessionStatus(accountId, sessionId, 'idle', doneAt)
      return {_: 'MessageSessionResponse', sessionId, assistantEventId: assistantEvent.id}
    } catch (error) {
      if (error instanceof SessionStoppedError) {
        const stoppedAt = Date.now()
        const assistantEvent = this.#appendSessionEvent(
          accountId,
          session.agent_id,
          sessionId,
          {type: 'message', role: 'assistant', content: 'Stopped.'},
          stoppedAt,
        )
        this.#updateSessionStatus(accountId, sessionId, 'idle', stoppedAt)
        return {_: 'MessageSessionResponse', sessionId, assistantEventId: assistantEvent.id}
      }
      const failedAt = Date.now()
      this.#appendSessionEvent(
        accountId,
        session.agent_id,
        sessionId,
        {type: 'error', message: error instanceof Error ? error.message : 'Agent run failed'},
        failedAt,
      )
      this.#updateSessionStatus(accountId, sessionId, 'error', failedAt)
      throw error
    }
  }

  async #stopSession(accountId: string, sessionId: string): Promise<api.StopSessionResponse> {
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')

    const running = this.#runningSessions.get(this.#runningSessionKey(accountId, sessionId))
    if (running) {
      running.stopped = true
      await running.abort?.()
      return {_: 'StopSessionResponse', sessionId, stopped: true}
    }

    if (session.status === 'streaming') {
      this.#updateSessionStatus(accountId, sessionId, 'idle', Date.now())
      return {_: 'StopSessionResponse', sessionId, stopped: true}
    }

    return {_: 'StopSessionResponse', sessionId, stopped: false}
  }

  #runningSessionKey(accountId: string, sessionId: string): string {
    return `${accountId}/${sessionId}`
  }

  async #agentSystemPrompt(accountId: string, definition: api.AgentDefinition): Promise<string> {
    const signingKeys = definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
    const systemPrompt = await promptBlocksToResolvedMarkdown(
      normalizeSystemPromptBlocks(definition.systemPrompt),
      createSeedClient(this.#hmServerUrl),
    )
    const sharedPrompt = seedAssistantSystemPrompt({
      currentTime: new Date().toISOString(),
      includeTitleToolInstruction: true,
    })
    const basePrompt = `${systemPrompt}\n\n${sharedPrompt}`
    if (!signingKeys.length) return basePrompt
    const identities = signingKeys.flatMap((name) => {
      const row = this.#db
        .query<
          {metadata_cbor: Uint8Array | null},
          [string, string]
        >(`SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`)
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
    )}\n</available_signing_identities>\nWhen signing or creating Seed content, use the publicKey value as the signing identity ID. Users may refer to these identities by profile name.\n\nFor write tool document and draft creation, set the visible Seed document title explicitly with input.name (or input.title) and include markdown body in input.content/body/text. A markdown # heading is content only; do not rely on it to set the document title. Example: {"command":"document.create","signer":{"publicKey":"..."},"input":{"name":"Test Document","path":"test-document","content":"# Test Document\\n\\nBody text.","format":"markdown"}}.\n\nFor write tool document.move, pass the existing document as input.source/sourceId/id and either input.destination as a full hm:// target or input.path as the new path on the same account. To move a document to the account home/root, use input.path = "/".`
  }

  async #runPiAgent(
    accountId: string,
    definition: api.AgentDefinition,
    sessionId: string,
    runningSession?: RunningSession,
  ): Promise<api.SessionEvent> {
    const session = this.#getSessionInfo(accountId, sessionId)
    if (!session) throw new APIError(404, 'Session not found')
    const providerRow = this.#db
      .query<
        {config_cbor: Uint8Array},
        [string, string]
      >(`SELECT config_cbor FROM model_providers WHERE account_id = ? AND name = ?`)
      .get(accountId, definition.modelProvider)
    if (!providerRow) throw new APIError(400, 'Model provider not found')
    const provider = cbor.decode<api.ModelProviderConfig>(providerRow.config_cbor)
    const providerName = normalizePiProviderName(provider.type)
    const apiKeySecretName = provider.secretRefs?.apiKey
    if (!apiKeySecretName) throw new APIError(400, `${providerName} API key is not configured`)
    const apiKey = new TextDecoder().decode(await this.#getSecretPlaintext(accountId, apiKeySecretName))
    const baseUrl = provider.baseUrl || defaultPiBaseUrl(providerName)
    if (!baseUrl) throw new APIError(400, `Unsupported model provider type: ${provider.type}`)
    if (providerName === 'openai' && provider.baseUrl && !isTrustedOpenAIBaseUrl(provider.baseUrl)) {
      throw new APIError(400, 'OpenAI base URL is not allowed')
    }

    const authStorage = pi.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(providerName, apiKey)
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(providerName, {
      baseUrl,
      apiKey,
      api: piApiForProvider(providerName),
      models: [piModelForDefinition(providerName, baseUrl, definition)],
    })
    const model = modelRegistry.find(providerName, definition.model)
    if (!model) throw new APIError(400, `Model not found: ${providerName}/${definition.model}`)

    const cwd = this.#dataDir
    const settingsManager = pi.SettingsManager.inMemory({compaction: {enabled: false}})
    const resourceLoader = createSeedPiResourceLoader(await this.#agentSystemPrompt(accountId, definition))
    const {session: piSession} = await pi.createAgentSession({
      cwd,
      agentDir: path.join(this.#dataDir, 'pi'),
      model,
      thinkingLevel: 'off',
      authStorage,
      modelRegistry,
      resourceLoader,
      customTools: createAgentServicePiTools({
        db: this.#db,
        accountId,
        agentId: session.agentId,
        definition,
        hmServerUrl: this.#hmServerUrl,
        setSessionTitle: (title) => this.#setSessionTitleFromAgent(accountId, sessionId, title),
      }),
      tools: [
        ...(definition.tools === undefined ? [seedToolRegistry.read.name] : definition.tools).filter(
          (tool) =>
            tool === seedToolRegistry.search.name ||
            tool === seedToolRegistry.read.name ||
            tool === seedToolRegistry.list_activity_feed.name ||
            tool === seedToolRegistry.write.name,
        ),
        seedToolRegistry.set_session_title.name,
      ],
      noTools: 'builtin',
      sessionManager: pi.SessionManager.inMemory(cwd),
      settingsManager,
    })

    const mergeModelDefaults = provider.modelDefaults
    piSession.agent.onPayload = (payload) => {
      const payloadTools = isRecord(payload) && Array.isArray(payload.tools) ? payload.tools.length : undefined
      console.info('[agents/runtime] sending provider request', {
        sessionId,
        agentId: session.agentId,
        provider: providerName,
        model: definition.model,
        activeTools: piSession.getActiveToolNames(),
        payloadTools,
      })
      return mergeModelDefaults ? mergePiPayloadDefaults(payload, mergeModelDefaults) : payload
    }
    piSession.state.messages = this.#piMessages(sessionId) as never
    let partialId = crypto.randomUUID()
    let partialText = ''
    let currentAssistantHadDelta = false
    let suppressCurrentAssistantEndFallback = false
    let finalError: string | undefined
    let assistantEvent: api.SessionEvent | undefined
    const appendedToolCalls = new Set<string>()

    const appendAssistantMessage = (content: string): void => {
      if (!content.trim()) return
      this.#emit({type: 'session-partial', accountId, agentId: session.agentId, sessionId, partialId, done: true})
      assistantEvent = this.#appendSessionEvent(
        accountId,
        session.agentId,
        sessionId,
        {type: 'message', role: 'assistant', content},
        Date.now(),
      )
      partialId = crypto.randomUUID()
    }

    const flushPartialAssistantMessage = (): void => {
      appendAssistantMessage(partialText)
      partialText = ''
      currentAssistantHadDelta = false
    }

    const unsubscribe = piSession.subscribe((event) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        partialText += event.assistantMessageEvent.delta
        currentAssistantHadDelta = true
        this.#emit({
          type: 'session-partial',
          accountId,
          agentId: session.agentId,
          sessionId,
          partialId,
          textDelta: event.assistantMessageEvent.delta,
        })
        return
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const assistantMessage = event.message as {stopReason?: string; errorMessage?: string}
        if (assistantMessage.stopReason === 'error' || assistantMessage.stopReason === 'aborted') {
          finalError = assistantMessage.errorMessage || 'Agent run failed'
          return
        }
        if (currentAssistantHadDelta) flushPartialAssistantMessage()
        else if (!suppressCurrentAssistantEndFallback) appendAssistantMessage(piAssistantText(event.message))
        suppressCurrentAssistantEndFallback = false
        return
      }
      if (event.type === 'tool_execution_start') {
        if (event.toolName === seedToolRegistry.set_session_title.name) return
        if (currentAssistantHadDelta) {
          flushPartialAssistantMessage()
          suppressCurrentAssistantEndFallback = true
        }
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
        if (event.toolName === seedToolRegistry.set_session_title.name) return
        if (!appendedToolCalls.has(event.toolCallId)) {
          this.#appendSessionEvent(
            accountId,
            session.agentId,
            sessionId,
            {type: 'tool_call', id: event.toolCallId, name: event.toolName, input: {}},
            Date.now(),
          )
        }
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
              }
            : {
                type: 'tool_result',
                toolCallId: event.toolCallId,
                name: event.toolName,
                output: piToolResultOutput(event.result),
              },
          Date.now(),
        )
        return
      }
      if (event.type === 'agent_end') {
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

    try {
      if (runningSession.stopped) throw new SessionStoppedError()
      await piSession.agent.continue()
    } finally {
      this.#runningSessions.delete(runningSessionKey)
      unsubscribe()
      piSession.dispose()
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
      .query<
        SessionEventRow,
        [string, number]
      >(`SELECT id, session_id, seq, event_cbor, created_at FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq ASC`)
      .all(sessionId, 0)
      .map(sessionEventRowToInfo)

    const messages: unknown[] = []
    let pendingAssistant: {content: Record<string, unknown>[]; timestamp: number} | undefined
    const appendPendingAssistantContent = (part: Record<string, unknown>, timestamp: number): void => {
      pendingAssistant ??= {content: [], timestamp}
      pendingAssistant.content.push(part)
    }
    const flushPendingAssistant = (): void => {
      if (!pendingAssistant) return
      const hasToolCall = pendingAssistant.content.some((part) => part.type === 'toolCall')
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
      }
      if (value.type === 'message' && value.role === 'user' && typeof value.content === 'string') {
        flushPendingAssistant()
        messages.push({role: 'user', content: value.content, timestamp: event.createdAt})
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
      .query<
        {ciphertext: Uint8Array},
        [string, string]
      >(`SELECT ciphertext FROM secrets WHERE account_id = ? AND name = ?`)
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
        .query<
          {seq: number},
          [string]
        >(`SELECT COALESCE(MAX(seq), 0) + 1 as seq FROM session_events WHERE session_id = ?`)
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
        `SELECT id, account_id, agent_id, title, status, created_at, updated_at
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
      systemPromptMarkdown: await this.#agentSystemPrompt(accountId, definition),
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
          .query<
            {request_cbor: Uint8Array; response_cbor: Uint8Array},
            [string, string, string]
          >(`SELECT request_cbor, response_cbor FROM action_idempotency WHERE account_id = ? AND action = ? AND client_request_id = ?`)
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
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, cooldown_ms, created_at, updated_at,
                last_checked_at, last_fired_at, last_error
         FROM agent_triggers WHERE account_id = ? AND id = ?`,
      )
      .get(accountId, triggerId)
    return trigger ? agentTriggerRowToInfo(trigger) : null
  }

  #getSessionInfo(accountId: string, sessionId: string): api.SessionInfo | null {
    const session = this.#db
      .query<SessionRow, [string, string]>(
        `SELECT id, account_id, agent_id, title, status, created_at, updated_at
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
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, cooldown_ms, created_at, updated_at,
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
        await this.#messageSessionOnce(
          trigger.account,
          session.sessionId,
          await triggerPromptMessage(trigger, firingId, occurrence.activity, createSeedClient(this.#hmServerUrl)),
        )
        this.#db.run(
          `UPDATE agent_triggers SET last_fired_at = ?, last_error = NULL, enabled = CASE WHEN ? THEN 0 ELSE enabled END WHERE account_id = ? AND id = ?`,
          [Date.now(), trigger.source.schedule.kind === 'once' ? 1 : 0, trigger.account, trigger.id],
        )
        fired += 1
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
    const activityKey = activityTriggers.activityEventKey(event)
    if (!activityKey) {
      console.log('[Agents Trigger] Skipping activity without stable key', {
        accountId,
        activity: activityTriggers.activityDebugInfo(event),
      })
      return {checked: 0, matched: 0, fired: 0, skipped: 1, errors: 0}
    }
    const rows = this.#db
      .query<AgentTriggerRow, [string]>(
        `SELECT id, account_id, agent_id, name, enabled, source_cbor, prompt, cooldown_ms, created_at, updated_at,
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
        [firingId, accountId, trigger.agentId, trigger.id, activityKey, cbor.encode(event), 'created', now],
      )
      if (inserted.changes === 0) {
        console.log('[Agents Trigger] Skipping duplicate trigger firing', {
          accountId,
          triggerId: trigger.id,
          activityKey,
        })
        skipped += 1
        continue
      }
      if (trigger.cooldownMs && trigger.lastFiredAt && now - trigger.lastFiredAt < trigger.cooldownMs) {
        this.#db.run(`UPDATE trigger_firings SET status = ? WHERE account_id = ? AND id = ?`, [
          'skipped',
          accountId,
          firingId,
        ])
        console.log('[Agents Trigger] Skipping trigger firing during cooldown', {
          accountId,
          triggerId: trigger.id,
          activityKey,
          cooldownMs: trigger.cooldownMs,
          lastFiredAt: trigger.lastFiredAt,
        })
        skipped += 1
        continue
      }
      try {
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
        await this.#messageSessionOnce(
          accountId,
          session.sessionId,
          await triggerPromptMessage(trigger, firingId, event, createSeedClient(this.#hmServerUrl)),
        )
        this.#db.run(`UPDATE agent_triggers SET last_fired_at = ?, last_error = NULL WHERE account_id = ? AND id = ?`, [
          Date.now(),
          accountId,
          trigger.id,
        ])
        console.log('[Agents Trigger] Fired trigger and created session', {
          accountId,
          triggerId: trigger.id,
          activityKey,
          sessionId: session.sessionId,
        })
        fired += 1
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
  cooldown_ms: number | null
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
): Promise<void> {
  const profile = await blobs.createProfile(keyPair, {name}, Date.now())
  await createSeedClient(hmServerUrl).publish({blobs: [{cid: profile.cid.toString(), data: profile.data}]})
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

function agentTriggerRowToInfo(row: AgentTriggerRow): api.AgentTriggerInfo {
  return {
    id: row.id,
    account: row.account_id,
    agentId: row.agent_id,
    name: row.name,
    enabled: row.enabled !== 0,
    source: cbor.decode<api.AgentTriggerSource>(row.source_cbor),
    prompt: parseStoredPromptBlocks(row.prompt),
    ...(row.cooldown_ms === null ? {} : {cooldownMs: row.cooldown_ms}),
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
        'When responding to a comment activity with the write tool command comment.create, create a threaded reply, not a new top-level comment. Set input.replyCommentId to the exact parent comment id from trigger_context.activity.comment.id when present, or trigger_context.activity.commentId.id as a fallback. Set input.target to the target document id from trigger_context.activity.target.id.id or the activity comment target fields. Do not omit replyCommentId when the user was mentioned in a comment.',
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
    ...(raw.cooldownMs === undefined || source.type === 'schedule'
      ? {}
      : {cooldownMs: normalizeOptionalPositiveInteger(raw.cooldownMs, 'Trigger cooldown')}),
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
  if (raw.cooldownMs !== undefined) {
    patch.cooldownMs =
      raw.cooldownMs === null ? null : normalizeOptionalPositiveInteger(raw.cooldownMs, 'Trigger cooldown')
  }
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
    return {
      type: 'user-mention',
      mentionedAccount: normalizeBoundedString(raw.mentionedAccount, 'Trigger mentioned account', MAX_NAME_BYTES),
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
  throw new APIError(400, 'Trigger source type is unsupported')
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

function normalizePiProviderName(type: string): 'openai' | 'anthropic' | 'google' {
  if (type === 'openai' || type === 'anthropic' || type === 'google') return type
  throw new APIError(400, `Unsupported model provider type: ${type}`)
}

function piApiForProvider(
  provider: 'openai' | 'anthropic' | 'google',
): 'openai-completions' | 'anthropic-messages' | 'google-generative-ai' {
  switch (provider) {
    case 'openai':
      return 'openai-completions'
    case 'anthropic':
      return 'anthropic-messages'
    case 'google':
      return 'google-generative-ai'
  }
}

function defaultPiBaseUrl(provider: 'openai' | 'anthropic' | 'google'): string {
  switch (provider) {
    case 'openai':
      return 'https://api.openai.com/v1'
    case 'anthropic':
      return 'https://api.anthropic.com'
    case 'google':
      return 'https://generativelanguage.googleapis.com/v1beta'
  }
}

async function fetchProviderModels(
  provider: 'openai' | 'anthropic' | 'google',
  baseUrl: string,
  apiKey: string,
): Promise<api.ProviderModelInfo[]> {
  switch (provider) {
    case 'openai':
      return fetchOpenAIModels(baseUrl, apiKey)
    case 'anthropic':
      return fetchAnthropicModels(baseUrl, apiKey)
    case 'google':
      return fetchGoogleModels(baseUrl, apiKey)
  }
}

async function fetchOpenAIModels(baseUrl: string, apiKey: string): Promise<api.ProviderModelInfo[]> {
  const response = await fetch(joinUrlPath(baseUrl, 'models'), {headers: {Authorization: `Bearer ${apiKey}`}})
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
  provider: 'openai' | 'anthropic' | 'google',
  baseUrl: string,
  definition: api.AgentDefinition,
): NonNullable<Parameters<pi.ModelRegistry['registerProvider']>[1]['models']>[number] {
  return {
    id: definition.model,
    name: definition.model,
    api: piApiForProvider(provider),
    baseUrl,
    reasoning: false,
    input: ['text'],
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

type AgentServicePiToolContext = WriteToolContext & {
  setSessionTitle: (title: string) => api.SessionInfo
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

function defineSeedPiTool(
  metadata: SeedToolMetadata,
  execute: (params: unknown) => Promise<unknown> | unknown,
): pi.ToolDefinition {
  return pi.defineTool({
    name: metadata.name,
    label: metadata.label,
    description: metadata.description,
    parameters: metadata.inputSchema as never,
    execute: async (_toolCallId, params) => {
      const output = jsonSafeToolOutput(await execute(params))
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

function createAgentServicePiTools(context: AgentServicePiToolContext): pi.ToolDefinition[] {
  return [
    defineSeedPiTool(seedToolRegistry.search, (params) => executeAgentServiceSearch(context, params)),
    defineSeedPiTool(seedToolRegistry.read, (params) => readHypermedia(params)),
    defineSeedPiTool(seedToolRegistry.list_activity_feed, async (params) => {
      const input: Record<string, unknown> = isRecord(params) ? params : {}
      const client = createSeedClient(context.hmServerUrl)
      const output = await client.request('ListEvents', {
        pageSize:
          typeof input.pageSize === 'number' ? Math.max(1, Math.min(50, Math.floor(input.pageSize))) : undefined,
        pageToken: typeof input.pageToken === 'string' ? input.pageToken : undefined,
        trustedOnly: typeof input.trustedOnly === 'boolean' ? input.trustedOnly : undefined,
        filterAuthors: Array.isArray(input.filterAuthors)
          ? input.filterAuthors.filter((author): author is string => typeof author === 'string')
          : undefined,
        filterEventType: Array.isArray(input.filterEventType)
          ? input.filterEventType.filter((eventType): eventType is string => typeof eventType === 'string')
          : undefined,
        filterResource: typeof input.filterResource === 'string' ? input.filterResource : undefined,
        currentAccount: context.accountId,
      })
      return {
        summary: `Loaded ${Array.isArray(output.events) ? output.events.length : 0} activity feed event${
          Array.isArray(output.events) && output.events.length === 1 ? '' : 's'
        }.`,
        ...output,
      }
    }),
    defineSeedPiTool(seedToolRegistry.write, (params) => writeHypermedia(context, params)),
    defineSeedPiTool(seedToolRegistry.set_session_title, (params) => {
      const title = isRecord(params) && typeof params.title === 'string' ? params.title : ''
      console.info('[agents/runtime] set_session_title tool called')
      const session = context.setSessionTitle(title)
      return {ok: true, title: session.title || ''}
    }),
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
    .query<
      {ciphertext: Uint8Array},
      [string, string]
    >(`SELECT ciphertext FROM secrets WHERE account_id = ? AND name = ?`)
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
      .query<
        {metadata_cbor: Uint8Array | null},
        [string, string]
      >(`SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`)
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
    .query<
      {metadata_cbor: Uint8Array | null},
      [string, string]
    >(`SELECT metadata_cbor FROM secrets WHERE account_id = ? AND name = ?`)
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
  return writeToolResult(request.command, signer, {
    commentId,
    target: packHmId(id),
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

async function writeDocumentCreate(
  client: ReturnType<typeof createSeedClient>,
  signer: ResolvedAgentSigner,
  request: ReturnType<typeof normalizeWriteToolRequest>,
): Promise<Record<string, unknown>> {
  const parsed = parseWriteDocumentContent(request.input)
  const metadata = mergeWriteMetadata(parsed.metadata, request.input, {name: 'Untitled'})
  const account =
    normalizeOptionalBoundedString(request.input.account, 'Document account', MAX_NAME_BYTES) || signer.publicKey
  const path = normalizeDocumentPath(request.input.path, metadata.name || 'Untitled')
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
    blobs: [{data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()}, ...refInput.blobs],
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
      warning: `Destination was created, but source redirect failed: ${error instanceof Error ? error.message : String(error)}`,
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

async function readHypermedia(input: unknown): Promise<Record<string, unknown>> {
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
  let resource = await client.request('Resource', id)
  if (
    (resource.type === 'not-found' || resource.type === 'error') &&
    !server &&
    !dev &&
    requestedId.startsWith('hm:')
  ) {
    const devResolved = await resolveIdWithClient(requestedId, {serverUrl: 'https://dev.hyper.media'})
    const devResource = await devResolved.client.request('Resource', devResolved.id)
    if (devResource.type !== 'not-found' && devResource.type !== 'error') {
      id = devResolved.id
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

function isTrustedOpenAIBaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && url.hostname === 'api.openai.com'
  } catch {
    return false
  }
}

function normalizeMessageContent(
  content: api.MessageSession['content'],
): Array<{text: string; blocks?: api.AgentMessageBlock[]}> {
  if (!Array.isArray(content) || content.length === 0) throw new APIError(400, 'Message content is required')
  const messages = content.map((part) => {
    if (!part || typeof part !== 'object' || part.type !== 'text' || typeof part.text !== 'string') {
      throw new APIError(400, 'Only text message content is supported')
    }
    const text = part.text.trim()
    return {
      text,
      ...(Array.isArray(part.blocks) && part.blocks.length > 0 ? {blocks: part.blocks} : {}),
    }
  })
  if (messages.some((message) => !message.text)) throw new APIError(400, 'Message content is required')
  if (
    new TextEncoder().encode(messages.map((message) => message.text).join('\n')).byteLength > MAX_MESSAGE_TEXT_BYTES
  ) {
    throw new APIError(400, 'Message content is too large')
  }
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
