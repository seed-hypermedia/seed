/**
 * Document updates through the daemon's `PrepareDocumentChange`.
 *
 * A Change built on the client ({@link createChangeOps}) is stored exactly as it was written, so
 * every op the caller listed lands in the document's history, whether or not it changed anything:
 * a `MoveBlocks` that re-lists a whole level re-moves every block of it, and a `ReplaceBlock` of an
 * untouched block is stored again. The daemon applies the same ops to the document's real state
 * and writes only what differs: a block already in place is not moved, a block already holding the
 * same content is not replaced, an attribute already holding the same value is not set. (Its
 * comparison of values is strict about whole numbers: a block with a whole-number attribute, or a
 * whole-number document attribute, is written again even when equal. Moves, text, links,
 * annotations and other attribute values are compared as you would expect.)
 *
 * This module is the seam for updating an EXISTING document that way:
 *
 * 1. {@link preparableDocumentChanges} turns native ops into the request's `changes`, in the form
 *    the daemon applies correctly, or says that it cannot ({@link documentOperationsToChanges} is
 *    the plain conversion underneath, which is NOT safe to send for a document that has content).
 * 2. {@link prepareDocumentUpdateBlobs} asks the daemon for the unsigned Change, signs it and
 *    returns the Change and Ref blobs without publishing them, so a caller can publish them
 *    together with file blobs, tombstones or another document's blobs.
 * 3. {@link clientBuiltDocumentUpdateBlobs} is the way out for an update the daemon cannot be
 *    asked for: the Change built here, stored as written.
 *
 * Creating a document (and the home document's genesis) stays with `createDocumentBlobs` and
 * `createChangeOps`: a first Change has no earlier state to be redundant against.
 */

import {decode as cborDecode} from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {createChange, createChangeOps, signDocumentChange, type DocumentOperation} from './change'
import type {SeedClient} from './client'
import type {DocumentState} from './document-state'
import type {CollectedBlob} from './file-to-ipfs'
import type {HMPrepareDocumentChangeInput} from './hm-types'
import {createVersionRef} from './ref'
import type {AnySigner} from './signer'

/** The `changes` of a `PrepareDocumentChange` request. */
export type DocumentChanges = HMPrepareDocumentChangeInput['changes']

/** One entry of {@link DocumentChanges}. */
export type DocumentChangeInput = DocumentChanges[number]

/** A block in the JSON form of the daemon's `Block` message, as `replaceBlock` takes it. */
export type ProtoBlockJson = {
  id: string
  type?: string
  text?: string
  link?: string
  attributes?: Record<string, unknown>
  annotations?: ProtoAnnotationJson[]
}

/** An annotation in the JSON form of the daemon's `Annotation` message. */
export type ProtoAnnotationJson = {
  type: string
  link?: string
  attributes?: Record<string, unknown>
  starts?: number[]
  ends?: number[]
}

const BLOCK_FIELDS = new Set(['id', 'iD', 'type', 'text', 'link', 'annotations', 'attributes', 'revision'])
const ANNOTATION_FIELDS = new Set(['type', 'link', 'starts', 'ends', 'attributes'])

/**
 * Converts native ops to the `changes` of a `PrepareDocumentChange` request, keeping their order
 * and their meaning:
 *
 * - `ReplaceBlock` becomes `replaceBlock` with the block in proto JSON (see
 *   {@link nativeBlockToProtoBlock}).
 * - `MoveBlocks {blocks, parent}` becomes one `moveBlock` per block. A native `MoveBlocks` carries
 *   no anchor, which places its blocks at the START of the parent's children, in the order listed;
 *   so the first block gets `leftSibling: ''` and each following block gets the block before it.
 *   A block listed twice in a row is placed once.
 * - `DeleteBlocks` becomes one `deleteBlock` per block.
 * - `SetAttributes` becomes `setMetadata` for a one-segment key with a string value and
 *   `setAttribute` (document level) for everything else. The daemon takes strings, whole numbers,
 *   booleans and null; anything else throws here instead of being stored as something else.
 *
 * To place a block anywhere but the start of a level, write the `moveBlock` change yourself: it
 * names the left sibling, which a native `MoveBlocks` cannot.
 *
 * This is the plain conversion. Its moves are NOT safe to send for a document that already has
 * blocks: the daemon misplaces blocks when a level is re-listed. Use
 * {@link preparableDocumentChanges} for an update.
 */
