import type {Database} from 'bun:sqlite'
import type * as api from '@/api'
import * as blobs from '@shm/shared/blobs'

const MAX_ACTION_CLOCK_SKEW_MS = 30_000

/** Authorization role values understood by the Agents service. */
export type Role = 'OWNER' | 'AGENT'

/** Result of verifying a signed Agents action envelope. */
export type VerifiedEnvelope = {
  envelope: api.SignedActionEnvelope
  accountId: string
  signerId: string
}

/** Verifies envelope signature and authorizes the signer for the account. */
export function verifyEnvelope(db: Database, envelope: api.SignedActionEnvelope): VerifiedEnvelope {
  validateEnvelopeShape(envelope)
  validateActionTimestamp(envelope.action.ts)
  if (!verifySignature(envelope)) {
    throw new Error('Invalid signature')
  }

  const accountId = blobs.principalToString(envelope.account)
  const signerId = blobs.principalToString(envelope.signer)

  if (!blobs.principalEqual(envelope.signer, envelope.account) && !isAuthorizedSigner(db, accountId, signerId)) {
    throw new Error('Signer is not authorized for account')
  }

  return {envelope, accountId, signerId}
}

/** Returns whether a non-account signer has an AGENT authorization for the account. */
export function isAuthorizedSigner(db: Database, accountId: string, signerId: string): boolean {
  const row = db
    .query<
      {role: string},
      [string, string]
    >(`SELECT role FROM account_authorizations WHERE account_id = ? AND signer = ? LIMIT 1`)
    .get(accountId, signerId)
  return row?.role === 'AGENT' || row?.role === 'OWNER'
}

/** Inserts or updates a local account authorization. Useful for tests and future admin actions. */
export function setLocalAuthorization(
  db: Database,
  input: {accountId: string; signerId: string; role: Role; capability?: string; now?: number},
): void {
  const now = input.now ?? Date.now()
  db.run(
    `INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    [input.accountId, now, now],
  )
  db.run(
    `INSERT INTO account_authorizations (account_id, signer, role, capability, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(account_id, signer) DO UPDATE SET role = excluded.role, capability = excluded.capability`,
    [input.accountId, input.signerId, input.role, input.capability ?? null, now],
  )
}

function verifySignature(envelope: api.SignedActionEnvelope): boolean {
  return blobs.verify(envelope as unknown as blobs.Blob)
}

function validateEnvelopeShape(envelope: api.SignedActionEnvelope): void {
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid envelope')
  if (envelope.type !== 'AgentsAction') throw new Error('Invalid envelope type')
  validatePrincipal('signer', envelope.signer)
  validatePrincipal('account', envelope.account)
  if (!(envelope.sig instanceof Uint8Array) || envelope.sig.length !== blobs.ED25519_SIGNATURE_SIZE) {
    throw new Error('Invalid signature bytes')
  }
  if (!envelope.action || typeof envelope.action !== 'object' || typeof envelope.action._ !== 'string') {
    throw new Error('Invalid action')
  }
}

function validateActionTimestamp(ts: number): void {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) throw new Error('Invalid action timestamp')
  if (Math.abs(Date.now() - ts) > MAX_ACTION_CLOCK_SKEW_MS)
    throw new Error('Action timestamp is outside allowed window')
}

function validatePrincipal(name: string, principal: Uint8Array): void {
  if (!(principal instanceof Uint8Array)) throw new Error(`Invalid ${name}`)
  if (principal.length !== blobs.ED25519_PRINCIPAL_SIZE) throw new Error(`Invalid ${name}`)
  if (principal[0] !== blobs.ED25519_VARINT_PREFIX[0] || principal[1] !== blobs.ED25519_VARINT_PREFIX[1]) {
    throw new Error(`Invalid ${name}`)
  }
}
