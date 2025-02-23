import {writeableStateStream} from "@shm/shared";
import {HMBlockNode} from "@shm/shared/hm-types";
import {queryClient} from "@shm/shared/models/query-client";
import {Tooltip, Trash, XStack} from "@shm/ui";
import {Button} from "@shm/ui/button";
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
  onDiscardDraft,
}: {
  onCommentSubmit: (content: HMBlockNode[]) => void;
  onDiscardDraft: () => void;
}) {
  const {editor} = useCommentEditor();
  return (
    <YStack gap="$3">
      <YStack
        marginTop="$1"
        borderRadius="$4"
        minHeight={105}
        bg="$color4"
        paddingHorizontal="$4"
        onPress={(e: MouseEvent) => {
          e.stopPropagation();
          editor._tiptapEditor.commands.focus();
        }}
        gap="$4"
        paddingBottom="$2"
      >
        <HyperMediaEditorView editor={editor} openUrl={() => {}} />
      </YStack>
      <XStack gap="$3" paddingHorizontal="$4" jc="flex-end">
        <Tooltip content="Discard Comment Draft">
          <Button theme="red" size="$2" onPress={onDiscardDraft} icon={Trash} />
        </Tooltip>
        <Button
          size="$2"
          theme="brand"
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
          Publish Comment
        </Button>
      </XStack>
    </YStack>
  );
}

const [setGwUrl, gwUrl] = writeableStateStream<string | null>(
  "https://hyper.media"
);

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
      gwUrl,
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
