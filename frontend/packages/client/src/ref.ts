/**
 * Ref SDK — create signed ref blobs for document version, tombstone, and redirect operations.
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import type {HMPublishBlobsInput, HMSigner} from './hm-types'
import {CID} from 'multiformats'
import {base58btc} from 'multiformats/bases/base58'
import {signObject, toPublishInput} from './signing'

export type CreateVersionRefInput = {
  /** Account UID (base58btc-encoded principal) */
  space: string
  /** Document path (API format, e.g., "/my-doc") */
  path: string
  /** Genesis CID string */
  genesis: string
  /** Version string (dot-separated CID strings) */
  version: string
  /** Generation number */
  generation: number
  /** Optional capability CID string */
  capability?: string
  /** Optional CBOR visibility value (e.g., "Private"). Omit or leave empty for public. */
  visibility?: string
}

export type CreateTombstoneRefInput = {
  /** Account UID (base58btc-encoded principal) */
  space: string
  /** Document path (API format, e.g., "/my-doc") */
  path: string
  /** Genesis CID string */
  genesis: string
  /** Generation number */
  generation: number
  /** Optional capability CID string */
  capability?: string
}

export type CreateRedirectRefInput = {
  /** Account UID (base58btc-encoded principal) */
  space: string
  /** Document path (API format, e.g., "/my-doc") */
  path: string
  /** Genesis CID string */
  genesis: string
  /** Generation number */
  generation: number
  /** Target account UID (omit or set same as space if same account) */
  targetSpace?: string
  /** Target document path */
  targetPath: string
  /** If true, republish target content at this location */
  republish?: boolean
  /** Optional capability CID string */
  capability?: string
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Build the base unsigned ref object with common fields.
 * Optional fields are only set when they have meaningful values.
 */
function buildUnsignedRef({
  signerKey,
  space,
  path,
  genesis,
  generation,
  capability,
  visibility,
}: {
  signerKey: Uint8Array
  space: string
  path: string
  genesis: string
  generation: number
  capability?: string
  visibility?: string
}): Record<string, unknown> {
  const signerBytes = new Uint8Array(signerKey)
  const spaceBytes = new Uint8Array(base58btc.decode(space))

  const unsigned: Record<string, unknown> = {
    type: 'Ref',
    signer: signerBytes,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    genesisBlob: CID.parse(genesis),
    generation,
  }

  // Only include space if different from signer
  if (!bytesEqual(spaceBytes, signerBytes)) {
    unsigned.space = spaceBytes
  }

  if (path) {
    unsigned.path = path
  }

  if (capability) {
    unsigned.capability = CID.parse(capability)
  }

  if (visibility) {
    unsigned.visibility = visibility
  }

  return unsigned
}

/**
 * Create a signed version ref blob ready for publishing.
 * Points to a specific document version (genesis + heads).
 * Used for fork/branch operations and normal document refs.
 */
export async function createVersionRef(input: CreateVersionRefInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  const signerKey = await signer.getPublicKey()

  const unsigned = buildUnsignedRef({
    signerKey,
    space: input.space,
    path: input.path,
    genesis: input.genesis,
    generation: input.generation,
    capability: input.capability,
    visibility: input.visibility,
  })

  // Parse version string into CID array
  unsigned.heads = input.version.split('.').map((v) => CID.parse(v))

  unsigned.sig = await signObject(signer, unsigned)

  return toPublishInput(cborEncode(unsigned))
}

/**
 * Create a signed tombstone ref blob ready for publishing.
 * Marks a document as deleted (empty heads, no redirect).
 */
export async function createTombstoneRef(
  input: CreateTombstoneRefInput,
  signer: HMSigner,
): Promise<HMPublishBlobsInput> {
  const signerKey = await signer.getPublicKey()

  const unsigned = buildUnsignedRef({
    signerKey,
    space: input.space,
    path: input.path,
    genesis: input.genesis,
    generation: input.generation,
    capability: input.capability,
  })

  // Tombstone: empty heads
  unsigned.heads = []

  unsigned.sig = await signObject(signer, unsigned)

  return toPublishInput(cborEncode(unsigned))
}

/**
 * Create a signed redirect ref blob ready for publishing.
 * Redirects this document path to a different account/path.
 * Optionally republishes the target content at this location.
 */
export async function createRedirectRef(input: CreateRedirectRefInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  const signerKey = await signer.getPublicKey()

  const unsigned = buildUnsignedRef({
    signerKey,
    space: input.space,
    path: input.path,
    genesis: input.genesis,
    generation: input.generation,
    capability: input.capability,
  })

  // Redirect refs have no heads
  unsigned.heads = []

  // Build redirect target
  const redirect: Record<string, unknown> = {
    path: input.targetPath,
  }

  // Only include target space if different from ref space
  if (input.targetSpace && input.targetSpace !== input.space) {
    redirect.space = new Uint8Array(base58btc.decode(input.targetSpace))
  }

  if (input.republish) {
    redirect.republish = true
  }

  unsigned.redirect = redirect

  unsigned.sig = await signObject(signer, unsigned)

  return toPublishInput(cborEncode(unsigned))
}
