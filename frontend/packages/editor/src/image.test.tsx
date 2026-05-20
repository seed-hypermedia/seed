// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const editorGate = {canEdit: true, isEditing: true, beginEditIfNeeded: vi.fn()}

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => editorGate,
}))

vi.mock('@shm/ui/get-file-url', () => ({
  useImageUrl: () => (url: string) => `resolved:${url}`,
}))

vi.mock('@shm/ui/resize-handle', () => ({
  ResizeHandle: ({onMouseDown, style}: any) => (
    <div
      data-testid={style?.left !== undefined ? 'left-resize-handle' : 'right-resize-handle'}
      onMouseDown={onMouseDown}
    />
  ),
}))

vi.mock('@shm/ui/toast', () => ({
  toast: {error: vi.fn()},
}))

vi.mock('./blocknote/react', () => ({
  createReactBlockSpec: (config: any) => config,
}))

vi.mock('./media-render', () => ({
  MediaRender: () => null,
}))

vi.mock('./media-container', () => ({
  MediaContainer: ({children, width, onHoverIn}: any) => (
    <div data-testid="media-container" data-width={width}>
      <button data-testid="show-resize-handles" onClick={onHoverIn} />
      {children}
    </div>
  ),
}))

import {ImageDisplay} from './image'

function makeEditor(editorWidth = 390) {
  return {
    domElement: {firstElementChild: {clientWidth: editorWidth}},
    importWebFile: undefined,
    isEditable: true,
    renderType: 'editor',
    setTextCursorPosition: vi.fn(),
  } as any
}

function makeBlock(width = '') {
  return {
    id: 'block-1',
    type: 'image',
    props: {
      url: 'https://example.com/tall-mobile-screenshot.png',
      width,
      name: '',
      alt: '',
      displaySrc: '',
      mediaRef: '',
    },
    content: [],
    children: [],
  } as any
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  editorGate.canEdit = true
  editorGate.isEditing = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('ImageDisplay responsive sizing', () => {
  it('keeps default images full-width and uses the 600px height cap as a CSS hint only', () => {
    const assign = vi.fn()

    act(() => {
      root.render(<ImageDisplay editor={makeEditor()} block={makeBlock()} assign={assign} />)
    })

    const mediaContainer = container.querySelector('[data-testid="media-container"]') as HTMLElement
    const image = container.querySelector('img') as HTMLImageElement

    expect(mediaContainer.dataset.width).toBe('100%')
    expect(image.style.width).toBe('100%')
    expect(image.style.height).toBe('auto')
    expect(image.style.maxHeight).toBe('600px')
    expect(image.style.objectFit).toBe('contain')

    act(() => {
      image.dispatchEvent(new Event('load'))
    })

    expect(assign).not.toHaveBeenCalled()
  })

  it('persists explicit resize as a percentage of the editor width', () => {
    const assign = vi.fn()
    const editor = makeEditor(390)

    act(() => {
      root.render(<ImageDisplay editor={editor} block={makeBlock()} assign={assign} />)
    })

    const showHandles = container.querySelector('[data-testid="show-resize-handles"]') as HTMLElement
    act(() => {
      showHandles.click()
    })

    const rightHandle = container.querySelector('[data-testid="right-resize-handle"]') as HTMLElement
    act(() => {
      rightHandle.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: 0}))
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', {clientX: -45}))
    })
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}))
    })

    expect(assign).toHaveBeenCalledWith({
      props: {
        width: '76.92%',
      },
    })
  })
})
