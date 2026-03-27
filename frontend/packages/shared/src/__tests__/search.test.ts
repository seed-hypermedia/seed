import {beforeEach, describe, expect, it, vi} from 'vitest'
import {unpackHmId} from '../utils'

const {resolveHypermediaUrlMock} = vi.hoisted(() => ({
  resolveHypermediaUrlMock: vi.fn(),
}))

vi.mock('../resolve-hm', () => ({
  resolveHypermediaUrl: resolveHypermediaUrlMock,
}))

import {search} from '../models/entity'

describe('search', () => {
  beforeEach(() => {
    resolveHypermediaUrlMock.mockReset()
  })

  it('routes root hm urls without adding an undefined path segment', async () => {
    await expect(search('hm://uid1')).resolves.toEqual({
      destination: '/hm/uid1',
    })
    expect(resolveHypermediaUrlMock).not.toHaveBeenCalled()
  })

  it('preserves versions from hm urls', async () => {
    await expect(search('hm://uid1/path?v=version1')).resolves.toEqual({
      destination: '/hm/uid1/path?v=version1',
    })
    expect(resolveHypermediaUrlMock).not.toHaveBeenCalled()
  })

  it('resolves https urls into hm destinations without a null version query', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({
      hmId: unpackHmId('hm://uid1/path'),
    })

    await expect(search('https://example.com/path')).resolves.toEqual({
      destination: '/hm/uid1/path',
    })
    expect(resolveHypermediaUrlMock).toHaveBeenCalledWith('https://example.com/path')
  })

  it('preserves resolved versions from https urls', async () => {
    resolveHypermediaUrlMock.mockResolvedValue({
      hmId: unpackHmId('hm://uid1/path?v=version2'),
    })

    await expect(search('https://example.com/path')).resolves.toEqual({
      destination: '/hm/uid1/path?v=version2',
    })
  })
})
