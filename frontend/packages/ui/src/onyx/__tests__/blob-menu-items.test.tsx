import {describe, expect, it, vi} from 'vitest'
import {blobBuilderMenuItems, META_SCHEMA_CID, newBlobRoute, newInstanceRoute} from '../blob-menu-items'

describe('blob builder menu items', () => {
  it('New Blob and New Schema open the inspector in draft mode', () => {
    const navigate = vi.fn()
    const items = blobBuilderMenuItems(navigate)
    expect(items.map((i) => i.label)).toEqual(['New Blob', 'New Schema'])
    items[0]!.onClick!({} as any)
    expect(navigate).toHaveBeenLastCalledWith({key: 'inspect-ipfs', ipfsPath: 'new'})
    items[1]!.onClick!({} as any)
    expect(navigate).toHaveBeenLastCalledWith({key: 'inspect-ipfs', ipfsPath: `new/${META_SCHEMA_CID}`})
    expect(META_SCHEMA_CID).toMatch(/^bafy/)
  })
  it('route helpers', () => {
    expect(newBlobRoute()).toEqual({key: 'inspect-ipfs', ipfsPath: 'new'})
    expect(newInstanceRoute('bafyX')).toEqual({key: 'inspect-ipfs', ipfsPath: 'new/bafyX'})
  })
})