export function documentOperationsToChanges(ops: DocumentOperation[]): DocumentChanges {
  const changes: DocumentChanges = []
  for (const op of ops) {
    switch (op.type) {
      case 'ReplaceBlock':
        changes.push({op: {case: 'replaceBlock', value: nativeBlockToProtoBlock(op.block)}})
        break
      case 'MoveBlocks': {
        const parent = op.parent ?? ''
        let left = ''
        for (const blockId of op.blocks) {
          if (typeof blockId !== 'string' || !blockId) throw new Error('MoveBlocks: every block needs an id')
          // The same block twice in a row is one placement (the daemon refuses a block as its own
          // left sibling).
          if (blockId === left) continue
          changes.push({op: {case: 'moveBlock', value: {blockId, parent, leftSibling: left}}})
          left = blockId
        }
        break
      }
      case 'DeleteBlocks':
        for (const blockId of op.blocks) {
          if (typeof blockId !== 'string' || !blockId) throw new Error('DeleteBlocks: every block needs an id')
          changes.push({op: {case: 'deleteBlock', value: blockId}})
        }
        break
      case 'SetAttributes':
        for (const attr of op.attrs) changes.push(attributeChange(attr.key, attr.value))
        break
      default:
        throw new Error(`Unsupported document operation: ${String((op as {type?: unknown}).type)}`)
    }
  }
  return changes
}

function attributeChange(key: string[], value: unknown): DocumentChangeInput {
  const name = Array.isArray(key) ? key.join('.') : String(key)
  if (!Array.isArray(key) || key.length === 0) throw new Error('SetAttributes: an attribute needs a key')
  for (const segment of key) {
    if (typeof segment !== 'string' || !segment || segment.includes('.')) {
      throw new Error(`SetAttributes: key segments must be non-empty strings without dots (in "${name}")`)
    }
  }
  if (typeof value === 'string') {
    if (key.length === 1) return {op: {case: 'setMetadata', value: {key: key[0]!, value}}}
    return {op: {case: 'setAttribute', value: {blockId: '', key, value: {case: 'stringValue', value}}}}
  }
  if (typeof value === 'boolean') {
    return {op: {case: 'setAttribute', value: {blockId: '', key, value: {case: 'boolValue', value}}}}
  }
  if (value === null) {
    return {op: {case: 'setAttribute', value: {blockId: '', key, value: {case: 'nullValue', value: {}}}}}
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw new Error(
        `SetAttributes: "${name}" is ${value}; a document attribute number must be a whole number (store anything else as a string)`,
      )
    }
    return {op: {case: 'setAttribute', value: {blockId: '', key, value: {case: 'intValue', value: BigInt(value)}}}}
  }
  throw new Error(
    `SetAttributes: "${name}" has a ${
      Array.isArray(value) ? 'list' : typeof value
    } value; a document attribute is a string, a whole number, a boolean or null`,
  )
}

/** A document's block tree (`document.content`), as far as placing blocks needs it. */
export type DocumentContent = Array<{block: {id: string}; children?: unknown}> | undefined | null

/**
 * Thrown by {@link prepareDocumentUpdateBlobs} for ops that {@link preparableDocumentChanges}
 * cannot turn into a request the daemon applies correctly. Build that update with
 * {@link clientBuiltDocumentUpdateBlobs} instead.
 */
export class UnpreparableDocumentUpdateError extends Error {
  constructor(readonly reason: string) {
    super(`This update cannot be prepared by the server: ${reason}`)
    this.name = 'UnpreparableDocumentUpdateError'
  }
}

