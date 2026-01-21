# Seed Hypermedia Signing Reference

## Key Generation

### From BIP-39 Mnemonic

Seed uses Ed25519 keys derived from BIP-39 mnemonics via SLIP-10.

```typescript
import * as bip39 from 'bip39'
import SLIP10 from '@exodus/slip10'
import * as ed25519 from '@noble/ed25519'
import {sha512} from '@noble/hashes/sha2'
import {base58btc} from 'multiformats/bases/base58'

// Configure ed25519 to use sha512
ed25519.etc.sha512Sync = sha512
ed25519.etc.sha512Async = async (m: Uint8Array) => sha512(m)

const KEY_DERIVATION_PATH = "m/44'/104109'/0'"  // 104109 = Unicode 'h' + 'm'
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

export function deriveKeyPair(mnemonic: string, passphrase = '') {
  // 1. BIP39 seed from mnemonic
  const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase)

  // 2. SLIP-10 derivation
  const masterKey = SLIP10.fromSeed(seed)
  const derivedKey = masterKey.derive(KEY_DERIVATION_PATH)

  // 3. Ed25519 keys
  const privateKey = derivedKey.key  // 32 bytes
  const publicKey = ed25519.getPublicKey(privateKey)  // 32 bytes

  // 4. Account ID (multibase base58btc)
  const publicKeyWithPrefix = new Uint8Array([
    ...ED25519_MULTICODEC_PREFIX,
    ...publicKey,
  ])
  const accountId = base58btc.encode(publicKeyWithPrefix)  // starts with 'z6Mk'

  return {privateKey, publicKey, publicKeyWithPrefix, accountId}
}
```

### Generate New Mnemonic

```typescript
import * as bip39 from 'bip39'

// Generate 12-word mnemonic (128 bits entropy)
const mnemonic = bip39.generateMnemonic(128)

// Or 24-word mnemonic (256 bits entropy)
const mnemonic24 = bip39.generateMnemonic(256)
```

## Blob Signing

All mutable data in Seed is stored as signed CBOR blobs.

### General Pattern

```typescript
import {encode as cborEncode} from '@ipld/dag-cbor'
import * as ed25519 from '@noble/ed25519'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'

const cborCodec = {code: 0x71, encode: cborEncode, name: 'DAG-CBOR'}

async function signBlob<T extends {sig: Uint8Array}>(
  unsigned: T,
  privateKey: Uint8Array
): Promise<T & {sig: Uint8Array}> {
  // 1. CBOR encode with empty signature
  const cborData = cborEncode(unsigned)

  // 2. Sign the CBOR bytes
  const signature = await ed25519.signAsync(cborData, privateKey)

  // 3. Return with signature
  return {...unsigned, sig: signature}
}

async function encodeBlob(signed: any) {
  return Block.encode({
    value: signed,
    codec: cborCodec,
    hasher: sha256,
  })
}
```

## Blob Types

### 1. Genesis Change

The first change in any document/account. Has no deps, genesis, or body.

```typescript
type GenesisChange = {
  type: 'Change'
  signer: Uint8Array    // Public key with multicodec prefix
  sig: Uint8Array       // 64-byte Ed25519 signature
  ts: 0n                // Always 0 for genesis
}

async function createGenesisChange(keyPair: KeyPair) {
  const unsigned: GenesisChange = {
    type: 'Change',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: 0n,
  }
  return signBlob(unsigned, keyPair.privateKey)
}
```

### 2. Document Change

Mutations to documents (after genesis).

```typescript
type DocumentChange = {
  type: 'Change'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint            // Current timestamp in ms
  genesis: CID          // Points to genesis change
  deps: CID[]           // Parent change(s)
  depth: number         // DAG depth (max of deps + 1)
  body: {
    ops: HMDocumentOperation[]
    opCount: number
  }
}

type HMDocumentOperation =
  | {type: 'SetAttributes', attrs: Array<{key: string[], value: any}>}
  | {type: 'MoveBlock', blockId: string, parent: string, leftSibling: string}
  | {type: 'ReplaceBlock', blockId: string, block: HMPublishableBlock}
  | {type: 'DeleteBlock', blockId: string}

async function createDocumentChange(
  keyPair: KeyPair,
  genesisCid: CID,
  deps: CID[],
  depth: number,
  operations: HMDocumentOperation[]
) {
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
```

