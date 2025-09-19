// This file contains auth-related utilities that are decoupled
// from any presentation and framework logic.
import * as cbor from '@ipld/dag-cbor'

export type PublicKey = Uint8Array

export type Profile = {
  type: 'Profile'
  alias: PublicKey
  signer: PublicKey
  sig: Uint8Array
  ts: bigint
}

/**
 * Signs a profile alias for device linking
 * @param kp The key pair to use for signing
 * @param alias The alias public key
 * @param ts The timestamp
 * @returns The signed profile
 */
export async function signProfileAlias(
  kp: CryptoKeyPair,
  alias: PublicKey,
  ts: bigint,
): Promise<Profile> {
  const pubKey = await preparePublicKey(kp.publicKey)

  const unsigned: Profile = {
    type: 'Profile',
    alias,
    ts,
    signer: pubKey,
    sig: new Uint8Array(64),
  }

  const unsignedData = cbor.encode(unsigned)
  const sig = await crypto.subtle.sign(
    {
      ...kp.privateKey.algorithm,
      hash: {name: 'SHA-256'},
    },
    kp.privateKey,
    unsignedData,
  )

  return {
    ...unsigned,
    sig: new Uint8Array(sig),
  }
}

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
  const sig = await crypto.subtle.sign(
    {
      ...kp.privateKey.algorithm,
      hash: {name: 'SHA-256'},
    },
    kp.privateKey,
    unsignedData,
  )

  return {
    ...unsigned,
    sig: new Uint8Array(sig),
  }
}

export async function preparePublicKey(
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  if (publicKey.type !== 'public') {
    throw new Error('Can only stringify public keys')
  }

  // Export raw key first
  const raw = await crypto.subtle.exportKey('raw', publicKey)
  const bytes = new Uint8Array(raw)

  // Raw format is 65 bytes: 0x04 + x (32) + y (32)
  const x = bytes.slice(1, 33)
  const y = bytes.slice(33)

  // Check if y is odd
  // @ts-expect-error
  const prefix = y[31] & 1 ? 0x03 : 0x02

  const outputKeyValue = new Uint8Array([
    // varint prefix for 0x1200
    128,
    36,
    prefix,
    ...x,
  ])
  return outputKeyValue
}

// // key pair was generated like this:
// const keyPair = await crypto.subtle.generateKey(
//   {
//     name: 'ECDSA',
//     namedCurve: 'P-256',
//   },
//   false, // non-extractable
//   ['sign', 'verify'],
// )
