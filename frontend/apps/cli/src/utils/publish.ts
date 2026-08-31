/**
 * Shared document publishing helpers.
 *
 * Factored out of `commands/document.ts` so other command groups (extensions)
 * can create and update documents without duplicating the sign-and-publish
 * sequence. Behaviour is identical to what `document create` / `document
 * update` did inline.
 */

import {CID} from 'multiformats/cid'
import {
  createChange,
  createChangeOps,
  createVersionRef,
  type DocumentOperation,
  type DocumentState,
  type SeedClient,
} from '@seed-hypermedia/client'
import type {HMBlockNode, HMDocument, HMMetadata, HMSigner} from '@seed-hypermedia/client/hm-types'
import {createBlocksMap, computeReplaceOps, rebindTableIdentities, type APIBlockNode} from './block-diff'
import type {BlockNode} from './markdown'

export type AttributeValue = string | number | boolean | null | unknown[]

/** One entry of a SetAttributes op: a key path and the value stored at it. */
export type Attribute = {key: string[]; value: AttributeValue}

/**
 * Flatten a (possibly nested) object into attribute key paths.
 *
 * Plain objects become nested key paths (`{theme: {color: 'x'}}` →
 * `['theme','color'] = 'x'`), which is how the daemon models nested metadata.
 * Arrays are stored whole as a single value: the daemon keeps any CBOR value
 * and returns arrays as arrays, and flattening them into numeric keys would
 * come back as an object. `undefined` values are skipped; `null` is written
 * (it deletes the key).
 */
export function flattenAttributes(value: unknown, key: string[], attrs: Attribute[] = []): Attribute[] {
  if (value === undefined) return attrs
  if (Array.isArray(value)) {
    attrs.push({key, value})
    return attrs
  }
  if (value !== null && typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      flattenAttributes(nestedValue, [...key, nestedKey], attrs)
    }
    return attrs
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    attrs.push({key, value})
  }
  return attrs
}

/**
 * Convert an HMMetadata object to a SetAttributes operation.
 * Only includes fields with defined values, flattening nested objects into key paths.
 */
export function metadataToSetAttributes(metadata: HMMetadata): DocumentOperation | null {
  const attrs: Attribute[] = []
  for (const [key, value] of Object.entries(metadata)) {
    flattenAttributes(value, [key], attrs)
  }
  if (attrs.length === 0) return null
  return setAttributesOp(attrs)
}

/**
 * Build a SetAttributes op. The client type declares scalar values only, but
 * the daemon stores any CBOR value and returns arrays as arrays (verified
 * against the fixture daemon), so array values are allowed through here.
 */
export function setAttributesOp(attrs: Attribute[]): DocumentOperation {
  return {type: 'SetAttributes', attrs} as unknown as DocumentOperation
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Attributes that turn the published value at `key` into `next`.
 *
 * Leaves present in `previous` but absent from `next` are written as `null`,
 * one per leaf — the same op shape the desktop emits when it removes an
 * object from metadata (see `expandObjectRemovals` in @shm/shared). Leaves
 * whose value is unchanged are skipped, so an empty result means no-op.
 * When the shape changes (an object becomes a scalar/array or vice versa)
 * the new value is written at `key` itself.
 */
export function diffAttributes(key: string[], next: unknown, previous: unknown, attrs: Attribute[] = []): Attribute[] {
  const nextObj = isPlainObject(next) ? next : undefined
  const prevObj = isPlainObject(previous) ? previous : undefined
  // Recurse only when both sides are objects (or an object is being removed).
  // A shape change (object <-> scalar/array) is written at `key` itself: the
  // daemon drops descendant registers when an ancestor is set and vice versa,
  // so writing the new value at `key` is enough to replace the old object.
  if ((nextObj && prevObj) || (next === undefined && prevObj)) {
    const keys = new Set([...Object.keys(prevObj ?? {}), ...Object.keys(nextObj ?? {})])
    for (const child of keys) {
      diffAttributes([...key, child], nextObj?.[child], prevObj?.[child], attrs)
    }
    return attrs
  }
  if (next === undefined) {
    if (previous !== undefined && previous !== null) attrs.push({key, value: null})
    return attrs
  }
  if (JSON.stringify(next) === JSON.stringify(previous)) return attrs
  flattenAttributes(next, key, attrs)
  return attrs
}

/**
 * Convert API BlockNode (with optional children) to the APIBlockNode shape
 * expected by block-diff utilities (with required children array).
 */
export function toAPIBlockNode(node: HMBlockNode): APIBlockNode {
  const block = node.block as {
    id: string
    type: string
    text?: string
    link?: string
    annotations?: unknown[]
    attributes?: Record<string, unknown>
  }
  return {
    block: {
      id: block.id,
      type: block.type,
      text: block.text || '',
      link: block.link || '',
      annotations: block.annotations || [],
      attributes: block.attributes || {},
    },
    children: (node.children || []).map(toAPIBlockNode),
  }
}

/**
 * Smart diff of a parsed input tree against an existing document's content:
 * blocks are matched by id, unchanged blocks are left alone, missing ones are
 * deleted. This is the body-replace strategy of `document update -f`.
 */
export function computeBodyReplaceOps(existingDoc: HMDocument, tree: BlockNode[]): DocumentOperation[] {
  const oldNodes = (existingDoc.content || []).map(toAPIBlockNode)
  const oldMap = createBlocksMap(oldNodes)
  // Tables: markdown only carries table/column/row ids, so cell block ids and
  // unexpressible attributes (column width, header column) are rebound from
  // the old document before diffing.
  const rebound = rebindTableIdentities(oldNodes, tree)
  return computeReplaceOps(oldMap, rebound)
}

export type PublishChangeOptions = {
  client: SeedClient
  signer: HMSigner
  /** Account (space) the Ref is published under. */
  space: string
  /** Document path: `''` for the home document, otherwise `/segment/...`. */
  path: string
  ops: DocumentOperation[]
  /**
   * Existing change-DAG state to build on (from `resolveEditableDocument`).
   * Omit to start a new lineage: the change itself becomes the genesis.
   */
  base?: DocumentState
  /** Capability CID when signing for another account. */
  capability?: string
  /** Extra blobs (IPFS file chunks) published alongside the change. */
  blobs?: Array<{data: Uint8Array; cid: string}>
}

/**
 * Sign a change over `ops`, publish it with a Version Ref at `space`/`path`,
 * and return the new document version (the change CID).
 */
export async function signAndPublishChange(opts: PublishChangeOptions): Promise<{version: string; generation: number}> {
  const {client, signer, space, path, ops, base, capability} = opts
  const {unsignedBytes, ts} = base
    ? createChangeOps({
        ops,
        genesisCid: CID.parse(base.genesis),
        deps: base.heads.map((h) => CID.parse(h)),
        depth: base.headDepth + 1,
      })
    : createChangeOps({ops})
  const changeBlock = await createChange(unsignedBytes, signer)
  const version = changeBlock.cid.toString()
  const generation = Number(ts)
  const refInput = await createVersionRef(
    {
      space,
      path,
      genesis: base ? base.genesis : version,
      version,
      generation,
      capability,
    },
    signer,
  )

  await client.publish({
    blobs: [{data: new Uint8Array(changeBlock.bytes), cid: version}, ...refInput.blobs, ...(opts.blobs ?? [])],
  })

  return {version, generation}
}
