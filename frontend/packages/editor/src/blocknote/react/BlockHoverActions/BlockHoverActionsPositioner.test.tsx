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

function renderPositioner() {
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
    prosemirrorView: {dom: editorDom},
  } as any

  act(() => {
    root.render(<BlockHoverActionsPositioner editor={editor} onCopyBlockLink={() => {}} onStartComment={() => {}} />)
  })

  return {plugin}
}

describe('BlockHoverActionsPositioner', () => {
  it('overlays actions on top of a supernumber badge', () => {
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
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
    expect(wrapper.style.left).toBe('32px')
    expect(wrapper.style.paddingLeft).toBe('')
    expect(container.querySelector('[data-bn-block-hover-bridge="true"]')).toBeNull()
    expect(block.classList.contains('bn-block-hover-highlight')).toBe(true)
  })

  it('pins the vertical actions inside the viewport when right placement would overflow', () => {
    Object.defineProperty(window, 'innerWidth', {value: 130, configurable: true})
    const block = document.createElement('div')
    block.dataset.id = 'block-1'
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
})
