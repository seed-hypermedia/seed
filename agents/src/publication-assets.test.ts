import {describe, expect, test, spyOn} from 'bun:test'
import * as dns from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import * as events from 'node:events'
import * as assets from './publication-assets'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

const CID = 'bafkreihz3ude43b6lilnvunejpnkr4d7sbjwrldflbfffkcg637l7uppbu'
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const image = (url: string): assets.PublicationAsset => ({url, kind: 'Image'})
const good = async () => ({status: 206, contentType: 'image/png', sample: PNG})
const node = (url: string, children: HMBlockNode[] = []) =>
  ({block: {id: 'image', type: 'Image', link: url, attributes: {}}, children}) as HMBlockNode

describe('publication asset collection and validation', () => {
  test('does not silently omit a media block with no URL', () => {
    expect(() => assets.collectPublicationAssets([node('')])).toThrow('no asset URL')
    expect(() => assets.collectPublicationAssets([node('   ')])).toThrow('no asset URL')
  })
  test('uses parsed nested block URLs and metadata, deduplicates, ignores paragraph links', () => {
    expect(
      assets.collectPublicationAssets([node('https://one', [node('https://two')]), node('https://one')], {
        icon: 'https://three',
        cover: 'https://two',
      }),
    ).toEqual([image('https://one'), image('https://two'), image('https://three')])
  })
  test('checks exact HTTP URL even when its CID works on another gateway', async () => {
    const urls: string[] = []
    const probe = async (url: string) => {
      urls.push(url)
      return url.startsWith('https://ipfs.io/') ? {...(await good()), status: 429} : good()
    }
    await expect(
      assets.checkPublicationAssets([image(`https://ipfs.io/ipfs/${CID}`)], {gateway: 'https://hyper.media', probe}),
    ).rejects.toThrow('HTTP 429')
    expect(urls).toEqual([`https://ipfs.io/ipfs/${CID}`])
    expect(
      await assets.checkPublicationAssets([image(`https://hyper.media/ipfs/${CID}`)], {
        gateway: 'https://hyper.media',
        probe,
      }),
    ).toMatchObject([{status: 'checked', bytes: PNG.length}])
  })
  test('requires content type AND signature, rejects empty bodies', async () => {
    for (const probe of [
      async () => ({...(await good()), contentType: 'text/html'}),
      async () => ({...(await good()), sample: Buffer.from('<html>not image</html>')}),
      async () => ({...(await good()), sample: new Uint8Array()}),
    ])
      await expect(
        assets.checkPublicationAssets([image('https://example.com/a')], {gateway: 'https://hyper.media', probe}),
      ).rejects.toThrow()
  })
  test('accepts supported image/video signatures and arbitrary nonempty file bodies', async () => {
    for (const [kind, type, sample] of [
      ['Image', 'image/jpeg', Buffer.from('ffd8ff', 'hex')],
      ['Image', 'image/gif', Buffer.from('GIF89a')],
      [
        'Image',
        'image/svg+xml',
        Buffer.from(
          '<?xml version="1.0"?><!--first--><!--second--><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg>',
        ),
      ],
      ['Image', 'image/svg+xml', Buffer.from('<!DOCTYPE svg [<!ENTITY title "example">]><svg>')],
      ['Image', 'image/svg+xml', Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg">')],
      ['Video', 'video/mp4', Buffer.from('000000186674797069736f6d', 'hex')],
      ['File', 'text/plain', Buffer.from('report')],
    ] as const)
      expect(
        await assets.checkPublicationAssets([{url: 'https://example.com/a', kind}], {
          gateway: 'https://hyper.media',
          probe: async () => ({status: 200, contentType: type, sample}),
        }),
      ).toMatchObject([{status: 'checked'}])
  })
  test('deduplicates requests but validates each media use', async () => {
    let calls = 0
    await expect(
      assets.checkPublicationAssets([{url: 'https://example.com/a', kind: 'File'}, image('https://example.com/a')], {
        gateway: 'https://hyper.media',
        probe: async () => {
          calls++
          return {...(await good()), contentType: 'text/plain'}
        },
      }),
    ).rejects.toThrow('Expected image')
    expect(calls).toBe(1)
  })
  test('staged IPFS roots defer availability; remote IPFS uses the explicit serving gateway', async () => {
    let calls = 0
    const probe = async (url: string) => {
      calls++
      expect(url).toBe(`https://hyper.media/ipfs/${CID}`)
      return good()
    }
    expect(
      await assets.checkPublicationAssets([image(`ipfs://${CID}`)], {
        gateway: 'https://hyper.media',
        deferIpfs: true,
        probe,
      }),
    ).toMatchObject([{status: 'pending-publication'}])
    expect(calls).toBe(0)
    await assets.checkPublicationAssets([image(`ipfs://${CID}`)], {gateway: 'https://hyper.media', probe})
    expect(calls).toBe(1)
  })
  test('limits URL count, simultaneous requests, and elapsed time', async () => {
    const many = Array.from({length: 64}, (_, i) => image(`https://example.com/${i}`))
    let active = 0,
      peak = 0,
      calls = 0
    const probe = async () => {
      calls++
      peak = Math.max(peak, ++active)
      await Bun.sleep(1)
      active--
      return good()
    }
    await assets.checkPublicationAssets(many, {gateway: 'https://hyper.media', probe})
    expect(calls).toBe(64)
    expect(peak).toBe(4)
    await expect(
      assets.checkPublicationAssets([...many, image('https://example.com/extra')], {
        gateway: 'https://hyper.media',
        probe,
      }),
    ).rejects.toThrow('64')
    const stalled: typeof assets.probePublicAsset = async (_url, signal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {once: true}))
    await expect(
      assets.checkPublicationAssets([image('https://example.com')], {
        gateway: 'https://hyper.media',
        probe: stalled,
        timeoutMs: 10,
      }),
    ).rejects.toThrow('deadline')
  })
})

