let nextEditorViewKey = 0
const editorViewKeys = new WeakMap<object, number>()

/**
 * Stable per-instance key for an editor. Assigning it as the `key` of tiptap's
 * `EditorContent` forces a remount whenever `useBlockNote` swaps in a new editor.
 *
 * Without it, @tiptap/react reuses the same `PureEditorContent` instance and its
 * `initialized` flag stays `true` from the previous editor, so the new editor's
 * `createNodeViews()` — called from `componentDidUpdate` — registers node views
 * through `flushSync`, which React rejects during a lifecycle method. Remounting
 * resets `initialized` to `false`, so registration happens synchronously instead.
 */
export function getEditorViewKey(editor: object): number {
  let key = editorViewKeys.get(editor)
  if (key === undefined) {
    key = nextEditorViewKey++
    editorViewKeys.set(editor, key)
  }
  return key
}
