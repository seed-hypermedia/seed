import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  LinkMenuPositioner,
  SlashMenuPositioner,
} from './blocknote'
import '@/blocknote/core/style.css'
import '@/editor.css'
import {HMFormattingToolbar} from './hm-formatting-toolbar'
import type {HyperMediaEditor} from './types'
import {HypermediaLinkPreview} from './hm-link-preview'

export function HyperMediaEditorView({
  editor,
  openUrl,
}: {
  editor: HyperMediaEditor
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
        // @ts-expect-error
        hyperlinkToolbar={HypermediaLinkPreview}
        editor={editor}
        // @ts-expect-error
        openUrl={openUrl}
      />
      <SlashMenuPositioner editor={editor} />
      {/* {comment ? null : <SideMenuPositioner editor={editor} placement="left" />} */}
      <LinkMenuPositioner editor={editor} />
    </BlockNoteView>
  )
}
