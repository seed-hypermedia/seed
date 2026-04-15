import '@/blocknote/core/style.css'
import '@/editor.css'
import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  LinkMenuPositioner,
  SlashMenuPositioner,
} from './blocknote'
import {HMFormattingToolbar} from './hm-formatting-toolbar'
import {HypermediaLinkPreview} from './hm-link-preview'
import {MentionMenuPositioner} from './mention-menu-positioner'
import type {HyperMediaEditor} from './types'

export function HyperMediaEditorView({
  editor,
  openUrl,
  perspectiveAccountUid,
}: {
  editor: HyperMediaEditor
  openUrl: (url: string, newWindow?: boolean) => void
  perspectiveAccountUid?: string | null
}) {
  return (
    <BlockNoteView editor={editor}>
      <FormattingToolbarPositioner editor={editor} formattingToolbar={HMFormattingToolbar} />
      <HyperlinkToolbarPositioner
        // hyperlinkToolbar={HypermediaLinkToolbar}
        // @ts-expect-error
        hyperlinkToolbar={HypermediaLinkPreview}
        editor={editor}
        // @ts-expect-error
        openUrl={openUrl}
      />
      <SlashMenuPositioner editor={editor} />
      <MentionMenuPositioner editor={editor} perspectiveAccountUid={perspectiveAccountUid} />
      {/* {comment ? null : <SideMenuPositioner editor={editor} placement="left" />} */}
      <LinkMenuPositioner editor={editor} />
    </BlockNoteView>
  )
}
