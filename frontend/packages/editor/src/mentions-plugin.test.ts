import {describe, expect, it} from 'vitest'
import {createInlineEmbedNode, inlineEmbedClipboardText} from './mentions-plugin'

describe('inlineEmbedClipboardText', () => {
  it('serializes inline embeds to a non-empty clipboard fallback', () => {
    expect(inlineEmbedClipboardText('hm://uid1/docs/page')).toBe('hm://uid1/docs/page')
  })

  it('returns empty string when link is missing', () => {
    expect(inlineEmbedClipboardText('')).toBe('')
  })

  it('parses data-inline-embed anchors before generic links', () => {
    const parseRules = createInlineEmbedNode().config.parseHTML?.() || []

    expect(parseRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'a[data-inline-embed]',
          priority: 1000,
        }),
      ]),
    )
  })
})
