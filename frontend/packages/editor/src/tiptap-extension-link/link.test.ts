import {describe, expect, it} from 'vitest'
import {buildRenderedLinkAttributes, getLinkAttrsFromElement} from './link'

describe('link DOM round-tripping', () => {
  it('preserves canonical hm href in data-hm-link while rendering a platform href', () => {
    const attrs = buildRenderedLinkAttributes(
      {
        href: 'hm://uid1/docs/page',
        class: 'link',
      },
      (url) => (url === 'hm://uid1/docs/page' ? 'https://example.com/docs/page' : url),
    )

    expect(attrs.href).toBe('https://example.com/docs/page')
    expect(attrs['data-hm-link']).toBe('hm://uid1/docs/page')
    expect(attrs.class).toContain('text-link')
  })

  it('prefers data-hm-link over rendered href while parsing', () => {
    const element = document.createElement('a')
    element.setAttribute('href', 'https://example.com/docs/page')
    element.setAttribute('data-hm-link', 'hm://uid1/docs/page')
    element.setAttribute('class', 'link text-link')

    expect(getLinkAttrsFromElement(element)).toEqual({
      href: 'hm://uid1/docs/page',
      class: 'link text-link',
    })
  })

  it('falls back to href when no canonical raw attr is present', () => {
    const element = document.createElement('a')
    element.setAttribute('href', 'https://example.com/docs/page')

    expect(getLinkAttrsFromElement(element)).toEqual({
      href: 'https://example.com/docs/page',
    })
  })

  it('does not claim inline embed anchors as normal links', () => {
    const element = document.createElement('a')
    element.setAttribute('href', 'https://example.com/docs/page')
    element.setAttribute('data-hm-link', 'hm://uid1/docs/page')
    element.setAttribute('data-inline-embed', 'hm://uid1/docs/page')

    expect(getLinkAttrsFromElement(element)).toBe(false)
  })
})
