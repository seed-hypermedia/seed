// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

import {InlineAddBlockButton} from './inline-add-block-button'

type SelectionContext = {
  depth: number
  parent: {isTextblock: boolean; childCount: number; type: {name: string}}
  node: (depth: number) => {type: {name: string}; attrs: {listType: string}}
}

function makeEditor(selectionContext: SelectionContext) {
  const listeners = new Map<string, Set<() => void>>()
  return {
    isEditable: true,
    _tiptapEditor: {
      view: {
        state: {
          selection: {anchor: 1},
          doc: {
            resolve: () => selectionContext,
          },
        },
        coordsAtPos: () => ({top: 20, bottom: 28, left: 64}),
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
      parent: {isTextblock: true, childCount: 0, type: {name: 'paragraph'}},
      node: () => ({type: {name: 'blockChildren'}, attrs: {listType: 'Group'}}),
    })

    act(() => {
      root.render(<InlineAddBlockButton editor={editor} />)
    })

    expect(document.body.querySelector('[aria-label="Insert block"]')).not.toBeNull()
  })

  it('does not render inside an image caption', () => {
    const editor = makeEditor({
      depth: 1,
      parent: {isTextblock: true, childCount: 0, type: {name: 'image'}},
      node: () => ({type: {name: 'blockChildren'}, attrs: {listType: 'Group'}}),
    })

    act(() => {
      root.render(<InlineAddBlockButton editor={editor} />)
    })

    expect(document.body.querySelector('[aria-label="Insert block"]')).toBeNull()
  })
})
