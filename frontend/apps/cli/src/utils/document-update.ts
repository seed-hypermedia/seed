/**
 * Builds the blobs for `document update`.
 *
 * The Change is computed by the server (`PrepareDocumentChange`, see `prepareDocumentUpdateBlobs`
 * in the client package): it applies the requested ops to the document's real state and writes
 * only what differs, so a block already in place is not moved again and an attribute already set
 * is not set again. When nothing differs there is no Change at all.
 *
 * Two kinds of update cannot go that way, and are built here the way every update used to be
 * (`createChangeOps`, stored exactly as written):
 *
 * - an attribute the request cannot carry: a fractional number, or a key containing a dot;
 * - a reorder the daemon gets wrong: blocks that move while keeping the block before them (two
 *   neighbours carried elsewhere together), see {@link serverChanges};
 * - a request the site refuses as too large (HTTP 413; a site may cap its API bodies well below
 *   what the daemon accepts), which `client.publish` can still deliver blob by blob.
 */

import {CID} from 'multiformats/cid'
import {
  createChange,
  createChangeOps,
  createVersionRef,
  documentOperationsToChanges,
  prepareDocumentUpdateBlobs,
  withoutLeadingMovesInPlace,
  type DocumentChanges,
  SeedClientError,
  type CollectedBlob,
  type DocumentOperation,
  type DocumentState,
  type SeedClient,
} from '@seed-hypermedia/client'
import type {AnySigner} from '@seed-hypermedia/client'

/** A document's block tree, as far as placing blocks needs it. */
export type DocumentContent = Array<{block: {id: string}; children?: unknown}> | undefined | null

/** What to update, for {@link buildDocumentUpdate}. */
export type DocumentUpdateInput = {
  client: Pick<SeedClient, 'request'>
  signer: AnySigner
  /** Account (space) of the address being written. */
  account: string
  /** Path of the address being written, in API form (`/notes/first`, `''` for the home document). */
  path: string
  /**
   * Change-DAG state to build on. For an address that holds a redirect this is the redirect
   * target's state: the Change continues the target's history and the Ref lands at `path`.
   */
  state: DocumentState
  ops: DocumentOperation[]
  /**
   * The content of the document `ops` were computed against (the redirect target's, for a
   * takeover). Needed to send the moves safely: see `withoutLeadingMovesInPlace`.
   */
  content: DocumentContent
  capability?: string
  /**
   * The lowest generation the new Ref may take. For an ordinary update, the generation the path
   * holds now; for a redirect takeover, the current time, so the Ref outranks the redirect Ref.
   */
  minGeneration?: number | bigint | string
}

/** The outcome of {@link buildDocumentUpdate}. */
export type DocumentUpdateResult =
  | {
      changed: true
      /** The signed Change, then the Version Ref. */
      blobs: CollectedBlob[]
      /** CID of the new Change: the document's new version. */
      version: string
      /** Who computed the Change: the server, or this process. */
      builtBy: 'server' | 'local'
      /** Why the Change was built locally, in a sentence fit to show the user. */
      localReason?: string
    }
  | {changed: false; blobs: []; version: string}

/**
 * Attributes of `ops` that `PrepareDocumentChange` cannot carry, each as `name (why)`.
 *
 * A document attribute in that request is a string, a whole number, a boolean or null, under a key
 * whose segments hold no dot. `--metadata '{"rating": 4.5}'` and `--metadata '{"a.b": "x"}'` are
 * the two things the command line can produce beyond that (lists and objects are flattened into
 * key paths before they get here).
 */
export function attributesServerCannotPrepare(ops: DocumentOperation[]): string[] {
  const found: string[] = []
  for (const op of ops) {
    if (op.type !== 'SetAttributes') continue
    for (const attr of op.attrs) {
      const name = attr.key.join('.')
      if (attr.key.length === 0 || attr.key.some((segment) => !segment || segment.includes('.'))) {
        found.push(`${JSON.stringify(name)} (a key segment is empty or contains a dot)`)
      } else if (typeof attr.value === 'number' && !Number.isSafeInteger(attr.value)) {
        found.push(`${JSON.stringify(name)} (${attr.value} is not a whole number)`)
      }
    }
  }
  return found
}

/**
 * Builds the Change and Version Ref for an update, without publishing them.
 *
 * `{changed: false}` means every requested op is already true of the document: nothing was
 * signed, and nothing must be published as a new version.
 */
export async function buildDocumentUpdate(input: DocumentUpdateInput): Promise<DocumentUpdateResult> {
  if (input.ops.length === 0) return {changed: false, blobs: [], version: input.state.version}

  const unsupported = attributesServerCannotPrepare(input.ops)
  if (unsupported.length > 0) {
    return buildLocally(
      input,
      `the server cannot prepare ${unsupported.length === 1 ? 'the attribute' : 'the attributes'} ${unsupported.join(
        ', ',
      )}`,
    )
  }

  const forServer = serverChanges(input.ops, input.content)
  if ('unsupported' in forServer) return buildLocally(input, forServer.unsupported)

  try {
    const prepared = await prepareDocumentUpdateBlobs({
      client: input.client,
      signer: input.signer,
      account: input.account,
      path: input.path,
      baseVersion: input.state.version,
      changes: forServer.changes,
      capability: input.capability,
      genesis: input.state.genesis,
      currentGeneration: input.minGeneration,
    })
    if (!prepared.changed) return {changed: false, blobs: [], version: prepared.version}
    return {changed: true, blobs: prepared.blobs, version: prepared.version, builtBy: 'server'}
  } catch (error) {
    if (error instanceof SeedClientError && error.status === 413) {
      return buildLocally(input, 'the server refused the update request as too large (HTTP 413)')
    }
    if (isClockBehindError(error)) {
      throw new Error(
        "The server's clock is behind the time of this document's latest change, so it cannot write the next one yet " +
          '(a change must be later than the changes it builds on). This happens when the last writer’s clock ran ' +
          `ahead of the server's. Wait a few seconds and run the update again. (${(error as Error).message})`,
      )
    }
    throw error
  }
}

