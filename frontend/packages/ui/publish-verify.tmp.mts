import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {dagJsonToIpld} from './src/dag-json.ts'
import {BLOB_META_SCHEMA, BLOB_META_SCHEMA_CID} from './src/blob-schema.ts'

async function encodeBlob(value: unknown) {
  const data = cbor.encode(dagJsonToIpld(value))
  const digest = await sha256.digest(data)
  const cid = CID.createV1(0x71, digest).toString()
  return {cid, data: Buffer.from(data).toString('base64')}
}

const meta = await encodeBlob(BLOB_META_SCHEMA)
if (meta.cid !== BLOB_META_SCHEMA_CID) throw new Error(`meta CID drift: ${meta.cid}`)

const articleSchema = {
  schema: {'/': BLOB_META_SCHEMA_CID},
  title: 'Article',
  type: 'object',
  required: ['title', 'status'],
  properties: {
    title: {type: 'string', minLength: 1},
    status: {type: 'string', enum: ['draft', 'published'], default: 'draft'},
    cover: {kind: 'bytes', maxBytes: 1048576},
  },
}
const schema = await encodeBlob(articleSchema)

const instance = {
  schema: {'/': schema.cid},
  title: 'Hello from the verification script',
  status: 'draft',
}
const inst = await encodeBlob(instance)

console.log(JSON.stringify({
  request: {blobs: [
    {cid: meta.cid, data: meta.data},
    {cid: schema.cid, data: schema.data},
    {cid: inst.cid, data: inst.data},
  ]},
  cids: {meta: meta.cid, schema: schema.cid, instance: inst.cid},
}))
