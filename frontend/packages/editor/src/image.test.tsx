// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {renderToStaticMarkup} from 'react-dom/server'
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
  FALLBACK_EDITOR_WIDTH: 640,
}))

vi.mock('./media-container', () => ({
  MediaContainer: ({children, width, onHoverIn}: any) => (
    <div data-testid="media-container" data-width={width} style={{width}}>
      <button data-testid="show-resize-handles" onClick={onHoverIn} />
      {children}
    </div>
  ),
}))

import {ImageBlock, ImageDisplay} from './image'

function makeEditor(editorWidth = 390, importWebFile?: any) {
  return {
    domElement: {firstElementChild: {clientWidth: editorWidth}},
    importWebFile,
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
  it.each([
    ['', '100%'],
    ['70.36%', '70.36%'],
    ['36.23%', '36.23%'],
    ['320', '320px'],
  ])('renders saved width %s before layout and preserves it on later renders', (savedWidth, cssWidth) => {
    const editor = makeEditor(0)
    const block = makeBlock(savedWidth)
    const assign = vi.fn()
    const html = renderToStaticMarkup(<ImageDisplay editor={editor} block={block} assign={assign} />)
    const serverContainer = document.createElement('div')
    serverContainer.innerHTML = html
    expect((serverContainer.querySelector('[data-testid="media-container"]') as HTMLElement).style.width).toBe(cssWidth)

    act(() => root.render(<ImageDisplay editor={editor} block={block} assign={assign} />))
    const mediaContainer = container.querySelector('[data-testid="media-container"]') as HTMLElement
    expect(mediaContainer.style.width).toBe(cssWidth)

    // Node views can mount before the editor is attached. Hovering an image
    // while scrolling triggers a render after the real layout is available.
    editor.domElement.firstElementChild.clientWidth = 668
    act(() => (container.querySelector('[data-testid="show-resize-handles"]') as HTMLElement).click())
    expect(mediaContainer.style.width).toBe(cssWidth)

    editor.domElement.firstElementChild.clientWidth = 390
    act(() => root.render(<ImageDisplay editor={editor} block={block} assign={assign} />))
    expect(mediaContainer.style.width).toBe(cssWidth)
    expect(assign).not.toHaveBeenCalled()
  })

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

  it('persists explicit resize as a percentage of the available width', () => {
    const assign = vi.fn()
    const editor = makeEditor(390)

    act(() => {
      root.render(<ImageDisplay editor={editor} block={makeBlock()} assign={assign} />)
    })

    const media = container.querySelector('[data-testid="media-container"]') as HTMLElement
    vi.spyOn(media, 'getBoundingClientRect').mockReturnValue({width: 390} as DOMRect)
    Object.defineProperty(media.parentElement, 'clientWidth', {value: 390, configurable: true})

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

describe('pasted remote image import', () => {
  it('imports a remote image through the configured native boundary', async () => {
    const importWebFile = vi.fn().mockResolvedValue({cid: 'image-cid', type: 'image/jpeg', size: 12})
    const assign = vi.fn()

    await act(async () => {
      root.render(<ImageDisplay editor={makeEditor(390, importWebFile)} block={makeBlock()} assign={assign} />)
    })

    await vi.waitFor(() =>
      expect(assign).toHaveBeenCalledWith({props: {url: 'ipfs://image-cid'}}, {addToHistory: false}),
    )
    expect(importWebFile).toHaveBeenCalledWith('https://example.com/tall-mobile-screenshot.png')
  })

  it('keeps the original remote image when native import fails', async () => {
    const error = new Error('network failure')
    const importWebFile = vi.fn().mockRejectedValue(error)
    const assign = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await act(async () => {
      root.render(<ImageDisplay editor={makeEditor(390, importWebFile)} block={makeBlock()} assign={assign} />)
    })

    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledWith('Could not fetch image from URL:', error))
    expect(assign).not.toHaveBeenCalled()
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.com/tall-mobile-screenshot.png')

    consoleError.mockRestore()
  })

  it('parses external image attributes into an image block', () => {
    const wrapper = document.createElement('div')
    wrapper.innerHTML = '<p>before</p><img src="https://example.com/image.jpg" alt="alt text"><p>after</p>'
    const image = wrapper.querySelector('img')!
    const rule = ImageBlock.parseHTML[0]

    expect(rule.getAttrs?.(image)).toMatchObject({
      url: 'https://example.com/image.jpg',
      src: 'https://example.com/image.jpg',
      alt: 'alt text',
    })
    expect(wrapper.textContent).toBe('beforeafter')
  })
})
