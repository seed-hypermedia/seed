/**
 * Document Change SDK — create and sign change blobs for documents.
 *
 * Two-step API:
 *   1. createChangeOps() — build unsigned CBOR bytes from native ops (sync, no signer needed)
 *   2. createChange() — sign any unsigned change bytes (from createChangeOps or daemon PrepareChange)
 *
 * Convenience wrappers combine both steps for common use cases.
 */

import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import type {HMPrepareDocumentChangeInput, HMPublishBlobsInput, HMSigner} from './hm-types'
import {CID} from 'multiformats'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {createVersionRef} from './ref'
import {cborCodec, normalizeBytes} from './signing'

export type DocumentOperation =
  | {type: 'SetAttributes'; attrs: Array<{key: string[]; value: unknown}>}
  | {type: 'MoveBlocks'; blocks: string[]; parent: string}
  | {type: 'ReplaceBlock'; block: unknown}
  | {type: 'DeleteBlocks'; blocks: string[]}

export type CreateChangeOpsInput = {
  /** Native CBOR ops */
  ops: DocumentOperation[]
  /** CID of the genesis change blob */
  genesisCid: CID
  /** CIDs of dependency changes */
  deps: CID[]
  /** Depth of the change (max depth of deps + 1) */
  depth: number
  /** Timestamp (defaults to Date.now()) */
  ts?: bigint
}

/**
 * Build unsigned change CBOR bytes from native ops.
 * The returned bytes have null signer and sig — pass to createChange() to sign.
 */
export function createChangeOps(input: CreateChangeOpsInput): {unsignedBytes: Uint8Array; ts: bigint} {
  const ts = input.ts ?? BigInt(Date.now())
  const unsigned: Record<string, unknown> = {
    type: 'Change',
    body: {
      ops: input.ops,
      opCount: input.ops.length,
    },
    signer: null,
    ts,
    sig: null,
    genesis: input.genesisCid,
    deps: input.deps,
    depth: input.depth,
  }
  return {unsignedBytes: cborEncode(unsigned), ts}
}

/**
 * Sign unsigned change CBOR bytes (from createChangeOps or daemon PrepareChange RPC).
 *
 * 1. Decode unsigned CBOR
 * 2. Fill signer with client's public key
 * 3. Fill sig with 64 zero bytes (Ed25519 signature placeholder)
 * 4. Sign the CBOR-encoded blob (with zeroed sig)
 * 5. Encode final blob and compute SHA256 CID
 */
export async function createChange(
  unsignedBytes: Uint8Array,
  signer: HMSigner,
): Promise<{bytes: Uint8Array; cid: CID; genesis: CID | null}> {
  const change = cborDecode(unsignedBytes) as Record<string, unknown>

  // Extract genesis CID from the change before signing
  const genesis = change.genesis instanceof CID ? change.genesis : null

  change.signer = new Uint8Array(await signer.getPublicKey())
  change.sig = new Uint8Array(64)

  change.sig = await signer.sign(cborEncode(change))

  const block = await Block.encode({value: change, codec: cborCodec, hasher: sha256})

  return {bytes: block.bytes, cid: block.cid, genesis}
}

/** @deprecated Use createChange instead */
export const signPreparedChange = async (
  unsignedBytes: Uint8Array,
  signer: HMSigner,
): Promise<{signedBytes: Uint8Array; cid: CID; genesis: CID | null}> => {
  const result = await createChange(unsignedBytes, signer)
  return {signedBytes: result.bytes, cid: result.cid, genesis: result.genesis}
}

/**
 * Create a signed genesis Change blob (empty, ts=0).
 * This is the bootstrap blob for a new document, matching the web pattern.
 */
export async function createGenesisChange(signer: HMSigner): Promise<{bytes: Uint8Array; cid: CID}> {
  const pubKey = await signer.getPublicKey()
  const unsigned: Record<string, unknown> = {
    type: 'Change',
    signer: new Uint8Array(pubKey),
    sig: new Uint8Array(64),
    ts: BigInt(0),
  }
  unsigned.sig = await signer.sign(cborEncode(unsigned))
  const block = await Block.encode({value: unsigned, codec: cborCodec, hasher: sha256})
  return {bytes: block.bytes, cid: block.cid}
}

