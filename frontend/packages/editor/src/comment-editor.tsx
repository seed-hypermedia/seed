import {writeableStateStream} from '@shm/shared'
import {HMBlockNode} from '@shm/shared/hm-types'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {queryClient} from '@shm/shared/models/query-client'
import {Button} from '@shm/ui/button'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {XStack, YStack} from '@tamagui/stacks'
import {Extension} from '@tiptap/core'
import {BlockNoteEditor, useBlockNote} from './blocknote'
import {HyperMediaEditorView} from './editor-view'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {hmBlockSchema} from './schema'
import {slashMenuItems} from './slash-menu-items'
import {serverBlockNodesFromEditorBlocks} from './utils'

export default function CommentEditor({
  onDiscardDraft,
  submitButton,
}: {
  onDiscardDraft?: () => void
  submitButton: (opts: {
    reset: () => void
    getContent: () => HMBlockNode[]
  }) => JSX.Element
}) {
  const {editor} = useCommentEditor()
  return (
    <YStack gap="$3">
      <YStack
        className="comment-editor"
        marginTop="$1"
        borderRadius="$4"
        minHeight={105}
        bg="$color4"
        paddingHorizontal="$4"
        onPress={(e: MouseEvent) => {
          const target = e.target as HTMLElement

          // Check if the clicked element is not an input, button, or textarea
          if (target.closest('input, textarea, select, button')) {
            return // Don't focus the editor in this case
          }
          e.stopPropagation()
          editor._tiptapEditor.commands.focus()
        }}
        gap="$4"
        paddingBottom="$2"
      >
        <HyperMediaEditorView editor={editor} openUrl={() => {}} />
      </YStack>
      <XStack gap="$3" paddingHorizontal="$4" jc="flex-end">
        {onDiscardDraft ? (
          <Tooltip content="Discard Comment Draft">
            <Button
              theme="red"
              size="$2"
              onPress={onDiscardDraft}
              icon={Trash}
            />
          </Tooltip>
        ) : null}
        {submitButton({
          reset: () => {
            editor.removeBlocks(editor.topLevelBlocks)
          },
          getContent: () => {
            const blocks = serverBlockNodesFromEditorBlocks(
              editor,
              editor.topLevelBlocks,
            )
            const commentContent = blocks.map((block) =>
              block.toJson(),
            ) as HMBlockNode[]
            return commentContent
          },
        })}
      </XStack>
    </YStack>
  )
}

const [setGwUrl, gwUrl] = writeableStateStream<string | null>(
  'https://hyper.media',
)

export function useCommentEditor() {
  const {onMentionsQuery} = useInlineMentions()

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
      (item) => !['Nostr', 'Query'].includes(item.name),
    ),
    onMentionsQuery,
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: 'hypermedia-link',
          addProseMirrorPlugins() {
            return [createHypermediaDocLinkPlugin({}).plugin]
          },
        }),
      ],
    },
  })

  return {
    editor,
  }
}
