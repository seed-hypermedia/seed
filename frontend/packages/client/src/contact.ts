import {encode as cborEncode, decode as cborDecode} from '@ipld/dag-cbor'
import type {HMPublishBlobsInput, HMSigner} from '@shm/shared/hm-types'
import {base58btc} from 'multiformats/bases/base58'

export type CreateContactInput = {
  /** The subject account UID (base58btc-encoded principal) */
  subjectUid: string
  /** The display name for the contact */
  name: string
}

export type UpdateContactInput = {
  /** The contact record ID in format "authority/tsid" */
  contactId: string
  /** The subject account UID */
  subjectUid: string
  /** The updated display name */
  name: string
}

export type DeleteContactInput = {
  /** The contact record ID in format "authority/tsid" */
  contactId: string
}

export type CreateContactResult = HMPublishBlobsInput & {
  /** The record ID in format "authority/tsid" */
  recordId: string
}

function normalizeBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(data.byteLength)
  normalized.set(data)
  return normalized
}

function toPublishInput(blobData: Uint8Array): HMPublishBlobsInput {
  return {
    blobs: [{data: normalizeBytes(blobData)}],
  }
}

async function signObject(signer: HMSigner, data: unknown): Promise<Uint8Array> {
  return await signer.sign(cborEncode(data))
}

/**
 * Extract TSID from a record ID (format: "authority/tsid").
 */
function extractTsid(contactId: string): string {
  const parts = contactId.split('/')
  const tsid = parts[1]
  if (!tsid) {
    throw new Error(`Invalid contact ID format: ${contactId}. Expected "authority/tsid".`)
  }
  return tsid
}

/**
 * Compute a TSID from a timestamp and blob data.
 * TSID = 6 bytes timestamp (ms, big-endian) + 4 bytes SHA-256 prefix, Base58BTC encoded.
 */
async function computeTSID(timestampMs: bigint, blobData: Uint8Array): Promise<string> {
  // 6 bytes for timestamp (lower 48 bits of ms, big-endian)
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, timestampMs, false)
  const tsBytes = new Uint8Array(buf, 2, 6)

  // 4 bytes from SHA-256 of blob data
  const hashBuffer = await crypto.subtle.digest('SHA-256', blobData)
  const hashBytes = new Uint8Array(hashBuffer, 0, 4)

  // Combine: 6 + 4 = 10 bytes
  const tsidBytes = new Uint8Array(10)
  tsidBytes.set(tsBytes, 0)
  tsidBytes.set(hashBytes, 6)

  return base58btc.encode(tsidBytes)
}

/**
 * Create a new contact blob and compute its record ID.
 * Returns the publish input plus a `recordId` in "authority/tsid" format.
 */
export async function createContact(input: CreateContactInput, signer: HMSigner): Promise<CreateContactResult> {
  const signerKey = await signer.getPublicKey()
  const ts = BigInt(Date.now())

  const unsigned: Record<string, unknown> = {
    type: 'Contact',
    signer: new Uint8Array(signerKey),
    sig: new Uint8Array(64),
    ts,
    subject: new Uint8Array(base58btc.decode(input.subjectUid)),
    name: input.name,
  }

  unsigned.sig = await signObject(signer, unsigned)

  const encoded = cborEncode(unsigned)
  const authority = base58btc.encode(new Uint8Array(signerKey))
  const tsid = await computeTSID(ts, encoded)

  return {
    ...toPublishInput(encoded),
    recordId: `${authority}/${tsid}`,
  }
}

/**
 * Update an existing contact blob. Reuses the original TSID.
 */
export async function updateContact(input: UpdateContactInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  const signerKey = await signer.getPublicKey()
  const tsid = extractTsid(input.contactId)

  const unsigned: Record<string, unknown> = {
    type: 'Contact',
    signer: new Uint8Array(signerKey),
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()),
    id: tsid,
    subject: new Uint8Array(base58btc.decode(input.subjectUid)),
    name: input.name,
  }

  unsigned.sig = await signObject(signer, unsigned)

  return toPublishInput(cborEncode(unsigned))
}

/**
 * Delete a contact by publishing a tombstone blob.
 * A tombstone has the same TSID but no subject and no name.
 */
export async function deleteContact(input: DeleteContactInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  const signerKey = await signer.getPublicKey()
  const tsid = extractTsid(input.contactId)

  const unsigned: Record<string, unknown> = {
    type: 'Contact',
    signer: new Uint8Array(signerKey),
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()),
    id: tsid,
  }

  unsigned.sig = await signObject(signer, unsigned)

  return toPublishInput(cborEncode(unsigned))
}

/**
 * Compute the record ID ("authority/tsid") from raw CBOR-encoded contact blob bytes.
 * Useful for resolving a CID to a record ID after fetching the blob.
 */
export async function contactRecordIdFromBlob(blobData: Uint8Array): Promise<string> {
  const decoded = cborDecode(blobData) as Record<string, unknown>
  if (decoded.type !== 'Contact') {
    throw new Error(`Expected Contact blob, got "${decoded.type}"`)
  }
  const signerBytes = decoded.signer as Uint8Array
  const ts = BigInt(decoded.ts as bigint | number)
  const authority = base58btc.encode(new Uint8Array(signerBytes))
  const tsid = await computeTSID(ts, blobData)
  return `${authority}/${tsid}`
}
