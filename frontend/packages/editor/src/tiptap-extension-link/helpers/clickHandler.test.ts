import {Schema} from '@tiptap/pm/model'
import {EditorState} from '@tiptap/pm/state'
import {describe, expect, it, vi} from 'vitest'
import {clickHandler} from './clickHandler'

const schema = new Schema({
  nodes: {
    doc: {content: 'text*'},
    text: {group: 'inline'},
  },
  marks: {
    link: {
      attrs: {href: {default: null}},
      parseDOM: [{tag: 'a[href]'}],
      toDOM(mark) {
        return ['a', {href: mark.attrs.href}, 0]
      },
    },
  },
})

function createView(editable: boolean) {
  return {
    editable,
    state: EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, schema.text('linked', [schema.marks.link.create({href: 'hm://abc'})])),
    }),
  } as any
}

function createClick(target: HTMLElement, init?: MouseEventInit) {
  const event = new MouseEvent('click', {button: 0, bubbles: true, cancelable: true, ...init})
  Object.defineProperty(event, 'target', {value: target})
  return event
}

describe('clickHandler', () => {
  it('opens read-only links with the platform openUrl handler', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl})
    const anchor = document.createElement('a')
    anchor.href = 'hm://abc'

    const event = createClick(anchor)
    const handled = plugin.props.handleDOMEvents?.click?.(createView(false), event)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).toHaveBeenCalledWith('hm://abc', false)
  })

  it('uses the rendered anchor href for inline embeds instead of the raw data-inline-embed URL', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl})
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/hm/abc'
    anchor.setAttribute('data-inline-embed', 'hm://abc')
    const mentionText = document.createElement('span')
    mentionText.className = 'link'
    anchor.appendChild(mentionText)

    const event = createClick(mentionText)
    const handled = plugin.props.handleDOMEvents?.click?.(createView(false), event)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).toHaveBeenCalledWith('https://example.com/hm/abc', false)
  })

  it('lets the browser handle modified clicks by default', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl})
    const anchor = document.createElement('a')
    anchor.href = 'hm://abc'

    const event = createClick(anchor, {metaKey: true})
    const handled = plugin.props.handleDOMEvents?.click?.(createView(false), event)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(false)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('opens modified clicks in a new window when platform handling is enabled', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl, handleModifiedClicks: true})
    const anchor = document.createElement('a')
    anchor.href = 'hm://abc'

    const event = createClick(anchor, {metaKey: true})
    const handled = plugin.props.handleDOMEvents?.click?.(createView(false), event)

    expect(handled).toBe(true)
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).toHaveBeenCalledWith('hm://abc', true)
  })

  it('keeps shift-click range selection from opening read-only links', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl, handleModifiedClicks: true})
    const anchor = document.createElement('a')
    anchor.href = 'hm://abc'

    const event = createClick(anchor, {shiftKey: true})
    const handled = plugin.props.handleDOMEvents?.click?.(createView(false), event)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('prevents native link navigation for shift-click range selection when platform handling is disabled', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl})
    const anchor = document.createElement('a')
    anchor.href = 'hm://abc'

    const event = createClick(anchor, {shiftKey: true})
    const handled = plugin.props.handleDOMEvents?.click?.(createView(false), event)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('keeps plain editable clicks in the editor', () => {
    const openUrl = vi.fn()
    const plugin = clickHandler({type: schema.marks.link, openUrl})
    const anchor = document.createElement('a')
    anchor.href = 'hm://abc'

    const event = createClick(anchor)
    const handled = plugin.props.handleDOMEvents?.click?.(createView(true), event)

    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(openUrl).not.toHaveBeenCalled()
  })
})
