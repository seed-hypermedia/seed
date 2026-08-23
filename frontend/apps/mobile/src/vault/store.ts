/**
 * VaultManager — the device-role vault (a port of Go's Vault,
 * backend/storage/vault/vault.go): local encrypted envelope + secret store,
 * identity CRUD with tombstones, the Vault Connect ceremony, and versioned
 * remote sync.
 *
 * Version semantics (Go applyMutation parity): every state mutation bumps
 * `localVersion` ONLY while connected to a remote — local mode is
 * version-less. Merge-ins from the remote never bump.
 */

import {toHMSigner, type HMSigner} from '@seed-hypermedia/client/signer'
import {nobleKeyPairFromSeed, principalFromString, principalToString} from '@seed-hypermedia/client/blobs'
import {StorageKeys, type KVStorage} from '../store/storage'
import {getMnemonic} from '../store/secure-storage'
import {deriveKeyPairFromMnemonic, validateMnemonic} from '../utils/key-derivation'
import {b64url, decrypt, encrypt, randomBytes} from './crypto'
import {
  createRemoteSyncState,
  parseEnvelope,
  serializeEnvelope,
  type EnvelopeCredential,
  type RemoteSyncState,
  type VaultEnvelope,
} from './envelope'
import {
  cleanupOldCredential,
  CONNECT_POLL_INTERVAL_MS,
  CONNECT_TOKEN_EXPIRED_ERROR,
  decodeConnectPayload,
  finishConnection,
  mergeCredentialLists,
  mintPendingConnection,
  normalizeVaultOriginURL,
  type PendingConnection,
} from './connect'
import {getVaultConnect} from './api'
import {
  createDefaultSecretStore,
  deleteSecret,
  ensureLocalKEK,
  loadSecret,
  remoteVaultAccount,
  storeSecret,
  type SecretStore,
} from './secret-store'
import {
  accountIdFromSeed,
  createEmpty,
  deserializeState,
  getAccountName,
  serializeState,
  type Account,
  type State,
} from './state-codec'
import {runRemoteSync, SyncScheduler, type RemoteSyncContext, type SyncSuccess} from './sync'

const KEY_NAME_FORMAT = /^[a-zA-Z0-9_-]+$/
const DEK_SIZE = 64

export type VaultIdentity = {name: string; accountId: string}

/** Consecutive poll failures before the pending status carries a warning. */
const POLL_WARNING_THRESHOLD = 3

export type VaultStatus = {
  backendMode: 'local' | 'remote'
  connectionStatus: 'disconnected' | 'pending' | 'connected'
  remoteVaultUrl?: string
  pendingConnection?: {
    vaultUrl: string
    connectUrl: string
    expireTime: number
    /** Set after repeated poll failures — the vault server is unreachable
     * (e.g. cross-origin polls blocked when it has no CORS headers). */
    pollWarning?: string
  }
  lastConnectError?: string
  syncStatus?: {
    localVersion: number
    remoteVersion: number
    syncedLocalVersion: number
    /** Unix SECONDS. */
    lastSyncTime: number
    lastSyncError: string
  }
}

export type VaultManagerDeps = {
  secretStore: SecretStore
  storage: KVStorage
}

export class VaultManager {
  #deps: VaultManagerDeps
  #state: State
  #dek: Uint8Array
  #credentials: EnvelopeCredential[]
  #remote: RemoteSyncState | null
  #subscribers = new Set<() => void>()
  #writeChain: Promise<void> = Promise.resolve()

  #pending: PendingConnection | null = null
  #pollTimer: ReturnType<typeof setInterval> | null = null
  #pollInFlight = false
  #pollFailureCount = 0
  #lastPollError: string | undefined
  #lastConnectError: string | undefined
  #scheduler: SyncScheduler

  private constructor(deps: VaultManagerDeps, state: State, dek: Uint8Array, envelope: VaultEnvelope | null) {
    this.#deps = deps
    this.#state = state
    this.#dek = dek
    this.#credentials = envelope?.credentials ?? []
    this.#remote = envelope?.remote ?? null
    this.#scheduler = new SyncScheduler(() => this.#syncRemoteMaybe())
  }

