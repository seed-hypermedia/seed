import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  LinkMenuPositioner,
  SideMenuPositioner,
  SlashMenuPositioner,
} from '@/editor/blocknote'
import '@/editor/blocknote/core/style.css'
import '@/editor/editor.css'
import {HMFormattingToolbar} from '@/editor/hm-formatting-toolbar'
import {HypermediaLinkSwitchToolbar} from '@/editor/hm-link-switch-toolbar'
// import {HypermediaLinkToolbar} from '@/editor/hyperlink-toolbar'
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
