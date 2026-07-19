import * as cbor from '@ipld/dag-cbor'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import {describe, expect, it} from 'vitest'
import {ipfsUrlToRoute} from '../omnibar-url'

async function makeDagCborCid(value: unknown): Promise<string> {
  const bytes = cbor.encode(value)
  const digest = await sha256.digest(bytes)
  return CID.createV1(cbor.code, digest).toString()
}

// A well-known CIDv0 (dag-pb codec 0x70)
const DAG_PB_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'

describe('ipfsUrlToRoute', () => {
  it('routes ipfs:// DAG-CBOR CIDs to the blob editor', async () => {
    const cid = await makeDagCborCid({hello: 'world'})
    expect(ipfsUrlToRoute(`ipfs://${cid}`)).toEqual({key: 'raw-blob', cid})
  })

  it('routes non-CBOR CIDs to the raw IPFS inspector', () => {
    expect(ipfsUrlToRoute(`ipfs://${DAG_PB_CID}`)).toEqual({
      key: 'inspect-ipfs',
      ipfsPath: DAG_PB_CID,
    })
  })

  it('routes CIDs with sub-paths to the inspector even for DAG-CBOR', async () => {
    const cid = await makeDagCborCid({nested: true})
    expect(ipfsUrlToRoute(`ipfs://${cid}/some/path`)).toEqual({
      key: 'inspect-ipfs',
      ipfsPath: `${cid}/some/path`,
    })
  })

  it('returns null for invalid CIDs', () => {
    expect(ipfsUrlToRoute('ipfs://not-a-cid')).toBeNull()
    expect(ipfsUrlToRoute('ipfs://')).toBeNull()
  })

  it('returns null for non-ipfs URLs', () => {
    expect(ipfsUrlToRoute('hm://z6Mk123')).toBeNull()
    expect(ipfsUrlToRoute('https://example.com')).toBeNull()
    expect(ipfsUrlToRoute('hello world')).toBeNull()
  })

  it('tolerates surrounding whitespace', async () => {
    const cid = await makeDagCborCid([1, 2, 3])
    expect(ipfsUrlToRoute(`  ipfs://${cid}  `)).toEqual({key: 'raw-blob', cid})
  })
})
