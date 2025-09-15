import {EditorBlock, writeableStateStream} from '@shm/shared'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {HMBlockNode, HMMetadata} from '@shm/shared/hm-types'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {queryClient} from '@shm/shared/models/query-client'
import {useAccount} from '@shm/shared/src/models/entity'
import {useTx} from '@shm/shared/translation'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Extension} from '@tiptap/core'
import {useCallback, useEffect, useRef, useState} from 'react'
import {useDocContentContext} from '../../ui/src/document-content'
import {BlockNoteEditor, getBlockInfoFromPos, useBlockNote} from './blocknote'
import {HyperMediaEditorView} from './editor-view'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {hmBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
  handleDragMedia,
  serverBlockNodesFromEditorBlocks,
} from './utils'

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

export function useCommentEditor(
  perspectiveAccountUid?: string | null | undefined,
) {
  const {onMentionsQuery} = useInlineMentions(perspectiveAccountUid)

  const editor = useBlockNote<typeof hmBlockSchema>({
    onEditorContentChange(editor: BlockNoteEditor<typeof hmBlockSchema>) {
      // console.log("editor content changed", editor.topLevelBlocks);
    },
    linkExtensionOptions: {
      // @ts-expect-error
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
    getSlashMenuItems: () => getSlashMenuItems(),
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

export interface CommentEditorProps {
  draft: Array<HMBlockNode>
  onSubmit: (content: Array<HMBlockNode>) => Promise<void>
  onDelete: (draftKey: string) => Promise<void>
  onMedia: () => Promise<void>
  autoFocus?: boolean
  signer?: HMMetadata
}

/**
 * CommentEditor
 * props:
 * - draft: editorDraft if any
 * - onSubmit: async function that submits the comment
 *   - content: editor content
 *   -
 * - autoFocus?: if we need to focus the editor right away
 * - onMedia: function that handles how we process images
 * when paste or included
 * - signer: account metadata for the signer to render avatar and name
 * - onDelete: function. self explanatory
 *
 * - logic:
 *   - load editor data depending if there's a draft already
 * with content or not
 *   - add listener to editor update to save editor I guess.
 *     maybe we can just pass the safeDraft function and call it here
 *   - focus editor if needed (autoFocus?)
 *   - getContent function is defined here
 *   - handle cmd+A when the editor is focused
 *   - pass the function to handle Images when pasted or upload
 *     and call it inside the editor extension
 *   - render the editor right away
 *   -
 *
 */
function _CommentEditor({}: CommentEditorProps) {
  const {editor} = useCommentEditor()

  const reset = useCallback(() => {
    editor.removeBlocks(editor.topLevelBlocks)
  }, [editor.topLevelBlocks])

  return null
}

export function CommentEditor({
  submitButton,
  handleSubmit,
  account,
  autoFocus,
  perspectiveAccountUid,
  onDiscardDraft,
  initialBlocks,
  onContentChange,
}: {
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
  handleSubmit: (
    getContent: (
      prepareAttachments: (binaries: Uint8Array[]) => Promise<{
        blobs: {cid: string; data: Uint8Array}[]
        resultCIDs: string[]
      }>,
    ) => Promise<{
      blockNodes: HMBlockNode[]
      blobs: {cid: string; data: Uint8Array}[]
    }>,
    reset: () => void,
  ) => void
  account?: ReturnType<typeof useAccount>['data']
  autoFocus?: boolean
  perspectiveAccountUid?: string | null | undefined
  onDiscardDraft?: () => void
  initialBlocks?: HMBlockNode[]
  onContentChange?: (blocks: HMBlockNode[]) => void
}) {
  // Debug logging for account updates
  console.log('🔍 CommentEditor render - account metadata:', account?.metadata)

  const {editor} = useCommentEditor(perspectiveAccountUid)
  // Check if we have non-empty draft content
  const hasDraftContent =
    initialBlocks &&
    initialBlocks.length > 0 &&
    initialBlocks.some((block) => {
      // Check if block has text content (for paragraph-like blocks)
      if (
        'text' in block.block &&
        typeof block.block.text === 'string' &&
        block.block.text.trim().length > 0
      ) {
        return true
      }
      // Check if block has children
      if (block.children && block.children.length > 0) {
        return true
      }
      return false
    })
  const [isEditorFocused, setIsEditorFocused] = useState(
    () => autoFocus || hasDraftContent || false,
  )
  const {openUrl, handleFileAttachment} = useDocContentContext()
  const [isDragging, setIsDragging] = useState(false)
  const tx = useTx()
  const isInitializedRef = useRef(false)
  const contentChangeTimeoutRef = useRef<NodeJS.Timeout>()

  const reset = () => {
    editor.removeBlocks(editor.topLevelBlocks)
  }

  // Initialize editor with draft content
  useEffect(() => {
    if (
      initialBlocks &&
      initialBlocks.length > 0 &&
      !isInitializedRef.current &&
      editor
    ) {
      isInitializedRef.current = true
      try {
        const editorBlocks = hmBlocksToEditorContent(initialBlocks, {
          childrenType: 'Group',
        })
        editor.removeBlocks(editor.topLevelBlocks)
        // @ts-expect-error - EditorBlock type mismatch with BlockNote
        editor.replaceBlocks(editor.topLevelBlocks, editorBlocks)
      } catch (error) {
        console.error('Failed to initialize editor with draft content:', error)
      }
    }
  }, [initialBlocks, editor])

  // Notify parent of content changes
  useEffect(() => {
    if (!onContentChange) return

    const handleChange = () => {
      // Clear previous timeout
      if (contentChangeTimeoutRef.current) {
        clearTimeout(contentChangeTimeoutRef.current)
      }

      // Debounce content change notifications
      contentChangeTimeoutRef.current = setTimeout(() => {
        try {
          const blocks = serverBlockNodesFromEditorBlocks(
            editor,
            // @ts-expect-error
            editor.topLevelBlocks,
          )
          onContentChange(blocks.map((b) => b.toJson()) as HMBlockNode[])
        } catch (error) {
          console.error('Failed to notify content change:', error)
        }
      }, 500)
    }

    // Listen to editor changes
    editor._tiptapEditor.on('update', handleChange)

    return () => {
      editor._tiptapEditor.off('update', handleChange)
      if (contentChangeTimeoutRef.current) {
        clearTimeout(contentChangeTimeoutRef.current)
      }
    }
  }, [editor, onContentChange])

  useEffect(() => {
    if (autoFocus) {
      setIsEditorFocused(true)
      setTimeout(() => {
        editor._tiptapEditor.commands.focus()
      }, 100)
    }
  }, [autoFocus])

  const getContent = async (
    prepareAttachments: (binaries: Uint8Array[]) => Promise<{
      blobs: {cid: string; data: Uint8Array}[]
      resultCIDs: string[]
    }>,
  ) => {
    // @ts-expect-error
    const editorBlocks: EditorBlock[] = editor.topLevelBlocks
    const blocksWithAttachments = crawlEditorBlocks(
      editorBlocks,
      // @ts-expect-error
      (block) => !!block.props?.fileBinary,
    )
    const {blobs, resultCIDs} = await prepareAttachments(
      // @ts-expect-error
      blocksWithAttachments.map((block) => block.props.fileBinary),
    )
    blocksWithAttachments.forEach((block, i) => {
      // @ts-expect-error
      block.props.url = `ipfs://${resultCIDs[i]}`
    })
    const blocks = serverBlockNodesFromEditorBlocks(editor, editorBlocks)
    return {
      blockNodes: blocks.map((b) => b.toJson()) as HMBlockNode[],
      blobs,
    }
  }

  useEffect(() => {
    function handleSelectAll(event: KeyboardEvent) {
      if (event.key == 'a' && event.metaKey) {
        if (editor && editor._tiptapEditor.isFocused) {
          event.preventDefault()
          editor._tiptapEditor.commands.focus()
          editor._tiptapEditor.commands.selectAll()
        }
      }
    }

    window.addEventListener('keydown', handleSelectAll)

    return () => {
      window.removeEventListener('keydown', handleSelectAll)
    }
  }, [])

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!isDragging) return
    const dataTransfer = event.dataTransfer

    if (dataTransfer) {
      const ttEditor = editor._tiptapEditor
      const files: File[] = []

      if (dataTransfer.files.length) {
        for (let i = 0; i < dataTransfer.files.length; i++) {
          const file = dataTransfer.files[i]
          if (file) files.push(file)
        }
      } else if (dataTransfer.items.length) {
        for (let i = 0; i < dataTransfer.items.length; i++) {
          const dataItem = dataTransfer.items[i]
          if (dataItem) {
            const item = dataItem.getAsFile()
            if (item) {
              files.push(item)
            }
          }
        }
      }

      if (files.length > 0) {
        const editorElement = document.getElementsByClassName(
          'mantine-Editor-root',
        )[0]
        if (!editorElement) return
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
        files.reduce((previousPromise, file, index) => {
          return previousPromise.then(() => {
            event.preventDefault()
            event.stopPropagation()

            if (pos) {
              return handleDragMedia(file, handleFileAttachment).then(
                (props) => {
                  if (!props) return Promise.resolve()

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
                  } else if (chromiumSupportedVideoMimeTypes.has(file.type)) {
                    blockNode = {
                      id: newId,
                      type: 'video',
                      props: {
                        displaySrc: props.displaySrc,
                        fileBinary: props.fileBinary,
                        name: props.name,
                      },
                    }
                  } else {
                    blockNode = {
                      id: newId,
                      type: 'file',
                      props: {
                        fileBinary: props.fileBinary,
                        name: props.name,
                        size: props.size,
                      },
                    }
                  }

                  const blockInfo = getBlockInfoFromPos(state, pos)

                  if (index === 0) {
                    ;(editor as BlockNoteEditor).insertBlocks(
                      // @ts-expect-error
                      [blockNode],
                      blockInfo.block.node.attrs.id,
                      // blockInfo.node.textContent ? 'after' : 'before',
                      'after',
                    )
                  } else {
                    ;(editor as BlockNoteEditor).insertBlocks(
                      // @ts-expect-error
                      [blockNode],
                      lastId,
                      'after',
                    )
                  }

                  lastId = newId
                  return Promise.resolve()
                },
              )
            } else {
              return Promise.resolve()
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
    <div className="flex w-full items-start gap-2">
      <div className="flex shrink-0 grow-0">
        {account?.metadata ? (
          <HMIcon
            id={account.id}
            name={account.metadata?.name}
            icon={account.metadata?.icon}
            size={32}
          />
        ) : (
          <UIAvatar id="?" label="?" size={32} />
        )}
      </div>
      <div className="bg-muted w-full flex-1 rounded-md">
        <div
          className={cn(
            'comment-editor min-h-8 flex-1',
            isEditorFocused ? 'justify-start px-3 pt-1 pb-2' : 'justify-center',
          )}
          // marginTop="$1"

          // minHeight={isEditorFocused ? 105 : 40}
          // paddingHorizontal="$4"
          onClick={(e) => {
            const target = e.target as HTMLElement

            // Check if the clicked element is not an input, button, or textarea
            if (target.closest('input, textarea, select, button')) {
              return // Don't focus the editor in this case
            }
            e.stopPropagation()
            editor._tiptapEditor.commands.focus()
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              e.stopPropagation()
              editor._tiptapEditor.commands.blur()
              handleSubmit(getContent, reset)
              return true
            }
            return false
          }}
          onDragStart={() => {
            setIsDragging(true)
          }}
          onDragEnd={() => {
            setIsDragging(false)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDrop={onDrop}
        >
          {isEditorFocused ? (
            // @ts-expect-error
            <HyperMediaEditorView editor={editor} openUrl={openUrl} />
          ) : (
            <Button
              onClick={() => {
                setIsEditorFocused(true)
                setTimeout(() => {
                  editor._tiptapEditor.commands.focus()
                }, 100)
              }}
              className="text-muted-foreground m-0 h-auto min-h-8 w-full flex-1 items-center justify-start border-0 text-left text-base hover:bg-transparent focus:bg-transparent"
              variant="ghost"
              size="sm"
            >
              {tx('Start a Discussion')}
            </Button>
          )}
        </div>
        {isEditorFocused ? (
          <div className="mx-2 mb-2 flex justify-end gap-2">
            {submitButton({
              reset,
              getContent,
            })}
            {onDiscardDraft && (
              <Tooltip content="Discard Comment Draft">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    // Clear the editor content
                    reset()
                    // Reset the focused state
                    setIsEditorFocused(false)
                    // Reset initialization flag for potential new drafts
                    isInitializedRef.current = false
                    // Call the discard callback
                    onDiscardDraft()
                  }}
                >
                  <Trash className="text-destructive size-4" />
                </Button>
              </Tooltip>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
