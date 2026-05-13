import {Selection, TextSelection} from 'prosemirror-state'
import type {EditorView} from 'prosemirror-view'

/**
 * Read-only click guard for the document editor.
 *
 * When the editor is in read-only mode and the user has edit permission, a
 * click on the document body is what flips the unified document machine into
 * edit mode. If the user already has a selection (highlighted text, a selected
 * media block, or a multi-block selection) we want that click to dismiss the
 * selection instead — losing the selection on the way into edit mode is
 * surprising.
 *
 * Call site captures whether a non-empty ProseMirror selection existed at
 * mousedown (the browser collapses the selection to a cursor at the click
 * position before the `click` event fires, so we cannot reliably check at
 * click time). This helper performs the actual dismissal.
 *
 * @param view - The ProseMirror view backing the editor.
 * @param hadSelectionAtMousedown - True if `view.state.selection.empty` was
 *   false at the most recent mousedown.
 * @returns `true` if the click was consumed (selection cleared, caller should
 *   skip `edit.start`); `false` if the caller should fall through to its
 *   normal click handling.
 */
export function applyReadOnlyClickSelectionGuard(view: EditorView, hadSelectionAtMousedown: boolean): boolean {
  if (!hadSelectionAtMousedown) return false

  const sel = view.state.selection
  if (!sel.empty) {
    // Collapse the selection. For a TextSelection, `sel.from` is inside an
    // inline-content node, so a plain `TextSelection.create(doc, from)` is
    // valid. For a NodeSelection / MultipleNodeSelection, `sel.from` sits at
    // a block boundary where a TextSelection would be invalid; in that case
    // search for the nearest text-only position.
    const $from = view.state.doc.resolve(sel.from)
    const collapsed = $from.parent.inlineContent
      ? TextSelection.create(view.state.doc, sel.from)
      : Selection.findFrom($from, -1, true) ?? Selection.findFrom($from, 1, true)
    if (collapsed) {
      view.dispatch(view.state.tr.setSelection(collapsed))
    }
  }

  if (typeof window !== 'undefined') {
    window.getSelection()?.removeAllRanges()
  }

  return true
}

/**
 * Returns true when a pointer target should keep document edit mode active.
 *
 * The document editor exits edit mode when the user clicks outside the editable
 * document body, but editor-adjacent controls (publish button, popovers, links,
 * form fields, etc.) still need to receive clicks without disappearing first.
 */
export function shouldKeepEditModeForPointerTarget(target: EventTarget | null, editorRoot: HTMLElement): boolean {
  if (!(target instanceof Element)) return true
  if (editorRoot.contains(target)) return true
  return !!target.closest(
    [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[role="button"]',
      '[role="dialog"]',
      '[data-radix-popper-content-wrapper]',
      '[data-editor-keep-editing]',
    ].join(','),
  )
}
