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
 * - a request the site refuses as too large (HTTP 413; a site may cap its API bodies well below
 *   what the daemon accepts), which `client.publish` can still deliver blob by blob.
 */

import {CID} from 'multiformats/cid'
import {
  createChange,
  createChangeOps,
  createVersionRef,
  prepareDocumentUpdateBlobs,
  SeedClientError,
  type CollectedBlob,
  type DocumentOperation,
  type DocumentState,
  type SeedClient,
} from '@seed-hypermedia/client'
import type {AnySigner} from '@seed-hypermedia/client'

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

  try {
    const prepared = await prepareDocumentUpdateBlobs({
      client: input.client,
      signer: input.signer,
      account: input.account,
      path: input.path,
      baseVersion: input.state.version,
      ops: input.ops,
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