describe('public-only pinned transport', () => {
  test('rejects private, mapped, transition and reserved addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '172.16.1.2',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '2002:7f00:1::',
      '2001:db8::1',
      '3fff::1',
    ])
      expect(assets.isPublicAssetAddress(address)).toBe(false)
    for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])
      expect(assets.isPublicAssetAddress(address)).toBe(true)
  })
  test('refuses forbidden schemes, credentials, ports and private literals before connecting', async () => {
    for (const url of [
      'file:///etc/passwd',
      'http://127.0.0.1',
      'http://[::1]',
      'https://user:pass@example.com',
      'https://example.com:8443',
    ])
      await expect(assets.probePublicAsset(url, AbortSignal.timeout(1000))).rejects.toThrow()
  })
  test('rejects mixed DNS and pins public DNS through lookup; redirect to private is not fetched', async () => {
    const lookup = spyOn(dns, 'lookup').mockResolvedValue([
      {address: '1.1.1.1', family: 4},
      {address: '127.0.0.1', family: 4},
    ] as never)
    const get = spyOn(https, 'get')
    try {
      await expect(assets.probePublicAsset('https://example.com/a', AbortSignal.timeout(1000))).rejects.toThrow(
        'not public',
      )
      expect(get).not.toHaveBeenCalled()
      lookup.mockResolvedValue([
        {address: '2606:4700:4700::1111', family: 6},
        {address: '1.1.1.1', family: 4},
      ] as never)
      get.mockImplementation(((_url: URL, options: any, receive: any) => {
        options.lookup('example.com', {all: true}, (error: unknown, result: unknown) => {
          expect(error).toBeNull()
          expect(result).toEqual([
            {address: '2606:4700:4700::1111', family: 6},
            {address: '1.1.1.1', family: 4},
          ])
        })
        expect(options.agent).toBe(false)
        expect(options.autoSelectFamily).toBe(true)
        expect(options.autoSelectFamilyAttemptTimeout).toBe(250)
        const request = new events.EventEmitter()
        queueMicrotask(() => receive({statusCode: 302, headers: {location: 'http://127.0.0.1/secret'}, destroy() {}}))
        return request
      }) as never)
      await expect(assets.probePublicAsset('https://example.com/a', AbortSignal.timeout(1000))).rejects.toThrow(
        'not public',
      )
      expect(get).toHaveBeenCalledTimes(1)
    } finally {
      lookup.mockRestore()
      get.mockRestore()
    }
  })
  test('caps actual response retention even when server ignores Range', async () => {
    const get = spyOn(http, 'get').mockImplementation(((_url: URL, options: any, receive: any) => {
      expect(options.headers.Range).toBe('bytes=0-1023')
      const response = Object.assign(new events.EventEmitter(), {
        statusCode: 200,
        headers: {'content-type': 'image/png'},
        destroy() {},
      })
      queueMicrotask(() => {
        receive(response)
        response.emit('data', Buffer.alloc(65536, 1))
        response.emit('end')
      })
      return new events.EventEmitter()
    }) as never)
    try {
      expect((await assets.probePublicAsset('http://1.1.1.1/a', AbortSignal.timeout(1000))).sample.length).toBe(1024)
    } finally {
      get.mockRestore()
    }
  })
})
