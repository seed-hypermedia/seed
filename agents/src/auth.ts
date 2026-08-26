import type {Database} from 'bun:sqlite'
import type * as api from '@/api'
import * as blobs from '@shm/shared/blobs'
import * as cbor from '@/cbor'

const MAX_ACTION_CLOCK_SKEW_MS = 30_000

/** Capability blobs are a few hundred bytes; anything near this is not one. */
const MAX_CAPABILITY_BYTES = 64 * 1024

/** Authorization role values understood by the Agents service. */
export type Role = 'OWNER' | 'AGENT'

/** Result of verifying a signed Agents action envelope. */
export type VerifiedEnvelope = {
  envelope: api.SignedActionEnvelope
  accountId: string
  signerId: string
}

/** Fetches the raw bytes of a published blob by CID, or null when the network does not have it. */
export type CapabilityFetcher = (cid: string) => Promise<Uint8Array | null>

/**
 * Verifies envelope signature and authorizes the signer for the account.
 *
 * A signer that is not the account must prove a delegation. The envelope names the account's
 * Capability blob by CID; the bytes come from the envelope itself, from a delegation this server
 * already verified, or from the HM network via `fetchCapability`. Whichever source, the blob's own
 * signature shows the account granted the delegation and the envelope signature (already verified)
 * shows the caller holds the delegated key — a published capability replayed by anyone else fails
 * the delegate check.
 */
export async function verifyEnvelope(
  db: Database,
  envelope: api.SignedActionEnvelope,
  options: {fetchCapability?: CapabilityFetcher} = {},
): Promise<VerifiedEnvelope> {
  validateEnvelopeShape(envelope)
  validateActionTimestamp(envelope.action.ts)
  if (!verifySignature(envelope)) {
    throw new Error('Invalid signature')
  }

  const accountId = blobs.principalToString(envelope.account)
  const signerId = blobs.principalToString(envelope.signer)

  if (blobs.principalEqual(envelope.signer, envelope.account)) {
    return {envelope, accountId, signerId}
  }
  if (isAuthorizedSigner(db, accountId, signerId)) {
    return {envelope, accountId, signerId}
  }
  if (envelope.capability === undefined) {
    throw new Error('Signer is not authorized for account')
  }

  const capabilityBytes = await resolveCapabilityBytes(envelope, options.fetchCapability)
  const capability = verifyCapabilityDelegation(capabilityBytes, {
    delegate: envelope.signer,
    expectedCid: envelope.capability,
  })
  if (!blobs.principalEqual(capability.signer, envelope.account)) {
    throw new Error('Capability was not issued by the envelope account')
  }
  setLocalAuthorization(db, {
    accountId,
    signerId,
    role: 'AGENT',
    capability: Buffer.from(capabilityBytes).toString('base64'),
    capabilityCid: envelope.capability,
  })
  return {envelope, accountId, signerId}
}

