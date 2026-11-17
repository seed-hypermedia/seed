import {HMBlockNodeSchema, type HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {getCardNavigationTargets, getIndexedCardNavigationTargets} from './card-navigation'
import {hmId, latestId} from './entity-id-url'

function card(link: string): HMBlockNode {
  return HMBlockNodeSchema.parse({block: {id: link, type: 'Embed', link, attributes: {view: 'Card'}}})
}

describe('Card navigation', () => {
  it('walks nested blocks in document order and keeps the first occurrence of a document', () => {
    const nested = card('hm://other/zebra')
    nested.children = [card('hm://site/alpha')]
    expect(getCardNavigationTargets([nested, card('hm://other/zebra?v=old&l'), card('hm://site/beta')])).toEqual([
      latestId(hmId('other', {path: ['zebra']})),
      latestId(hmId('site', {path: ['alpha']})),
      latestId(hmId('site', {path: ['beta']})),
    ])
  })

  it('navigates to the whole latest document for Cards that follow the latest version', () => {
    expect(getCardNavigationTargets([card('hm://site/page?v=old&l#block'), card('hm://site/block#block')])).toEqual([
      latestId(hmId('site', {path: ['page']})),
      latestId(hmId('site', {path: ['block']})),
    ])
  })

  it('skips Cards pinned to a version', () => {
    expect(
      getCardNavigationTargets([card('hm://site/pinned?v=old'), card('hm://site/pinned-block?v=old#block')]),
    ).toEqual([])
  })

  it('lets a later latest Card place a document that an earlier pinned Card names', () => {
    expect(getCardNavigationTargets([card('hm://site/page?v=old'), card('hm://site/page')])).toEqual([
      latestId(hmId('site', {path: ['page']})),
    ])
  })

  it('ignores content embeds, inline links, queries, and invalid targets', () => {
    const content = card('hm://site/content')
    if (content.block.type === 'Embed') content.block.attributes.view = 'Content'
    const paragraph = HMBlockNodeSchema.parse({
      block: {
        id: 'text',
        type: 'Paragraph',
        text: 'Link',
        annotations: [{type: 'Link', link: 'hm://site/link', starts: [0], ends: [4]}],
      },
    })
    expect(getCardNavigationTargets([content, paragraph, card('not a link'), card('https://example.com')])).toEqual([])
  })

  it('reads indexed navigation Cards as latest document IDs, once each', () => {
    expect(getIndexedCardNavigationTargets(['hm://site/b', 'hm://site/a', 'hm://site/b/', 'not a link'])).toEqual([
      latestId(hmId('site', {path: ['b']})),
      latestId(hmId('site', {path: ['a']})),
    ])
  })
})
