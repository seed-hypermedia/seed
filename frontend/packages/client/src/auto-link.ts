/**
 * Auto-link child documents to their parent on first publish.
 *
 * When a document is created at a nested path (e.g. /docs/my-article), the
 * parent document at /docs should contain an embed link pointing to the child.
 * This module provides:
 *
 * - Pure decision logic: should a link be added?
 * - Operation builder: what DocumentOperations to emit
 * - Full I/O convenience: fetch parent, check, build ops, sign, publish
 */

import type {HMBlockNode, HMDocument, HMSigner, UnpackedHypermediaId} from './hm-types'
import {hmIdPathToEntityQueryPath, packHmId, unpackHmId} from './hm-types'
import type {SeedClient} from './client'
import type {DocumentOperation} from './change'
import {createChangeOps, createChange} from './change'
import {createVersionRef} from './ref'
import {resolveDocumentState} from './document-state'
import {CID} from 'multiformats/cid'

// ── Layer 1: Pure decision logic (no I/O) ────────────────────────────────────

/**
 * Check if a document contains a link/embed to a specific child document.
 * Compares URLs ignoring version and latest flags.
 */
export function documentContainsLinkToChild(document: HMDocument, childId: UnpackedHypermediaId): boolean {
  const childUrlNormalized = packHmId({...childId, version: null, latest: null})

  function searchBlocks(nodes: HMBlockNode[]): boolean {
    for (const node of nodes) {
      if (node.block.type === 'Embed') {
        const linkId = unpackHmId(node.block.link)
        if (linkId) {
          const linkUrl = packHmId({...linkId, version: null, latest: null})
          if (linkUrl === childUrlNormalized) return true
        }
      }
      const annotations = 'annotations' in node.block ? node.block.annotations : undefined
      if (annotations) {
        for (const ann of annotations) {
          if (ann.type === 'Link' || ann.type === 'Embed') {
            const linkId = unpackHmId(ann.link)
            if (linkId) {
              const linkUrl = packHmId({...linkId, version: null, latest: null})
              if (linkUrl === childUrlNormalized) return true
            }
          }
        }
      }
      if (node.children && searchBlocks(node.children)) return true
    }
    return false
  }
  return searchBlocks(document.content || [])
}

/**
 * Check if a document has a self-referential Query block
 * (a query to itself that would automatically include children).
 */
export function documentHasSelfQuery(document: HMDocument, documentId: UnpackedHypermediaId): boolean {
  const documentPathWithSlash = hmIdPathToEntityQueryPath(documentId.path)
  const documentPathWithoutSlash = documentId.path?.join('/') || ''

  function searchBlocks(nodes: HMBlockNode[]): boolean {
    for (const node of nodes) {
      if (node.block.type === 'Query') {
        const query = node.block.attributes?.query
        if (query?.includes) {
          for (const inc of query.includes) {
            const isSpaceMatch = !inc.space || inc.space === documentId.uid
            const isPathMatch = !inc.path || inc.path === documentPathWithSlash || inc.path === documentPathWithoutSlash
            if (isSpaceMatch && isPathMatch) return true
          }
        }
      }
      if (node.children && searchBlocks(node.children)) return true
    }
    return false
  }
  return searchBlocks(document.content || [])
}

/**
 * Determine whether a parent auto-link should be added on first publish.
 * Returns true when the parent document should receive an embed link to the child.
 */
export function shouldAutoLinkParent(
  isPrivate: boolean,
  parentDocument: HMDocument | null,
  editableLocation: UnpackedHypermediaId,
  parentId: UnpackedHypermediaId,
): boolean {
  if (isPrivate) return false

  if (parentDocument) {
    if (documentContainsLinkToChild(parentDocument, editableLocation)) {
      return false
    }
    if (documentHasSelfQuery(parentDocument, parentId)) {
      return false
    }
  }

  return true
}

// ── Layer 2: Operation builder (no I/O) ──────────────────────────────────────

/**
 * Generate the DocumentOperations to append an Embed Card block to a parent document.
 *
 * The returned operations include a ReplaceBlock for the new embed block and a
 * MoveBlocks that lists ALL root-level block IDs (existing + new) to ensure
 * correct ordering. The CBOR MoveBlocks format with no `ref` positions blocks
 * from the start, so we must re-specify the full ordering.
 */
