import {HMFormattingToolbar} from '@/editor/hm-formatting-toolbar'
import {HypermediaLinkSwitchToolbar} from '@/editor/hm-link-switch-toolbar'
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
// import {HypermediaLinkToolbar} from '@/editor/hyperlink-toolbar'
import type {HyperMediaEditor} from '@shm/editor/types'

export function HyperMediaEditorView({
  editor,
  comment,
  openUrl,
}: {
  editor: HyperMediaEditor
  comment?: boolean
  openUrl: (url: string, newWindow?: boolean) => void
}) {
  return (
    <BlockNoteView editor={editor}>
      <FormattingToolbarPositioner
        editor={editor}
        formattingToolbar={HMFormattingToolbar}
      />
      <HyperlinkToolbarPositioner
        // hyperlinkToolbar={HypermediaLinkToolbar}
        hyperlinkToolbar={HypermediaLinkSwitchToolbar}
        editor={editor}
        openUrl={openUrl}
      />
      <SlashMenuPositioner editor={editor} />
      {comment ? null : <SideMenuPositioner editor={editor} placement="left" />}
      <LinkMenuPositioner editor={editor} />
    </BlockNoteView>
  )
}
