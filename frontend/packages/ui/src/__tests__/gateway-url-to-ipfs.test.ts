import {describe, expect, it} from 'vitest'
import {gatewayUrlToIpfs} from '../get-file-url'

const CID = 'bafyreia6fzsx6pkwdolb6qqa6b4tb7kxt2xcjuhuoxyvvt4p6lucacfg2y'

describe('gatewayUrlToIpfs', () => {
  it('converts a gateway /ipfs/<cid> URL to ipfs://<cid>', () => {
    expect(gatewayUrlToIpfs(`https://hyper.media/ipfs/${CID}`)).toBe(`ipfs://${CID}`)
  })

  it('is host-agnostic (any gateway origin converts)', () => {
    expect(gatewayUrlToIpfs(`http://localhost:58001/ipfs/${CID}`)).toBe(`ipfs://${CID}`)
    expect(gatewayUrlToIpfs(`https://some-other-gateway.example/ipfs/${CID}`)).toBe(`ipfs://${CID}`)
  })

  it("converts the app's own inspect URLs (the web server host)", () => {
    expect(gatewayUrlToIpfs(`http://localhost:3000/inspect/ipfs/${CID}`)).toBe(`ipfs://${CID}`)
    expect(gatewayUrlToIpfs(`https://hyper.media/hm/inspect/ipfs/${CID}`)).toBe(`ipfs://${CID}`)
  })

  it('preserves a sub-path after the CID', () => {
    expect(gatewayUrlToIpfs(`https://hyper.media/ipfs/${CID}/meta/title`)).toBe(`ipfs://${CID}/meta/title`)
  })

  it('drops query/hash and trims whitespace', () => {
    expect(gatewayUrlToIpfs(`  https://hyper.media/ipfs/${CID}?foo=1#frag  `)).toBe(`ipfs://${CID}`)
  })

  it('returns null when the /ipfs/ segment is not a valid CID', () => {
    expect(gatewayUrlToIpfs('https://hyper.media/ipfs/not-a-cid')).toBeNull()
  })

  it('returns null for non-ipfs URLs and for an already-ipfs:// URL', () => {
    expect(gatewayUrlToIpfs('https://hyper.media/hm/z6Mk/doc')).toBeNull()
    expect(gatewayUrlToIpfs(`ipfs://${CID}`)).toBeNull()
    expect(gatewayUrlToIpfs('just some text')).toBeNull()
  })
})
