import {beforeEach, expect, test, vi} from 'vitest'

const mocks = vi.hoisted(() => ({chunk: vi.fn(), process: vi.fn()}))
vi.mock('@seed-hypermedia/client', () => ({filesToIpfsBlobs: mocks.chunk}))
vi.mock('@shm/ui/image-processing', () => ({
  CONTENT_IMAGE_POLICY: {name: 'content'},
  processImageIfSupported: mocks.process,
}))

import {makeWebFileUpload} from './web-image-upload'

beforeEach(() => {
  mocks.process.mockReset()
  mocks.chunk.mockReset()
})

test('publishes bytes from the locally processed image', async () => {
  const original = new File(['heic'], 'photo.heic', {type: 'image/heic'})
  const processed = new File(['webp'], 'photo.webp', {type: 'image/webp'})
  mocks.process.mockResolvedValue(processed)
  mocks.chunk.mockResolvedValue({resultCIDs: ['cid'], blobs: [{cid: 'part', data: new Uint8Array([1])}]})
  const client = {publish: vi.fn()} as any

  await makeWebFileUpload(client)(original)

  expect(mocks.process).toHaveBeenCalledWith(original, {name: 'content'})
  expect(mocks.chunk).toHaveBeenCalledWith([new Uint8Array(await processed.arrayBuffer())])
})
