import {describe, expect, it} from 'vitest'
import {getIndexedCardNavigationTargets} from './card-navigation'
import {hmId, latestId} from './entity-id-url'

describe('Card navigation', () => {
  it('reads indexed navigation Cards as latest document IDs, once each', () => {
    expect(getIndexedCardNavigationTargets(['hm://site/b', 'hm://site/a', 'hm://site/b/', 'not a link'])).toEqual([
      latestId(hmId('site', {path: ['b']})),
      latestId(hmId('site', {path: ['a']})),
    ])
  })
})
