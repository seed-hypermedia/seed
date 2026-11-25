import {beforeEach, expect, test, vi} from 'vitest'

const processing = vi.hoisted(() => ({process: vi.fn()}))
vi.mock('@shm/ui/image-processing', () => ({
  CONTENT_IMAGE_POLICY: {name: 'content'},
  processImageIfSupported: processing.process,
}))

import {fileUpload} from '../file-upload'

beforeEach(() => {
  processing.process.mockReset()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('cid', {status: 200})),
  )
})

test('uploads the locally processed image', async () => {
  const original = new File(['heic'], 'photo.heic', {type: 'image/heic'})
  const processed = new File(['webp'], 'photo.webp', {type: 'image/webp'})
  processing.process.mockResolvedValue(processed)

  await fileUpload(original)

  expect(processing.process).toHaveBeenCalledWith(original, {name: 'content'})
  const body = vi.mocked(fetch).mock.calls[0]![1]!.body as FormData
  expect(body.get('file')).toBe(processed)
})
