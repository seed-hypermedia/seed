import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const {resolveHypermediaUrlMock} = vi.hoisted(() => ({
  resolveHypermediaUrlMock: vi.fn(),
}))

vi.mock('@shm/shared/resolve-hm', () => ({
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

  it('returns null when the web url cannot be resolved', async () => {
    resolveHypermediaUrlMock.mockResolvedValue(null)

    await expect(resolveOmnibarUrlToHypermediaUrl('https://example.com/missing')).resolves.toBeNull()
  })
})
