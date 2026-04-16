import {useEffect} from 'react'
import {BlockNoteEditor, BlockSchema} from '../../core'
import {supernumbersPluginKey, SupernumbersData} from '../../core/extensions/Supernumbers/SupernumbersPlugin'

/**
 * Props for the `SupernumbersController` component.
 *
 * - `editor`              – the BlockNote editor instance whose plugin state is managed.
 * - `data`                – the current citation/comment counts keyed by block id.
 *                           Pass `null` to clear all badges.
 * - `onSupernumberClick`  – callback invoked with the block id when a badge is clicked.
 */
export type SupernumbersControllerProps<BSchema extends BlockSchema> = {
  editor: BlockNoteEditor<BSchema>
  data: SupernumbersData | null
  onSupernumberClick?: (blockId: string) => void
}

/**
 * Hook that synchronises `SupernumbersData` into the ProseMirror plugin and
 * wires up a delegated click listener on the editor DOM for badge clicks.
 *
 * Intended for use inside a React tree that has access to a `BlockNoteEditor`.
 * The `SupernumbersController` component is the recommended way to use this hook.
 *
 * @example
 * ```tsx
 * useSupernumbers(editor, citationData, (blockId) => {
 *   openSidePanel(blockId)
 * })
 * ```
 */
export function useSupernumbers<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  data: SupernumbersData | null,
  onSupernumberClick?: (blockId: string) => void,
): void {
  // Dispatch the latest data into the plugin whenever it changes.
  useEffect(() => {
    const view = editor._tiptapEditor.view
    if (!view) return

    if (data === null) {
      view.dispatch(view.state.tr.setMeta(supernumbersPluginKey, {type: 'clear'}))
    } else {
      view.dispatch(view.state.tr.setMeta(supernumbersPluginKey, {type: 'setData', data}))
    }
  }, [editor, data])

  // Attach a delegated click listener on the editor DOM element for badge clicks.
  useEffect(() => {
    if (!onSupernumberClick) return

    const editorDom = editor._tiptapEditor.view?.dom
    if (!editorDom) return

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const badge = target?.closest('.bn-supernumber-badge') as HTMLElement | null
      if (!badge) return

      const blockId = badge.dataset.blockId
      if (blockId) {
        event.preventDefault()
        event.stopPropagation()
        onSupernumberClick(blockId)
      }
    }

    editorDom.addEventListener('click', handleClick)
    return () => {
      editorDom.removeEventListener('click', handleClick)
    }
  }, [editor, onSupernumberClick])
}

/**
 * Render-less React component that manages supernumber badges in a BlockNote
 * editor.  Mount it anywhere inside the same React tree as the editor.
 *
 * On mount and whenever `data` changes, the component dispatches a `setData`
 * action to the ProseMirror supernumbers plugin.  When `data` is `null` all
 * badges are cleared.  A delegated click listener is attached to the editor
 * DOM so that `onSupernumberClick` is called with the block id whenever a
 * badge button is pressed.
 *
 * The plugin itself (`createSupernumbersPlugin`) must be registered separately
 * with the editor before this component is used.
 *
 * @example
 * ```tsx
 * <SupernumbersController
 *   editor={editor}
 *   data={citationCounts}
 *   onSupernumberClick={(blockId) => openCitationsPanel(blockId)}
 * />
 * ```
 */
export function SupernumbersController<BSchema extends BlockSchema>({
  editor,
  data,
  onSupernumberClick,
}: SupernumbersControllerProps<BSchema>): null {
  useSupernumbers(editor, data, onSupernumberClick)
  return null
}