/**
 * The `changes` to send to `PrepareDocumentChange` for `ops`, or why they cannot be sent.
 *
 * This is the one conversion to use for an update of a document that has content. `content` is the
 * content of the document the ops were computed against (the one `baseVersion` names).
 *
 * Replaces, deletes and attributes go as {@link documentOperationsToChanges} writes them. Moves do
 * not. A `MoveBlocks` from a diff lists a whole level, which as a request is "first block at the
 * start, each next block after the one before". The daemon (as seen on a real one, 2026-11-16)
 * gets that wrong in two ways:
 *
 * - a first block "moved" to where it already is makes the block after it land before it:
 *   `[a, b]` plus a new block after `a` reads back as `[new, a, b]`;
 * - a block whose move leaves it behind the same block as before is not written, even when that
 *   block itself moved: `[a, b, c, d]` to `[a, c, d, b]` sent as a chain stores only the move of
 *   `c` and reads back `[a, c, b, d]`.
 *
 * So each level is sent as the fewest moves that produce it: the longest run of blocks already in
 * the right order relative to each other stays put and is not mentioned, and every other block is
 * placed after the block that precedes it in the result. No block in place is ever sent, which
 * covers the first case. The second cannot be said to the daemon at all when a block that has to
 * move keeps its left neighbour (`[a, b, c, d]` to `[c, d, a, b]`: whichever pair moves, its
 * second block follows its first as before). Such an update is `unpreparable`: build it with
 * {@link clientBuiltDocumentUpdateBlobs}, where the level is stored as listed.
 *
 * A native `MoveBlocks` puts its blocks at the start of the level, in order, ahead of the blocks it
 * does not list; that is the result computed here when a list is not the whole level. Ops that
 * order the same level twice, or place a block twice, are unpreparable too.
 */
export function preparableDocumentChanges(
  ops: DocumentOperation[],
  content: DocumentContent,
): {changes: DocumentChanges} | {unpreparable: string} {
  const parentOf = new Map<string, string>()
  const leftOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  const walk = (nodes: unknown, parent: string) => {
    if (!Array.isArray(nodes)) return
    const ids: string[] = []
    for (const node of nodes as Array<{block?: {id?: unknown}; children?: unknown}>) {
      const id = node?.block?.id
      if (typeof id !== 'string' || !id) continue
      parentOf.set(id, parent)
      leftOf.set(id, ids[ids.length - 1] ?? '')
      ids.push(id)
      walk(node.children, id)
    }
    childrenOf.set(parent, ids)
  }
  walk(content, '')

  const deleted = new Set<string>()
  /** Where each listed block is headed: the parent of the MoveBlocks that lists it. */
  const destination = new Map<string, string>()
  const orderedParents = new Set<string>()
  for (const op of ops) {
    if (op.type === 'DeleteBlocks') for (const id of op.blocks) deleted.add(id)
    if (op.type === 'MoveBlocks') {
      const parent = op.parent ?? ''
      if (orderedParents.has(parent)) {
        return {unpreparable: `the update orders the blocks under ${parent ? `block ${parent}` : 'the root'} twice`}
      }
      orderedParents.add(parent)
      for (const id of op.blocks) {
        if (destination.has(id)) return {unpreparable: `the update places block ${id} twice`}
        destination.set(id, parent)
      }
    }
  }

  const changes: DocumentChanges = []
  for (const op of ops) {
    if (op.type !== 'MoveBlocks') {
      changes.push(...documentOperationsToChanges([op]))
      continue
    }
    const parent = op.parent ?? ''
    for (const blockId of op.blocks) {
      if (typeof blockId !== 'string' || !blockId) throw new Error('MoveBlocks: every block needs an id')
    }
    const before = childrenOf.get(parent) ?? []
    // The level as it will read: the listed blocks, then the ones that stay behind them.
    const level = [...op.blocks, ...before.filter((id) => !deleted.has(id) && !destination.has(id))]
    // Blocks that were already under this parent, by their old position; the longest run of them
    // in rising order stays where it is.
    const settled = longestRisingRun(level.map((id) => (parentOf.get(id) === parent ? before.indexOf(id) : -1)))
    for (let index = 0; index < level.length; index++) {
      if (settled.has(index)) continue
      const blockId = level[index]!
      const leftSibling = index > 0 ? level[index - 1]! : ''
      if (parentOf.get(blockId) === parent) {
        // What the block followed before: its left neighbour, or the nearest one not deleted.
        let was = leftOf.get(blockId) ?? ''
        const followed = new Set([was])
        while (was && deleted.has(was)) {
          was = leftOf.get(was) ?? ''
          followed.add(was)
        }
        if (followed.has(leftSibling)) {
          return {unpreparable: `block ${blockId} moves together with the block before it`}
        }
      }
      changes.push({op: {case: 'moveBlock', value: {blockId, parent, leftSibling}}})
    }
  }
  return {changes}
}

