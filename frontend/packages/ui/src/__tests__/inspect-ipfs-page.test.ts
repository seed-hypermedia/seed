import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {beforeAll, describe, expect, test} from 'vitest'
import {BLOB_META_SCHEMA_CID} from '../blob-schema'
import {inspectorBlobActions} from '../inspect-ipfs-page'

// BLOB_META_SCHEMA_CID is a real DAG-CBOR (0x71) CIDv1, so it doubles as a valid
// "editable blob" CID here. OTHER_CBOR_CID is a second, distinct DAG-CBOR CID
// (a non-meta schema an instance points at).
const CBOR_CID = BLOB_META_SCHEMA_CID
let OTHER_CBOR_CID: string

beforeAll(async () => {
  const digest = await sha256.digest(cbor.encode({some: 'schema'}))
  OTHER_CBOR_CID = CID.createV1(0x71, digest).toString()
})

describe('inspectorBlobActions', () => {
  test('a schema blob offers Edit + New Instance and reads as a schema', () => {
    const value = {schema: {'/': BLOB_META_SCHEMA_CID}, type: 'object'}
    expect(inspectorBlobActions(CBOR_CID, value, true)).toEqual({
      canEdit: true,
      valueIsSchema: true,
      hasAttachedSchema: false,
      attachedSchemaCid: undefined,
    })
  })

  test('an instance with an attached schema link exposes that CID for validation', () => {
    const value = {schema: {'/': OTHER_CBOR_CID}, title: 'hi'}
    expect(inspectorBlobActions(CBOR_CID, value, true)).toEqual({
      canEdit: true,
      valueIsSchema: false,
      hasAttachedSchema: true,
      attachedSchemaCid: OTHER_CBOR_CID,
    })
  })

  test('a plain DAG-CBOR blob is editable but neither a schema nor schema-attached', () => {
    expect(inspectorBlobActions(CBOR_CID, {foo: 1}, true)).toEqual({
      canEdit: true,
      valueIsSchema: false,
      hasAttachedSchema: false,
      attachedSchemaCid: undefined,
    })
  })

  test('a non-CID / non-DAG-CBOR reference is not editable', () => {
    expect(inspectorBlobActions('not-a-cid', {foo: 1}, true).canEdit).toBe(false)
  })

  test('a non-DAG-CBOR schema link is not treated as an attached schema', () => {
    // a raw (0x55) codec link is not a schema blob we can validate against
    const value = {schema: {'/': 'bafkreщ-not-cbor'}, title: 'hi'}
    expect(inspectorBlobActions(CBOR_CID, value, true).attachedSchemaCid).toBeUndefined()
  })

  test('a deep path (sub-value, not the blob root) offers no blob-level actions', () => {
    const value = {schema: {'/': BLOB_META_SCHEMA_CID}, type: 'object'}
    expect(inspectorBlobActions(CBOR_CID, value, false)).toEqual({
      canEdit: false,
      valueIsSchema: false,
      hasAttachedSchema: false,
      attachedSchemaCid: undefined,
    })
  })
})
