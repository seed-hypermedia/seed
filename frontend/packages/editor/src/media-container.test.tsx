// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const editorGate = {canEdit: false, isEditing: false, beginEditIfNeeded: vi.fn()}

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => editorGate,
}))

vi.mock('./blocknote/react/ReactBlockSpec', () => ({
  InlineContent: (props: any) => <span data-testid="inline-content" {...props} />,
}))

import {MediaContainer} from './media-container'

function makeBlock() {
  return {id: 'block-1', type: 'image', props: {}, content: [], children: []} as any
}

function makeEditor(isEditable: boolean) {
  return {
    isEditable,
    sideMenu: {blockDragStart: vi.fn(), blockDragEnd: vi.fn()},
    handleFileAttachment: undefined,
    commentEditor: false,
  } as any
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  editorGate.canEdit = false
  editorGate.isEditing = false
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
      <MediaContainer
        editor={editor}
        block={makeBlock()}
        mediaType="image"
        selected={false}
        setSelected={() => {}}
        assign={() => {}}
      >
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
})
