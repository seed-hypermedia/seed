import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {resolveHypermediaUrlMock} = vi.hoisted(() => ({
  resolveHypermediaUrlMock: vi.fn(),
}))

vi.mock('@seed-hypermedia/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@seed-hypermedia/client')>()),
  resolveHypermediaUrl: resolveHypermediaUrlMock,
}))

import {resolveOmnibarUrlToHypermediaUrl, resolveOmnibarUrlToRoute} from '../omnibar-url'

describe('omnibar url resolution', () => {
  beforeEach(() => {
    resolveHypermediaUrlMock.mockReset()
  })

  it('returns hm urls unchanged when they are already parseable', async () => {
    await expect(resolveOmnibarUrlToHypermediaUrl('hm://uid1/:comments/comment123')).resolves.toBe(
      'hm://uid1/:comments/comment123',
    )
  })

  it('returns inspect hm urls unchanged when they are already parseable', async () => {
    await expect(resolveOmnibarUrlToHypermediaUrl('hm://inspect/uid1/:comments/comment123')).resolves.toBe(
      'hm://inspect/uid1/:comments/comment123',
    )
  })

  it('resolves web urls into hm urls using omnibar route logic', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({
      hmId: unpackHmId('hm://uid1/path#blk1'),
      panel: null,
    })

    await expect(resolveOmnibarUrlToHypermediaUrl('https://example.com/doc/:activity/citations#blk1')).resolves.toBe(
      'hm://uid1/path/:activity/citations#blk1',
    )
  })

  it('preserves omnibar panel handling when resolving web urls', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({
      hmId: unpackHmId('hm://uid1/path'),
      panel: 'comments/abc123',
    })

    await expect(resolveOmnibarUrlToHypermediaUrl('https://example.com/doc?panel=comments/abc123')).resolves.toBe(
      'hm://uid1/path?panel=comments/abc123',
    )
  })

  it('applies view terms to the resolved route', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({
      hmId: unpackHmId('hm://uid1/path'),
      panel: null,
    })

    await expect(resolveOmnibarUrlToRoute('https://example.com/doc/:collaborators')).resolves.toEqual({
      key: 'collaborators',
      id: unpackHmId('hm://uid1/path'),
    })
  })

  it('wraps resolved web urls in inspect routes when using inspect urls', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({
      hmId: unpackHmId('hm://uid1/path'),
      panel: null,
    })

    await expect(resolveOmnibarUrlToRoute('https://example.com/inspect/doc/:comments/comment123')).resolves.toEqual({
      key: 'inspect',
      id: unpackHmId('hm://uid1/path'),
      targetView: 'comments',
      targetOpenComment: 'comment123',
    })
  })

  it('parses inspect ipfs urls without resolution', async () => {
    await expect(resolveOmnibarUrlToRoute('hm://inspect/ipfs/bafy123/path/to/node')).resolves.toEqual({
      key: 'inspect-ipfs',
      ipfsPath: 'bafy123/path/to/node',
    })
  })

  it('returns null when the web url cannot be resolved', async () => {
    resolveHypermediaUrlMock.mockResolvedValue(null)

    await expect(resolveOmnibarUrlToHypermediaUrl('https://example.com/missing')).resolves.toBeNull()
  })
})
