import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {beforeAll, describe, expect, test} from 'vitest'
import {folderEntriesOf, inspectorBlobActions} from '../inspect-ipfs-page'

describe('folderEntriesOf', () => {
  test('a dag-pb node with named links is a folder, listed in the node order', () => {
    const node = {
      Data: {'/': {bytes: 'CAE'}},
      Links: [
        {Hash: {'/': 'bafkindex'}, Name: 'index.ts', Tsize: 12},
        {Hash: {'/': 'bafylib'}, Name: 'lib', Tsize: 40},
      ],
    }
    expect(folderEntriesOf(node)).toEqual([
      {name: 'index.ts', cid: 'bafkindex'},
      {name: 'lib', cid: 'bafylib'},
    ])
  })

  test('a chunked file, an empty node and plain data are not folders', () => {
    // A file in several blocks is a dag-pb node whose links carry no names.
    expect(
      folderEntriesOf({Data: {'/': {bytes: 'CAI'}}, Links: [{Hash: {'/': 'bafkchunk'}, Name: '', Tsize: 1}]}),
    ).toBeNull()
    expect(folderEntriesOf({Data: {'/': {bytes: 'CAE'}}, Links: []})).toBeNull()
    expect(folderEntriesOf({a: 1})).toBeNull()
    expect(folderEntriesOf(null)).toBeNull()
  })
})

// Two distinct real DAG-CBOR (0x71) CIDv1s: CBOR_CID stands in for the blob's
// own editable CID; OTHER_CBOR_CID is a schema an instance points at. Under
// A blob "is a schema" when it validates against the meta-schema, so the
// fixtures use real library-dialect schemas (`type: hm://…`), not a meta-CID link.
let CBOR_CID: string
let OTHER_CBOR_CID: string

beforeAll(async () => {
  CBOR_CID = CID.createV1(0x71, await sha256.digest(cbor.encode({a: 1}))).toString()
  OTHER_CBOR_CID = CID.createV1(0x71, await sha256.digest(cbor.encode({some: 'schema'}))).toString()
})

describe('inspectorBlobActions', () => {
  test('a Hypermedia schema blob offers Edit + New Instance and reads as a schema', () => {
    const value = {
      type: 'hm://hyper.media/struct',
      properties: {},
      name: 'Thing',
    } // a valid Hypermedia schema (kinds are pinned to the Hypermedia account's published URLs)
    expect(inspectorBlobActions(CBOR_CID, value, true)).toEqual({
      canEdit: true,
      valueIsSchema: true,
      hasAttachedSchema: false,
      attachedSchemaCid: undefined,
    })
  })

  test('an instance with an attached schema link exposes that CID for validation', () => {
    const value = {schema: {'/': OTHER_CBOR_CID}, name: 'hi'} // not itself a schema
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
    const value = {schema: {'/': 'bafkreщ-not-cbor'}, name: 'hi'}
    expect(inspectorBlobActions(CBOR_CID, value, true).attachedSchemaCid).toBeUndefined()
  })

  test('a deep path (sub-value, not the blob root) offers no blob-level actions', () => {
    const value = {type: 'hm://hyper.media/map', properties: {}}
    expect(inspectorBlobActions(CBOR_CID, value, false)).toEqual({
      canEdit: false,
      valueIsSchema: false,
      hasAttachedSchema: false,
      attachedSchemaCid: undefined,
    })
  })
})
