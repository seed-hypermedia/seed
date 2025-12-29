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
import {useEffect} from 'react'

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

  return (
    <BlockNoteView editor={editor}>
      <FormattingToolbarPositioner
        editor={editor}
        formattingToolbar={HMFormattingToolbar}
      />
      <HyperlinkToolbarPositioner
        // hyperlinkToolbar={HypermediaLinkToolbar}
        // @ts-expect-error
        hyperlinkToolbar={HypermediaLinkPreview}
        editor={editor}
        // @ts-expect-error
        openUrl={openUrl}
      />
      <SlashMenuPositioner editor={editor} />
      {comment ? null : <SideMenuPositioner editor={editor} placement="left" />}
      <LinkMenuPositioner editor={editor} />
    </BlockNoteView>
  )
}
