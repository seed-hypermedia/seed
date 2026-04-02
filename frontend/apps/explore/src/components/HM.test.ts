import {describe, expect, it} from 'vitest'
import {getTabSearchParams} from './Tabs'

describe('getTabSearchParams', () => {
  it('preserves existing params when switching tabs', () => {
    const nextParams = getTabSearchParams(new URLSearchParams('tab=document&v=bafy123&foo=bar'), 'versions')

    expect(nextParams.get('tab')).toBe('versions')
    expect(nextParams.get('v')).toBe('bafy123')
    expect(nextParams.get('foo')).toBe('bar')
  })
})