/** @deprecated Use CreateChangeOpsInput instead */
export type CreateDocumentChangeFromOpsInput = CreateChangeOpsInput

/**
 * Convenience: create unsigned ops + sign in one step.
 * @deprecated Use createChangeOps() + createChange() for the decoupled API.
 */
export async function createDocumentChangeFromOps(
  input: CreateChangeOpsInput,
  signer: HMSigner,
): Promise<{bytes: Uint8Array; cid: CID; ts: bigint}> {
  const {unsignedBytes, ts} = createChangeOps(input)
  const {bytes, cid} = await createChange(unsignedBytes, signer)
  return {bytes, cid, ts}
}

export type CreateDocumentChangeInput = {
  /** Proto-format changes (same as PrepareDocumentChange input) */
  changes: HMPrepareDocumentChangeInput['changes']
  /** CID of the genesis change blob */
  genesisCid: CID
  /** CIDs of dependency changes */
  deps: CID[]
  /** Depth of the change (max depth of deps + 1) */
  depth: number
}

/**
 * Create a signed document Change blob from proto-format changes.
 * Only supports setMetadata — for all ops, use createChangeOps + createChange.
 */
export async function createDocumentChange(
  input: CreateDocumentChangeInput,
  signer: HMSigner,
): Promise<{bytes: Uint8Array; cid: CID}> {
  const ops = protoChangesToOps(input.changes)
  const {unsignedBytes} = createChangeOps({ops, genesisCid: input.genesisCid, deps: input.deps, depth: input.depth})
  const {bytes, cid} = await createChange(unsignedBytes, signer)
  return {bytes, cid}
}

function protoChangesToOps(changes: HMPrepareDocumentChangeInput['changes']): DocumentOperation[] {
  return changes.map((change) => {
    const op = change.op
    if (!op || !op.case) throw new Error('Invalid change: missing op')
    switch (op.case) {
      case 'setMetadata':
        return {
          type: 'SetAttributes' as const,
          attrs: [{key: [op.value.key], value: op.value.value}],
        }
      default:
        throw new Error(
          `Op "${op.case}" is not supported for client-side change creation. Use PrepareDocumentChange + createChange instead.`,
        )
    }
  })
}

export type SignDocumentChangeInput = {
  /** Account UID (base58btc-encoded principal) */
  account: string
  /** Document path (API format, e.g., "/my-doc"). Defaults to root (""). */
  path?: string
  /** Unsigned CBOR bytes from PrepareChange RPC */
  unsignedChange: Uint8Array
  /** Genesis CID string (from GetDocument). For new documents omit — changeCid is used. */
  genesis?: string
  /** Generation number (from GetDocument.generationInfo). Defaults to Date.now(). */
  generation?: number | bigint
  /** Optional capability CID string */
  capability?: string
}

/**
 * Sign a prepared change and create a version ref, returning blobs ready for publishing.
 *
 * Combines: createChange + createVersionRef into a single publish payload.
 * The caller is responsible for calling PrepareChange beforehand and submitting via publishBlobs.
 */
export async function signDocumentChange(
  input: SignDocumentChangeInput,
  signer: HMSigner,
): Promise<{changeCid: CID; publishInput: HMPublishBlobsInput}> {
  const {bytes: signedBytes, cid: changeCid, genesis: changeGenesis} = await createChange(input.unsignedChange, signer)

  // Use explicit genesis from input, or the genesis embedded in the change blob, or fall back to the change CID
  const effectiveGenesis = input.genesis || (changeGenesis ? changeGenesis.toString() : changeCid.toString())
  const effectiveGeneration = input.generation != null ? Number(input.generation) : Date.now()

  const refBlobs = await createVersionRef(
    {
      space: input.account,
      path: input.path ?? '',
      genesis: effectiveGenesis,
      version: changeCid.toString(),
      generation: effectiveGeneration,
      capability: input.capability,
    },
    signer,
  )

  return {
    changeCid,
    publishInput: {
      blobs: [{data: normalizeBytes(signedBytes), cid: changeCid.toString()}, ...refBlobs.blobs],
    },
  }
}
