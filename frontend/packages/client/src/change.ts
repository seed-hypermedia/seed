/**
 * Document Change SDK — sign prepared changes from the daemon for client-side key management.
 *
 * The daemon's PrepareChange RPC handles all CRDT resolution and returns unsigned CBOR bytes.
 * This module signs those bytes locally so the daemon never needs access to the signing key.
 */

import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import type {HMPublishBlobsInput, HMSigner} from '@shm/shared/hm-types'
import {CID} from 'multiformats'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {createVersionRef} from './ref'

const cborCodec = {
  code: 0x71 as const,
  encode: (input: unknown) => cborEncode(input),
  name: 'DAG-CBOR' as const,
}

/**
 * Sign an unsigned Change blob returned by the daemon's PrepareChange RPC.
 *
 * 1. Decode unsigned CBOR (signer and sig are null from NopSigner)
 * 2. Fill signer with client's public key
 * 3. Fill sig with 64 zero bytes (Ed25519 signature placeholder)
 * 4. Sign the CBOR-encoded blob (with zeroed sig)
 * 5. Encode final blob and compute SHA256 CID
 */
export async function signPreparedChange(
  unsignedBytes: Uint8Array,
  signer: HMSigner,
): Promise<{signedBytes: Uint8Array; cid: CID}> {
  const change = cborDecode(unsignedBytes) as Record<string, unknown>

  change.signer = new Uint8Array(await signer.getPublicKey())
  change.sig = new Uint8Array(64)

  change.sig = await signer.sign(cborEncode(change))

  const block = await Block.encode({value: change, codec: cborCodec, hasher: sha256})

  return {signedBytes: block.bytes, cid: block.cid}
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
 * Combines: sign change + create version ref into a single publish payload.
 * The caller is responsible for calling PrepareChange beforehand and submitting via publishBlobs.
 */
export async function signDocumentChange(
  input: SignDocumentChangeInput,
  signer: HMSigner,
): Promise<{changeCid: CID; publishInput: HMPublishBlobsInput}> {
  const {signedBytes, cid: changeCid} = await signPreparedChange(input.unsignedChange, signer)

  // For new documents, the change CID is the genesis
  const effectiveGenesis = input.genesis || changeCid.toString()
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

function normalizeBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(data.byteLength)
  normalized.set(data)
  return normalized
}
