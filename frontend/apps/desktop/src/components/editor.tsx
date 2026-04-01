import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  LinkMenuPositioner,
  SideMenuPositioner,
  SlashMenuPositioner,
} from '@shm/editor/blocknote'
import '@shm/editor/blocknote/core/style.css'
import '@shm/editor/editor.css'
import {HMFormattingToolbar} from '@shm/editor/hm-formatting-toolbar'
import {HypermediaLinkPreview} from '@shm/editor/hm-link-preview'
import type {HyperMediaEditor} from '@shm/editor/types'
import {useUniversalAppContext} from '@shm/shared'
import {useEffect, useState} from 'react'
import {AddBlockAtEndButton} from './add-block-at-end-button'

export function HyperMediaEditorView({
  editor,
  comment,
  openUrl,
}: {
  editor: HyperMediaEditor
  comment?: boolean
  openUrl: (url: string, newWindow?: boolean) => void
}) {
  // Handle Cmd+B for bold when this editor is focused
  // Using useEffect directly to avoid issues with useListenAppEvent callback deps
  useEffect(() => {
    const unsubscribe = window.appWindowEvents?.subscribe((event) => {
      console.log('AppWindowEvent received in HyperMediaEditorView:', event)
      if (event.type === 'toggle_bold') {
        console.log('[toggle_bold] event received in editor')
        if (editor.isFocused()) {
          console.log('[toggle_bold] editor is focused, toggling bold')
          editor._tiptapEditor.commands.toggleBold()
        }
      }
    })
    return unsubscribe
  }, [editor])

  // Debug toggle state — forces re-render when toggled so toolbar suppression updates
  const [editableOverride, setEditableOverride] = useState<boolean | null>(null)
  const editable = editableOverride ?? editor.isEditable

  return (
    <>
      <BlockNoteView editor={editor}>
        {editable && (
          <>
            <FormattingToolbarPositioner editor={editor} formattingToolbar={HMFormattingToolbar} />
            <SlashMenuPositioner editor={editor} />
            <LinkMenuPositioner editor={editor} />
          </>
        )}
        <HyperlinkToolbarPositioner
          // @ts-expect-error
          hyperlinkToolbar={HypermediaLinkPreview}
          editor={editor}
          // @ts-expect-error
          openUrl={openUrl}
        />
        {editable && !comment ? <SideMenuPositioner editor={editor} placement="left" /> : null}
      </BlockNoteView>
      {editable && !comment ? <AddBlockAtEndButton editor={editor} /> : null}
      <EditorEditableToggle
        editor={editor}
        onToggle={(next) => {
          editor.isEditable = next
          setEditableOverride(next)
        }}
      />
    </>
  )
}

/**
 * Debug toggle for editor editable state.
 * Only renders when the developerTools experiment flag is enabled.
 */
function EditorEditableToggle({
  editor,
  onToggle,
}: {
  editor: HyperMediaEditor
  onToggle: (editable: boolean) => void
}) {
  const experiments = useUniversalAppContext().experiments
  if (!experiments?.developerTools) return null

  const editable = editor.isEditable
  return (
    <button
      onClick={() => onToggle(!editable)}
      className="fixed bottom-3 left-3 z-[9999] flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-neutral-100 shadow-lg transition-colors hover:bg-neutral-800 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      title="Toggle editor editable state (debug)"
    >
      <span
        className="inline-block size-2 rounded-full"
        style={{backgroundColor: editable ? '#22c55e' : '#ef4444'}}
      />
      {editable ? 'editable' : 'readOnly'}
    </button>
  )
}