### 3. Ref (Version Pointer)

Points to current document head(s).

```typescript
type Ref = {
  type: 'Ref'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  genesisBlob: CID      // Points to genesis
  heads: CID[]          // Current head change(s)
  generation: number    // Ref version (increments)
  space?: Uint8Array    // Target space (if delegating)
  path?: string         // Document path (if not root)
  capability?: Uint8Array
}

async function createRef(
  keyPair: KeyPair,
  genesisCid: CID,
  headCid: CID,
  generation: number,
  path?: string,
  space?: Uint8Array
) {
  const unsigned: Ref = {
    type: 'Ref',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()),
    genesisBlob: genesisCid,
    heads: [headCid],
    generation,
  }

  // Only include path if non-root
  if (path) unsigned.path = path

  // Only include space if different from signer
  if (space && !bytesEqual(space, keyPair.publicKeyWithPrefix)) {
    unsigned.space = space
  }

  return signBlob(unsigned, keyPair.privateKey)
}
```

### 4. Comment

```typescript
type Comment = {
  type: 'Comment'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  body: HMPublishableBlock[]
  space: Uint8Array     // Target doc's space
  path: string          // Target doc's path
  version: CID[]        // Target doc's version
  replyParent?: CID     // Parent comment CID
  threadRoot?: CID      // Thread root CID
}

async function createComment(
  keyPair: KeyPair,
  targetId: UnpackedHypermediaId,
  targetVersion: string,
  content: HMBlockNode[],
  replyParent?: CID,
  threadRoot?: CID
) {
  const unsigned: Comment = {
    type: 'Comment',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()),
    body: blocksToPublishable(content),
    space: base58btc.decode(targetId.uid),
    path: targetId.path?.join('/') || '',
    version: targetVersion.split('.').map(CID.parse),
  }

  if (replyParent) unsigned.replyParent = replyParent
  if (threadRoot) unsigned.threadRoot = threadRoot

  return signBlob(unsigned, keyPair.privateKey)
}
```

## Account Creation Flow

```typescript
async function createAccount(
  mnemonic: string,
  name: string,
  iconBlob?: Uint8Array
) {
  const keyPair = deriveKeyPair(mnemonic)

  // 1. Genesis change
  const genesis = await createGenesisChange(keyPair)
  const genesisBlock = await encodeBlob(genesis)

  // 2. Icon blob (optional)
  let iconBlock = null
  if (iconBlob) {
    iconBlock = await Block.encode({
      value: iconBlob,
      codec: rawCodec,
      hasher: sha256,
    })
  }

  // 3. Home document change
  const ops: HMDocumentOperation[] = [
    {type: 'SetAttributes', attrs: [{key: ['name'], value: name}]},
  ]
  if (iconBlock) {
    ops.push({type: 'SetAttributes', attrs: [{key: ['icon'], value: iconBlock.cid.toString()}]})
  }

  const home = await createDocumentChange(
    keyPair,
    genesisBlock.cid,
    [genesisBlock.cid],
    1,
    ops
  )
  const homeBlock = await encodeBlob(home)

  // 4. Ref
  const ref = await createRef(keyPair, genesisBlock.cid, homeBlock.cid, 1)
  const refBlock = await encodeBlob(ref)

  // 5. POST to server
  const payload = cborEncode({
    genesis: {data: genesisBlock.bytes, cid: genesisBlock.cid.toString()},
    home: {data: homeBlock.bytes, cid: homeBlock.cid.toString()},
    ref: refBlock.bytes,
    icon: iconBlock ? {data: iconBlock.bytes, cid: iconBlock.cid.toString()} : null,
  })

  await fetch('/hm/api/create-account', {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: payload,
  })

  return keyPair.accountId
}
```

## Test Vectors

Known mnemonic/accountId pairs for testing:

```
Mnemonic: "parrot midnight lion defense ski senior trouble slice chase spot history awkward"
Passphrase: ""
Account ID: z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8
```

## Dependencies

```json
{
  "bip39": "^3.1.0",
  "@exodus/slip10": "^3.0.1",
  "@noble/ed25519": "^2.2.0",
  "@noble/hashes": "^1.7.0",
  "multiformats": "^13.3.1",
  "@ipld/dag-cbor": "^9.2.2"
}
```
