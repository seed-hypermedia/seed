// @vitest-environment jsdom
import {createContext} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const mocked = vi.hoisted(() => ({
  selectCanEdit: Symbol('selectCanEdit'),
  selectIsEditing: Symbol('selectIsEditing'),
  actorRef: {
    send: vi.fn(),
    getSnapshot: () => ({matches: () => false}),
  },
  handlersRef: {current: null as any},
  editor: {
    isEditable: false,
    topLevelBlocks: [{id: 'existing-block', type: 'paragraph', content: ''}],
    replaceBlocks: vi.fn(),
    _tiptapEditor: {
      view: {
        isDestroyed: false,
        dom: null,
        focus: vi.fn(),
        dispatch: vi.fn(),
        domAtPos: () => ({node: null}),
        state: {
          doc: {
            firstChild: null,
            content: {size: 0},
          },
          selection: {
            empty: true,
            eq: () => true,
          },
          tr: {},
        },
      },
    },
  } as any,
}))

const {selectCanEdit, selectIsEditing, actorRef, handlersRef, editor} = mocked

vi.mock('@seed-hypermedia/client/hmblock-to-editorblock', () => ({
  hmBlocksToEditorContent: (blocks: unknown[]) => blocks,
}))

vi.mock('@shm/shared', () => ({
  RenderResourceProvider: ({children}: any) => children,
  hypermediaUrlToHref: () => null,
  useOpenUrl: () => vi.fn(),
  useUniversalAppContext: () => ({
    hmUrlHref: '',
    openRouteNewWindow: false,
    origin: '',
    originHomeId: '',
  }),
}))

vi.mock('@shm/shared/models/editor-handlers-context', () => ({
  useEditorHandlersRef: () => mocked.handlersRef,
}))

vi.mock('@shm/shared/models/use-document-machine', () => ({
  selectCanEdit: mocked.selectCanEdit,
  selectIsEditing: mocked.selectIsEditing,
  useDocumentMachineRef: () => mocked.actorRef,
  useDocumentSelector: (selector: unknown) => selector === mocked.selectCanEdit,
}))

vi.mock('@shm/shared/utils/child-draft-refs', () => ({
  collectChildDraftIds: () => [],
}))

vi.mock('@shm/ui/get-file-url', () => ({
  useImageUrl: () => vi.fn(),
}))

vi.mock('./blocknote', () => ({
  BlockHoverActionsPositioner: () => null,
  BlockNoteEditor: class {},
  BlockNoteView: ({children}: any) => <div>{children}</div>,
  FormattingToolbarPositioner: () => null,
  FullBlockSelectionObserver: () => null,
  HyperlinkToolbarPositioner: () => null,
  ImageGalleryOverlay: () => null,
  LinkMenuPositioner: () => null,
  RangeSelectionPositioner: () => null,
  SideMenuPositioner: () => null,
  SlashMenuPositioner: () => null,
  SupernumbersController: () => null,
  useBlockNote: () => mocked.editor,
}))

vi.mock('./blocknote/core/extensions/BlockHighlight/BlockHighlightPlugin', () => ({
  blockHighlightPluginKey: {},
}))

vi.mock('./blocknote/core/extensions/SlashMenu/defaultSlashMenuItems', () => ({
  insertOrUpdateBlock: vi.fn(),
}))

vi.mock('./click-edit-mode-guard', () => ({
  applyReadOnlyClickSelectionGuard: () => false,
  shouldKeepEditModeForPointerTarget: () => true,
}))

vi.mock('./draft-actions-context', () => ({
  useDraftActions: () => null,
}))

vi.mock('./fragment-actions-context', () => ({
  FragmentActionsContext: createContext(null),
}))

vi.mock('./hm-formatting-toolbar', () => ({
  HMFormattingToolbar: () => null,
}))

vi.mock('./hm-link-preview', () => ({
  HypermediaLinkPreview: () => null,
}))

vi.mock('./hypermedia-link-plugin', () => ({
  createHypermediaDocLinkPlugin: () => ({plugin: {}}),
}))

vi.mock('./inline-add-block-button', () => ({
  InlineAddBlockButton: () => null,
}))

