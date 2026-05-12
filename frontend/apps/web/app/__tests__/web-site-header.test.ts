import {describe, expect, it, vi} from 'vitest'
import type {DocNavigationItem} from '@shm/ui/navigation'

vi.mock('@shm/shared', () => ({unpackHmId: vi.fn()}))
vi.mock('@shm/shared/constants', () => ({NOTIFY_SERVICE_HOST: ''}))
vi.mock('@shm/shared/models/entity', () => ({useResource: vi.fn()}))
vi.mock('@shm/ui/hm-host-banner', () => ({HypermediaHostBanner: vi.fn()}))
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

  it('returns empty array while home resource is loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: true,
      homeNavigationItems: homeNav,
    })
    expect(result).toEqual([])
  })

  it('returns home navigation items when available after loading', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: homeNav,
    })
    expect(result).toBe(homeNav)
  })

  it('returns empty array when there is no explicit top navigation', () => {
    const result = resolveNavigationItems({
      isHomeResourceLoading: false,
      homeNavigationItems: [],
    })
    expect(result).toEqual([])
  })
})
