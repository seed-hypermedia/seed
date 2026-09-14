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
})

describe('ReadOnlyViewer', () => {
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
