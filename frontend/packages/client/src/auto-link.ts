/**
 * Auto-link child documents to their parent on first publish.
 *
 * When a document is created at a nested path (e.g. /docs/my-article), the
 * parent document at /docs should contain an embed link pointing to the child.
 * This module provides:
 *
 * - Pure decision logic: should a link be added?
 * - Operation builder: what DocumentOperations to emit
 * - Full I/O convenience: fetch parent, check, build the change, sign, publish
 */

import type {HMBlockNode, HMDocument, UnpackedHypermediaId} from './hm-types'
import type {AnySigner} from './signer'
import {entityQueryPathToHmIdPath, packHmId, unpackHmId} from './hm-types'
import type {SeedClient} from './client'
import type {DocumentOperation} from './change'
import {resolveDocumentState} from './document-state'
import {documentUpdateBlobs} from './prepare-change'

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
 *
 * A query block is self-referential when its target is implicit/empty or one
 * of its `query.includes` entries targets the document. New Collections use
 * the implicit empty target until it is resolved against their published ID.
 */
export function documentHasSelfQuery(document: HMDocument, documentId: UnpackedHypermediaId): boolean {
  const parentPathStr = (documentId.path || []).join('/')

  function isSelfMatch(include: {space?: string; path?: string} | undefined): boolean {
    if (!include) return false
    if (!include.space && !include.path) return true
    if (include.space !== documentId.uid) return false
    const includePath = entityQueryPathToHmIdPath(include.path)
    return (includePath || []).join('/') === parentPathStr
  }

  function searchBlocks(nodes: HMBlockNode[]): boolean {
    for (const node of nodes) {
      if (node.block.type === 'Query') {
        const includes = node.block.attributes?.query?.includes
        if (!includes || includes.length === 0) return true
        if (includes?.some(isSelfMatch)) return true
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
    // A typed collection (its children follow a schema) lists its records itself; linking each
    // record into its body would bury it.
    if (parentDocument.metadata?.childAttributesSchema) {
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
 *
 * Sent through `documentUpdateBlobs`, the daemon stores only the new block and
 * its one placement after the last root block; a Change built from these ops
 * directly stores the whole list.
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
  /** hm:// URL of the published child document (without version). */
  childHmUrl: string
  /** Signer for the parent document change. */
  signer: AnySigner
  /** Writer capability CID, when the signer writes into another account's space. */
  capability?: string
}

/**
 * Auto-link a newly published child document to its parent.
 *
 * Computes the parent path, fetches the parent document, decides whether a link
 * is needed (using `shouldAutoLinkParent`), and if so publishes an Embed Card
 * block to the parent document. The parent's Change goes through
 * `documentUpdateBlobs`: the daemon computes it on top of the version that was
 * read, so it holds only the new block and its placement; when the daemon
 * cannot be asked or does not give a usable answer, the Change is built here
 * and lists every root block, as it always did.
 *
 * Returns true if a link was added, false otherwise. Throws on network errors.
 */
export async function autoLinkChildToParent(opts: AutoLinkChildToParentOptions): Promise<boolean> {
  const {client, account, path, childHmUrl, signer, capability} = opts

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

  // The heads to build on. When they are not the version just read, the helper builds the
  // Change itself rather than ask the daemon to place blocks against content that has moved on.
  const state = await resolveDocumentState(client, `hm://${account}${parentPath}`)
  const update = await documentUpdateBlobs({
    client,
    signer,
    account,
    path: parentPath,
    state,
    ops: createAutoLinkOps(parentDocument, childHmUrl, newBlockId),
    content: parentDocument.content ?? [],
    documentVersion: parentDocument.version,
    capability,
    currentGeneration: parentDocument.generationInfo?.generation,
  })
  if (!update.changed) return false

  await client.publish({blobs: update.blobs})

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
