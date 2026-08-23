/**
 * Remote vault sync — a port of Go's syncRemote/remoteNeedsUpload/
 * recordRemoteSyncSuccess (backend/storage/vault/vault.go:1535-1680).
 *
 * One pass = fetch (with knownVersion) → merge any remote change into the
 * local state (no localVersion bump for pure merge-ins) → decide upload
 * semantically (statesEqual, never bytes) → on 409 refetch and retry (≤3).
 *
 * Triggers (wired by VaultManager): 30s foreground interval, AppState
 * 'active', post-mutation, and forceSync. All runs are single-flighted
 * through a promise-chain mutex (Go remoteSyncMu).
 */

import {AppState, type NativeEventSubscription} from 'react-native'
import {buildBearerAuth, findSecretCredential, getVault, saveVault, VaultWriteConflictError} from './api'
import {b64url, decrypt, encrypt} from './crypto'
import type {EnvelopeCredential} from './envelope'
import {credentialToEnvelope, mergeCredentialLists} from './connect'
import {createEmpty, deserializeState, mergeStates, serializeState, statesEqual, type State} from './state-codec'

/** Foreground sync cadence (Go defaultRemoteSyncInterval). */
export const REMOTE_SYNC_INTERVAL_MS = 30_000

export type RemoteSyncContext = {
  vaultUrl: string
  userId: string
  credentialId: string
  secret: Uint8Array
  /** The envelope credential's wrappedDEK (b64url), used when the server says unchanged. */
  wrappedDEK: string
  localVersion: number
  remoteVersion: number
  syncedLocalVersion: number
}

export type SyncSuccess = {
  remoteVersion: number
  syncedLocalVersion: number
  /** Unix SECONDS. */
  lastSyncTime: number
  credentials: EnvelopeCredential[]
  /** The DEK in effect after this sync (unwrapped from the active credential). */
  dek: Uint8Array
}

export type RemoteSyncHost = {
  /** Returns null when the vault is not connected to a remote (sync disabled). */
  loadSyncContext(): Promise<RemoteSyncContext | null>
  getLocalSnapshot(): {state: State; localVersion: number}
  /** Persist a merged-in state WITHOUT bumping localVersion. */
  applyMergedState(state: State): Promise<void>
  recordSyncSuccess(success: SyncSuccess): Promise<void>
  log?: (message: string) => void
}

const MERGE_LOG_PREFIX = '🔑 VAULT-MERGE'

/** Run one sync pass. Throws on failure (callers decide how to record it). */
export async function runRemoteSync(host: RemoteSyncHost): Promise<void> {
  const log = host.log ?? ((message: string) => console.log(`${MERGE_LOG_PREFIX} ${message}`))
  const ctx = await host.loadSyncContext()
  if (!ctx) return

  const maxAttempts = 3
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const bearer = buildBearerAuth(ctx.credentialId, ctx.secret)
    const snapshot = await getVault(ctx.vaultUrl, bearer, ctx.remoteVersion)

    let credential: EnvelopeCredential = {
      kind: 'secret',
      credentialId: ctx.credentialId,
      wrappedDEK: ctx.wrappedDEK,
    }
    if (!snapshot.unchanged) {
      credential = credentialToEnvelope(findSecretCredential(snapshot.credentials, ctx.credentialId))
    }

    let dek: Uint8Array
    try {
      dek = await decrypt(b64url.decode(credential.wrappedDEK), ctx.secret)
    } catch {
      throw new Error('Failed to decrypt wrapped DEK for the remote credential.')
    }

    // Merge any remote change into local state (Go mergeRemoteSnapshot).
    let remoteState: State | null = null
    if (!snapshot.unchanged && snapshot.encryptedData && snapshot.encryptedData.trim()) {
      remoteState = await deserializeState(await decrypt(b64url.decode(snapshot.encryptedData), dek))
      const local = host.getLocalSnapshot()
      const {merged, changedFromLocal} = mergeStates(local.state, remoteState, local.localVersion, snapshot.version)
      log(
        `mergeNormalizedStates result: localVersion=${local.localVersion} remoteVersion=${snapshot.version} changedLocalVault=${changedFromLocal} mergedIdentityCount=${merged.accounts.length}`,
      )
      if (changedFromLocal) {
        await host.applyMergedState(merged)
      }
    }

    // Upload decision (Go remoteNeedsUpload).
    let needsUpload: boolean
    let syncedLocalVersion: number
    if (snapshot.unchanged) {
      needsUpload = ctx.localVersion !== ctx.syncedLocalVersion
      syncedLocalVersion = ctx.syncedLocalVersion
    } else {
      const local = host.getLocalSnapshot()
      needsUpload = !statesEqual(remoteState ?? createEmpty(), local.state)
      syncedLocalVersion = local.localVersion
    }

    let remoteVersion = snapshot.version
    if (needsUpload) {
      const local = host.getLocalSnapshot()
      const encryptedData = b64url.encode(await encrypt(await serializeState(local.state), dek))
      try {
        await saveVault(ctx.vaultUrl, bearer, {encryptedData, version: snapshot.version})
      } catch (error) {
        if (error instanceof VaultWriteConflictError && attempt < maxAttempts) {
          continue
        }
        throw error
      }
      remoteVersion = snapshot.version + 1
      syncedLocalVersion = local.localVersion
    }

    await host.recordSyncSuccess({
      remoteVersion,
      syncedLocalVersion,
      lastSyncTime: Math.floor(Date.now() / 1000),
      credentials: mergeCredentialLists(snapshot.credentials.map(credentialToEnvelope), [credential]),
      dek,
    })
    return
  }

  throw new Error('remote vault sync failed after conflict retries')
}

/**
 * Single-flight scheduler: every run chains onto the previous one, so at most
 * one sync pass executes at a time and every trigger gets a full pass.
 */
export class SyncScheduler {
  #run: () => Promise<void>
  #intervalMs: number
  #chain: Promise<void> = Promise.resolve()
  #interval: ReturnType<typeof setInterval> | null = null
  #appStateSubscription: NativeEventSubscription | null = null

  constructor(run: () => Promise<void>, opts: {intervalMs?: number} = {}) {
    this.#run = run
    this.#intervalMs = opts.intervalMs ?? REMOTE_SYNC_INTERVAL_MS
  }

  /** Start the foreground interval + AppState 'active' triggers. */
  start(): void {
    if (this.#interval) return
    this.#interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        void this.schedule()
      }
    }, this.#intervalMs)
    this.#appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void this.schedule()
      }
    })
  }

  stop(): void {
    if (this.#interval) {
      clearInterval(this.#interval)
      this.#interval = null
    }
    this.#appStateSubscription?.remove()
    this.#appStateSubscription = null
  }

  /**
   * Queue a run behind any in-flight one. The returned promise settles with
   * THIS run's outcome (rejections propagate to the caller); the internal
   * chain never breaks.
   */
  schedule(run?: () => Promise<void>): Promise<void> {
    const task = this.#chain.then(() => (run ?? this.#run)())
    this.#chain = task.catch(() => {})
    return task
  }
}
