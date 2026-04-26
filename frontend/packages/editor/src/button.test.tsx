// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Required by react-dom 18 to suppress "not configured to support act(...)" warnings.
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const openUrl = vi.fn()
const editorGate = {canEdit: false, isEditing: false}

vi.mock('@shm/shared', () => ({
  useOpenUrl: () => openUrl,
}))

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => editorGate,
}))

import {ButtonBlockView} from './button-view'

function makeBlock(overrides: {url?: string; name?: string; alignment?: string} = {}) {
  return {
    id: 'block-1',
    type: 'button',
    props: {
      url: 'https://example.com/foo',
      name: 'Click me',
      alignment: 'flex-start',
      ...overrides,
    },
    content: [],
    children: [],
  } as any
}

function makeEditor() {
  return {
    _tiptapEditor: {
      on: vi.fn(),
      off: vi.fn(),
    },
    updateBlock: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({block: {id: 'block-1'}})),
  } as any
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  openUrl.mockReset()
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

function render(block: ReturnType<typeof makeBlock>, editor: ReturnType<typeof makeEditor> = makeEditor()) {
  act(() => {
    root.render(<ButtonBlockView block={block} editor={editor} />)
  })
  const el = container.querySelector('button')
  if (!el) throw new Error('Button element not rendered')
  return el
}

describe('ButtonBlockView', () => {
  it('navigates to the configured URL when clicked in read-only mode (canEdit=false)', () => {
    editorGate.canEdit = false
    editorGate.isEditing = false
    const button = render(makeBlock({url: 'https://example.com/page'}))

    act(() => {
      button.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openUrl).toHaveBeenCalledTimes(1)
    expect(openUrl).toHaveBeenCalledWith('https://example.com/page')
  })

  it('navigates when the user can edit but is not currently editing', () => {
    editorGate.canEdit = true
    editorGate.isEditing = false
    const button = render(makeBlock({url: 'https://example.com/page'}))

    act(() => {
      button.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openUrl).toHaveBeenCalledWith('https://example.com/page')
  })

  it('does not navigate when the editor is in edit mode', () => {
    editorGate.canEdit = true
    editorGate.isEditing = true
    const button = render(makeBlock({url: 'https://example.com/page'}))

    act(() => {
      button.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openUrl).not.toHaveBeenCalled()
  })

  it('does not attach a click handler when no URL is configured', () => {
    const button = render(makeBlock({url: ''}))

    act(() => {
      button.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(openUrl).not.toHaveBeenCalled()
  })
})