/** Indexes of the longest strictly rising run of the non-negative values in `values`. */
function longestRisingRun(values: number[]): Set<number> {
  const best: number[] = new Array(values.length).fill(0)
  const previous: number[] = new Array(values.length).fill(-1)
  let end = -1
  for (let i = 0; i < values.length; i++) {
    if (values[i]! < 0) continue
    best[i] = 1
    for (let j = 0; j < i; j++) {
      if (values[j]! >= 0 && values[j]! < values[i]! && best[j]! + 1 > best[i]!) {
        best[i] = best[j]! + 1
        previous[i] = j
      }
    }
    if (end < 0 || best[i]! > best[end]!) end = i
  }
  const run = new Set<number>()
  for (let i = end; i >= 0; i = previous[i]!) run.add(i)
  return run
}

/**
 * Converts a native block (the `block` of a `ReplaceBlock` op) to the proto JSON the daemon takes,
 * so that the daemon stores the block the native op would have stored.
 *
 * A native block keeps `id`, `type`, `text`, `link` and `annotations` as fields and its attributes
 * beside them (`{id, type, text, childrenType: 'Ordered'}`); the older form with a nested
 * `attributes` map is read the same way. Both become the proto block's `attributes`. A block that
 * has a non-empty `attributes` map AND attributes beside it is refused: a reader of the stored
 * native block would see only the nested map, so one of the two would be lost. `revision`, which
 * blocks read from the API carry, is not content and is dropped. Annotations follow the same rule.
 *
 * Attribute values must be plain JSON (strings, finite numbers, booleans, null, arrays and plain
 * objects). Anything else, a protobuf message in particular, throws: stored as it is, it would
 * be kept in its in-memory shape (`{fields: {x: {kind: …}}}`).
 */
export function nativeBlockToProtoBlock(block: unknown): ProtoBlockJson {
  if (!isPlainObject(block)) throw new Error('ReplaceBlock: the block must be an object')
  const id = block.id ?? block.iD
  if (typeof id !== 'string' || !id) throw new Error('ReplaceBlock: the block needs an id')
  const where = `block ${id}`
  const out: ProtoBlockJson = {id}
  const type = optionalString(block.type, `${where}: type`)
  if (type) out.type = type
  const text = optionalString(block.text, `${where}: text`)
  if (text) out.text = text
  const link = optionalString(block.link, `${where}: link`)
  if (link) out.link = link
  const attributes = collectAttributes(block, BLOCK_FIELDS, where)
  if (attributes) out.attributes = attributes
  if (block.annotations !== undefined && block.annotations !== null) {
    if (!Array.isArray(block.annotations)) throw new Error(`${where}: annotations must be a list`)
    if (block.annotations.length) {
      out.annotations = block.annotations.map((annotation, index) =>
        nativeAnnotationToProto(annotation, `${where}: annotation ${index}`),
      )
    }
  }
  return out
}

