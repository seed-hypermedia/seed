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
 * This module is the seam for updating an EXISTING document that way. {@link documentUpdateBlobs}
 * is the one function to call: it asks the daemon, checks what comes back, and builds the Change
 * here instead whenever the daemon cannot be asked, refuses, does not answer in time or answers
 * with something implausible. Its parts are exported for callers that need one of them alone:
 *
 * 1. {@link preparableDocumentChanges} turns native ops into the request's `changes`, in the form
 *    the daemon applies correctly, or says that it cannot ({@link documentOperationsToChanges} is
 *    the plain conversion underneath, which is NOT safe to send for a document that has content).
 * 2. {@link prepareDocumentUpdateBlobs} asks the daemon for the unsigned Change, signs it and
 *    returns the Change and Ref blobs without publishing them, so a caller can publish them
 *    together with file blobs, tombstones or another document's blobs. It has none of the guards.
 * 3. {@link clientBuiltDocumentUpdateBlobs} is the way out for an update the daemon cannot be
 *    asked for: the Change built here, stored as written.
 *
 * Creating a document (and the home document's genesis) stays with `createDocumentBlobs` and
 * `createChangeOps`: a first Change has no earlier state to be redundant against.
 */

import {decode as cborDecode} from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {createChange, createChangeOps, signDocumentChange, visibilityToCbor, type DocumentOperation} from './change'
import type {SeedClient} from './client'
import {sameDocumentVersion, type DocumentState} from './document-state'
import {SeedClientError} from './errors'
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
 * order the same level twice, place a block twice, or delete a block and place it are
 * unpreparable too.
 *
 * Every `replaceBlock` comes before the first `moveBlock` or `deleteBlock`. The daemon learns that
 * a new block can be a parent when it sees its `replaceBlock`, but only until the first move or
 * delete of the request; a new block's content sent after that point makes a move under it fail
 * ("desired parent block is not in the tree"). The moves themselves keep the order of the ops.
 *
 * An update that turns a block's descendant into its ancestor (a parent and child swapping places,
 * or any longer loop of that kind) is unpreparable: the daemon either refuses it ("cycle
 * detected") or, without Seed PR #1375, never answers and keeps a CPU busy. Only the document's
 * current tree is looked at here. A daemon without that fix also never answers a request that
 * moves or deletes blocks in a document whose HISTORY holds such a turn; nothing reads the history
 * to avoid that, and {@link documentUpdateBlobs} stops waiting after its timeout.
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
  for (const id of Array.from(destination.keys())) {
    // The daemon keeps the delete and drops the placement, whichever comes first.
    if (deleted.has(id)) return {unpreparable: `the update deletes block ${id} and places it`}
  }
  const loop = blockInLoop([...edgesOf(parentOf), ...edgesOf(destination)])
  if (loop !== null) {
    return {unpreparable: `the update puts block ${loop} under a block that is, or was, inside it`}
  }

  // Every replace first (see above), then the rest in the order given.
  const replaces: DocumentChanges = []
  const changes: DocumentChanges = []
  for (const op of ops) {
    if (op.type === 'ReplaceBlock') {
      replaces.push(...documentOperationsToChanges([op]))
      continue
    }
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
  return {changes: [...replaces, ...changes]}
}

/** `[parent, child]` for each entry of a child-to-parent map. */
function edgesOf(parentOf: Map<string, string>): Array<[string, string]> {
  return Array.from(parentOf, ([child, parent]) => [parent, child] as [string, string])
}

/**
 * A block that lies on a loop of `[parent, child]` edges, or null when there is none.
 *
 * The edges are the places a block is put: under its parent in the document, and under the
 * parent a request moves it to. The daemon keeps every place a block has been, the ones it has
 * since left included, and walks them when it writes a Change with moves. A loop makes that walk
 * endless in a daemon without Seed PR #1375.
 */
function blockInLoop(edges: Array<[string, string]>): string | null {
  const children = new Map<string, string[]>()
  for (const [parent, child] of edges) {
    if (parent === child) return child
    if (!parent) continue
    const list = children.get(parent)
    if (list) list.push(child)
    else children.set(parent, [child])
  }
  // Depth-first, without recursion: `open` blocks are on the path being walked.
  const open = new Set<string>()
  const done = new Set<string>()
  for (const start of Array.from(children.keys())) {
    if (done.has(start)) continue
    const stack: Array<{id: string; next: number}> = [{id: start, next: 0}]
    open.add(start)
    while (stack.length) {
      const top = stack[stack.length - 1]!
      const child = children.get(top.id)?.[top.next++]
      if (child === undefined) {
        open.delete(top.id)
        done.add(top.id)
        stack.pop()
      } else if (open.has(child)) {
        return child
      } else if (!done.has(child)) {
        open.add(child)
        stack.push({id: child, next: 0})
      }
    }
  }
  return null
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
  /** Aborts the request. */
  signal?: AbortSignal
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
      /** The new Change's timestamp (milliseconds) and depth: what a Change built on top of it needs. */
      ts: number
      depth: number
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
 * way `client.publishDocument` does. There is no timeout, no check of the answer and no way out
 * when the daemon refuses; {@link documentUpdateBlobs} adds those and is what an update should
 * normally go through.
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

  const {unsignedChange} = await input.client.request(
    'PrepareDocumentChange',
    {
      account: input.account,
      path: input.path ?? '',
      baseVersion: input.baseVersion,
      changes,
      capability: input.capability,
      visibility: input.visibility,
    },
    {signal: input.signal},
  )
  if (isEmptyPreparedChange(unsignedChange)) return unchanged
  return signPreparedChange(input, unsignedChange)
}

/** Signs an unsigned Change from the daemon and the Version Ref for it. */
async function signPreparedChange(
  input: Pick<
    PrepareDocumentUpdateInput,
    'signer' | 'account' | 'path' | 'genesis' | 'generation' | 'currentGeneration' | 'capability' | 'visibility'
  >,
  unsignedChange: Uint8Array,
): Promise<Extract<PrepareDocumentUpdateResult, {changed: true}>> {
  const decoded = cborDecode(unsignedChange) as {ts?: number | bigint; depth?: number | bigint}
  const changeTs = Number(decoded.ts ?? 0)
  let generation = input.generation
  if (generation == null && input.currentGeneration != null) {
    const current = Number(input.currentGeneration)
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
    ts: changeTs,
    depth: Number(decoded.depth ?? 0),
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
  /**
   * The change history to build on (`resolveDocumentState`, or `resolveEditableDocument().state`).
   * `headTs` matters: see the timestamp rule below.
   */
  state: Pick<DocumentState, 'genesis' | 'heads' | 'headDepth' | 'headTs'>
  ops: DocumentOperation[]
  /** Writer capability CID, when the signer writes into another account's space. */
  capability?: string
  /** The lowest generation the Ref may take; the Ref's generation is otherwise the Change's timestamp. */
  currentGeneration?: number | bigint | string
  /** Proto `ResourceVisibility` (2 is private); only needed for a private document. */
  visibility?: number
  /** This machine's clock in milliseconds. Defaults to `Date.now`. */
  now?: () => number
}

/**
 * Builds the blobs for the next version of an existing document without the daemon: the Change
 * holds `ops` exactly as given, on top of `state.heads`.
 *
 * Its timestamp is this machine's clock, or one millisecond after the latest head
 * (`state.headTs`) when the clock is not past it. A Change must be later than the Changes it
 * builds on: the daemon stores one that is not and then reads the document as broken ("missing
 * dependency"). The heads often carry another machine's clock (a prepared Change carries the
 * site's), so a clock a second behind is enough to hit that.
 *
 * Nothing is compared with the document, so an op that changes nothing is stored too. Use it for
 * the updates {@link prepareDocumentUpdateBlobs} cannot make: ops that are unpreparable
 * ({@link UnpreparableDocumentUpdateError}), attribute values the request cannot carry, or a
 * request the site refuses. Returns the same shape as a prepared update that changed the
 * document; nothing is published.
 */
export async function clientBuiltDocumentUpdateBlobs(
  input: ClientBuiltDocumentUpdateInput,
): Promise<Extract<PrepareDocumentUpdateResult, {changed: true}>> {
  const now = Math.floor((input.now ?? Date.now)())
  const headTs = input.state.headTs
  const depth = input.state.headDepth + 1
  const {unsignedBytes, ts} = createChangeOps({
    ops: input.ops,
    genesisCid: CID.parse(input.state.genesis),
    deps: input.state.heads.map((head) => CID.parse(head)),
    depth,
    ts: BigInt(headTs !== undefined && Number.isFinite(headTs) && headTs >= now ? headTs + 1 : now),
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
      visibility: visibilityToCbor(input.visibility),
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
    ts: Number(ts),
    depth,
  }
}

/** How long {@link documentUpdateBlobs} waits for `PrepareDocumentChange` before building the Change itself. */
export const DEFAULT_PREPARE_TIMEOUT_MS = 15_000

/**
 * The largest prepared Change {@link documentUpdateBlobs} signs. A stored block may be 2 MB and a
 * publish request 4 MB; a daemon that repeats moves has been seen to answer a one-block insert
 * with 2 to 23 MB.
 */
export const DEFAULT_MAX_PREPARED_CHANGE_BYTES = 1024 * 1024

/** What to update, for {@link documentUpdateBlobs}. */
export type DocumentUpdateBlobsInput = {
  /** Any client that reaches a Seed API (`PrepareDocumentChange`, `GetCID`). */
  client: Pick<SeedClient, 'request'>
  /** Signs the Change and the Ref. The daemon never sees the key. */
  signer: AnySigner
  /** Account (space) of the address being written. */
  account: string
  /** Path of the address being written, in API form (`/notes/first`); `''` or omitted for the home document. */
  path?: string
  /**
   * The change history to build on (`resolveEditableDocument().state`). For an address that holds
   * a redirect this is the redirect target's state: the Change continues the target's history
   * and the Ref lands at `path`.
   */
  state: DocumentState
  /** Native ops to apply, computed against `content`. */
  ops: DocumentOperation[]
  /** The content of the document the ops were computed against (`document.content`). */
  content: DocumentContent
  /**
   * The version `content` was read at (`document.version`). When it does not name the heads of
   * `state`, the content is stale, so nothing is asked of the daemon and the Change is built here.
   */
  documentVersion?: string
  /**
   * The ops to store when the Change is built here, if they should differ from `ops`. A caller
   * that keeps part of an update out of `ops` because the daemon cannot carry it puts the whole
   * update here, so a Change built here needs no second Change on top. Used only when `ops` is
   * not empty and the daemon's Change is not used.
   */
  localOps?: DocumentOperation[]
  /** Writer capability CID, when the signer writes into another account's space. */
  capability?: string
  /**
   * The lowest generation the new Ref may take: for an ordinary update the generation the path
   * holds now (`document.generationInfo.generation`), for a redirect takeover the current time.
   */
  currentGeneration?: number | bigint | string
  /** Proto `ResourceVisibility` (2 is private); only needed for a private document. */
  visibility?: number
  /** This machine's clock in milliseconds, for a Change built here. Defaults to `Date.now`. */
  now?: () => number
  /** How long to wait for the daemon's answer. Defaults to {@link DEFAULT_PREPARE_TIMEOUT_MS}. */
  prepareTimeoutMs?: number
  /** The largest prepared Change to sign. Defaults to {@link DEFAULT_MAX_PREPARED_CHANGE_BYTES}. */
  maxPreparedChangeBytes?: number
}

/** The outcome of {@link documentUpdateBlobs}. */
export type DocumentUpdateBlobsResult =
  | (Extract<PrepareDocumentUpdateResult, {changed: true}> & {
      /** Who computed the Change: the server (only what differs is stored), or this process (the ops as written). */
      builtBy: 'server' | 'local'
      /** Why the Change was built here, in words fit to show after "built locally because". */
      localReason?: string
    })
  | Extract<PrepareDocumentUpdateResult, {changed: false}>

/**
 * Builds the blobs for the next version of an existing document: the one way an update should be
 * made. Nothing is published; the caller publishes `blobs`.
 *
 * The daemon is asked for the Change (`PrepareDocumentChange`), so that only what differs from
 * the document is stored, and `{changed: false}` comes back when nothing differs. The Change is
 * built here instead (`builtBy: 'local'`, with `localReason`), holding the ops as written, when:
 *
 * - `content` is not the content at the heads (`documentVersion` differs from `state.version`);
 * - the ops cannot be put in a request the daemon applies correctly
 *   ({@link preparableDocumentChanges}), or hold an attribute value the request cannot carry;
 * - the daemon does not answer within `prepareTimeoutMs` (the document is then built here for
 *   the next ten minutes without asking again);
 * - the site refuses the request as too large (413) or does not know `PrepareDocumentChange`;
 * - the daemon fails to apply the changes (a 5xx such as "is not in the tree" or "cycle
 *   detected"), or its clock is not past the document's latest Change ("must be greater than ts
 *   of its dependency");
 * - the Change it answers with is not plausible for the request: it moves, replaces or deletes
 *   blocks the request did not name, places more blocks than the request did, or is larger than
 *   `maxPreparedChangeBytes`.
 *
 * Falling back is safe because `PrepareDocumentChange` only reads: the daemon loads the document,
 * applies the changes in memory and returns unsigned bytes (`PrepareChange` in
 * `backend/api/documents/v3alpha/documents.go` stores nothing). Whatever happened to that request,
 * nothing was published, so building the Change here cannot publish the update twice.
 *
 * Errors that are the caller's to see are thrown as they are: a refusal for lack of permission, a
 * 4xx about the request itself, and a network failure (the site that could not be reached for
 * this would not take the publish either).
 */
export async function documentUpdateBlobs(input: DocumentUpdateBlobsInput): Promise<DocumentUpdateBlobsResult> {
  const {state} = input
  const unchanged: DocumentUpdateBlobsResult = {changed: false, blobs: [], version: state.version}
  if (!input.ops.length) return unchanged

  const local = async (localReason: string): Promise<DocumentUpdateBlobsResult> => {
    const built = await clientBuiltDocumentUpdateBlobs({
      signer: input.signer,
      account: input.account,
      path: input.path,
      state: {...state, headTs: state.headTs ?? (await headTimestamp(input.client, state.heads))},
      ops: parentsFirst(input.localOps ?? input.ops),
      capability: input.capability,
      currentGeneration: input.currentGeneration,
      visibility: input.visibility,
      now: input.now,
    })
    return {...built, builtBy: 'local', localReason}
  }

  if (input.documentVersion !== undefined && !sameDocumentVersion(input.documentVersion, state.version)) {
    return local('the document changed while it was being read')
  }

  let changes: DocumentChanges
  try {
    const preparable = preparableDocumentChanges(input.ops, input.content)
    if ('unpreparable' in preparable) return local(`the server cannot place the blocks (${preparable.unpreparable})`)
    changes = preparable.changes
  } catch (error) {
    // A value the request cannot carry (a fraction, a list, a key with a dot).
    return local(`the server cannot be sent this update (${errorText(error)})`)
  }
  if (!changes.length) return unchanged

  const documentKey = `${input.account}${input.path ?? ''}`
  const silentUntil = unansweredDocuments.get(documentKey)
  if (silentUntil !== undefined) {
    if (silentUntil > Date.now()) return local('the server did not answer an earlier request for this document')
    unansweredDocuments.delete(documentKey)
  }

  const timeoutMs = input.prepareTimeoutMs ?? DEFAULT_PREPARE_TIMEOUT_MS
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = Symbol('timed out')
  let unsignedChange: Uint8Array
  try {
    const request = input.client.request(
      'PrepareDocumentChange',
      {
        account: input.account,
        path: input.path ?? '',
        baseVersion: state.version,
        changes,
        capability: input.capability,
        visibility: input.visibility,
      },
      {signal: abort.signal},
    )
    // The request is aborted, and also raced: a client whose fetch ignores the signal still ends here.
    request.catch(() => {})
    const answer = await Promise.race([
      request,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => {
          abort.abort()
          resolve(timedOut)
        }, timeoutMs)
      }),
    ])
    if (answer === timedOut) {
      unansweredDocuments.set(documentKey, Date.now() + UNANSWERED_DOCUMENT_MS)
      return local(`the server did not answer within ${Math.round(timeoutMs / 100) / 10} s`)
    }
    unsignedChange = answer.unsignedChange
  } catch (error) {
    const refusal = prepareRefusal(error)
    if (refusal === null) throw error
    return local(refusal)
  } finally {
    clearTimeout(timer)
  }

  if (isEmptyPreparedChange(unsignedChange)) return unchanged
  const implausible = implausiblePreparedChange(
    unsignedChange,
    changes,
    input.maxPreparedChangeBytes ?? DEFAULT_MAX_PREPARED_CHANGE_BYTES,
  )
  if (implausible) return local(`the server's change is not what was asked for (${implausible})`)

  const signed = await signPreparedChange({...input, genesis: state.genesis}, unsignedChange)
  return {...signed, builtBy: 'server'}
}

