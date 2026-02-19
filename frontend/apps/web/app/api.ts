import {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'
import {HMDocumentOperation, UnpackedHypermediaId} from '@shm/shared'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {BlockView, CID} from 'multiformats'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {preparePublicKey} from './auth-utils'

export {decode as cborDecode, encode as cborEncode} from '@ipld/dag-cbor'

export * as rawCodec from 'multiformats/codecs/raw'

export async function postCBOR(path: string, body: Uint8Array) {
  const response = await fetch(`${path}`, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/cbor',
    },
  })
  return await response.json()
}

export async function get(path: string) {
  const response = await fetch(`${path}`, {})
  return await response.json()
}

export async function post(path: string, body: any) {
  const response = await fetch(`${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return await response.json()
}

export const cborCodec = {
  code: 0x71,
  encode: (input: any) => cborEncode(input),
  name: 'DAG-CBOR',
}

type EncodedBlock = BlockView<unknown, number, 18, 1>

export async function encodeBlock(
  data: any,
  codec?: Parameters<typeof Block.encode>[0]['codec'],
): Promise<EncodedBlock> {
  const block = await Block.encode({
    value: data,
    codec: codec || cborCodec,
    hasher: sha256,
  })
  return block
}

export function blockReference(block: EncodedBlock) {
  return {
    data: block.bytes,
    cid: block.cid.toString(),
  } as const
}

export async function getChangesDepth(deps: string[]) {
  const allDepths = await Promise.all(
    deps.map(async (dep) => {
      const res = await fetch(getDaemonFileUrl(dep))
      const data = await res.arrayBuffer()
      const cborData = new Uint8Array(data)
      const decoded = cborDecode(cborData) as {depth: number}
      return decoded.depth
    }),
  )
  return Math.max(...allDepths)
}

export async function signObject(keyPair: CryptoKeyPair, data: any): Promise<ArrayBuffer> {
  const cborData = cborEncode(data)

  if (keyPair.privateKey.algorithm.name === 'Ed25519') {
    const signature = await crypto.subtle.sign(
      'Ed25519' as unknown as AlgorithmIdentifier,
      keyPair.privateKey,
      cborData,
    )
    return signature
  }

  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: {name: 'SHA-256'},
    },
    keyPair.privateKey,
    cborData,
  )
  return signature
}

type UnsignedDocumentChange = {
  type: 'Change'
  body?: {
    ops: HMDocumentOperation[]
    opCount: number
  }
  signer: Uint8Array
  sig: Uint8Array // new Uint8Array(64); // we are expected to sign a blob with empty signature
  ts?: bigint // undefined for genesis only!
  depth?: number
  genesis?: CID
  deps?: CID[]
}
type SignedDocumentChange = Omit<UnsignedDocumentChange, 'sig'> & {
  sig: ArrayBuffer
}

type UnsignedRef = {
  type: 'Ref'
  space?: Uint8Array
  path?: string
  genesisBlob: CID
  capability?: Uint8Array
  heads: CID[]
  generation: number
  signer: Uint8Array
  ts: bigint
  sig: Uint8Array // new Uint8Array(64); // we are expected to sign a blob with empty signature
}
type SignedRef = Omit<UnsignedRef, 'sig'> & {
  sig: ArrayBuffer
}

export async function createDocumentGenesisChange({keyPair}: {keyPair: CryptoKeyPair}) {
  const signerKey = await preparePublicKey(keyPair.publicKey)
  const unsignedChange: UnsignedDocumentChange = {
    type: 'Change',
    signer: signerKey,
    sig: new Uint8Array(64),
    ts: 0n,
  }
  const signature = await signObject(keyPair, unsignedChange)
  return {
    ...unsignedChange,
    sig: signature,
  } satisfies SignedDocumentChange
}

export async function createHomeDocumentChange({
  operations,
  keyPair,
  genesisChangeCid,
  deps,
  depth,
}: {
  operations: HMDocumentOperation[]
  keyPair: CryptoKeyPair
  genesisChangeCid: CID
  deps: CID[]
  depth: number
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey)
  const unsignedChange: UnsignedDocumentChange = {
    type: 'Change',
    body: {
      ops: operations,
      opCount: operations.length,
    },
    signer: signerKey,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    genesis: genesisChangeCid,
    deps,
    depth,
  }
  const signature = await signObject(keyPair, unsignedChange)
  return {
    ...unsignedChange,
    sig: signature,
  } satisfies SignedDocumentChange
}

export async function createRef({
  keyPair,
  genesisCid,
  head,
  space,
  path,
  generation,
}: {
  keyPair: CryptoKeyPair
  genesisCid: CID
  head: CID
  space?: Uint8Array
  path?: string
  generation: number
}) {
  const signerKey = await preparePublicKey(keyPair.publicKey)
  const unsignedRef: UnsignedRef = {
    type: 'Ref',
    signer: signerKey,
    ts: BigInt(Date.now()),
    sig: new Uint8Array(64),
    genesisBlob: genesisCid,
    heads: [head],
    generation,
  }
  if (path) {
    unsignedRef.path = path
  }
  if (space && !uint8Equals(space, signerKey)) {
    unsignedRef.space = space
  }
  const signature = await signObject(keyPair, unsignedRef)
  return {
    ...unsignedRef,
    sig: signature,
  } satisfies SignedRef
}

function uint8Equals(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}
