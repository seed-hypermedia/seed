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
import {HMFormattingToolbar} from "./hm-formatting-toolbar";
import {HypermediaLinkSwitchToolbar} from "./hm-link-switch-toolbar";

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
        formattingToolbar={HMFormattingToolbar}
      />
      <HyperlinkToolbarPositioner
        // hyperlinkToolbar={HypermediaLinkToolbar}
        hyperlinkToolbar={HypermediaLinkSwitchToolbar}
        editor={editor}
        openUrl={openUrl}
      />
      <SlashMenuPositioner editor={editor} />
      {/* {comment ? null : <SideMenuPositioner editor={editor} placement="left" />} */}
      <LinkMenuPositioner editor={editor} />
    </BlockNoteView>
  );
}
