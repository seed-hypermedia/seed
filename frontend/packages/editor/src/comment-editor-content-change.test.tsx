// @vitest-environment jsdom
import {UniversalAppProvider} from '@shm/shared'
import {hmId} from '@shm/shared/utils/entity-id-url'
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Regression tests for #884: typing in long comments was slow because every
 * ProseMirror update synchronously serialized the whole document (an O(n²)
 * operation) to feed onContentChange. Serialization must now be debounced off
 * the keystroke path and flushed on blur/submit/unmount.
 */

// Counts full-document serializations: one call = one expensive conversion.
const serializeSpy = vi.hoisted(() => vi.fn(() => [{toJson: () => ({block: {id: 'b1', type: 'paragraph'}})}]))

vi.mock('./utils', () => ({
  serverBlockNodesFromEditorBlocks: serializeSpy,
  createMediaBlock: vi.fn(),
  handleDragMedia: vi.fn(),
  selectAllEditorContent: vi.fn(),
}))

const fakeEditorRef = vi.hoisted(() => ({current: null as any}))

vi.mock('./blocknote', () => ({
  BlockNoteEditor: class {},
  getBlockInfoFromPos: vi.fn(),
  useBlockNote: () => fakeEditorRef.current,
}))
vi.mock('./blocknote/core/extensions/SlashMenu/defaultSlashMenuItems', () => ({
  insertOrUpdateBlock: vi.fn(),
}))
vi.mock('./blocknote/core/extensions/DragMedia/DragExtension', () => ({
  FILE_DROP_INSERTED_EVENT: 'hm-file-drop-inserted',
}))
vi.mock('./blocknote/core/extensions/SlashMenu/SlashMenuPlugin', () => ({
  slashMenuPluginKey: {getState: () => undefined},
}))
vi.mock('./mention-suggestion-plugin', () => ({
  mentionSuggestionPluginKey: {getState: () => undefined},
}))
vi.mock('./editor-view', () => ({
  HyperMediaEditorView: () => <div data-testid="editor-view" />,
}))
vi.mock('./hypermedia-link-plugin', () => ({
  createHypermediaDocLinkPlugin: () => ({plugin: {}}),
}))
vi.mock('./mobile-mentions-dialog', () => ({MobileMentionsDialog: () => null}))
vi.mock('./mobile-slash-dialog', () => ({MobileSlashDialog: () => null}))
vi.mock('./schema', () => ({hmBlockSchema: {}}))
vi.mock('./slash-menu-items', () => ({getSlashMenuItems: () => []}))
vi.mock('./use-mobile', () => ({
  isMobileDevice: () => false,
  useMobile: () => false,
}))

import {CommentEditor, type CommentEditorSubmitHandle} from './comment-editor'

function createFakeEditor() {
  const handlers = new Map<string, Set<() => void>>()
  const dom = document.createElement('div')
  const editor: any = {
    topLevelBlocks: [{id: 'b1', type: 'paragraph', props: {}, content: [], children: []}],
    removeBlocks: vi.fn(),
    replaceBlocks: vi.fn(),
    insertBlocks: vi.fn(),
    _tiptapEditor: {
      on: (event: string, fn: () => void) => {
        if (!handlers.has(event)) handlers.set(event, new Set())
        handlers.get(event)!.add(fn)
      },
      off: (event: string, fn: () => void) => {
        handlers.get(event)?.delete(fn)
      },
      commands: {focus: vi.fn(), blur: vi.fn()},
      chain: () => ({focus: () => ({run: vi.fn()})}),
      view: {dom, state: {doc: {content: {size: 10}}}},
      state: {},
    },
  }
  return {
    editor,
    emit: (event: string) => {
      handlers.get(event)?.forEach((fn) => fn())
    },
  }
}

let container: HTMLDivElement
let root: Root
let fake: ReturnType<typeof createFakeEditor>
let onContentChange: ReturnType<typeof vi.fn>
let submitHandleRef: {current: CommentEditorSubmitHandle | null}

function renderCommentEditor() {
  act(() => {
    root.render(
      <UniversalAppProvider
        originHomeId={hmId('uid1')}
        openUrl={vi.fn()}
        openRoute={vi.fn()}
        openRouteNewWindow={vi.fn()}
        universalClient={{request: vi.fn(), publish: vi.fn()} as any}
      >
        <CommentEditor
          handleSubmit={vi.fn()}
          submitButton={() => <></>}
          onContentChange={onContentChange}
          submitHandleRef={submitHandleRef as any}
        />
      </UniversalAppProvider>,
    )
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  fake = createFakeEditor()
  fakeEditorRef.current = fake.editor
  onContentChange = vi.fn()
  submitHandleRef = {current: null}
  serializeSpy.mockClear()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
})

describe('CommentEditor content change emission (#884)', () => {
  it('does not serialize the document on each keystroke; emits once after the debounce', () => {
    renderCommentEditor()

    act(() => {
      for (let i = 0; i < 25; i++) fake.emit('update')
    })

    // Nothing expensive may run on the keystroke path.
    expect(serializeSpy).not.toHaveBeenCalled()
    expect(onContentChange).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    // 25 keystrokes collapse into a single serialization + emission.
    expect(serializeSpy).toHaveBeenCalledTimes(1)
    expect(onContentChange).toHaveBeenCalledTimes(1)
  })

  it('flushes the pending change immediately when the editor blurs', () => {
    renderCommentEditor()

    act(() => {
      fake.emit('update')
      fake.emit('blur')
    })

    expect(onContentChange).toHaveBeenCalledTimes(1)

    // The debounce timer must not fire a duplicate emission afterwards.
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onContentChange).toHaveBeenCalledTimes(1)
  })

  it('exposes flush() on the submit handle for submit-time freshness', () => {
    renderCommentEditor()

    act(() => {
      fake.emit('update')
    })
    expect(onContentChange).not.toHaveBeenCalled()

    act(() => {
      submitHandleRef.current?.flush()
    })
    expect(onContentChange).toHaveBeenCalledTimes(1)

    // flush with nothing pending is a no-op
    act(() => {
      submitHandleRef.current?.flush()
    })
    expect(onContentChange).toHaveBeenCalledTimes(1)
  })

  it('flushes the pending change on unmount so drafts are not lost', () => {
    renderCommentEditor()

    act(() => {
      fake.emit('update')
    })
    expect(onContentChange).not.toHaveBeenCalled()

    act(() => {
      root.unmount()
    })
    expect(onContentChange).toHaveBeenCalledTimes(1)
  })
})
