/**
 * Account creation helpers for testing
 * Implements the full account creation workflow
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import * as ed25519 from '@noble/ed25519'
import {sha512} from '@noble/hashes/sha2'
import * as Block from 'multiformats/block'
import {sha256} from 'multiformats/hashes/sha2'
import {CID} from 'multiformats/cid'
import {
  generateMnemonic,
  deriveKeyPairFromMnemonic,
  type KeyPair,
} from '../utils/key-derivation'

// Configure ed25519 to use sha512
ed25519.etc.sha512Sync = (...m) => sha512(ed25519.etc.concatBytes(...m))

const cborCodec = {
  code: 0x71 as const,
  encode: (input: unknown) => cborEncode(input),
  name: 'DAG-CBOR' as const,
}

type EncodedBlock = {
  cid: CID
  bytes: Uint8Array
}

async function encodeBlock(data: unknown): Promise<EncodedBlock> {
  const block = await Block.encode({
    value: data,
    codec: cborCodec,
    hasher: sha256,
  })
  return {cid: block.cid, bytes: block.bytes}
}

function blockReference(block: EncodedBlock) {
  return {
    data: block.bytes,
    cid: block.cid.toString(),
  }
}

async function signBlob<T extends {sig: Uint8Array}>(
  unsigned: T,
  privateKey: Uint8Array,
): Promise<T> {
  const cborData = cborEncode(unsigned)
  const signature = await ed25519.signAsync(cborData, privateKey)
  return {...unsigned, sig: signature}
}

export type TestAccount = {
  keyPair: KeyPair
  mnemonic: string
  accountId: string
}

/**
 * Generate a new test account with a random mnemonic
 */
export function generateTestAccount(): TestAccount {
  const mnemonic = generateMnemonic(12)
  const keyPair = deriveKeyPairFromMnemonic(mnemonic, '')
  return {
    keyPair,
    mnemonic,
    accountId: keyPair.accountId,
  }
}

/**
 * Create genesis change for account
 */
async function createGenesisChange(keyPair: KeyPair) {
  const unsigned = {
    type: 'Change',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: 0n,
  }
  return signBlob(unsigned, keyPair.privateKey)
}

/**
 * Create home document change with account name
 */
async function createHomeDocumentChange(
  keyPair: KeyPair,
  genesisCid: CID,
  accountName: string,
) {
  const blockId = generateBlockId()
  const operations = [
    {
      type: 'SetAttributes',
      attrs: [{key: ['name'], value: accountName}],
    },
    {
      type: 'ReplaceBlock',
      block: {
        type: 'Paragraph',
        id: blockId,
        text: `Welcome to ${accountName}'s space`,
        annotations: [],
      },
    },
    {
      type: 'MoveBlocks',
      parent: '',
      blocks: [blockId],
    },
  ]

  const unsigned = {
    type: 'Change',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()), // milliseconds (daemon expects UnixMilli)
    genesis: genesisCid,
    deps: [genesisCid],
    depth: 1,
    body: {ops: operations, opCount: operations.length},
  }
  return signBlob(unsigned, keyPair.privateKey)
}

/**
 * Create ref (version pointer)
 */
async function createRef(keyPair: KeyPair, genesisCid: CID, headCid: CID) {
  const unsigned = {
    type: 'Ref',
    signer: keyPair.publicKeyWithPrefix,
    sig: new Uint8Array(64),
    ts: BigInt(Date.now()), // milliseconds (daemon expects UnixMilli)
    genesisBlob: genesisCid,
    heads: [headCid],
    generation: 1,
  }
  return signBlob(unsigned, keyPair.privateKey)
}

/**
 * Register an account on the server
 */
export async function registerAccount(
  serverUrl: string,
  account: TestAccount,
  accountName: string,
): Promise<void> {
  const {keyPair} = account

  // Create genesis change
  const genesisChange = await createGenesisChange(keyPair)
  const genesisBlock = await encodeBlock(genesisChange)

  // Create home document change
  const homeChange = await createHomeDocumentChange(
    keyPair,
    genesisBlock.cid,
    accountName,
  )
  const homeBlock = await encodeBlock(homeChange)

  // Create ref
  const ref = await createRef(keyPair, genesisBlock.cid, homeBlock.cid)
  const refBlock = await encodeBlock(ref)

  // Build payload
  const payload = {
    genesis: blockReference(genesisBlock),
    home: blockReference(homeBlock),
    ref: refBlock.bytes,
    icon: null,
  }

  const cborData = cborEncode(payload)

  const response = await fetch(`${serverUrl}/hm/api/create-account`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: new Uint8Array(cborData) as unknown as BodyInit,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to create account: ${response.status} - ${text}`)
  }
}

/**
 * Create a document change for updating a document
 */
export async function createDocumentUpdate(
  serverUrl: string,
  account: TestAccount,
  path: string,
  operations: Array<{type: string; [key: string]: unknown}>,
): Promise<void> {
  const {keyPair} = account
  const accountId = account.accountId

  // Get current document version to use as dependency
  const resourceUrl = `${serverUrl}/api/Resource?id=${encodeURIComponent(
    `hm://${accountId}${path ? '/' + path : ''}`,
  )}`
  const resourceRes = await fetch(resourceUrl)
  const resource = await resourceRes.json()
  const doc = resource.json || resource

  let genesisCid: CID
  let deps: CID[]
  let depth: number

  if (doc.type === 'not-found') {
    // New document - use account genesis as dependency
    const accountUrl = `${serverUrl}/api/Account?id=${accountId}`
    const accountRes = await fetch(accountUrl)
    const accountData = await accountRes.json()
    const account = accountData.json || accountData

    // For new documents, we need the account's genesis
    // We'll create a new genesis for this document
    const genesisChange = await createGenesisChange(keyPair)
    const genesisBlock = await encodeBlock(genesisChange)
    genesisCid = genesisBlock.cid
    deps = [genesisCid]
    depth = 1

    // Create the document change
    const change = {
      type: 'Change',
      signer: keyPair.publicKeyWithPrefix,
      sig: new Uint8Array(64),
      ts: BigInt(Date.now()) * 1000n,
      genesis: genesisCid,
      deps,
      depth,
      body: {ops: operations, opCount: operations.length},
    }
    const signedChange = await signBlob(change, keyPair.privateKey)
    const changeBlock = await encodeBlock(signedChange)

    // Create ref
    const ref = await createRef(keyPair, genesisCid, changeBlock.cid)
    const refBlock = await encodeBlock(ref)

    // Add path and space to ref for non-home documents
    const refWithPath = {
      ...ref,
      path,
      space: keyPair.publicKeyWithPrefix,
    }
    const signedRefWithPath = await signBlob(refWithPath, keyPair.privateKey)
    const refWithPathBlock = await encodeBlock(signedRefWithPath)

    const payload = {
      change: blockReference(changeBlock),
      ref: blockReference(refWithPathBlock),
      blobs: [blockReference(genesisBlock)],
    }

    const cborData = cborEncode(payload)
    const response = await fetch(`${serverUrl}/hm/api/document-update`, {
      method: 'POST',
      headers: {'Content-Type': 'application/cbor'},
      body: new Uint8Array(cborData) as unknown as BodyInit,
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to update document: ${response.status} - ${text}`)
    }
  } else {
    // Existing document - use its current version
    throw new Error('Updating existing documents not yet implemented in tests')
  }
}

function generateBlockId(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}
