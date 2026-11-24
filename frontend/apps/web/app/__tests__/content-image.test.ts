import {Struct} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {Document} from '@shm/shared/client'
import {readFileSync} from 'fs'
import {join} from 'path'
import sharp from 'sharp'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {getDocument} = vi.hoisted(() => ({getDocument: vi.fn()}))
vi.mock('@/client.server', () => ({grpcClient: {documents: {getDocument}}}))

import {emojiToTwemojiCode} from '../content-image-fonts.server'
import {loader} from '../routes/hm.api.content-image'

const account = 'z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS'
const author = 'z6MkqVHQ4tp58QkZ6jSRamtQHNkZyJvACvtDfWEm9U5xWypK'
const request = () => new Request(`https://example.com/hm/api/content-image?space=${account}&version=test-version`)

describe('content image', () => {
  beforeEach(() => vi.resetAllMocks())

  describe('emojiToTwemojiCode', () => {
    it('strips FE0F variation selectors from a simple emoji', () => {
      // ❤️ (U+2764 U+FE0F) → 2764
      expect(emojiToTwemojiCode('❤️')).toBe('2764')
    })

    it('preserves ZWJ in a multi-codepoint family sequence', () => {
      // 👨‍👩‍👧 (man-woman-girl joined with ZWJ) → 1f468-200d-1f469-200d-1f467
      expect(emojiToTwemojiCode('👨‍👩‍👧')).toBe('1f468-200d-1f469-200d-1f467')
    })

    it('converts a single emoji without variation selector', () => {
      // 💥 (collision) → 1f4a5
      expect(emojiToTwemojiCode('💥')).toBe('1f4a5')
    })
  })

  it('renders a PNG when an author profile is unavailable', async () => {
    getDocument.mockImplementation(async ({account: uid}) => {
      if (uid === author) throw new ConnectError('Profile not found', Code.NotFound)
      return new Document({
        account,
        version: 'test-version',
        metadata: Struct.fromJson({name: 'Shared document'}),
        authors: [account, author],
      })
    })

    const response = await loader({request: request()})
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    const image = await sharp(Buffer.from(await response.arrayBuffer())).metadata()
    expect(image).toMatchObject({format: 'png', width: 1200, height: 630})
  })

  it('does not render an image when the shared document is unavailable', async () => {
    const error = new ConnectError('Document not found', Code.NotFound)
    getDocument.mockRejectedValue(error)
    await expect(loader({request: request()})).rejects.toBe(error)
  })

  describe('non-Latin glyph rendering', () => {
    const fixtureFont = readFileSync(join(__dirname, 'fixtures', 'noto-sans-kr-subset.ttf'))
    const fixtureFontUrl = 'https://fonts.gstatic.com/fixture.ttf'
    const twemojiSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36" fill="#FF0000"/></svg>`
    const requestedUrls: string[] = []

    beforeEach(() => {
      requestedUrls.length = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
          requestedUrls.push(url)
          if (url.includes('fonts.googleapis.com/css2')) {
            return new Response(
              `@font-face{font-family:'Noto Sans KR';src:url(${fixtureFontUrl}) format('truetype');}`,
              {status: 200, headers: {'Content-Type': 'text/css'}},
            )
          }
          if (url.includes(fixtureFontUrl)) {
            return new Response(fixtureFont, {
              status: 200,
              headers: {'Content-Type': 'font/ttf'},
            })
          }
          if (url.includes('twemoji@') && url.endsWith('.svg')) {
            return new Response(twemojiSvg, {
              status: 200,
              headers: {'Content-Type': 'image/svg+xml'},
            })
          }
          // Unexpected request: fail loudly so the test does not silently pass.
          return new Response('not found', {status: 404})
        }),
      )
    })

    afterEach(() => vi.unstubAllGlobals())

    /** Count pixels in a raw RGBA buffer matching a predicate over (R,G,B). */
    function countPixels(raw: Buffer, match: (r: number, g: number, b: number) => boolean): number {
      let n = 0
      for (let i = 0; i < raw.length; i += 4) {
        if (match(raw[i]!, raw[i + 1]!, raw[i + 2]!)) n++
      }
      return n
    }

    it('renders distinct Korean titles with distinct pixels and fetches Noto Sans KR', async () => {
      // Equal-length titles covered by the fixture font: with only Inter
      // (tofu) every glyph is the same box, so the pixel buffers must be
      // identical. With the fallback font the two titles render different
      // glyphs, so the buffers must differ.
      const titles = ['카드', '후기']
      const buffers: Buffer[] = []
      for (const title of titles) {
        getDocument.mockImplementation(
          async () =>
            new Document({
              account,
              version: 'test-version',
              metadata: Struct.fromJson({name: title}),
              authors: [account],
            }),
        )
        const response = await loader({request: request()})
        expect(response.status).toBe(200)
        const png = Buffer.from(await response.arrayBuffer())
        const raw = await sharp(png).raw().toBuffer()
        buffers.push(raw)
      }

      expect(buffers[0]!.equals(buffers[1]!)).toBe(false)

      const css2Requests = requestedUrls.filter((u) => u.includes('fonts.googleapis.com/css2'))
      expect(css2Requests.length).toBeGreaterThan(0)
      for (const url of css2Requests) {
        expect(url).toContain('family=Noto+Sans+KR')
        const textParam = new URL(url).searchParams.get('text')
        expect(textParam).toBeTruthy()
      }
      // Across all css2 requests, both titles' characters must appear in the
      // subset text so the fetched font actually contains the glyphs.
      const allText = css2Requests.map((u) => new URL(u).searchParams.get('text') ?? '').join('')
      for (const title of titles) {
        for (const ch of title) {
          expect(allText).toContain(ch)
        }
      }
    })

    it('renders emoji via Twemoji SVG (no tofu) and fetches the correct asset', async () => {
      getDocument.mockImplementation(
        async () =>
          new Document({
            account,
            version: 'test-version',
            metadata: Struct.fromJson({name: '💥 Boom'}),
            authors: [account],
          }),
      )
      const response = await loader({request: request()})
      expect(response.status).toBe(200)
      const png = Buffer.from(await response.arrayBuffer())
      const raw = await sharp(png).raw().toBuffer()

      // A request must have been made for the collision emoji's Twemoji SVG.
      const twemojiRequest = requestedUrls.find((u) => u.includes('twemoji@15.1.0/assets/svg/1f4a5.svg'))
      expect(twemojiRequest).toBeTruthy()

      // The rendered PNG must contain pure-red pixels from the Twemoji SVG.
      // (Inter has no red glyph; the tofu box is a neutral outline, not red.)
      const redPixels = countPixels(raw, (r, g, b) => r > 240 && g < 20 && b < 20)
      expect(redPixels).toBeGreaterThan(0)
    })
  })
})
