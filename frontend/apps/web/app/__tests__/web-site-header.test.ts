import {describe, expect, it, vi} from 'vitest'
import type {DocNavigationItem} from '@shm/ui/navigation'

vi.mock('@shm/shared', () => ({unpackHmId: vi.fn()}))
vi.mock('@shm/shared/models/capabilities', () => ({useCanSeePrivateDocs: vi.fn()}))
vi.mock('@shm/shared/constants', () => ({NOTIFY_SERVICE_HOST: ''}))
vi.mock('@shm/shared/models/entity', () => ({useDirectory: vi.fn(), useResource: vi.fn()}))
vi.mock('@shm/ui/hm-host-banner', () => ({HypermediaHostBanner: vi.fn()}))
vi.mock('@shm/ui/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/ui/navigation')>()
  return {...actual, getSiteNavDirectory: vi.fn()}
})
vi.mock('@shm/ui/site-header', () => ({SiteHeader: vi.fn()}))

import {resolveNavigationItems} from '../web-site-header'

function makeNavItem(name: string): DocNavigationItem {
  return {
    key: name,
    metadata: {name},
    isPublished: true,
  }
}

describe('resolveNavigationItems', () => {
  const homeNav = [makeNavItem('Home Nav 1'), makeNavItem('Home Nav 2')]
  const dirItems = [makeNavItem('Dir Item 1'), makeNavItem('Dir Item 2')]

  it('returns empty array while home resource is loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: true,
      homeNavigationItems: [],
      directoryItems: dirItems,
    })
    expect(result).toEqual([])
  })

  it('returns empty array while loading even if both have items', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: true,
      homeNavigationItems: homeNav,
      directoryItems: dirItems,
    })
    expect(result).toEqual([])
  })

  it('returns home navigation items when available after loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: homeNav,
      directoryItems: dirItems,
    })
    expect(result).toBe(homeNav)
  })

  it('falls back to directory items when no home navigation items after loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: [],
      directoryItems: dirItems,
    })
    expect(result).toBe(dirItems)
  })

  it('returns empty array when both are empty and loaded', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: [],
      directoryItems: [],
    })
    expect(result).toEqual([])
  })
})
