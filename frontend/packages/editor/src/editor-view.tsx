import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  LinkMenuPositioner,
  SlashMenuPositioner,
} from "@/blocknote";
import "@/blocknote/core/style.css";
import "@/editor.css";
import type {HyperMediaEditor} from "@/types";

export function HyperMediaEditorView({
  editor,
  openUrl,
}: {
  editor: HyperMediaEditor;
  openUrl: (url: string, newWindow?: boolean) => void;
}) {
  return (
    <BlockNoteView editor={editor}>
      <FormattingToolbarPositioner
        editor={editor}
        // formattingToolbar={HMFormattingToolbar}
      />
      <HyperlinkToolbarPositioner
        // hyperlinkToolbar={HypermediaLinkToolbar}
        // hyperlinkToolbar={HypermediaLinkSwitchToolbar}
        editor={editor}
        openUrl={openUrl}
      />
      <SlashMenuPositioner editor={editor} />
      <LinkMenuPositioner editor={editor} />
    </BlockNoteView>
  );
}
