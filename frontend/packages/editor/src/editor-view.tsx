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
  const editable = editor.isEditable
  return (
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
      <MentionMenuPositioner editor={editor} perspectiveAccountUid={perspectiveAccountUid} />
    </BlockNoteView>
  )
}
