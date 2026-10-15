import {Struct} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import {Document} from '@shm/shared/client'
import sharp from 'sharp'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {getDocument} = vi.hoisted(() => ({getDocument: vi.fn()}))
vi.mock('@/client.server', () => ({grpcClient: {documents: {getDocument}}}))

import {loader} from '../routes/hm.api.content-image'

const account = 'z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS'
const author = 'z6MkqVHQ4tp58QkZ6jSRamtQHNkZyJvACvtDfWEm9U5xWypK'
const request = () => new Request(`https://example.com/hm/api/content-image?space=${account}&version=test-version`)

describe('content image', () => {
  beforeEach(() => vi.resetAllMocks())

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
})
