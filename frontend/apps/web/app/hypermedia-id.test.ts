import {describe, expect, it} from 'vitest'
import {getRequestResourceIds} from './hypermedia-id'

describe('getRequestResourceIds', () => {
  it('resolves space profile URLs to the addressed account resource and metadata id', () => {
    const result = getRequestResourceIds(new URL('https://example.com/:profile/profileUid'), 'spaceUid')

    expect(result?.loadResourceId.id).toBe('hm://profileUid')
    expect(result?.publicMetadataId.id).toBe('hm://profileUid/:profile')
  })

  it('resolves gateway profile URLs to the addressed account resource and metadata id', () => {
    const result = getRequestResourceIds(new URL('https://example.com/hm/spaceUid/:profile/profileUid'), 'gatewayUid')

    expect(result?.loadResourceId.id).toBe('hm://profileUid')
    expect(result?.publicMetadataId.id).toBe('hm://profileUid/:profile')
  })

  it('leaves normal document resource and metadata ids unchanged', () => {
    const result = getRequestResourceIds(new URL('https://example.com/docs/intro'), 'spaceUid')

    expect(result?.loadResourceId.id).toBe('hm://spaceUid/docs/intro')
    expect(result?.publicMetadataId.id).toBe('hm://spaceUid/docs/intro')
  })
})
