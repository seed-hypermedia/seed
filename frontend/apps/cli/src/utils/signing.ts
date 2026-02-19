/**
 * Blob signing utilities for Seed Hypermedia
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import * as ed25519 from '@noble/ed25519'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {CID} from 'multiformats/cid'
import type {KeyPair} from './key-derivation'

export const cborCodec = {
  code: 0x71,
  encode: (input: unknown) => cborEncode(input),
  name: 'DAG-CBOR',
}

export const rawCodec = {
  code: 0x55,
  encode: (input: Uint8Array) => input,
  name: 'raw',
}

export type EncodedBlock = {
  cid: CID
  bytes: Uint8Array
}

/**
 * Encodes data as IPLD block with CID
 */
export async function encodeBlock(
  data: unknown,
  codec = cborCodec,
): Promise<EncodedBlock> {
  const block = await Block.encode({
    value: data,
    codec,
    hasher: sha256,
  })
  return {cid: block.cid, bytes: block.bytes}
}

/**
 * Creates block reference for API payloads
 */
export function blockReference(block: EncodedBlock) {
  return {
    data: block.bytes,
    cid: block.cid.toString(),
  }
}

/**
 * Signs a blob with Ed25519
 */
export async function signBlob<T extends {sig: Uint8Array}>(
  unsigned: T,
  privateKey: Uint8Array,
): Promise<T> {
  const cborData = cborEncode(unsigned)
  const signature = await ed25519.signAsync(cborData, privateKey)
  return {...unsigned, sig: signature}
}

// Blob type definitions

export type GenesisChange = {
  type: 'Change'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
}

export type DocumentChange = {
  type: 'Change'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  genesis: CID
  deps: CID[]
  depth: number
  body: {
    ops: DocumentOperation[]
    opCount: number
  }
}

export type DocumentOperation =
  | {type: 'SetAttributes'; attrs: Array<{key: string[]; value: unknown}>}
  | {type: 'MoveBlocks'; blocks: string[]; parent: string}
  | {type: 'ReplaceBlock'; block: unknown}
  | {type: 'DeleteBlocks'; blocks: string[]}

export type Ref = {
  type: 'Ref'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  genesisBlob: CID
  heads: CID[]
  generation: number
  space?: Uint8Array
  path?: string
  capability?: Uint8Array
}

/**
 * Creates a genesis change (first change in document/account)
 */
export async function createGenesisChange(
  keyPair: KeyPair,
): Promise<GenesisChange> {
  const unsigned: GenesisChange = {
    type: 'Change',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: 0n,
  }
  return signBlob(unsigned, keyPair.privateKey)
}

/**
 * Creates a document change
 */
export async function createDocumentChange(
  keyPair: KeyPair,
  genesisCid: CID,
  deps: CID[],
  depth: number,
  operations: DocumentOperation[],
): Promise<DocumentChange> {
  const unsigned: DocumentChange = {
    type: 'Change',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()),
    genesis: genesisCid,
    deps,
    depth,
    body: {ops: operations, opCount: operations.length},
  }
  return signBlob(unsigned, keyPair.privateKey)
}

/**
 * Creates a ref (version pointer)
 */
export async function createRef(
  keyPair: KeyPair,
  genesisCid: CID,
  headCid: CID,
  generation: number,
  path?: string,
  space?: Uint8Array,
): Promise<Ref> {
  const unsigned: Ref = {
    type: 'Ref',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()),
    genesisBlob: genesisCid,
    heads: [headCid],
    generation,
  }

  if (path) {
    unsigned.path = path
  }

  if (space && !bytesEqual(space, keyPair.publicKeyWithPrefix)) {
    unsigned.space = space
  }

  return signBlob(unsigned, keyPair.privateKey)
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