/**
 * The `changes` to send to `PrepareDocumentChange` for `ops`, or why they cannot be sent.
 *
 * Replaces, deletes and attributes go as they are. Moves do not. A `MoveBlocks` from a diff lists
 * a whole level, which as a request is "first block at the start, each next block after the one
 * before". The daemon (as seen on a real one, 2026-11-16) gets that wrong in two ways:
 *
 * - a first block "moved" to where it already is makes the block after it land before it;
 * - a block whose move leaves it behind the same block as before is not written, even when that
 *   block itself moved: `[a, b, c, d]` to `[a, c, d, b]` sent as a chain stores only the move of
 *   `c` and reads back `[a, c, b, d]`.
 *
 * So each level is sent as the fewest moves that produce it: the longest run of blocks already in
 * the right order relative to each other stays put and is not mentioned, and every other block is
 * placed after the block that precedes it in the result. No block in place is ever sent, which
 * covers the first case (`withoutLeadingMovesInPlace` is still applied, as the guard the client
 * package gives every caller). The second case cannot be said to the daemon at all when a block
 * that has to move keeps its left neighbour (`[a, b, c, d]` to `[c, d, a, b]`: whichever pair
 * moves, its second block follows its first as before). Such an update is reported as
 * unsupported, and is built locally, where the level is stored as listed.
 *
 * A native `MoveBlocks` puts its blocks at the start of the level, in order, ahead of the blocks it
 * does not list; that is the result computed here when a list is not the whole level.
 */
export function serverChanges(
  ops: DocumentOperation[],
  content: DocumentContent,
): {changes: DocumentChanges} | {unsupported: string} {
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
  const movedParents = new Set<string>()
  for (const op of ops) {
    if (op.type === 'DeleteBlocks') for (const id of op.blocks) deleted.add(id)
    if (op.type === 'MoveBlocks') {
      const parent = op.parent ?? ''
      if (movedParents.has(parent)) {
        return {unsupported: `the update orders the blocks under ${parent ? `block ${parent}` : 'the root'} twice`}
      }
      movedParents.add(parent)
      for (const id of op.blocks) {
        if (destination.has(id)) return {unsupported: `the update places block ${id} twice`}
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
    // The level as it will read: the listed blocks, then the ones that stay behind them.
    const staying = (childrenOf.get(parent) ?? []).filter((id) => !deleted.has(id) && !destination.has(id))
    const level = [...op.blocks, ...staying]
    // Blocks that were already under this parent, by their old position; the longest run of them
    // in rising order stays where it is.
    const before = childrenOf.get(parent) ?? []
    const oldIndex = level.map((id) => (parentOf.get(id) === parent ? before.indexOf(id) : -1))
    const settled = longestRisingRun(oldIndex)
    level.forEach((blockId, index) => {
      if (settled.has(index)) return
      const leftSibling = index > 0 ? level[index - 1]! : ''
      changes.push({op: {case: 'moveBlock', value: {blockId, parent, leftSibling}}})
    })
    for (let index = 0; index < level.length; index++) {
      if (settled.has(index)) continue
      const blockId = level[index]!
      if (parentOf.get(blockId) !== parent) continue
      const leftSibling = index > 0 ? level[index - 1]! : ''
      // What the block followed before: its left neighbour, or the nearest one that is not deleted.
      let was = leftOf.get(blockId) ?? ''
      const followed = new Set([was])
      while (was && deleted.has(was)) {
        was = leftOf.get(was) ?? ''
        followed.add(was)
      }
      if (followed.has(leftSibling)) {
        return {
          unsupported: `the server cannot place block ${blockId}, which moves together with the block before it`,
        }
      }
    }
  }
  return {changes: withoutLeadingMovesInPlace(changes, content)}
}

/** Indexes of the longest strictly rising run of non-negative values in `values`. */
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

/** The daemon refuses a Change whose timestamp is not later than every Change it builds on. */
function isClockBehindError(error: unknown): boolean {
  return error instanceof Error && /must be greater than ts of its dependency/.test(error.message)
}

/** The Change exactly as requested, stamped with this machine's clock. */
async function buildLocally(input: DocumentUpdateInput, localReason: string): Promise<DocumentUpdateResult> {
  const {state} = input
  const {unsignedBytes, ts} = createChangeOps({
    ops: input.ops,
    genesisCid: CID.parse(state.genesis),
    deps: state.heads.map((head) => CID.parse(head)),
    depth: state.headDepth + 1,
  })
  const change = await createChange(unsignedBytes, input.signer)
  const floor = input.minGeneration == null ? NaN : Number(input.minGeneration)
  const generation = Number.isFinite(floor) && floor > Number(ts) ? floor : Number(ts)
  const version = change.cid.toString()
  const ref = await createVersionRef(
    {
      space: input.account,
      path: input.path,
      genesis: state.genesis,
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
    builtBy: 'local',
    localReason,
  }
}
