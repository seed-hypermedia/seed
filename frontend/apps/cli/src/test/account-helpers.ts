/**
 * Account creation helpers for testing
 * Implements the full account creation workflow using @seed-hypermedia/client
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import {
  createGenesisChange,
  createChangeOps,
  createChange,
  createVersionRef,
  type DocumentOperation,
} from '@seed-hypermedia/client'
import {generateMnemonic, deriveKeyPairFromMnemonic} from '../utils/key-derivation'
import {createSignerFromKey} from '../utils/signer'

export type TestAccount = {
  keyPair: ReturnType<typeof deriveKeyPairFromMnemonic>
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
 * Register an account on the server
 */
export async function registerAccount(serverUrl: string, account: TestAccount, accountName: string): Promise<void> {
  const signer = createSignerFromKey(account.keyPair)

  // Create genesis change
  const genesisBlock = await createGenesisChange(signer)

  // Create home document change
  const blockId = generateBlockId()
  const ops: DocumentOperation[] = [
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

  const {unsignedBytes, ts} = createChangeOps({
    ops,
    genesisCid: genesisBlock.cid,
    deps: [genesisBlock.cid],
    depth: 1,
  })
  const homeBlock = await createChange(unsignedBytes, signer)

  // Create ref
  const refInput = await createVersionRef(
    {
      space: account.accountId,
      path: '',
      genesis: genesisBlock.cid.toString(),
      version: homeBlock.cid.toString(),
      generation: Number(ts),
    },
    signer,
  )

  // Publish all blobs via PublishBlobs API
  const payload = {
    blobs: [
      {data: genesisBlock.bytes, cid: genesisBlock.cid.toString()},
      {data: homeBlock.bytes, cid: homeBlock.cid.toString()},
      ...refInput.blobs,
    ],
  }

  const cborData = cborEncode(payload)

  const response = await fetch(`${serverUrl}/api/PublishBlobs`, {
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
  operations: DocumentOperation[],
): Promise<void> {
  const signer = createSignerFromKey(account.keyPair)
  const accountId = account.accountId

  // Get current document version to use as dependency
  const resourceUrl = `${serverUrl}/api/Resource?id=${encodeURIComponent(`hm://${accountId}${path ? '/' + path : ''}`)}`
  const resourceRes = await fetch(resourceUrl)
  const resource = await resourceRes.json()
  const doc = resource.json || resource

  if (doc.type === 'not-found') {
    // New document — create genesis + change + ref
    const genesisBlock = await createGenesisChange(signer)

    const {unsignedBytes, ts} = createChangeOps({
      ops: operations,
      genesisCid: genesisBlock.cid,
      deps: [genesisBlock.cid],
      depth: 1,
    })
    const changeBlock = await createChange(unsignedBytes, signer)

    const refInput = await createVersionRef(
      {
        space: accountId,
        path,
        genesis: genesisBlock.cid.toString(),
        version: changeBlock.cid.toString(),
        generation: Number(ts),
      },
      signer,
    )

    const toRef = (block: {bytes: Uint8Array; cid: {toString(): string}}) => ({
      data: block.bytes,
      cid: block.cid.toString(),
    })

    const payload = {
      change: toRef(changeBlock),
      ref: refInput.blobs[0],
      blobs: [toRef(genesisBlock)],
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}
