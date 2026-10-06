import {BlockNoteEditor} from '../blocknote/core/BlockNoteEditor'
import {describe, expect, it, vi} from 'vitest'
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

it.each(['paste', 'drop'])('filters hostile website HTML through the shared editor schema on %s', (operation) => {
  const editor = new BlockNoteEditor({initialContent: [{id: 'target', type: 'paragraph'}]})
  const view = editor._tiptapEditor.view
  document.body.appendChild(view.dom)
  const html = `<p onclick="alert(1)">Article
    <script>scriptPayload()</script>
    <a href="javascript:alert(1)">bad1</a>
    <a href="java&#x09;script:alert(1)">bad2</a>
    <a href="https://example.com" data-hm-link="javascript:alert(1)">bad3</a>
    <a href="data:text/html,scriptPayload()">bad4</a>
    <a href="https://example.com" data-inline-embed="javascript:alert(1)">bad5</a>
    <span data-inline-embed="java&#x09;script:alert(1)">bad6</span>
    <a href="https://example.com/safe">safe</a>
    <a href="hm://alice/docs" data-hm-link="hm://alice/docs">Seed</a>
  </p>`
  const getData = (type: string) => (type === 'text/html' ? html : '')
  try {
    if (operation === 'paste') {
      const event = new Event('paste', {bubbles: true, cancelable: true})
      Object.defineProperty(event, 'clipboardData', {value: {getData, items: [], files: []}})
      view.dom.dispatchEvent(event)
    } else {
      vi.spyOn(view, 'posAtCoords').mockReturnValue({pos: view.state.selection.from, inside: -1})
      const event = new MouseEvent('drop', {bubbles: true, cancelable: true})
      Object.defineProperty(event, 'dataTransfer', {value: {getData, types: ['text/html'], items: [], files: []}})
      view.dom.dispatchEvent(event)
    }
    expect(view.state.doc.textContent).toContain('Article')
    expect(view.state.doc.textContent).toContain('bad3')
    expect(view.state.doc.textContent).toContain('bad5')
    expect(view.state.doc.textContent).toContain('bad6')
    expect(view.state.doc.textContent).not.toContain('scriptPayload')
    const links: string[] = []
    view.state.doc.descendants((node) => {
      for (const mark of node.marks) if (mark.type.name === 'link') links.push(mark.attrs.href)
    })
    expect(links).toEqual(['https://example.com/safe', 'hm://alice/docs'])
    expect(view.dom.querySelector('[onclick], script')).toBeNull()
  } finally {
    editor._tiptapEditor.destroy()
    view.dom.remove()
    vi.restoreAllMocks()
  }
})
