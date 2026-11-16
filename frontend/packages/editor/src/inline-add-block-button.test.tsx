// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
class MockResizeObserver {
  observe = vi.fn()
  disconnect = vi.fn()
}
;(globalThis as any).ResizeObserver = MockResizeObserver
;(globalThis as any).requestAnimationFrame = (callback: FrameRequestCallback) => {
  callback(0)
  return 0
}
;(globalThis as any).cancelAnimationFrame = vi.fn()

import {InlineAddBlockButton} from './inline-add-block-button'

type SelectionContext = {
  depth: number
  parent: {isTextblock: boolean; childCount: number; type: {name: string; spec?: {code?: boolean}}}
  node: (depth: number) => {type: {name: string}; attrs: {listType: string}}
}

const emptyParagraph: SelectionContext = {
  depth: 1,
  parent: {isTextblock: true, childCount: 0, type: {name: 'paragraph', spec: {}}},
  node: () => ({type: {name: 'blockChildren'}, attrs: {listType: 'Group'}}),
}

function makeEditor(selectionContext: SelectionContext, cursorTop = 20) {
  const listeners = new Map<string, Set<() => void>>()
  return {
    isEditable: true,
    _tiptapEditor: {
      view: {
        dom: document.createElement('div'),
        state: {
          selection: {anchor: 1, $from: selectionContext},
          doc: {
            resolve: () => selectionContext,
          },
        },
        coordsAtPos: () => ({top: cursorTop, bottom: cursorTop + 8, left: 64}),
        focus: vi.fn(),
        dispatch: vi.fn(),
      },
      on: (event: string, cb: () => void) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event)!.add(cb)
      },
      off: (event: string, cb: () => void) => {
        listeners.get(event)?.delete(cb)
      },
    },
  } as any
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
})

describe('InlineAddBlockButton', () => {
  it('renders for an empty paragraph block', () => {
    const editor = makeEditor({
      depth: 1,
      parent: {isTextblock: true, childCount: 0, type: {name: 'paragraph', spec: {}}},
      node: () => ({type: {name: 'blockChildren'}, attrs: {listType: 'Group'}}),
    })

    act(() => {
      root.render(<InlineAddBlockButton editor={editor} />)
    })

    expect(document.body.querySelector('[aria-label="Insert block"]')).not.toBeNull()
  })

  it('stays fixed to the window, so it never makes the page scrollable', () => {
    act(() => {
      root.render(<InlineAddBlockButton editor={makeEditor(emptyParagraph)} />)
    })

    const button = document.body.querySelector<HTMLElement>('[aria-label="Insert block"]')!
    expect(button.parentElement!.style.position).toBe('fixed')
    expect(button.parentElement!.style.top).toBe('24px')
  })

  it('hides while its block is scrolled out of the editor pane', () => {
    // The editor scrolls inside a pane that shows window y 0-300; the empty block sits at y 500.
    const editor = makeEditor(emptyParagraph, 500)
    const pane = document.createElement('div')
    pane.style.overflowY = 'auto'
    pane.getBoundingClientRect = () => ({top: 0, bottom: 300}) as DOMRect
    pane.appendChild(editor._tiptapEditor.view.dom)
    document.body.appendChild(pane)

    act(() => {
      root.render(<InlineAddBlockButton editor={editor} />)
    })

    expect(document.body.querySelector('[aria-label="Insert block"]')).toBeNull()
  })

  it('does not render inside an image caption', () => {
    const editor = makeEditor({
      depth: 1,
      parent: {isTextblock: true, childCount: 0, type: {name: 'image', spec: {}}},
      node: () => ({type: {name: 'blockChildren'}, attrs: {listType: 'Group'}}),
    })

    act(() => {
      root.render(<InlineAddBlockButton editor={editor} />)
    })

    expect(document.body.querySelector('[aria-label="Insert block"]')).toBeNull()
  })
})
