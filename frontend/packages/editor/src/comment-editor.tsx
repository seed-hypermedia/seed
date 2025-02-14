import {queryClient} from "@shm/shared/models/query-client";
import {HMBlockNode} from "@shm/shared/src/hm-types";
import {Button} from "@shm/ui/src/button";
import {YStack} from "@tamagui/stacks";
import {Extension} from "@tiptap/core";
import {BlockNoteEditor, useBlockNote} from "./blocknote";
import {HyperMediaEditorView} from "./editor-view";
import {createHypermediaDocLinkPlugin} from "./hypermedia-link-plugin";
import {hmBlockSchema} from "./schema";
import {slashMenuItems} from "./slash-menu-items";
import {serverBlockNodesFromEditorBlocks} from "./utils";

export default function CommentEditor({
  onCommentSubmit,
}: {
  onCommentSubmit: (content: HMBlockNode[]) => void;
}) {
  const {editor} = useCommentEditor();
  return (
    <YStack
      f={1}
      marginTop="$1"
      paddingHorizontal="$4"
      onPress={(e: MouseEvent) => {
        e.stopPropagation();
        editor._tiptapEditor.commands.focus();
      }}
      gap="$4"
      paddingBottom="$2"
    >
      <HyperMediaEditorView editor={editor} openUrl={() => {}} />
      <Button
        onPress={() => {
          const blocks = serverBlockNodesFromEditorBlocks(
            editor,
            editor.topLevelBlocks
          );
          const commentContent = blocks.map((block) =>
            block.toJson()
          ) as HMBlockNode[];
          onCommentSubmit(commentContent);
        }}
      >
        Submit
      </Button>
    </YStack>
  );
}

export function useCommentEditor() {
  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      // console.log("editor content changed", editor.topLevelBlocks);
    },
    linkExtensionOptions: {
      openOnClick: false,
      queryClient,
      // grpcClient,
      // openUrl,
      // gwUrl,
      // checkWebUrl: checkWebUrl.mutateAsync,
    },

    // onEditorReady: (e) => {
    //   readyEditor.current = e;
    //   initDraft();
    // },
    blockSchema: hmBlockSchema,
    slashMenuItems: slashMenuItems.filter(
      (item) => !["Nostr", "Query"].includes(item.name)
    ),
    // onMentionsQuery: (query: string) => {
    //   inlineMentionsQuery(query);
    // },
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: "hypermedia-link",
          addProseMirrorPlugins() {
            return [createHypermediaDocLinkPlugin({}).plugin];
          },
        }),
      ],
    },
  });

  return {
    editor,
  };
}
