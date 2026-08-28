import type {HMNavigationItem} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'

vi.mock('@/components/edit-navigation-popover', () => ({HMDocURLInput: () => null}))
vi.mock('@/models/site', () => ({useUpdateHomeDocument: vi.fn()}))
vi.mock('@shm/shared/models/capabilities', () => ({useIsSiteOwner: vi.fn()}))
vi.mock('@shm/shared/models/entity', () => ({useResource: vi.fn()}))

import {getNavigationPreviewItems} from '../site-settings-navigation'

describe('getNavigationPreviewItems', () => {
  it('prepends Home without modifying persisted navigation items', () => {
    const configured: HMNavigationItem[] = [{id: 'about', type: 'Link', text: 'About', link: 'hm://about'}]

    const preview = getNavigationPreviewItems(configured)

    expect(preview.map((item) => item.text)).toEqual(['Home', 'About'])
    expect(configured.map((item) => item.text)).toEqual(['About'])
  })
})