export function createAutoLinkOps(
  parentDocument: HMDocument,
  childHmUrl: string,
  newBlockId: string,
): DocumentOperation[] {
  const existingRootBlockIds = (parentDocument.content || []).map((node) => node.block.id).filter(Boolean)

  const embedBlock = {
    id: newBlockId,
    type: 'Embed',
    link: childHmUrl,
    attributes: {view: 'Card'},
  }

  return [
    {type: 'ReplaceBlock', block: embedBlock},
    {type: 'MoveBlocks', blocks: [...existingRootBlockIds, newBlockId], parent: ''},
  ]
}

// ── Layer 3: Full I/O convenience function ───────────────────────────────────

/** Options for the auto-link convenience function. */
export type AutoLinkChildToParentOptions = {
  /** Seed API client. */
  client: SeedClient
  /** Account UID of the document owner. */
  account: string
  /** Full path of the child document (e.g. "/tests/benefits-of-cli"). */
  path: string
  /** hm:// URL of the published child document (with version). */
  childHmUrl: string
  /** Signer for the parent document change. */
  signer: HMSigner
}

/**
 * Auto-link a newly published child document to its parent.
 *
 * Computes the parent path, fetches the parent document, decides whether a link
 * is needed (using `shouldAutoLinkParent`), and if so publishes an Embed Card
 * block to the parent document.
 *
 * Returns true if a link was added, false otherwise. Throws on network errors.
 */
export async function autoLinkChildToParent(opts: AutoLinkChildToParentOptions): Promise<boolean> {
  const {client, account, path, childHmUrl, signer} = opts

  // Compute parent path — skip if the document is at root level
  const segments = path.replace(/^\//, '').split('/')
  if (segments.length <= 1) return false

  const parentSegments = segments.slice(0, -1)
  const parentPath = '/' + parentSegments.join('/')

  // Build IDs for the parent and child
  const parentId = unpackHmId(`hm://${account}${parentPath}`)
  if (!parentId) return false

  const childId = unpackHmId(childHmUrl)
  if (!childId) return false

  // Fetch the parent resource
  let parentDocument: HMDocument | null = null
  try {
    const resource = await client.request('Resource', {...parentId, latest: true})
    if (resource.type === 'document') {
      parentDocument = resource.document
    }
  } catch {
    // Parent doesn't exist or network error — nothing to link to
    return false
  }

  // If the parent doesn't exist as a document, nothing to link to
  if (!parentDocument) return false

  // Check if we should add a link
  if (!shouldAutoLinkParent(false, parentDocument, childId, parentId)) {
    return false
  }

  // Generate a block ID for the embed
  const newBlockId = generateBlockId()

  // Build the operations
  const ops = createAutoLinkOps(parentDocument, childHmUrl, newBlockId)

  // Resolve document state (genesis, heads, depth)
  const hmUrl = `hm://${account}${parentPath}`
  const state = await resolveDocumentState(client, hmUrl)
  const genesisCid = CID.parse(state.genesis)
  const depCids = state.heads.map((h: string) => CID.parse(h))
  const newDepth = state.headDepth + 1

  // Create and sign the change
  const {unsignedBytes, ts} = createChangeOps({ops, genesisCid, deps: depCids, depth: newDepth})
  const changeBlock = await createChange(unsignedBytes, signer)
  const generation = Number(ts)

  // Create version ref
  const refInput = await createVersionRef(
    {
      space: account,
      path: parentPath,
      genesis: state.genesis,
      version: changeBlock.cid.toString(),
      generation,
    },
    signer,
  )

  // Publish
  await client.publish({
    blobs: [{data: new Uint8Array(changeBlock.bytes), cid: changeBlock.cid.toString()}, ...refInput.blobs],
  })

  return true
}

/**
 * Generate a random 10-character block ID (alphanumeric).
 * Equivalent to nanoid(10) but without the dependency.
 */
function generateBlockId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < 10; i++) {
    id += chars[bytes[i]! % chars.length]
  }
  return id
}