  /**
   * Load the vault, creating an empty local-mode vault on first run
   * (fresh 64-byte DEK wrapped under a 32-byte local KEK).
   */
  static async load(deps: VaultManagerDeps): Promise<VaultManager> {
    const stored = deps.storage.getString(StorageKeys.VAULT_ENVELOPE)
    let manager: VaultManager
    if (stored) {
      const envelope = parseEnvelope(stored)
      const wrappingKey = await loadEnvelopeWrappingKey(deps.secretStore, envelope)
      let dek: Uint8Array
      try {
        dek = await decrypt(envelope.wrappedDEK, wrappingKey)
      } catch {
        throw new Error('Failed to unwrap the vault data encryption key: wrong vault secret.')
      }
      let state: State
      try {
        state = await deserializeState(await decrypt(envelope.encryptedData, dek))
      } catch (error) {
        throw new Error(`Failed to decode local vault state: ${error instanceof Error ? error.message : String(error)}`)
      }
      manager = new VaultManager(deps, state, dek, envelope)
    } else {
      manager = new VaultManager(deps, createEmpty(), randomBytes(DEK_SIZE), null)
      await ensureLocalKEK(deps.secretStore)
      await manager.#persist()
    }

    // Legacy migration: a mnemonic saved by the pre-vault app becomes a vault
    // account. The stored mnemonic is kept as a recovery path. Never fatal.
    try {
      await manager.#importLegacyMnemonic()
    } catch {
      // Legacy probe must not block vault startup (e.g. keychain unavailable).
    }

    if (manager.#remote) {
      manager.#scheduler.start()
      void manager.#scheduler.schedule()
    }

    return manager
  }

  /** Stop timers and listeners (app teardown / tests). */
  destroy(): void {
    this.#scheduler.stop()
    this.#stopPolling()
    this.#subscribers.clear()
  }

  // ─── Subscriptions & status ────────────────────────────────────────────────

  subscribe(fn: () => void): () => void {
    this.#subscribers.add(fn)
    return () => {
      this.#subscribers.delete(fn)
    }
  }