function nativeAnnotationToProto(annotation: unknown, where: string): ProtoAnnotationJson {
  if (!isPlainObject(annotation)) throw new Error(`${where} must be an object`)
  if (typeof annotation.type !== 'string' || !annotation.type) throw new Error(`${where} needs a type`)
  const out: ProtoAnnotationJson = {type: annotation.type}
  const link = optionalString(annotation.link, `${where}: link`)
  if (link) out.link = link
  const attributes = collectAttributes(annotation, ANNOTATION_FIELDS, where)
  if (attributes) out.attributes = attributes
  const starts = offsets(annotation.starts, `${where}: starts`)
  const ends = offsets(annotation.ends, `${where}: ends`)
  if (starts.length !== ends.length) throw new Error(`${where}: starts and ends must have the same length`)
  if (starts.length) {
    out.starts = starts
    out.ends = ends
  }
  return out
}

/** The attributes of a native block or annotation: the nested `attributes` map, or the fields beside the known ones. */
function collectAttributes(
  source: Record<string, unknown>,
  known: Set<string>,
  where: string,
): Record<string, unknown> | undefined {
  const inline: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (known.has(key) || value === undefined) continue
    inline[key] = plainJson(value, `${where}: ${key}`)
  }
  let nested: Record<string, unknown> | undefined
  if (source.attributes !== undefined && source.attributes !== null) {
    const value = plainJson(source.attributes, `${where}: attributes`)
    if (!isPlainObject(value)) throw new Error(`${where}: attributes must be an object`)
    if (Object.keys(value).length) nested = value
  }
  const inlineKeys = Object.keys(inline)
  if (nested && inlineKeys.length) {
    throw new Error(
      `${where} has both an "attributes" map and attributes beside it (${inlineKeys.join(', ')}); use one form`,
    )
  }
  if (nested) return nested
  return inlineKeys.length ? inline : undefined
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`${where} must be a string`)
  return value
}

function offsets(value: unknown, where: string): number[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`${where} must be a list`)
  return value.map((offset) => {
    const number = typeof offset === 'bigint' ? Number(offset) : offset
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > 0x7fffffff) {
      throw new Error(`${where} must hold whole, non-negative numbers`)
    }
    return number
  })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** A copy of `value` holding only plain JSON; throws on anything JSON cannot carry unchanged. */
