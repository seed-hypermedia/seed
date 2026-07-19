import {sha256 as sha256hash} from '@noble/hashes/sha2.js'
import {filesToIpfsBlobs} from '@seed-hypermedia/client'
import * as cbor from '@shm/shared/cbor'
import {CID} from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import {sha256 as sha256hasher} from 'multiformats/hashes/sha2'
import {dagJsonToIpld, findSeedIndexerCollision} from './dag-json'

/** Minimal shape of the universal client needed to publish blobs. */
export type BlobPublisher = {
  publish: (input: {blobs: {cid?: string; data: Uint8Array}[]}) => Promise<{cids: string[]}>
}

/**
 * Encode an edited DAG-JSON value back to DAG-CBOR and publish it as a new
 * blob, returning the new CID. Link/bytes forms (`{"/": …}`) are converted to
 * real IPLD via `dagJsonToIpld`. Guards against Seed indexer type collisions,
 * which the daemon would otherwise reject with an opaque error.
 */
export async function publishCborBlob(client: BlobPublisher, editedJson: unknown): Promise<string> {
  const ipld = dagJsonToIpld(editedJson)
  const data = new Uint8Array(cbor.encode(ipld))
  const collision = findSeedIndexerCollision(data)
  if (collision) {
    throw new Error(
      `This data can't be published: it collides with the Seed "${collision}" blob type (a "type" field with that value). Rename or remove it and try again.`,
    )
  }
  const digest = Digest.create(sha256hasher.code, sha256hash(data))
  const cid = CID.createV1(cbor.code, digest).toString()
  await client.publish({blobs: [{cid, data}]})
  return cid
}

/**
 * Publish edited text as a new UnixFS blob (chunked client-side), returning the
 * new root CID. Works on both desktop and web via the universal client.
 */
export async function publishTextBlob(client: BlobPublisher, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const {resultCIDs, blobs} = await filesToIpfsBlobs([bytes])
  if (!blobs.length || !resultCIDs[0]) throw new Error('IPFS chunking produced no blobs')
  await client.publish({blobs: blobs.map((b) => ({cid: b.cid, data: b.data}))})
  return resultCIDs[0]
}
