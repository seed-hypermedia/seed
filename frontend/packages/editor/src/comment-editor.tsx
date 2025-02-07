import {YStack} from "@shm/ui";
import {BlockNoteEditor, useBlockNote} from "./blocknote";
import {HyperMediaEditorView} from "./editor-view";
import {hmBlockSchema} from "./schema";
export function CommentEditor() {
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
      <HyperMediaEditorView editor={editor} openUrl={() => {}} comment />
    </YStack>
  );
}

export function useCommentEditor() {
  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {},
    // linkExtensionOptions: {
    //   openOnClick: false,
    //   queryClient,
    //   grpcClient,
    //   openUrl,
    //   gwUrl,
    //   checkWebUrl: checkWebUrl.mutateAsync,
    // },

    // onEditorReady: (e) => {
    //   readyEditor.current = e;
    //   initDraft();
    // },
    blockSchema: hmBlockSchema,
    // slashMenuItems: slashMenuItems.filter(
    //   (item) => !["Nostr", "Query"].includes(item.name)
    // ),
    // onMentionsQuery: (query: string) => {
    //   inlineMentionsQuery(query);
    // },
    // _tiptapOptions: {
    //   extensions: [
    //     Extension.create({
    //       name: "hypermedia-link",
    //       addProseMirrorPlugins() {
    //         return [createHypermediaDocLinkPlugin({}).plugin];
    //       },
    //     }),
    //   ],
    // },
  });

  return {
    editor,
  };
}
