/**
 * A stand-in for a site's `PrepareDocumentChange`, for tests that mock the Seed API with a fetch.
 *
 * The real daemon applies the requested changes to the document and answers with the minimal
 * unsigned Change. Tests have no document state, so this writes every requested change into the
 * Change as the matching native op, on top of the request's base version. That is enough to assert
 * what a caller asked for and what it then signed and published.
 */

import * as cbor from '@/cbor'
import {CID} from 'multiformats/cid'

type RequestedChange = {op: {case?: string; value?: any}}

/** What a test knows about the document a fake Change is prepared on. */
export type FakePrepareOptions = {
  /** Genesis of the document; defaults to the first head of the request's base version. */
  genesis?: string
  /**
   * The site's clock in milliseconds, which stamps the Change. Defaults to `Date.now`. Give a
   * clock that differs from the test's to see what a caller does with a Change that carries
   * another machine's time.
   */
  now?: () => number
  /**
   * The Changes the request builds on, by CID: their depth and timestamp. The prepared Change's
   * depth is one more than the deepest head named here (2 when none is known).
   */
  heads?: Record<string, {depth: number; ts: number}>
  /**
   * Refuse, as the daemon does, a Change that would not be later than a head it builds on
   * ("ts of change … must be greater than ts of its dependency …"). Needs `heads`.
   */
  checkCausality?: boolean
}

/**
 * The unsigned Change bytes for a `PrepareDocumentChange` request body (DAG-CBOR).
 *
 * The Change builds on the request's base version: its `deps` are the heads the request names,
 * its depth follows theirs, and its timestamp is the fake site's clock (`options.now`), not
 * whatever clock the caller under test uses.
 */
export function fakePreparedChange(requestBody: Uint8Array, options: FakePrepareOptions | string = {}): Uint8Array {
  const {
    genesis,
    now = Date.now,
    heads = {},
    checkCausality = false,
  } = typeof options === 'string' ? {genesis: options} : options
  const request = cbor.decode<{baseVersion?: string; changes: RequestedChange[]}>(requestBody)
  const headCids = (request.baseVersion ?? '').split('.').filter(Boolean)
  const deps = headCids.map((cid) => CID.parse(cid))
  const ts = Math.floor(now())
  // Depth 1 when no head is known, as before these options existed.
  let depth = headCids.some((cid) => heads[cid]) ? 0 : 1
  for (const cid of headCids) {
    const head = heads[cid]
    if (!head) continue
    depth = Math.max(depth, head.depth)
    if (checkCausality && ts <= head.ts) {
      throw new Error(`ts of change (prepared) must be greater than ts of its dependency ${cid}`)
    }
  }
  const ops = request.changes.map(({op}) => {
    switch (op.case) {
      case 'replaceBlock': {
        const {attributes, ...block} = op.value as Record<string, unknown>
        return {type: 'ReplaceBlock', block: {...block, ...((attributes as object | undefined) ?? {})}}
      }
      case 'moveBlock':
        return {
          type: 'MoveBlocks',
          blocks: [op.value.blockId],
          ...(op.value.parent ? {parent: op.value.parent} : {}),
        }
      case 'deleteBlock':
        return {type: 'DeleteBlocks', blocks: [op.value]}
      case 'setMetadata':
        return {type: 'SetAttributes', attrs: [{key: [op.value.key], value: op.value.value}]}
      case 'setAttribute': {
        const value = op.value.value
        return {
          type: 'SetAttributes',
          attrs: [{key: op.value.key, value: value?.case === 'nullValue' ? null : value?.value ?? null}],
        }
      }
      default:
        throw new Error(`fakePreparedChange: unsupported change ${String(op.case)}`)
    }
  })
  // A plain Uint8Array: the encoder may hand back a Buffer, which superjson cannot carry.
  return Uint8Array.from(
    cbor.encode({
      type: 'Change',
      body: {ops, opCount: ops.length},
      genesis: CID.parse(genesis ?? request.baseVersion!.split('.')[0]!),
      deps,
      depth: depth + 1,
      signer: null,
      ts,
      sig: null,
    }),
  )
}