/**
 * `ops` with each `MoveBlocks` after the `MoveBlocks` that places its parent.
 *
 * A diff lists a level after the levels inside it. Stored that way, a parent and child that swap
 * places do not swap: the old parent is put under its old child while that child is still inside
 * it, a loop every reader ignores, and the old parent stays where it was. Parents first, each
 * block is placed under a parent that is already where it will be. Only the `MoveBlocks` ops
 * trade places among themselves, and only when one is out of order; everything else stays put.
 */
function parentsFirst(ops: DocumentOperation[]): DocumentOperation[] {
  const slots: number[] = []
  const placedBy = new Map<string, number>()
  ops.forEach((op, index) => {
    if (op.type !== 'MoveBlocks') return
    slots.push(index)
    for (const block of op.blocks) if (!placedBy.has(block)) placedBy.set(block, index)
  })
  const ordered: number[] = []
  const visiting = new Set<number>()
  const visit = (index: number) => {
    if (ordered.includes(index) || visiting.has(index)) return
    visiting.add(index)
    const parent = (ops[index] as Extract<DocumentOperation, {type: 'MoveBlocks'}>).parent ?? ''
    const before = parent ? placedBy.get(parent) : undefined
    if (before !== undefined) visit(before)
    visiting.delete(index)
    ordered.push(index)
  }
  slots.forEach(visit)
  if (ordered.every((index, position) => index === slots[position])) return ops
  const out = [...ops]
  slots.forEach((slot, position) => {
    out[slot] = ops[ordered[position]!]!
  })
  return out
}

