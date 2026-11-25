// This file contains auth-related utilities that are decoupled
// from any presentation and framework logic.
import type {HMSigner} from '@seed-hypermedia/client/hm-types'
import * as cbor from '@ipld/dag-cbor'
import * as blobs from '@shm/shared/blobs'

/** Encoded public key bytes used by the web auth helpers. */
export type PublicKey = Uint8Array

/** Signed profile-alias blob used during browser device linking. */
export type Profile = {
  type: 'Profile'
  alias: PublicKey
  signer: PublicKey
  sig: Uint8Array
  ts: bigint
}

/** Signs data with an Ed25519 identity key. */
export async function signWithKeyPair(keyPair: CryptoKeyPair, data: Uint8Array): Promise<Uint8Array> {
  if (keyPair.privateKey.algorithm.name !== 'Ed25519') {
    throw new Error(`Unsupported signing key algorithm: ${keyPair.privateKey.algorithm.name}`)
  }
  const signature = await crypto.subtle.sign('Ed25519' as unknown as AlgorithmIdentifier, keyPair.privateKey, data)
  return new Uint8Array(signature)
}

/** Bind a signer to one local identity, including its delegated account, without re-reading global auth state. */
export function createWebIdentitySigner(
  identity: CryptoKeyPair & {id: string; delegatedAccountUid?: string},
  accountUid: string,
): HMSigner {
  if (identity.id !== accountUid && identity.delegatedAccountUid !== accountUid) {
    throw new Error('This account is not available to the local web identity')
  }
  const {publicKey, privateKey} = identity
  return {
    getPublicKey: () => preparePublicKey(publicKey),
    sign: (data) => signWithKeyPair({publicKey, privateKey}, new Uint8Array(data)),
  }
}

/**
 * Signs a profile alias for device linking
 * @param kp The key pair to use for signing
 * @param alias The alias public key
 * @param ts The timestamp
 * @returns The signed profile
 */
export async function signProfileAlias(kp: CryptoKeyPair, alias: PublicKey, ts: bigint): Promise<Profile> {
  const pubKey = await preparePublicKey(kp.publicKey)

  const unsigned: Profile = {
    type: 'Profile',
    alias,
    ts,
    signer: pubKey,
    sig: new Uint8Array(64),
  }

  const unsignedData = cbor.encode(unsigned)
  const sig = await signWithKeyPair(kp, unsignedData)

  return {
    ...unsigned,
    sig,
  }
}

/** Signed AGENT capability blob used during browser device linking. */
export type AgentCapability = {
  type: 'Capability'
  role: 'AGENT'
  delegate: PublicKey
  signer: PublicKey
  sig: Uint8Array
  ts: bigint
}

/**
 * Signs an agent capability for device linking
 * @param kp The key pair to use for signing
 * @param delegate The delegate public key
 * @param ts The timestamp
 * @returns The signed agent capability
 */
export async function signAgentCapability(
  kp: CryptoKeyPair,
  delegate: PublicKey,
  ts: bigint,
): Promise<AgentCapability> {
  const pubKey = await preparePublicKey(kp.publicKey)

  const unsigned: AgentCapability = {
    type: 'Capability',
    role: 'AGENT',
    delegate,
    ts,
    signer: pubKey,
    sig: new Uint8Array(64),
  }

  const unsignedData = cbor.encode(unsigned)
  const sig = await signWithKeyPair(kp, unsignedData)

  return {
    ...unsigned,
    sig,
  }
}

/** Converts a browser CryptoKey public key into the canonical multicodec-prefixed form. */
export async function preparePublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  if (publicKey.type !== 'public') {
    throw new Error('Can only stringify public keys')
  }

  // Export raw key first
  const raw = await crypto.subtle.exportKey('raw', publicKey)
  const bytes = new Uint8Array(raw)

  if (publicKey.algorithm.name !== 'Ed25519') {
    throw new Error(`Unsupported public key algorithm: ${publicKey.algorithm.name}`)
  }

  return blobs.principalFromEd25519(bytes)
}
