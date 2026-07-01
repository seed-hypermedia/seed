import * as cbor from '@ipld/dag-cbor'
import {dagJsonToIpld} from '@shm/ui/dag-json'
import {CID} from 'multiformats/cid'
import {describe, expect, it} from 'vitest'

const CID_STR = 'bafyreigu5vewjq63sy3t2spkkpmchine3vo3jnuuvntx7ig4oef7hafuka'

describe('blob editor DAG-CBOR encoding', () => {
  it('encodes DAG-JSON link forms as real IPLD links (tag 42)', () => {
    const encoded = cbor.encode(dagJsonToIpld({link: {'/': CID_STR}}))
    const decoded = cbor.decode(encoded) as {link: CID}
    expect(decoded.link).toBeInstanceOf(CID)
    expect(decoded.link.toString()).toBe(CID_STR)
  })

  it('encodes DAG-JSON bytes forms as real CBOR byte strings', () => {
    const encoded = cbor.encode(dagJsonToIpld({data: {'/': {bytes: 'AQID'}}}))
    const decoded = cbor.decode(encoded) as {data: Uint8Array}
    expect(decoded.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(decoded.data)).toEqual([1, 2, 3])
  })

  it('round-trips plain JSON values unchanged', () => {
    const value = {name: 'x', nested: {count: 3, flag: true}, items: [1, 'two', null]}
    const decoded = cbor.decode(cbor.encode(dagJsonToIpld(value)))
    expect(decoded).toEqual(value)
  })
})
