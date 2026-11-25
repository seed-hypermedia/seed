// @vitest-environment jsdom
import {Schema} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {ImageGalleryPlugin} from './blocknote/core/extensions/ImageGallery/ImageGalleryPlugin'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const editor = {
    _tiptapEditor: {
      view: null,
      on: (_event: string, callback: () => void) => listeners.add(callback),
      off: (_event: string, callback: () => void) => listeners.delete(callback),
    },
    prosemirrorView: null as unknown as EditorView,
  }
  return {
    editor,
    listeners,
    useBlockNote: vi.fn(() => editor),
    openUrl: vi.fn(),
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
      ipfsFileUrl: 'https://files.example/ipfs',
    }),
  }
})

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

import {ReadOnlyViewer} from './readonly-viewer'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  const schema = new Schema({
    nodes: {
      doc: {content: 'blockNode+'},
      blockNode: {content: 'image', attrs: {id: {default: ''}}, toDOM: () => ['div', 0]},
      image: {attrs: {url: {default: ''}, name: {default: ''}}, toDOM: () => ['img']},
      text: {},
    },
  })
  const doc = schema.node(
    'doc',
    null,
    ['first', 'second'].map((id) =>
      schema.node('blockNode', {id}, [schema.node('image', {url: `ipfs://${id}`, name: id})]),
    ),
  )
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({doc, plugins: [ImageGalleryPlugin]}),
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr))
      mocks.listeners.forEach((callback) => callback())
    },
  })
  mocks.editor.prosemirrorView = view
  mocks.useBlockNote.mockClear()
  mocks.openUrl.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  mocks.editor.prosemirrorView.destroy()
  vi.useRealTimers()
})

describe('ReadOnlyViewer', () => {
  it('opens comment images, navigates between them, and closes with Escape', () => {
    act(() => {
      root.render(<ReadOnlyViewer blocks={[]} resourceKind="comment" commentStyle />)
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    const view = mocks.editor.prosemirrorView
    act(() => {
      ImageGalleryPlugin.props.handleDoubleClickOn!.call(
        ImageGalleryPlugin,
        view,
        1,
        view.state.doc.nodeAt(1)!,
        1,
        new MouseEvent('dblclick'),
        true,
      )
      vi.runAllTimers()
    })
    expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('https://files.example/ipfs/first')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight'}))
      vi.runAllTimers()
    })
    expect(document.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe('https://files.example/ipfs/second')

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}))
      vi.runAllTimers()
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('mounts the read-only editor with comment styling', () => {
    act(() => {
      root.render(<ReadOnlyViewer blocks={[]} commentStyle />)
    })

    expect(container.querySelector('[data-testid="readonly-blocknote-view"]')).not.toBeNull()
    expect(container.querySelector('.comment-editor.is-comment')).not.toBeNull()
    expect(mocks.useBlockNote).toHaveBeenCalledWith(
      expect.objectContaining({editable: false, renderType: 'viewer'}),
      expect.any(Array),
    )
  })
})