vi.mock('./mention-menu-positioner', () => ({
  MentionMenuPositioner: () => null,
}))

vi.mock('./publish-required-dialog', () => ({
  PublishRequiredDialog: () => null,
}))

vi.mock('./schema', () => ({
  hmBlockSchema: {},
}))

vi.mock('./slash-menu-items', () => ({
  getSlashMenuItems: () => [],
}))

vi.mock('./utils', () => ({
  selectAllEditorContent: () => true,
}))

import {DocumentEditor} from './document-editor'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  editor._tiptapEditor.view.dom = document.createElement('div')
  editor._tiptapEditor.view.domAtPos = () => ({node: document.createElement('div')})
  const tr = {
    setSelection: vi.fn(() => tr),
    setMeta: vi.fn(() => tr),
    setNodeMarkup: vi.fn(() => tr),
  }
  editor._tiptapEditor.view.state.tr = tr
  editor._tiptapEditor.view.state.doc.firstChild = null
  editor._tiptapEditor.view.state.selection.empty = true
  editor.topLevelBlocks = [{id: 'existing-block', type: 'paragraph', content: ''}]
  editor.replaceBlocks.mockReset()
  editor.replaceBlocks.mockImplementation((_blocksToRemove: unknown[], blocksToInsert: unknown[]) => {
    editor.topLevelBlocks = blocksToInsert as any
  })
  editor._tiptapEditor.view.focus.mockClear()
  editor._tiptapEditor.view.dispatch.mockClear()
  actorRef.send.mockClear()
  handlersRef.current = null
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  document.body.innerHTML = ''
})

describe('DocumentEditor', () => {
  it('defers read-only content replacement to a microtask', async () => {
    act(() => {
      root.render(
        <DocumentEditor
          blocks={[{id: 'next-block', type: 'paragraph', content: ''}] as any}
          resourceId="hm://doc/test"
        />,
      )
    })

    expect(editor.replaceBlocks).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(editor.replaceBlocks).toHaveBeenCalledTimes(1)
    expect(editor.topLevelBlocks).toEqual([{id: 'next-block', type: 'paragraph', content: ''}])
  })

  it('defers machine-driven editor mutations to microtasks', async () => {
    act(() => {
      root.render(
        <DocumentEditor
          blocks={[{id: 'next-block', type: 'paragraph', content: ''}] as any}
          resourceId="hm://doc/test"
        />,
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    editor.isEditable = false
    editor.replaceBlocks.mockClear()

    act(() => {
      handlersRef.current.setEditable(true)
      handlersRef.current.applyInitialContent()
    })

    expect(editor.isEditable).toBe(false)
    expect(editor.replaceBlocks).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(editor.isEditable).toBe(true)
    expect(editor.replaceBlocks).toHaveBeenCalledTimes(1)
    expect(editor.topLevelBlocks).toEqual([{id: 'next-block', type: 'paragraph', content: ''}])
  })

  it('defers block highlight dispatch to a microtask', async () => {
    act(() => {
      root.render(
        <DocumentEditor
          blocks={[{id: 'next-block', type: 'paragraph', content: ''}] as any}
          resourceId="hm://doc/test"
          focusBlockId="next-block"
        />,
      )
    })

    expect(editor._tiptapEditor.view.dispatch).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(editor._tiptapEditor.view.dispatch).toHaveBeenCalledTimes(1)
  })

  it('defers root children type sync to a microtask', async () => {
    editor._tiptapEditor.view.state.doc.firstChild = {
      type: {name: 'blockChildren'},
      attrs: {listType: 'Group'},
    }

    act(() => {
      root.render(
        <DocumentEditor
          blocks={[{id: 'next-block', type: 'paragraph', content: ''}] as any}
          resourceId="hm://doc/test"
          rootChildrenType="Ordered"
        />,
      )
    })

    expect(editor._tiptapEditor.view.dispatch).not.toHaveBeenCalled()
    expect(editor._tiptapEditor.view.state.tr.setNodeMarkup).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(editor._tiptapEditor.view.state.tr.setNodeMarkup).toHaveBeenCalledTimes(1)
  })
})
