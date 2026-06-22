// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const editor = {
    _tiptapEditor: {view: null},
    prosemirrorView: {state: {}, dispatch: vi.fn()},
  }
  return {
    editor,
    useBlockNote: vi.fn(() => editor),
    openUrl: vi.fn(),
    overlayProps: [] as Array<{editor: typeof editor; resolveImageUrl?: (url: string) => string}>,
  }
})

vi.mock('@shm/shared', async () => {
  const React = await import('react')
  return {
    hypermediaUrlToHref: () => null,
    RenderResourceProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
    useOpenUrl: () => mocks.openUrl,
    useUniversalAppContext: () => ({
      hmUrlHref: undefined,
      openRouteNewWindow: undefined,
      origin: undefined,
      originHomeId: undefined,
    }),
  }
})

vi.mock('@shm/ui/get-file-url', () => ({
  useImageUrl: () => (url: string) => `resolved:${url}`,
}))

vi.mock('./blocknote', () => ({
  useBlockNote: mocks.useBlockNote,
}))

vi.mock('./schema', () => ({
  hmBlockSchema: {},
}))

vi.mock('./readonly-blocknote-view', async () => {
  const React = await import('react')
  return {
    ReadOnlyBlockNoteView: ({children}: {children?: React.ReactNode}) => (
      <div data-testid="readonly-blocknote-view">{children}</div>
    ),
  }
})

vi.mock('./blocknote/react', () => ({
  ImageGalleryOverlay: (props: {editor: typeof mocks.editor; resolveImageUrl?: (url: string) => string}) => {
    mocks.overlayProps.push(props)
    return <div data-testid="image-gallery-overlay" data-resolved-src={props.resolveImageUrl?.('ipfs://image-cid')} />
  },
}))

import {ReadOnlyViewer} from './readonly-viewer'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  mocks.useBlockNote.mockClear()
  mocks.openUrl.mockClear()
  mocks.overlayProps.length = 0
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

describe('ReadOnlyViewer image gallery', () => {
  it('mounts the image gallery overlay with the viewer editor and resolved image URLs', () => {
    act(() => {
      root.render(<ReadOnlyViewer blocks={[]} commentStyle />)
    })

    const overlay = container.querySelector('[data-testid="image-gallery-overlay"]') as HTMLElement | null
    expect(overlay).not.toBeNull()
    expect(overlay?.dataset.resolvedSrc).toBe('resolved:ipfs://image-cid')
    expect(mocks.overlayProps).toHaveLength(1)
    expect(mocks.overlayProps[0]?.editor).toBe(mocks.editor)
  })
})