  #notify(): void {
    for (const fn of [...this.#subscribers]) fn()
  }

  getStatus(): VaultStatus {
    const pendingActive = this.#pending && Date.now() < this.#pending.expireTime ? this.#pending : null
    const status: VaultStatus = {
      backendMode: this.#remote ? 'remote' : 'local',
      connectionStatus: this.#remote ? 'connected' : pendingActive ? 'pending' : 'disconnected',
    }
    if (this.#remote) {
      status.remoteVaultUrl = this.#remote.vaultUrl
      status.syncStatus = {
        localVersion: this.#remote.localVersion,
        remoteVersion: this.#remote.remoteVersion,
        syncedLocalVersion: this.#remote.syncedLocalVersion,
        lastSyncTime: this.#remote.lastSyncTime,
        lastSyncError: this.#remote.lastSyncError,
      }
    }
    if (pendingActive) {
      status.pendingConnection = {
        vaultUrl: pendingActive.vaultUrl,
        connectUrl: pendingActive.connectUrl,
        expireTime: pendingActive.expireTime,
      }
      if (this.#pollFailureCount >= POLL_WARNING_THRESHOLD && this.#lastPollError) {
        status.pendingConnection.pollWarning =
          `Cannot reach the vault server (${this.#pollFailureCount} failed checks: ${this.#lastPollError}). ` +
          'If this app is running in a web browser, the vault server must allow cross-origin requests.'
      }
    }
    if (this.#lastConnectError) {
      status.lastConnectError = this.#lastConnectError
    }
    return status
  }

  // ─── Identities ────────────────────────────────────────────────────────────

  listIdentities(): VaultIdentity[] {
    return this.#state.accounts.map((account) => ({
      name: getAccountName(account),
      accountId: accountIdFromSeed(account.seed),
    }))
  }

  async createIdentity(name?: string): Promise<VaultIdentity> {
    const seed = randomBytes(32)
    return this.#storeIdentity(seed, name)
  }

  async importIdentityFromMnemonic(mnemonic: string, name?: string): Promise<VaultIdentity> {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid recovery phrase.')
    }
    const {privateKey} = deriveKeyPairFromMnemonic(mnemonic)
    const seed = new Uint8Array(privateKey)
    const accountId = accountIdFromSeed(seed)
    const existing = this.#state.accounts.find((account) => accountIdFromSeed(account.seed) === accountId)
    if (existing) {
      return {name: getAccountName(existing), accountId}
    }
    return this.#storeIdentity(seed, name)
  }

  async #storeIdentity(seed: Uint8Array, name?: string): Promise<VaultIdentity> {
    const accountId = accountIdFromSeed(seed)
    if (name !== undefined) {
      validateNewKeyName(name, accountId, this.#state.accounts)
    }
    const account: Account = {
      ...(name !== undefined ? {name} : {}),
      seed,
      createTime: Date.now(),
      delegations: [],
    }
    await this.#applyMutation((state) => {
      state.accounts = [...state.accounts, account]
      if (state.deletedAccounts && accountId in state.deletedAccounts) {
        const {[accountId]: _removed, ...rest} = state.deletedAccounts
        state.deletedAccounts = Object.keys(rest).length > 0 ? rest : undefined
      }
      return true
    })
    return {name: getAccountName(account), accountId}
  }

  /** Rename with the Go rules: format, no-op guard, uniqueness, validateLocalKeyName. */
  async renameIdentity(currentName: string, newName: string): Promise<void> {
    if (!KEY_NAME_FORMAT.test(newName)) {
      throw new Error('Invalid new name format.')
    }
    await this.#applyMutation((state) => {
      const index = findAccountIndex(state.accounts, currentName)
      if (index < 0) {
        throw new Error(`${currentName}: named key not found`)
      }
      const account = state.accounts[index]
      if (account.name === newName) {
        throw new Error('New name equals current name.')
      }
      if (state.accounts.some((candidate) => candidate.name === newName)) {
        throw new Error('Name already exists, delete it first.')
      }
      // Go validateLocalKeyName: a name that decodes as a principal DIFFERENT
      // from the account's own key is rejected.
      const accountId = accountIdFromSeed(account.seed)
      try {
        const decoded = principalToString(principalFromString(newName))
        if (decoded !== accountId) {
          throw new Error('Key name parses as a different public key.')
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Key name parses as a different public key.') {
          throw error
        }
        // Not a principal-shaped name — allowed.
      }
      state.accounts = state.accounts.map((candidate, idx) =>
        idx === index ? {...candidate, name: newName} : candidate,
      )
      return true
    })
  }

  /** Remove an identity and record a deletion tombstone (Go DeleteKey). */
  async deleteIdentity(nameOrId: string): Promise<void> {
    await this.#applyMutation((state) => {
      const index = findAccountIndex(state.accounts, nameOrId)
      if (index < 0) {
        throw new Error(`${nameOrId}: named key not found`)
      }
      const accountId = accountIdFromSeed(state.accounts[index].seed)
      state.accounts = state.accounts.filter((_, idx) => idx !== index)
      const now = Date.now()
      const tombstones = {...(state.deletedAccounts ?? {})}
      if (!(tombstones[accountId] >= now)) {
        tombstones[accountId] = now
      }
      state.deletedAccounts = tombstones
      return true
    })
  }

  /** Signer for publishing as a vault identity. Throws when unknown. */
  getSigner(accountId: string): HMSigner {
    const index = findAccountIndex(this.#state.accounts, accountId)
    if (index < 0) {
      throw new Error(`${accountId}: named key not found`)
    }
    return toHMSigner(nobleKeyPairFromSeed(this.#state.accounts[index].seed))
  }

  // ─── Vault Connect ceremony ────────────────────────────────────────────────

  async startVaultConnection(
    vaultUrl: string,
    opts: {force?: boolean; siteName?: string} = {},
  ): Promise<{connectUrl: string; expireTime: number}> {
    const normalizedUrl = normalizeVaultOriginURL(vaultUrl)
    if (this.#remote && !opts.force) {
      throw new Error('Remote vault is already connected; retry with force.')
    }
    if (this.#pending && Date.now() < this.#pending.expireTime && !opts.force) {
      throw new Error('Vault connection is already in progress; retry with force.')
    }

    this.#stopPolling()
    this.#lastConnectError = undefined
    this.#pollFailureCount = 0
    this.#lastPollError = undefined
    const pending = mintPendingConnection(normalizedUrl, opts.siteName)
    this.#pending = pending
    this.#startPolling()
    this.#notify()
    return {connectUrl: pending.connectUrl, expireTime: pending.expireTime}
  }

  cancelVaultConnection(): void {
    this.#stopPolling()
    this.#pending = null
    this.#notify()
  }

  #startPolling(): void {
    this.#stopPolling()
    this.#pollTimer = setInterval(() => {
      void this.#pollOnce()
    }, CONNECT_POLL_INTERVAL_MS)
  }

  #stopPolling(): void {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer)
      this.#pollTimer = null
    }
  }

  async #pollOnce(): Promise<void> {
    const pending = this.#pending
    if (!pending || this.#pollInFlight) return
    if (Date.now() > pending.expireTime) {
      this.#stopPolling()
      this.#pending = null
      this.#lastConnectError = CONNECT_TOKEN_EXPIRED_ERROR
      this.#notify()
      return
    }
    this.#pollInFlight = true
    try {
      const result = await getVaultConnect(pending.vaultUrl, pending.connectId)
      if (this.#pollFailureCount >= POLL_WARNING_THRESHOLD) this.#notify()
      this.#pollFailureCount = 0
      this.#lastPollError = undefined
      if (!result.found || this.#pending !== pending) return
      // The payload is one-time: consume the pending token before finalizing
      // (Go HandleConnection). Any later failure requires a fresh mint.
      this.#stopPolling()
      this.#pending = null
      await this.#handleConnectPayload(pending, result.payload!)
    } catch (error) {
      // Transient network/server errors must not end the flow; keep polling —
      // but surface persistent failure (e.g. CORS-blocked cross-origin polls)
      // so "pending" is never a silent black hole.
      this.#pollFailureCount += 1
      this.#lastPollError = error instanceof Error ? error.message : String(error)
      if (this.#pollFailureCount === POLL_WARNING_THRESHOLD) this.#notify()
    } finally {
      this.#pollInFlight = false
    }
  }

  async #handleConnectPayload(pending: PendingConnection, encryptedPayload: string): Promise<void> {
    try {
      const payload = await decodeConnectPayload(encryptedPayload, pending.tokenBytes)
      const payloadUrl = normalizeVaultOriginURL(payload.vaultUrl)
      if (payloadUrl !== pending.vaultUrl) {
        throw new Error(`Vault URL mismatch: expected ${pending.vaultUrl}, got ${payloadUrl}`)
      }
      const secret = b64url.decode(payload.secret)

      // Capture the credential being superseded (same vault + user only).
      let oldCredential: {credentialId: string; secret: Uint8Array} | null = null
      const previousRemote = this.#remote
      if (
        previousRemote &&
        previousRemote.vaultUrl === payloadUrl &&
        previousRemote.userId === payload.userId &&
        previousRemote.credentialId &&
        previousRemote.credentialId !== payload.credentialId
      ) {
        const oldSecret = await loadSecret(
          this.#deps.secretStore,
          remoteVaultAccount(previousRemote.vaultUrl, previousRemote.userId),
          previousRemote.credentialId,
        ).catch(() => null)
        if (oldSecret) {
          oldCredential = {credentialId: previousRemote.credentialId, secret: oldSecret}
        }
      }

      const result = await finishConnection({
        vaultUrl: payloadUrl,
        userId: payload.userId,
        credentialId: payload.credentialId,
        secret,
        getLocalSnapshot: () => ({state: this.#state, localVersion: this.#remote?.localVersion ?? 0}),
      })

      // Persist the connection: the device ADOPTS the remote vault's DEK
      // (Go vault.go:2139-2163) — the pre-connect local DEK is abandoned and
      // the local state re-encrypted under the remote DEK.
      await storeSecret(
        this.#deps.secretStore,
        remoteVaultAccount(payloadUrl, payload.userId),
        payload.credentialId,
        secret,
      )
      this.#state = result.state
      this.#dek = result.dek
      this.#remote = createRemoteSyncState({
        vaultUrl: payloadUrl,
        userId: payload.userId,
        credentialId: payload.credentialId,
        localVersion: previousRemote?.localVersion ?? 0,
        remoteVersion: result.remoteVersion,
        syncedLocalVersion: result.syncedLocalVersion,
        lastSyncTime: result.lastSyncTime,
      })
      this.#credentials = mergeCredentialLists(this.#credentials, result.credentials)
      await this.#persist()
      this.#lastConnectError = undefined

      if (oldCredential) {
        await cleanupOldCredential({
          vaultUrl: payloadUrl,
          credentialId: oldCredential.credentialId,
          secret: oldCredential.secret,
        })
        await deleteSecret(
          this.#deps.secretStore,
          remoteVaultAccount(payloadUrl, payload.userId),
          oldCredential.credentialId,
        ).catch(() => {})
        this.#credentials = this.#credentials.filter(
          (credential) => !(credential.kind === 'secret' && credential.credentialId === oldCredential!.credentialId),
        )
        await this.#persist()
      }

      this.#scheduler.start()
      this.#notify()
    } catch (error) {
      this.#lastConnectError = error instanceof Error ? error.message : String(error)
      this.#notify()
    }
  }

  /**
   * Switch back to local mode.
   * - `clearLocalVault: false` — Go Disconnect: drop remote + credentials,
   *   rewrap the DEK under the local KEK, keep identities. NO tombstones.
   * - `clearLocalVault: true` — Go DisconnectAndClear: empty state. NO tombstones.
   */
  async disconnect(opts: {clearLocalVault: boolean}): Promise<void> {
    this.#scheduler.stop()
    this.#stopPolling()
    this.#pending = null
    if (opts.clearLocalVault) {
      this.#state = createEmpty()
      this.#dek = randomBytes(DEK_SIZE)
    }
    this.#remote = null
    this.#credentials = []
    await ensureLocalKEK(this.#deps.secretStore)
    await this.#persist()
    this.#notify()
  }

  /** Immediate sync; throws when not connected or the pass fails. */
  async forceSync(): Promise<void> {
    if (!this.#remote) {
      throw new Error('Not connected to a remote vault.')
    }
    try {
      await this.#scheduler.schedule(() => runRemoteSync(this.#syncHost()))
    } catch (error) {
      this.#recordSyncFailure(error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  async #importLegacyMnemonic(): Promise<void> {
    const mnemonic = await getMnemonic()
    if (!mnemonic || !validateMnemonic(mnemonic)) return
    await this.importIdentityFromMnemonic(mnemonic)
  }

  /**
   * Go applyMutation: run the mutation, and when it reports a change persist
   * the state — bumping localVersion ONLY when connected to a remote — then
   * schedule a sync. Mutations are serialized on a write chain.
   */
  #applyMutation(fn: (state: State) => boolean): Promise<void> {
    const task = this.#writeChain.then(async () => {
      const draft: State = {
        ...this.#state,
        accounts: [...this.#state.accounts],
        ...(this.#state.deletedAccounts ? {deletedAccounts: {...this.#state.deletedAccounts}} : {}),
      }
      const changed = fn(draft)
      if (!changed) return
      this.#state = draft
      if (this.#remote) {
        this.#remote = {...this.#remote, localVersion: this.#remote.localVersion + 1}
      }
      await this.#persist()
      this.#notify()
      if (this.#remote) {
        void this.#scheduler.schedule()
      }
    })
    this.#writeChain = task.catch(() => {})
    return task
  }

  async #persist(): Promise<void> {
    const plaintext = await serializeState(this.#state)
    const encryptedData = await encrypt(plaintext, this.#dek)
    const wrappingKey = await this.#loadWrappingKey()
    const wrappedDEK = await encrypt(this.#dek, wrappingKey)
    const envelope: VaultEnvelope = {
      encryptedData,
      wrappedDEK,
      credentials: this.#credentials,
      remote: this.#remote,
    }
    this.#deps.storage.set(StorageKeys.VAULT_ENVELOPE, serializeEnvelope(envelope))
  }

  async #loadWrappingKey(): Promise<Uint8Array> {
    if (!this.#remote) {
      return ensureLocalKEK(this.#deps.secretStore)
    }
    const secret = await loadSecret(
      this.#deps.secretStore,
      remoteVaultAccount(this.#remote.vaultUrl, this.#remote.userId),
      this.#remote.credentialId,
    )
    if (!secret) {
      throw new Error('Failed to load remote vault KEK: credential secret not found.')
    }
    return secret
  }

  #syncHost() {
    return {
      loadSyncContext: async (): Promise<RemoteSyncContext | null> => {
        const remote = this.#remote
        if (!remote || !remote.vaultUrl.trim()) return null
        const credential = this.#credentials.find(
          (entry) => entry.kind === 'secret' && entry.credentialId === remote.credentialId,
        )
        if (!credential || !credential.wrappedDEK.trim()) {
          throw new Error(`Remote vault response is missing secret credential "${remote.credentialId}".`)
        }
        const secret = await loadSecret(
          this.#deps.secretStore,
          remoteVaultAccount(remote.vaultUrl, remote.userId),
          remote.credentialId,
        )
        if (!secret) {
          throw new Error('Failed to load remote auth secret.')
        }
        return {
          vaultUrl: remote.vaultUrl,
          userId: remote.userId,
          credentialId: remote.credentialId,
          secret,
          wrappedDEK: credential.wrappedDEK,
          localVersion: remote.localVersion,
          remoteVersion: remote.remoteVersion,
          syncedLocalVersion: remote.syncedLocalVersion,
        }
      },
      getLocalSnapshot: () => ({state: this.#state, localVersion: this.#remote?.localVersion ?? 0}),
      applyMergedState: async (state: State) => {
        // Merge-ins never bump localVersion (Go mergeRemoteAccounts).
        this.#state = state
        await this.#persist()
        this.#notify()
      },
      recordSyncSuccess: async (success: SyncSuccess) => {
        if (!this.#remote) return
        this.#remote = {
          ...this.#remote,
          remoteVersion: success.remoteVersion,
          syncedLocalVersion: success.syncedLocalVersion,
          lastSyncTime: success.lastSyncTime,
          lastSyncError: '',
        }
        this.#credentials = mergeCredentialLists(this.#credentials, success.credentials)
        this.#dek = success.dek
        await this.#persist()
        this.#notify()
      },
    }
  }

  async #syncRemoteMaybe(): Promise<void> {
    try {
      await runRemoteSync(this.#syncHost())
    } catch (error) {
      this.#recordSyncFailure(
        `remote sync failed after local mutation: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  #recordSyncFailure(message: string): void {
    if (!this.#remote) return
    this.#remote = {
      ...this.#remote,
      lastSyncTime: Math.floor(Date.now() / 1000),
      lastSyncError: message.trim(),
    }
    void this.#persist().catch(() => {})
    this.#notify()
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function validateNewKeyName(name: string, accountId: string, accounts: Account[]): void {
  if (!KEY_NAME_FORMAT.test(name)) {
    throw new Error('Invalid name format.')
  }
  if (accounts.some((account) => account.name === name || getAccountName(account) === name)) {
    throw new Error('Name already exists, delete it first.')
  }
  try {
    const decoded = principalToString(principalFromString(name))
    if (decoded !== accountId) {
      throw new Error('Key name parses as a different public key.')
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Key name parses as a different public key.') {
      throw error
    }
    // Not principal-shaped — fine.
  }
}

/** Resolve an account by name, falling back to principal (Go findAccountByNameOrPrincipal). */
function findAccountIndex(accounts: Account[], nameOrId: string): number {
  const byName = accounts.findIndex((account) => account.name === nameOrId)
  if (byName >= 0) return byName
  try {
    principalFromString(nameOrId)
  } catch {
    return -1
  }
  return accounts.findIndex((account) => accountIdFromSeed(account.seed) === nameOrId)
}

async function loadEnvelopeWrappingKey(secretStore: SecretStore, envelope: VaultEnvelope): Promise<Uint8Array> {
  if (!envelope.remote) {
    return ensureLocalKEK(secretStore)
  }
  const secret = await loadSecret(
    secretStore,
    remoteVaultAccount(envelope.remote.vaultUrl, envelope.remote.userId),
    envelope.remote.credentialId,
  )
  if (!secret) {
    throw new Error('Failed to load remote vault KEK: credential secret not found.')
  }
  return secret
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let managerPromise: Promise<VaultManager> | null = null

/** The app-wide VaultManager, constructed with platform-default storage. */
export function getVaultManager(): Promise<VaultManager> {
  if (!managerPromise) {
    const {storage} = require('../store/storage') as typeof import('../store/storage')
    managerPromise = VaultManager.load({secretStore: createDefaultSecretStore(), storage}).catch((error) => {
      managerPromise = null
      throw error
    })
  }
  return managerPromise
}

/** Test-only: drop the singleton so the next getVaultManager() reloads. */
export function resetVaultManager(): void {
  managerPromise = null
}
