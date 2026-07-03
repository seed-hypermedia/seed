// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection} from 'prosemirror-state'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const editorGate = {canEdit: false, isEditing: false, beginEditIfNeeded: vi.fn()}
const fragmentActions = {current: null as any}

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => editorGate,
}))

vi.mock('./fragment-actions-context', () => ({
  useFragmentActions: () => fragmentActions.current,
}))

vi.mock('@shm/ui/tooltip', () => ({
  Tooltip: ({children}: any) => <>{children}</>,
}))

vi.mock('./blocknote/react/ReactBlockSpec', () => ({
  InlineContent: (props: any) => <span data-testid="inline-content" {...props} />,
}))

import {MediaContainer} from './media-container'

function makeBlock() {
  return {id: 'block-1', type: 'image', props: {}, content: [], children: []} as any
}

const schema = new Schema({
  nodes: {
    doc: {content: 'blockNode+'},
    blockNode: {
      group: 'blockNodeChild',
      attrs: {id: {default: ''}},
      content: 'block',
      toDOM: (node) => ['div', {'data-node-type': 'blockNode', 'data-id': node.attrs.id}, 0],
    },
    image: {
      group: 'block',
      content: 'inline*',
      selectable: true,
      toDOM: () => ['div', {'data-content-type': 'image'}, 0],
    },
    text: {group: 'inline'},
  },
})

function createSelectableEditorState() {
  const doc = schema.node('doc', null, [schema.node('blockNode', {id: 'block-1'}, [schema.node('image')])])
  return EditorState.create({schema, doc})
}

function makeEditor(isEditable: boolean, withView = false) {
  let state = createSelectableEditorState()
  const currentBlock = {id: 'block-1'}
  const nextBlock = {id: 'block-2'}
  const view = {
    get state() {
      return state
    },
    dispatch: vi.fn((tr) => {
      state = state.apply(tr)
    }),
    focus: vi.fn(),
  }

  return {
    isEditable,
    renderType: 'editor',
    sideMenu: {blockDragStart: vi.fn(), blockDragEnd: vi.fn()},
    handleFileAttachment: undefined,
    commentEditor: false,
    _tiptapEditor: withView ? {view} : undefined,
    __view: view,
    getTextCursorPosition: vi.fn(() => ({block: currentBlock, nextBlock})),
    setTextCursorPosition: vi.fn(),
    insertBlocks: vi.fn(),
    focus: vi.fn(),
    removeBlocks: vi.fn(),
  } as any
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  editorGate.canEdit = false
  editorGate.isEditing = false
  editorGate.beginEditIfNeeded.mockClear()
  fragmentActions.current = null
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

function renderImageContainer(editor: ReturnType<typeof makeEditor>) {
  act(() => {
    root.render(
      <MediaContainer editor={editor} block={makeBlock()} mediaType="image" assign={() => {}}>
        <div data-testid="media-child" />
      </MediaContainer>,
    )
  })
  const caption = container.querySelector('[data-testid="inline-content"]') as HTMLElement | null
  if (!caption) throw new Error('Caption not rendered')
  return caption
}

describe('MediaContainer image caption', () => {
  it('is not editable when the editor is not in edit mode', () => {
    const caption = renderImageContainer(makeEditor(false))
    expect(caption.getAttribute('contentEditable')).toBe('false')
  })

  it('is editable when the editor is in edit mode', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const caption = renderImageContainer(makeEditor(true))
    expect(caption.getAttribute('contentEditable')).toBe('true')
  })

  it('does not select the image block when the caption is clicked', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const editor = makeEditor(true, true)
    const caption = renderImageContainer(editor)

    act(() => {
      caption.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(editorGate.beginEditIfNeeded).not.toHaveBeenCalled()
    expect(editor.__view.dispatch).not.toHaveBeenCalled()
    expect(editor.__view.focus).not.toHaveBeenCalled()
    expect(editor.__view.state.selection instanceof NodeSelection).toBe(false)
  })

  it('still selects the image block when the media surface is clicked', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const editor = makeEditor(true, true)
    act(() => {
      root.render(
        <MediaContainer editor={editor} block={makeBlock()} mediaType="image" assign={() => {}}>
          <div data-testid="media-child" />
        </MediaContainer>,
      )
    })

    const mediaChild = container.querySelector('[data-testid="media-child"]') as HTMLElement
    act(() => {
      mediaChild.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(editorGate.beginEditIfNeeded).toHaveBeenCalledOnce()
    expect(editor.__view.dispatch).toHaveBeenCalledOnce()
    expect(editor.__view.focus).toHaveBeenCalledOnce()
    expect(editor.__view.state.selection instanceof NodeSelection).toBe(true)
  })

  it('moves to the next block when Enter is pressed in the image caption', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const editor = makeEditor(true)
    const caption = renderImageContainer(editor)

    const event = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})
    act(() => {
      caption.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith({id: 'block-2'}, 'start')
    expect(editor.insertBlocks).not.toHaveBeenCalled()
    expect(editor.focus).toHaveBeenCalledOnce()
  })

  it('creates a paragraph below the image when Enter is pressed in the last image caption', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const editor = makeEditor(true)
    const insertedBlock = {id: 'inserted-block'}
    editor.getTextCursorPosition
      .mockReturnValueOnce({block: {id: 'block-1'}, nextBlock: undefined})
      .mockReturnValueOnce({block: {id: 'block-1'}, nextBlock: insertedBlock})
    const caption = renderImageContainer(editor)

    const event = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true})
    act(() => {
      caption.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
    expect(editor.insertBlocks).toHaveBeenCalledWith([{type: 'paragraph', content: ''}], 'block-1', 'after')
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith(insertedBlock, 'start')
    expect(editor.focus).toHaveBeenCalledOnce()
  })

  it('lets Shift+Enter create a line break in the image caption', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const editor = makeEditor(true)
    const caption = renderImageContainer(editor)

    const event = new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true, bubbles: true, cancelable: true})
    act(() => {
      caption.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
    expect(editor.setTextCursorPosition).not.toHaveBeenCalled()
    expect(editor.insertBlocks).not.toHaveBeenCalled()
    expect(editor.focus).not.toHaveBeenCalled()
  })

  it('does not render copy or comment actions inside the media selection menu', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    fragmentActions.current = {
      onCopyFragmentLink: vi.fn(),
      onComment: vi.fn(),
      onCopyBlockLink: vi.fn(),
      onCommentOnBlock: vi.fn(),
    }
    const editor = makeEditor(true)

    act(() => {
      root.render(
        <MediaContainer editor={editor} block={makeBlock()} mediaType="image" assign={() => {}} onSubmitUrl={() => {}}>
          <div data-testid="media-child" />
        </MediaContainer>,
      )
    })

    expect(container.querySelector('[data-testid="image-selection-menu"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="image-more"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="image-copy-link"]')).toBeNull()
    expect(container.querySelector('[data-testid="image-comment"]')).toBeNull()
  })
})