async function resolveCapabilityBytes(
  envelope: api.SignedActionEnvelope,
  fetchCapability: CapabilityFetcher | undefined,
): Promise<Uint8Array> {
  const cid = envelope.capability
  if (typeof cid !== 'string' || !/^[a-z0-9]{10,}$/.test(cid)) {
    throw new Error('Invalid capability CID')
  }
  if (envelope.capabilityBlob !== undefined) {
    if (!(envelope.capabilityBlob instanceof Uint8Array) || !envelope.capabilityBlob.length) {
      throw new Error('Invalid capability bytes')
    }
    return envelope.capabilityBlob
  }
  if (!fetchCapability) {
    throw new Error('Capability blob is not available to this server')
  }
  let fetched: Uint8Array | null
  try {
    fetched = await fetchCapability(cid)
  } catch (error) {
    throw new Error(`Failed to fetch capability ${cid}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!fetched || !fetched.length) {
    throw new Error(`Capability ${cid} is not available on the HM network`)
  }
  return fetched
}

/** Returns whether a non-account signer has an AGENT authorization for the account. */
export function isAuthorizedSigner(db: Database, accountId: string, signerId: string): boolean {
  const row = db
    .query<{role: string}, [string, string]>(
      `SELECT role FROM account_authorizations WHERE account_id = ? AND signer = ? LIMIT 1`,
    )
    .get(accountId, signerId)
  return row?.role === 'AGENT' || row?.role === 'OWNER'
}

/**
 * Decodes and verifies a Capability blob that delegates agent actions to `delegate`.
 *
 * Checks the blob shape, its signature, that it names `delegate`, that its role permits agent
 * actions, that it is not self-issued, and (when given) that its bytes hash to `expectedCid`.
 */
export function verifyCapabilityDelegation(
  capabilityBytes: Uint8Array,
  input: {delegate: blobs.Principal; expectedCid?: string},
): blobs.Capability {
  if (!(capabilityBytes instanceof Uint8Array) || !capabilityBytes.length) {
    throw new Error('Invalid capability bytes')
  }
  if (capabilityBytes.length > MAX_CAPABILITY_BYTES) {
    throw new Error('Capability blob is too large')
  }
  let capability: blobs.Capability
  try {
    capability = cbor.decode<blobs.Capability>(capabilityBytes)
  } catch {
    throw new Error('Capability is not valid CBOR')
  }
  if (!capability || typeof capability !== 'object' || capability.type !== 'Capability') {
    throw new Error('Blob is not a Capability')
  }
  validatePrincipal('capability signer', capability.signer)
  validatePrincipal('capability delegate', capability.delegate)
  if (input.expectedCid !== undefined) {
    // The CID is what the envelope signed over; the bytes must be that blob, not merely a valid one.
    const reencoded = blobs.encode(capability as unknown as blobs.Blob)
    if (reencoded.cid.toString() !== input.expectedCid) {
      throw new Error('Capability bytes do not match the envelope capability CID')
    }
  }
  if (!blobs.verify(capability as unknown as blobs.Blob)) {
    throw new Error('Invalid capability signature')
  }
  if (!blobs.principalEqual(capability.delegate, input.delegate)) {
    throw new Error('Capability delegate does not match envelope signer')
  }
  // WRITER is a broader grant than AGENT, so both prove the account trusts this key to act for it.
  if (capability.role !== 'AGENT' && capability.role !== 'WRITER') {
    throw new Error('Capability role does not permit agent actions')
  }
  if (blobs.principalEqual(capability.signer, capability.delegate)) {
    throw new Error('Capability delegates to its own issuer')
  }
  return capability
}

/**
 * Registers a delegated signer for an account from a signed Capability blob.
 *
 * @deprecated Envelopes now carry their delegation (see {@link verifyEnvelope}); this backs the
 * legacy `RegisterSigner` action for clients from before that change.
 */
export function registerDelegatedSigner(
  db: Database,
  capabilityBytes: Uint8Array,
  envelopeSigner: blobs.Principal,
): {accountId: string; signerId: string} {
  const capability = verifyCapabilityDelegation(capabilityBytes, {delegate: envelopeSigner})
  const accountId = blobs.principalToString(capability.signer)
  const signerId = blobs.principalToString(capability.delegate)
  setLocalAuthorization(db, {
    accountId,
    signerId,
    role: 'AGENT',
    capability: Buffer.from(capabilityBytes).toString('base64'),
    capabilityCid: blobs.encode(capability as unknown as blobs.Blob).cid.toString(),
  })
  return {accountId, signerId}
}

/** Inserts or updates a local account authorization. Useful for tests and future admin actions. */
export function setLocalAuthorization(
  db: Database,
  input: {accountId: string; signerId: string; role: Role; capability?: string; capabilityCid?: string; now?: number},
): void {
  const now = input.now ?? Date.now()
  db.run(
    `INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
    [input.accountId, now, now],
  )
  db.run(
    `INSERT INTO account_authorizations (account_id, signer, role, capability, capability_cid, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, signer) DO UPDATE SET
       role = excluded.role,
       capability = excluded.capability,
       capability_cid = excluded.capability_cid`,
    [input.accountId, input.signerId, input.role, input.capability ?? null, input.capabilityCid ?? null, now],
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
