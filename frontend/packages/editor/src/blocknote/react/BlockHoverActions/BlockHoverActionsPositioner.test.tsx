import {createRoot, Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {BlockHoverActionsState} from '../../core/extensions/BlockHoverActions/BlockHoverActionsPlugin'
import {BlockHoverActionsPositioner} from './BlockHoverActionsPositioner'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared/models/use-document-machine', () => ({
  useHideOnDocumentScroll: vi.fn(),
}))

type Listener = (state: BlockHoverActionsState) => void

let container: HTMLDivElement
let root: Root
let listeners: Listener[]
let editorDom: HTMLDivElement

beforeEach(() => {
  listeners = []
  editorDom = document.createElement('div')
  container = document.createElement('div')
  document.body.appendChild(editorDom)
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  editorDom.remove()
  container.remove()
})

function rect(top: number, right: number): DOMRect {
  return {
    top,
    right,
    bottom: top + 20,
    left: right - 100,
    width: 100,
    height: 20,
    x: right - 100,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function appendPublishedContent(block: HTMLElement) {
  const content = document.createElement('div')
  content.dataset.contentType = 'paragraph'
  content.dataset.revision = 'rev-1'
  block.appendChild(content)
}

function createDocFromEditorDom() {
  return {
    descendants: (callback: (node: any) => void | false) => {
      for (const block of Array.from(editorDom.querySelectorAll('[data-id]'))) {
        const revision = block.querySelector('[data-revision]')?.getAttribute('data-revision') || ''
        const shouldStop = callback({
          type: {name: 'blockNode'},
          attrs: {id: (block as HTMLElement).dataset.id},
          forEach: (childCallback: (child: any) => void) => {
            childCallback({type: {spec: {group: 'block'}}, attrs: {revision}})
          },
        })
        if (shouldStop === false) return
      }
    },
  }
}

function renderPositioner({
  onCopyBlockLink = () => {},
  onStartComment = () => {},
  isBlockReferenceable,
  getCommentCount,
  doc,
}: {
  onCopyBlockLink?: (blockId: string) => void
  onStartComment?: (blockId: string) => void
  isBlockReferenceable?: (blockId: string) => boolean
  getCommentCount?: (blockId: string) => number | undefined
  doc?: {descendants: (callback: (node: any) => void | false) => void}
} = {}) {
  const plugin = {
    onUpdate: (listener: Listener) => {
      listeners.push(listener)
      return () => {
        listeners = listeners.filter((item) => item !== listener)
      }
    },
    freeze: vi.fn(),
    unfreeze: vi.fn(),
  }
  const editor = {
    blockHoverActions: plugin,
    prosemirrorView: {dom: editorDom, state: {doc: doc ?? createDocFromEditorDom()}},
  } as any

  act(() => {
    root.render(
      <BlockHoverActionsPositioner
        editor={editor}
        onCopyBlockLink={onCopyBlockLink}
        onStartComment={onStartComment}
        isBlockReferenceable={isBlockReferenceable}
        getCommentCount={getCommentCount}
      />,
    )
  })

  return {plugin}
}

describe('BlockHoverActionsPositioner', () => {
  it('overlays actions on top of a supernumber badge', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    appendPublishedContent(block)
    editorDom.appendChild(block)

    const badge = document.createElement('button')
    badge.className = 'bn-supernumber-badge'
    badge.dataset.blockId = 'block-1'
    Object.defineProperty(badge, 'getBoundingClientRect', {
      value: () => rect(30, 124),
    })
    block.appendChild(badge)

    renderPositioner()

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    const copyButton = container.querySelector('[aria-label="Copy block link"]') as HTMLElement
    const card = copyButton.parentElement as HTMLElement
    const wrapper = card.parentElement as HTMLElement

    expect(card.className).toContain('flex-col')
    expect(wrapper.dataset.bnBlockHoverActions).toBe('true')
    expect(wrapper.style.left).toBe('24px')
    expect(wrapper.style.paddingLeft).toBe('')
    expect(container.querySelector('[data-bn-block-hover-bridge="true"]')).toBeNull()
    expect(block.classList.contains('bn-block-hover-highlight')).toBe(true)
  })

  it('pins the vertical actions inside the viewport when right placement would overflow', () => {
    Object.defineProperty(window, 'innerWidth', {value: 130, configurable: true})
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    appendPublishedContent(block)
    editorDom.appendChild(block)

    renderPositioner()

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    const copyButton = container.querySelector('[aria-label="Copy block link"]') as HTMLElement
    const wrapper = copyButton.parentElement?.parentElement as HTMLElement

    expect(wrapper.style.right).toBe('4px')
    expect(wrapper.style.left).toBe('')
    expect(wrapper.style.paddingLeft).toBe('')
  })

  it('uses ProseMirror block revision state when the DOM has no data-revision attribute', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    editorDom.appendChild(block)

    renderPositioner({
      doc: {
        descendants: (callback) => {
          callback({
            type: {name: 'blockNode'},
            attrs: {id: 'block-1'},
            forEach: (childCallback: (child: any) => void) => {
              childCallback({type: {spec: {group: 'block'}}, attrs: {revision: 'rev-1'}})
            },
          })
        },
      },
    })

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Copy block link"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Start comment"]')).not.toBeNull()
  })

  it('finds ProseMirror revisions inside the normal blockChildren document wrapper', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    editorDom.appendChild(block)

    const publishedBlock = {
      type: {name: 'blockNode'},
      attrs: {id: 'block-1'},
      forEach: (childCallback: (child: any) => void) => {
        childCallback({type: {spec: {group: 'block'}}, attrs: {revision: 'rev-1'}})
      },
      children: [],
    }
    const blockChildren = {
      type: {name: 'blockChildren'},
      attrs: {},
      children: [publishedBlock],
    }

    renderPositioner({
      doc: {
        descendants: (callback) => {
          const visit = (node: any) => {
            if (callback(node) === false) return
            node.children?.forEach(visit)
          }
          visit(blockChildren)
        },
      },
    })

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Copy block link"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Start comment"]')).not.toBeNull()
  })

  it('hides actions for blocks without a revision', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    const content = document.createElement('div')
    content.dataset.contentType = 'paragraph'
    block.appendChild(content)
    editorDom.appendChild(block)

    renderPositioner()

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Copy block link"]')).toBeNull()
    expect(container.querySelector('[aria-label="Start comment"]')).toBeNull()
  })

  it('shows actions for revised blocks that pass the caller-provided referenceable predicate', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    appendPublishedContent(block)
    editorDom.appendChild(block)

    renderPositioner({isBlockReferenceable: (blockId) => blockId === 'block-1'})

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Copy block link"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Start comment"]')).not.toBeNull()
  })

  it('requires a current revision even when the caller-provided predicate allows the block', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    editorDom.appendChild(block)

    renderPositioner({isBlockReferenceable: () => true})

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Copy block link"]')).toBeNull()
    expect(container.querySelector('[aria-label="Start comment"]')).toBeNull()
  })

  it('keeps editor focus stable when pressing hover action buttons', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    appendPublishedContent(block)
    editorDom.appendChild(block)

    const onCopyBlockLink = vi.fn()
    const onStartComment = vi.fn()
    renderPositioner({onCopyBlockLink, onStartComment})

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    const copyButton = container.querySelector('[aria-label="Copy block link"]') as HTMLElement
    const mouseDown = new MouseEvent('mousedown', {bubbles: true, cancelable: true})

    expect(copyButton.dispatchEvent(mouseDown)).toBe(false)
    expect(mouseDown.defaultPrevented).toBe(true)

    copyButton.click()
    ;(container.querySelector('[aria-label="Start comment"]') as HTMLElement).click()

    expect(onCopyBlockLink).toHaveBeenCalledWith('block-1')
    expect(onStartComment).toHaveBeenCalledWith('block-1')
  })

  it('renders the hovered block comment count under the comment button', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    appendPublishedContent(block)
    editorDom.appendChild(block)

    renderPositioner({getCommentCount: (blockId) => (blockId === 'block-1' ? 147 : 0)})

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Start comment"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="147 comments"]')?.textContent).toBe('147')
  })

  it('hides the comment count when the hovered block has no comments', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
    appendPublishedContent(block)
    editorDom.appendChild(block)

    renderPositioner({getCommentCount: () => 0})

    act(() => {
      listeners[0]({show: true, blockId: 'block-1', referenceRect: rect(30, 100)})
    })

    expect(container.querySelector('[aria-label="Start comment"]')).not.toBeNull()
    expect(container.querySelector('[aria-label$="comments"]')).toBeNull()
  })
})