/** Documents (`account` + `path`) whose prepare request went unanswered, and until when not to ask again. */
const unansweredDocuments = new Map<string, number>()
const UNANSWERED_DOCUMENT_MS = 10 * 60_000

/**
 * Why a failed `PrepareDocumentChange` can be answered by building the Change here, or null when
 * the error is the caller's to see.
 *
 * A site answers every daemon error with HTTP 500 and the daemon's message, which starts with the
 * gRPC code in brackets. Errors from applying the changes carry no code of their own
 * (`[unknown]`); refusals about who is asking or what was asked carry one, and are not retried
 * another way.
 */
function prepareRefusal(error: unknown): string | null {
  if (!(error instanceof SeedClientError)) return null
  const text = `${error.message} ${error.body ?? ''}`
  if (error.status === 413) return 'the server refused the request as too large (HTTP 413)'
  if (error.status === 404 && /Unknown action key/i.test(text)) return 'the server has no PrepareDocumentChange'
  if (error.status < 500) return null
  if (/must be greater than ts of its dependency/.test(text)) {
    return "the server's clock is not past the time of the document's latest change"
  }
  if (
    /\[(permission_denied|unauthenticated|invalid_argument|not_found|failed_precondition|already_exists|unimplemented|out_of_range)\]/.test(
      text,
    ) ||
    /permission|not allowed|unauthori[sz]ed|forbidden/i.test(text)
  ) {
    return null
  }
  const said = /"error"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(error.body ?? '')?.[1] ?? error.message
  return `the server could not prepare it (HTTP ${error.status}: ${said.slice(0, 200)})`
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Why an unsigned Change from the daemon is not a plausible answer to `changes`, or null when it is.
 *
 * The daemon writes a subset of what was asked: a block already in place is not moved, a block
 * already holding the content is not replaced. So a prepared Change never places more blocks than
 * the request has `moveBlock` changes, and never moves, replaces or deletes a block the request
 * did not name. (It stores one `MoveBlocks` per run of neighbours, so the count is of blocks
 * placed, not of ops.) A daemon that repeats moves (seen in 2026: every move once per stale entry
 * of each ancestor, compounding with depth) breaks the first rule and is caught here, before
 * anything is signed.
 */
export function implausiblePreparedChange(
  unsignedChange: Uint8Array,
  changes: DocumentChanges,
  maxBytes: number = DEFAULT_MAX_PREPARED_CHANGE_BYTES,
): string | null {
  if (unsignedChange.byteLength > maxBytes) {
    return `it is ${unsignedChange.byteLength} bytes, over the ${maxBytes} this client signs`
  }
  const moved = new Map<string, number>()
  const replaced = new Set<string>()
  const deleted = new Set<string>()
  let moves = 0
  for (const {op} of changes) {
    if (op.case === 'moveBlock') {
      moved.set(op.value.blockId, (moved.get(op.value.blockId) ?? 0) + 1)
      moves++
    } else if (op.case === 'replaceBlock') {
      replaced.add(String((op.value as {id?: unknown}).id))
    } else if (op.case === 'deleteBlock') {
      deleted.add(op.value)
    }
  }
  const ops = (cborDecode(unsignedChange) as {body?: {ops?: unknown} | null}).body?.ops
  const placedTimes = new Map<string, number>()
  let placed = 0
  let replaces = 0
  for (const op of Array.isArray(ops) ? (ops as Array<Record<string, unknown>>) : []) {
    const blocks = Array.isArray(op.blocks) ? (op.blocks as unknown[]) : []
    if (op.type === 'MoveBlocks') {
      for (const block of blocks) {
        const id = String(block)
        const wanted = moved.get(id)
        if (wanted === undefined) return `it moves block ${id}, which the request does not`
        const times = (placedTimes.get(id) ?? 0) + 1
        if (times > wanted)
          return `it places block ${id} ${times} times, the request ${wanted === 1 ? 'once' : `${wanted} times`}`
        placedTimes.set(id, times)
      }
      placed += blocks.length
    } else if (op.type === 'DeleteBlocks') {
      for (const block of blocks) {
        if (!deleted.has(String(block))) return `it deletes block ${String(block)}, which the request does not`
      }
    } else if (op.type === 'ReplaceBlock') {
      const id = String((op.block as {id?: unknown} | undefined)?.id)
      if (!replaced.has(id)) return `it replaces block ${id}, which the request does not`
      replaces++
    }
  }
  if (placed > moves) return `it places blocks ${placed} times for ${moves} requested`
  if (replaces > replaced.size) return `it replaces blocks ${replaces} times for ${replaced.size} requested`
  return null
}

/** The latest timestamp among the head Changes, read from the Changes themselves; undefined when they cannot be read. */
async function headTimestamp(client: Pick<SeedClient, 'request'>, heads: string[]): Promise<number | undefined> {
  try {
    let latest = 0
    for (const cid of heads) {
      const {value} = await client.request('GetCID', {cid})
      const ts = Number((value as {ts?: unknown} | undefined)?.ts)
      if (!Number.isFinite(ts)) return undefined
      latest = Math.max(latest, ts)
    }
    return latest
  } catch {
    return undefined
  }
}