function plainJson(value: unknown, where: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${where} is ${value}, which an attribute cannot hold`)
    return value
  }
  if (typeof value === 'bigint') {
    const number = Number(value)
    if (!Number.isSafeInteger(number)) throw new Error(`${where} is too large a number for an attribute`)
    return number
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => plainJson(item === undefined ? null : item, `${where}[${index}]`))
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[key] = plainJson(item, `${where}.${key}`)
    }
    return out
  }
  throw new Error(
    `${where} is not plain JSON (${describeValue(
      value,
    )}); attributes hold strings, numbers, booleans, null, lists and plain objects`,
  )
}

function describeValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value !== 'object' || value === null) return typeof value
  return Object.getPrototypeOf(value)?.constructor?.name || 'object'
}

/**
 * Whether an unsigned Change from `PrepareDocumentChange` carries no operations.
 *
 * The daemon does not refuse a request whose changes are all already true of the document: it
 * answers with a well-formed Change that has an empty body. Signing and publishing that would add
 * an empty version to the document's history, so callers check this first.
 */
export function isEmptyPreparedChange(unsignedChange: Uint8Array): boolean {
  const change = cborDecode(unsignedChange) as {body?: {ops?: unknown[]; opCount?: unknown} | null}
  const ops = change.body?.ops
  return !Array.isArray(ops) || ops.length === 0
}

/** What to update, for {@link prepareDocumentUpdateBlobs}. */
export type PrepareDocumentUpdateInput = {
  /** Any client that reaches a Seed API (`PrepareDocumentChange`). */
  client: Pick<SeedClient, 'request'>
  /** Signs the Change and the Ref. The daemon never sees the key. */
  signer: AnySigner
  /** Account (space) the document lives in. */
  account: string
  /** Document path in API form (`/notes/first`); `''` or omitted for the home document. */
  path?: string
  /** The version to build on: the document's current heads joined with `.`. */
  baseVersion: string
  /**
   * Native ops to apply; converted with {@link preparableDocumentChanges}, which needs `content`.
   * Give this or `changes`. Ops the daemon cannot be asked for throw
   * {@link UnpreparableDocumentUpdateError}.
   */
  ops?: DocumentOperation[]
  /**
   * With `ops`: the content of the document at `baseVersion` (`document.content`), which the ops
   * were computed against. Required when the ops move blocks; `[]` for a document with no blocks.
   */
  content?: DocumentContent
  /** Changes already in the request's form, for what native ops cannot say (a `moveBlock` with a left sibling). */
  changes?: DocumentChanges
  /** Writer capability CID, when the signer writes into another account's space. */
  capability?: string
  /** Genesis for the Ref. Defaults to the genesis the prepared Change names. */
  genesis?: string
  /**
   * Generation for the Ref, used as given. Pass the document's current generation to stay in it.
   * Left out, the generation is the prepared Change's timestamp (the daemon's clock), raised to
   * `currentGeneration` when that is higher.
   */
  generation?: number | bigint
  /**
   * The generation the path holds now (`document.generationInfo.generation`). A Ref below it is
   * published and then ignored, which a clock running behind the last writer's would cause; with
   * this set, the Ref never goes below it. Ignored when `generation` is given.
   */
  currentGeneration?: number | bigint | string
  /** Proto `ResourceVisibility` (2 is private); only needed for a private document. */
  visibility?: number
}

/** The outcome of {@link prepareDocumentUpdateBlobs}. */
export type PrepareDocumentUpdateResult =
  | {
      /** The document changes: publish `blobs`. */
      changed: true
      /** The signed Change, then the Version Ref that makes it the latest version. */
      blobs: CollectedBlob[]
      /** CID of the new Change, which is the document's new version. */
      version: string
      genesis: string
      generation: number
    }
  | {
      /** Every requested change is already true of the document: there is nothing to publish. */
      changed: false
      blobs: []
      /** The version the request was built on, which is still the latest one it knows. */
      version: string
    }

/**
 * Builds the blobs for the next version of an existing document, letting the daemon compute the
 * Change.
 *
 * It sends the changes to `PrepareDocumentChange`, signs the unsigned Change it returns and signs
 * the Version Ref for it. Nothing is published: the caller publishes `blobs`, usually together with
 * other blobs, in one `client.publish`.
 *
 * When the daemon finds nothing to change (every block already in place and unchanged, every
 * attribute already set) the result is `{changed: false, blobs: []}`. No Change is signed and
 * there is nothing to publish. An empty list of ops gives the same result without a request.
 *
 * The site is trusted for the Change's content: the bytes it returns are signed as they are, the
 * way `client.publishDocument` does.
 */
export async function prepareDocumentUpdateBlobs(
  input: PrepareDocumentUpdateInput,
): Promise<PrepareDocumentUpdateResult> {
  if (input.ops && input.changes) throw new Error('Give either ops or changes, not both')
  if (!input.baseVersion) {
    throw new Error('baseVersion is required: prepareDocumentUpdateBlobs updates an existing document')
  }
  const changes = input.changes ?? changesForOps(input.ops ?? [], input.content)
  const unchanged: PrepareDocumentUpdateResult = {changed: false, blobs: [], version: input.baseVersion}
  if (!changes.length) return unchanged

  const {unsignedChange} = await input.client.request('PrepareDocumentChange', {
    account: input.account,
    path: input.path ?? '',
    baseVersion: input.baseVersion,
    changes,
    capability: input.capability,
    visibility: input.visibility,
  })
  if (isEmptyPreparedChange(unsignedChange)) return unchanged

  let generation = input.generation
  if (generation == null && input.currentGeneration != null) {
    const current = Number(input.currentGeneration)
    const changeTs = Number((cborDecode(unsignedChange) as {ts?: number | bigint}).ts ?? 0)
    if (Number.isFinite(current) && current > changeTs) generation = current
  }

  const signed = await signDocumentChange(
    {
      account: input.account,
      path: input.path ?? '',
      unsignedChange,
      genesis: input.genesis,
      generation,
      capability: input.capability,
      visibility: input.visibility,
    },
    input.signer,
  )
  return {
    changed: true,
    blobs: signed.publishInput.blobs.map((blob) => ({cid: blob.cid!, data: blob.data})),
    version: signed.changeCid.toString(),
    genesis: signed.genesis,
    generation: signed.generation,
  }
}

function changesForOps(ops: DocumentOperation[], content: DocumentContent): DocumentChanges {
  if (content === undefined && ops.some((op) => op.type === 'MoveBlocks')) {
    throw new Error(
      'content is required with ops that move blocks: pass the content of the document the ops were computed against',
    )
  }
  const prepared = preparableDocumentChanges(ops, content)
  if ('unpreparable' in prepared) throw new UnpreparableDocumentUpdateError(prepared.unpreparable)
  return prepared.changes
}

/** What to update, for {@link clientBuiltDocumentUpdateBlobs}. */
export type ClientBuiltDocumentUpdateInput = {
  signer: AnySigner
  /** Account (space) the document lives in. */
  account: string
  /** Document path in API form (`/notes/first`); `''` or omitted for the home document. */
  path?: string
  /** The change history to build on (`resolveDocumentState`, or `resolveEditableDocument().state`). */
  state: Pick<DocumentState, 'genesis' | 'heads' | 'headDepth'>
  ops: DocumentOperation[]
  /** Writer capability CID, when the signer writes into another account's space. */
  capability?: string
  /** The lowest generation the Ref may take; the Ref's generation is otherwise this machine's clock. */
  currentGeneration?: number | bigint | string
}

/**
 * Builds the blobs for the next version of an existing document without the daemon: the Change
 * holds `ops` exactly as given, stamped with this machine's clock, on top of `state.heads`.
 *
 * Nothing is compared with the document, so an op that changes nothing is stored too. Use it for
 * the updates {@link prepareDocumentUpdateBlobs} cannot make: ops that are unpreparable
 * ({@link UnpreparableDocumentUpdateError}), attribute values the request cannot carry, or a
 * request the site refuses as too large. Returns the same shape as a prepared update that changed
 * the document; nothing is published.
 */
export async function clientBuiltDocumentUpdateBlobs(
  input: ClientBuiltDocumentUpdateInput,
): Promise<Extract<PrepareDocumentUpdateResult, {changed: true}>> {
  const {unsignedBytes, ts} = createChangeOps({
    ops: input.ops,
    genesisCid: CID.parse(input.state.genesis),
    deps: input.state.heads.map((head) => CID.parse(head)),
    depth: input.state.headDepth + 1,
  })
  const change = await createChange(unsignedBytes, input.signer)
  const floor = input.currentGeneration == null ? NaN : Number(input.currentGeneration)
  const generation = Number.isFinite(floor) && floor > Number(ts) ? floor : Number(ts)
  const version = change.cid.toString()
  const ref = await createVersionRef(
    {
      space: input.account,
      path: input.path ?? '',
      genesis: input.state.genesis,
      version,
      generation,
      capability: input.capability,
    },
    input.signer,
  )
  return {
    changed: true,
    blobs: [
      {data: new Uint8Array(change.bytes), cid: version},
      ...ref.blobs.map((blob) => ({data: blob.data, cid: blob.cid!})),
    ],
    version,
    genesis: input.state.genesis,
    generation,
  }
}
