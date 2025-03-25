import {EditorBlock, writeableStateStream} from '@shm/shared'
import {HMBlockNode} from '@shm/shared/hm-types'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {queryClient} from '@shm/shared/models/query-client'
import {Button} from '@shm/ui/button'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {XStack, YStack} from '@tamagui/stacks'
import {Extension} from '@tiptap/core'
import {useState} from 'react'
import {useDocContentContext} from '../../ui/src/document-content'
import {BlockNoteEditor, getBlockInfoFromPos, useBlockNote} from './blocknote'
import {HyperMediaEditorView} from './editor-view'
import {EmbedToolbarProvider} from './embed-toolbar-context'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {hmBlockSchema} from './schema'
import {slashMenuItems} from './slash-menu-items'
import {
  chromiumSupportedImageMimeTypes,
  generateBlockId,
  handleDragMedia,
  serverBlockNodesFromEditorBlocks,
} from './utils'

export default function CommentEditor({
  onDiscardDraft,
  submitButton,
}: {
  onDiscardDraft?: () => void
  submitButton: (opts: {
    reset: () => void
    getContent: (
      prepareAttachments: (binaries: Uint8Array[]) => Promise<{
        blobs: {cid: string; data: Uint8Array}[]
        resultCIDs: string[]
      }>,
    ) => Promise<{
      blockNodes: HMBlockNode[]
      blobs: {cid: string; data: Uint8Array}[]
    }>
  }) => JSX.Element
}) {
  const {editor} = useCommentEditor()
  const {openUrl, handleFileAttachment} = useDocContentContext()
  const [isDragging, setIsDragging] = useState(false)

  function onDrop(event: DragEvent) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer) {
      const ttEditor = editor._tiptapEditor
      const files: File[] = []

      if (dataTransfer.files.length) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
          files.push(dataTransfer.files[i])
        }
      } else if (dataTransfer.items.length) {
        for (let i = 0; i < dataTransfer.items.length; i++) {
          const item = dataTransfer.items[i].getAsFile()
          if (item) {
            files.push(item)
          }
        }
      }

      if (files.length > 0) {
        const editorElement = document.getElementsByClassName(
          'mantine-Editor-root',
        )[0]
        const editorBoundingBox = editorElement.getBoundingClientRect()
        const posAtCoords = ttEditor.view.posAtCoords({
          left: editorBoundingBox.left + editorBoundingBox.width / 2,
          top: event.clientY,
        })
        let pos: number | null
        if (posAtCoords && posAtCoords.inside !== -1) pos = posAtCoords.pos
        else if (event.clientY > editorBoundingBox.bottom)
          pos = ttEditor.view.state.doc.content.size - 4

        let lastId: string

        // using reduce so files get inserted sequentially
        files
          // @ts-expect-error
          .reduce((previousPromise, file, index) => {
            return previousPromise.then(() => {
              event.preventDefault()
              event.stopPropagation()

              if (pos) {
                return handleDragMedia(file, handleFileAttachment).then(
                  (props) => {
                    if (!props) return false

                    const {state} = ttEditor.view
                    let blockNode
                    const newId = generateBlockId()

                    if (chromiumSupportedImageMimeTypes.has(file.type)) {
                      blockNode = {
                        id: newId,
                        type: 'image',
                        props: {
                          displaySrc: props.displaySrc,
                          fileBinary: props.fileBinary,
                          name: props.name,
                        },
                      }
                    }
                    // else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
                    //   blockNode = {
                    //     id: newId,
                    //     type: 'video',
                    //     props: {
                    //       url: props.url,
                    //       name: props.name,
                    //     },
                    //   }
                    // } else {
                    //   blockNode = {
                    //     id: newId,
                    //     type: 'file',
                    //     props: {
                    //       ...props,
                    //     },
                    //   }
                    // }

                    const blockInfo = getBlockInfoFromPos(state, pos)

                    console.log(blockNode)

                    if (index === 0) {
                      ;(editor as BlockNoteEditor).insertBlocks(
                        [blockNode],
                        blockInfo.block.node.attrs.id,
                        // blockInfo.node.textContent ? 'after' : 'before',
                        'after',
                      )
                    } else {
                      ;(editor as BlockNoteEditor).insertBlocks(
                        [blockNode],
                        lastId,
                        'after',
                      )
                    }

                    lastId = newId
                  },
                )
              }
            })
          }, Promise.resolve())
        // .then(() => true) // TODO: @horacio ask Iskak about this
        setIsDragging(false)
        return true
      }
      setIsDragging(false)
      return false
    }
    setIsDragging(false)

    return false
  }

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
        onDragStart={() => {
          setIsDragging(true)
        }}
        onDragEnd={() => {
          setIsDragging(false)
        }}
        onDragOver={(event: DragEvent) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        // onDrop={(e) => {
        //   e.preventDefault()
        //   const files = Array.from(e.dataTransfer.files)
        //   console.log('Dropped files:', files)
        // }}
        onDrop={onDrop}
      >
        <EmbedToolbarProvider>
          <HyperMediaEditorView editor={editor} openUrl={openUrl} />
        </EmbedToolbarProvider>
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
          getContent: async (
            prepareAttachments: (binaries: Uint8Array[]) => Promise<{
              blobs: {cid: string; data: Uint8Array}[]
              resultCIDs: string[]
            }>,
          ) => {
            const editorBlocks: EditorBlock[] = editor.topLevelBlocks
            const blocksWithAttachments = crawlEditorBlocks(
              editorBlocks,
              (block) => !!block.props?.fileBinary,
            )
            const {blobs, resultCIDs} = await prepareAttachments(
              blocksWithAttachments.map((block) => block.props.fileBinary),
            )
            blocksWithAttachments.forEach((block, blockWithAttachmentIndex) => {
              const resultCID = resultCIDs[blockWithAttachmentIndex]
              // performing a mutation so the same block is modififed with the new CID
              block.props.url = `ipfs://${resultCID}`
            })
            const blocks = serverBlockNodesFromEditorBlocks(
              editor,
              editorBlocks,
            )
            const blockNodes = blocks.map((block) =>
              block.toJson(),
            ) as HMBlockNode[]
            return {blockNodes, blobs}
          },
        })}
      </XStack>
    </YStack>
  )
}

function crawlEditorBlocks(
  blocks: EditorBlock[],
  filter: (block: EditorBlock) => boolean,
): EditorBlock[] {
  const matchedChildren = blocks.flatMap((block) =>
    crawlEditorBlocks(block.children, filter),
  )
  return [...matchedChildren, ...blocks.filter(filter)]
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
