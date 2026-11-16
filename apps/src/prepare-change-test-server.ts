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

/** The unsigned Change bytes for a `PrepareDocumentChange` request body (DAG-CBOR). */
export function fakePreparedChange(requestBody: Uint8Array, genesis?: string): Uint8Array {
  const request = cbor.decode<{baseVersion?: string; changes: RequestedChange[]}>(requestBody)
  const deps = (request.baseVersion ?? '')
    .split('.')
    .filter(Boolean)
    .map((cid) => CID.parse(cid))
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
      depth: 1,
      signer: null,
      ts: Date.now(),
      sig: null,
    }),
  )
}
