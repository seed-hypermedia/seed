import {Schema} from 'prosemirror-model'
import {EditorState, NodeSelection, TextSelection} from 'prosemirror-state'
import {EditorView} from 'prosemirror-view'
import {beforeEach, describe, expect, it} from 'vitest'
import {applyReadOnlyClickSelectionGuard, shouldKeepEditModeForPointerTarget} from './click-edit-mode-guard'

/**
 * Regression tests for the "click while selecting" guard wired into the
 * read-only click handler in `document-editor.tsx`. The guard suppresses
 * `edit.start` when the user clicks while a non-empty ProseMirror selection
 * is active and clears the selection instead.
 */

function createSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {content: 'block+'},
      paragraph: {
        content: 'text*',
        group: 'block',
        toDOM() {
          return ['p', 0]
        },
      },
      image: {
        group: 'block',
        atom: true,
        attrs: {src: {default: ''}},
        toDOM(node) {
          return ['img', {src: node.attrs.src}]
        },
      },
      text: {group: 'inline'},
    },
  })
}

function createView(schema: Schema, editable: boolean): EditorView {
  const para = schema.nodes['paragraph']!.create(null, schema.text('hello world'))
  const img = schema.nodes['image']!.create({src: 'about:blank'})
  const doc = schema.nodes['doc']!.create(null, [para, img])
  const state = EditorState.create({doc, schema})
  const container = document.createElement('div')
  return new EditorView(container, {
    state,
    editable: () => editable,
  })
}

describe('applyReadOnlyClickSelectionGuard', () => {
  let view: EditorView

  beforeEach(() => {
    view = createView(createSchema(), false)
  })

  it('returns false and leaves selection alone when nothing was selected at mousedown', () => {
    const before = view.state.selection
    expect(before.empty).toBe(true)

    const consumed = applyReadOnlyClickSelectionGuard(view, false)

    expect(consumed).toBe(false)
    expect(view.state.selection).toBe(before)
  })

  it('clears a non-empty TextSelection and returns true', () => {
    const tr = view.state.tr
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1, 6)))
    expect(view.state.selection.empty).toBe(false)

    const consumed = applyReadOnlyClickSelectionGuard(view, true)

    expect(consumed).toBe(true)
    expect(view.state.selection.empty).toBe(true)
  })

  it('clears a NodeSelection (e.g. on a media block) and returns true', () => {
    // The image node sits right after the paragraph; its position is the
    // paragraph's nodeSize.
    const para = view.state.doc.firstChild!
    const imagePos = para.nodeSize
    const tr = view.state.tr
    view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, imagePos)))
    expect(view.state.selection.empty).toBe(false)
    expect(view.state.selection instanceof NodeSelection).toBe(true)

    const consumed = applyReadOnlyClickSelectionGuard(view, true)

    expect(consumed).toBe(true)
    expect(view.state.selection.empty).toBe(true)
  })

  it('clears window.getSelection() ranges when invoked', () => {
    // Stand up a native browser selection over a separate DOM node so we can
    // observe removeAllRanges() running.
    const span = document.createElement('span')
    span.textContent = 'pick me'
    document.body.appendChild(span)
    const range = document.createRange()
    range.selectNodeContents(span)
    const winSel = window.getSelection()!
    winSel.removeAllRanges()
    winSel.addRange(range)
    expect(winSel.rangeCount).toBe(1)

    // Force a non-empty PM selection so the guard takes its full path.
    const tr = view.state.tr
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1, 6)))

    applyReadOnlyClickSelectionGuard(view, true)

    expect(window.getSelection()?.rangeCount ?? 0).toBe(0)

    document.body.removeChild(span)
  })

  it('is a no-op when hadSelectionAtMousedown is false even if selection is non-empty', () => {
    // Edge case: the caller didn't capture a selection at mousedown. We trust
    // the caller — this preserves the "drag-then-click" path where a fresh
    // selection should not be wiped on the very same click.
    const tr = view.state.tr
    view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 1, 6)))
    const before = view.state.selection

    const consumed = applyReadOnlyClickSelectionGuard(view, false)

    expect(consumed).toBe(false)
    expect(view.state.selection).toBe(before)
  })
})

describe('shouldKeepEditModeForPointerTarget', () => {
  it('keeps edit mode for clicks inside the editor root', () => {
    const root = document.createElement('div')
    const child = document.createElement('p')
    root.appendChild(child)

    expect(shouldKeepEditModeForPointerTarget(child, root)).toBe(true)
  })

  it('keeps edit mode for interactive controls outside the editor root', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    const popover = document.createElement('div')
    const popoverChild = document.createElement('span')
    popover.setAttribute('data-radix-popper-content-wrapper', '')
    popover.appendChild(popoverChild)

    expect(shouldKeepEditModeForPointerTarget(button, root)).toBe(true)
    expect(shouldKeepEditModeForPointerTarget(popoverChild, root)).toBe(true)
  })

  it('exits edit mode for non-interactive clicks outside the editor root', () => {
    const root = document.createElement('div')
    const outside = document.createElement('div')

    expect(shouldKeepEditModeForPointerTarget(outside, root)).toBe(false)
  })
})
