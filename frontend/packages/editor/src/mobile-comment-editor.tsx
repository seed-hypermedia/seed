import {EditorBlock, writeableStateStream} from '@shm/shared'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {queryClient} from '@shm/shared/models/query-client'
import {useAccount} from '@shm/shared/src/models/entity'
import {useTx} from '@shm/shared/translation'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {AtSignIcon, ImageIcon, SlashSquareIcon, Trash} from '@shm/ui/icons'
import {cn} from '@shm/ui/utils'
import {Extension} from '@tiptap/core'
import {useEffect, useRef, useState} from 'react'
import {useDocContentContext} from '../../ui/src/document-content'
import avatarPlaceholder from './assets/avatar.png'
import {BlockNoteEditor, getBlockInfoFromPos, useBlockNote} from './blocknote'
import {HyperMediaEditorView} from './editor-view'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {MobileMentionsDialog} from './mobile-mentions-dialog'
import {MobileSlashDialog} from './mobile-slash-dialog'
import {hmBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'
import {
  chromiumSupportedImageMimeTypes,
  chromiumSupportedVideoMimeTypes,
  generateBlockId,
  handleDragMedia,
  serverBlockNodesFromEditorBlocks,
} from './utils'

const [setGwUrl, gwUrl] = writeableStateStream<string | null>(
  'https://hyper.media',
)

// Mobile-specific comment editor with button toolbar
export function MobileCommentEditor({
  submitButton,
  handleSubmit,
  account,
  autoFocus,
  perspectiveAccountUid,
  onDiscardDraft,
  initialBlocks,
  onContentChange,
  onAvatarPress,
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
  onAvatarPress?: () => void
}) {
  const {editor} = useCommentEditor(perspectiveAccountUid)
  const {openUrl, handleFileAttachment} = useDocContentContext()
  const [isDragging, setIsDragging] = useState(false)
  const [isMentionsDialogOpen, setIsMentionsDialogOpen] = useState(false)
  const [isSlashDialogOpen, setIsSlashDialogOpen] = useState(false)
  const tx = useTx()
  const isInitializedRef = useRef(false)
  const contentChangeTimeoutRef = useRef<NodeJS.Timeout>()

  const hasDraftContent =
    initialBlocks &&
    initialBlocks.length > 0 &&
    initialBlocks.some((block) => {
      if (
        'text' in block.block &&
        typeof block.block.text === 'string' &&
        block.block.text.trim().length > 0
      ) {
        return true
      }
      if (block.children && block.children.length > 0) {
        return true
      }
      return false
    })

  const [isEditorFocused, setIsEditorFocused] = useState(
    () => autoFocus || hasDraftContent || false,
  )

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
      if (contentChangeTimeoutRef.current) {
        clearTimeout(contentChangeTimeoutRef.current)
      }

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

  // Mobile-specific handlers for new buttons
  const handleMentionsClick = () => {
    setIsMentionsDialogOpen(true)
  }

  const handleSlashCommandsClick = () => {
    setIsSlashDialogOpen(true)
  }

  const handleMentionSelect = (mention: {
    id: UnpackedHypermediaId
    label: string
    type: string
  }) => {
    // Insert mention at current cursor position
    const {state, schema} = editor._tiptapEditor
    const node = schema.nodes['inline-embed'].create(
      {link: mention.id.id},
      schema.text(' '),
    )

    editor._tiptapEditor.view.dispatch(
      state.tr.replaceSelectionWith(node).scrollIntoView(),
    )

    setTimeout(() => {
      editor._tiptapEditor.commands.focus()
    }, 100)
  }

  const handleImageClick = () => {
    // Create hidden file input
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.multiple = true

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return

      // Handle file insertion logic
      const ttEditor = editor._tiptapEditor
      const pos = ttEditor.view.state.doc.content.size - 4

      for (const file of files) {
        const props = await handleDragMedia(file, handleFileAttachment)
        if (!props) continue

        const newId = generateBlockId()
        let blockNode

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

        const blockInfo = getBlockInfoFromPos(ttEditor.view.state, pos)
        ;(editor as BlockNoteEditor).insertBlocks(
          // @ts-expect-error
          [blockNode],
          blockInfo.block.node.attrs.id,
          'after',
        )
      }
    }

    input.click()
  }

  // Drag & drop logic
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
        setIsDragging(false)
        return true
      }
      setIsDragging(false)
      return false
    }
    setIsDragging(false)

    return false
  }

  try {
    return (
      <>
        <div className="flex w-full items-start gap-2">
          <div className="flex shrink-0 grow-0">
            {account?.metadata ? (
              <HMIcon
                id={account.id}
                name={account.metadata?.name}
                icon={account.metadata?.icon}
                size={32}
                onPress={onAvatarPress}
              />
            ) : (
              <UIAvatar
                url={avatarPlaceholder}
                size={32}
                onPress={onAvatarPress}
                className="rounded-full"
              />
            )}
          </div>

          <div className="bg-muted ring-px ring-border w-full flex-1 rounded-md ring">
            {/* Editor Content */}
            <div
              className={cn(
                'comment-editor min-h-8 flex-1',
                isEditorFocused
                  ? 'justify-start px-3 pt-1 pb-2'
                  : 'justify-center',
              )}
              onClick={(e) => {
                const target = e.target as HTMLElement
                if (target.closest('input, textarea, select, button')) {
                  return
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
              onDragStart={() => setIsDragging(true)}
              onDragEnd={() => setIsDragging(false)}
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

            {/* Mobile Button Toolbar */}
            {isEditorFocused && (
              <div className="border-border border-t px-3 py-2">
                <div className="flex items-center justify-between">
                  {/* Left side buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={handleMentionsClick}
                    >
                      <AtSignIcon className="h-4 w-4" />
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={handleImageClick}
                    >
                      <ImageIcon className="h-4 w-4" />
                    </Button>

                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={handleSlashCommandsClick}
                    >
                      <SlashSquareIcon className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Right side buttons */}
                  <div className="flex items-center gap-2">
                    {submitButton({
                      reset,
                      getContent,
                    })}

                    {onDiscardDraft && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          reset()
                          setIsEditorFocused(false)
                          isInitializedRef.current = false
                          onDiscardDraft()
                        }}
                      >
                        <Trash className="text-destructive h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <MobileMentionsDialog
          isOpen={isMentionsDialogOpen}
          onClose={() => setIsMentionsDialogOpen(false)}
          onSelect={handleMentionSelect}
          perspectiveAccountUid={perspectiveAccountUid}
        />
        <MobileSlashDialog
          isOpen={isSlashDialogOpen}
          onClose={() => setIsSlashDialogOpen(false)}
          editor={editor}
        />
      </>
    )
  } catch (error) {
    console.error('MobileCommentEditor error:', error)

    return (
      <div className="flex w-full items-start gap-2">
        <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          <p>
            Error loading mobile comment editor:{' '}
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
          <p className="mt-2 text-xs">User Agent: {navigator.userAgent}</p>
          <p className="text-xs">Time: {new Date().toLocaleString()}</p>
        </div>
      </div>
    )
  }
}

// Helper functions
function crawlEditorBlocks(
  blocks: EditorBlock[],
  filter: (block: EditorBlock) => boolean,
): EditorBlock[] {
  const matchedChildren = blocks.flatMap((block) =>
    crawlEditorBlocks(block.children, filter),
  )
  return [...matchedChildren, ...blocks.filter(filter)]
}

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
      gwUrl,
    },
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
