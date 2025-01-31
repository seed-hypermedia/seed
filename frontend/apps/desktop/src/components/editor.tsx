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
import {HypermediaLinkSwitchToolbar} from '@shm/editor/hm-link-switch-toolbar'
// import {HypermediaLinkToolbar} from '@shm/editor/hyperlink-toolbar'
import {HyperDocsEditor} from '@/models/documents'
import {useOpenUrl} from '@/open-url'

export function HyperMediaEditorView({
  editor,
  comment,
}: {
  editor: HyperDocsEditor
  comment: boolean
}) {
  const openUrl = useOpenUrl()
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
