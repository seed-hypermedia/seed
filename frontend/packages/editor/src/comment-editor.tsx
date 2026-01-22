import {EditorBlock, useOpenUrl, writeableStateStream} from '@shm/shared'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {HMBlockNode, HMMetadata} from '@shm/shared/hm-types'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {queryClient} from '@shm/shared/models/query-client'
import {useAccount} from '@shm/shared/src/models/entity'
import {useTx} from '@shm/shared/translation'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {LinkIcon} from '@shm/ui/hm-icon'
import {AtSignIcon, ImageIcon, SlashSquareIcon} from '@shm/ui/icons'
import {cn} from '@shm/ui/utils'
import {Extension} from '@tiptap/core'
import {useCallback, useEffect, useRef, useState} from 'react'
import avatarPlaceholder from './assets/avatar.png'
import {BlockNoteEditor, getBlockInfoFromPos, useBlockNote} from './blocknote'
import {HyperMediaEditorView} from './editor-view'
import {createHypermediaDocLinkPlugin} from './hypermedia-link-plugin'
import {MobileMentionsDialog} from './mobile-mentions-dialog'
import {MobileSlashDialog} from './mobile-slash-dialog'
import {hmBlockSchema} from './schema'
import {getSlashMenuItems} from './slash-menu-items'
import {isMobileDevice, useMobile} from './use-mobile'
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
  onSubmit?: () => void,
  onMobileMentionTrigger?: () => void,
  onMobileSlashTrigger?: () => void,
  importWebFile?: (url: string) => Promise<{
    displaySrc: string
    fileBinary?: Uint8Array
    type: string
    size: number
  }>,
  handleFileAttachment?: (file: File) => Promise<{
    displaySrc: string
    fileBinary?: Uint8Array
    mediaRef?: {
      draftId: string
      mediaId: string
      name: string
      mime: string
      size: number
    }
  }>,
) {
  const {onMentionsQuery} = useInlineMentions(perspectiveAccountUid)

  // Use ref so the extension can access the latest onSubmit
  const onSubmitRef = useRef<(() => void) | undefined>(onSubmit)
  onSubmitRef.current = onSubmit

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
    importWebFile,
    handleFileAttachment,
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: 'hypermedia-link',
          addProseMirrorPlugins() {
            return [createHypermediaDocLinkPlugin({}).plugin]
          },
        }),
        Extension.create({
          name: 'comment-submit-shortcut',
          priority: 1000,
          addKeyboardShortcuts() {
            return {
              'Mod-Enter': () => {
                // Prevent the default Enter behavior
                // and trigger the submit callback
                if (onSubmitRef.current) {
                  onSubmitRef.current()
                  return true
                }
                return false
              },
            }
          },
        }),
        // Mobile-specific keyboard handlers for mentions and slash menu
        ...(onMobileMentionTrigger || onMobileSlashTrigger
          ? [
              Extension.create({
                name: 'mobile-dialog-triggers',
                priority: 2000,
                addKeyboardShortcuts() {
                  return {
                    '@': ({editor}) => {
                      if (!onMobileMentionTrigger || !isMobileDevice())
                        return false

                      const {state, view} = editor
                      const {selection} = state

                      const textBeforeCursor =
                        selection.$from.parent.textContent.substring(
                          0,
                          selection.$from.parentOffset,
                        )

                      const isAtStart = textBeforeCursor.length === 0
                      const isAfterSpace = textBeforeCursor.endsWith(' ')

                      if (isAtStart || isAfterSpace) {
                        onMobileMentionTrigger()
                        return true
                      }
                      return false
                    },
                    '/': ({editor}) => {
                      if (!onMobileSlashTrigger || !isMobileDevice())
                        return false

                      const {state, view} = editor
                      const {selection} = state

                      const textBeforeCursor =
                        selection.$from.parent.textContent.substring(
                          0,
                          selection.$from.parentOffset,
                        )

                      const isAtStart = textBeforeCursor.length === 0
                      const isAfterSpace = textBeforeCursor.endsWith(' ')

                      if (isAtStart || isAfterSpace) {
                        onMobileSlashTrigger()
                        return true
                      }
                      return false
                    },
                  }
                },
              }),
            ]
          : []),
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
  onAvatarPress,
  importWebFile,
  handleFileAttachment,
  getDraftMediaBlob,
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
  importWebFile?: (url: string) => Promise<{
    displaySrc: string
    fileBinary?: Uint8Array
    type: string
    size: number
  }>
  handleFileAttachment?: (file: File) => Promise<{
    displaySrc: string
    fileBinary?: Uint8Array
    mediaRef?: {
      draftId: string
      mediaId: string
      name: string
      mime: string
      size: number
    }
  }>
  getDraftMediaBlob?: (draftId: string, mediaId: string) => Promise<Blob | null>
}) {
  const [submitTrigger, setSubmitTrigger] = useState(0)
  const submitCallbackRef = useRef<(() => void) | null>(null)
  const isMobile = useMobile()
  const [isMentionsDialogOpen, setIsMentionsDialogOpen] = useState(false)
  const [isSlashDialogOpen, setIsSlashDialogOpen] = useState(false)

  const {editor} = useCommentEditor(
    perspectiveAccountUid,
    () => setSubmitTrigger((prev) => prev + 1),
    isMobile ? () => setIsMentionsDialogOpen(true) : undefined,
    isMobile ? () => setIsSlashDialogOpen(true) : undefined,
    importWebFile,
    handleFileAttachment,
  )
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
  const openUrl = useOpenUrl()
  const [isDragging, setIsDragging] = useState(false)
  const tx = useTx()
  const isInitializedRef = useRef(false)
  const contentChangeTimeoutRef = useRef<NodeJS.Timeout>()

  const reset = () => {
    editor.removeBlocks(editor.topLevelBlocks)
  }

  // Initialize editor with draft content and rehydrate media
  useEffect(() => {
    if (
      initialBlocks &&
      initialBlocks.length > 0 &&
      !isInitializedRef.current &&
      editor
    ) {
      isInitializedRef.current = true

      const initializeWithRehydration = async () => {
        try {
          const editorBlocks = hmBlocksToEditorContent(initialBlocks, {
            childrenType: 'Group',
          })

          // Rehydrate media blocks from IndexedDB
          if (getDraftMediaBlob) {
            const rehydrateEditorBlocks = async (
              blocks: any[],
            ): Promise<void> => {
              for (const block of blocks) {
                if (
                  (block.type === 'image' ||
                    block.type === 'video' ||
                    block.type === 'file') &&
                  block.props?.mediaRef
                ) {
                  // Parse mediaRef from JSON string
                  let mediaRef
                  try {
                    mediaRef =
                      typeof block.props.mediaRef === 'string'
                        ? JSON.parse(block.props.mediaRef)
                        : block.props.mediaRef
                  } catch (e) {
                    console.error('Failed to parse mediaRef:', e)
                    continue
                  }

                  const {draftId, mediaId} = mediaRef
                  try {
                    const blob = await getDraftMediaBlob(draftId, mediaId)
                    if (blob) {
                      // Clear any old url and set a new blob url
                      delete block.props.url
                      block.props.displaySrc = URL.createObjectURL(blob)
                    } else {
                      console.warn(
                        `Media blob not found in IndexedDB for rehydration: ${draftId}/${mediaId}`,
                      )
                    }
                  } catch (error) {
                    console.error(
                      `Failed to rehydrate media ${mediaId}:`,
                      error,
                    )
                  }
                }

                // Process children recursively
                if (block.children && block.children.length > 0) {
                  await rehydrateEditorBlocks(block.children)
                }
              }
            }

            await rehydrateEditorBlocks(editorBlocks)
          }

          editor.removeBlocks(editor.topLevelBlocks)
          // @ts-expect-error - EditorBlock type mismatch with BlockNote
          editor.replaceBlocks(editor.topLevelBlocks, editorBlocks)
        } catch (error) {
          console.error(
            'Failed to initialize editor with draft content:',
            error,
          )
        }
      }

      initializeWithRehydration()
    }
  }, [initialBlocks, editor, getDraftMediaBlob])

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Revoke any blob URLs in the editor blocks on unmount
      if (editor && typeof window !== 'undefined') {
        try {
          const blocks = editor.topLevelBlocks
          const revokeFromBlock = (block: any) => {
            if (
              block.props?.displaySrc &&
              typeof block.props.displaySrc === 'string' &&
              block.props.displaySrc.startsWith('blob:')
            ) {
              try {
                URL.revokeObjectURL(block.props.displaySrc)
              } catch (error) {
                // URL might already be revoked
              }
            }
            if (block.children && Array.isArray(block.children)) {
              block.children.forEach(revokeFromBlock)
            }
          }
          blocks.forEach(revokeFromBlock)
        } catch (error) {
          // Editor might be in invalid state during unmount
          console.debug('Failed to revoke URLs on unmount:', error)
        }
      }
    }
  }, [editor])

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

    // Collect blocks with fileBinary or mediaRef
    const blocksWithAttachments = crawlEditorBlocks(
      editorBlocks,
      // @ts-expect-error
      (block) => !!block.props?.fileBinary || !!block.props?.mediaRef,
    )

    // Prepare binaries for upload
    // TODO: decide if this should be removed
    const binariesToUpload: Uint8Array[] = []
    const blockToIndexMap = new Map<any, number>()

    for (const block of blocksWithAttachments) {
      // @ts-expect-error
      if (block.props?.fileBinary) {
        blockToIndexMap.set(block, binariesToUpload.length)
        // @ts-expect-error
        binariesToUpload.push(block.props.fileBinary)
      }
      // @ts-expect-error
      else if (block.props?.mediaRef && getDraftMediaBlob) {
        // Parse mediaRef from JSON string
        let mediaRef
        try {
          mediaRef =
            // @ts-expect-error - mediaRef exists on media blocks
            typeof block.props.mediaRef === 'string'
              ? // @ts-expect-error
                JSON.parse(block.props.mediaRef)
              : // @ts-expect-error
                block.props.mediaRef
        } catch (e) {
          console.error('Failed to parse mediaRef:', e)
          continue
        }

        const {draftId, mediaId} = mediaRef
        try {
          const blob = await getDraftMediaBlob(draftId, mediaId)
          if (blob) {
            const arrayBuffer = await blob.arrayBuffer()
            const binary = new Uint8Array(arrayBuffer)
            blockToIndexMap.set(block, binariesToUpload.length)
            binariesToUpload.push(binary)
          } else {
            console.warn(`Media not found: ${draftId}/${mediaId}`)
          }
        } catch (error) {
          console.error('Failed to load media:', error)
        }
      }
    }

    const {blobs, resultCIDs} = await prepareAttachments(binariesToUpload)

    // Update blocks with IPFS URLs
    blocksWithAttachments.forEach((block) => {
      const index = blockToIndexMap.get(block)
      if (index !== undefined) {
        // @ts-expect-error
        block.props.url = `ipfs://${resultCIDs[index]}`
        // Clean up temporary properties
        // @ts-expect-error
        delete block.props.fileBinary
        // @ts-expect-error
        delete block.props.mediaRef
        // @ts-expect-error
        delete block.props.displaySrc
      }
    })

    const blocks = serverBlockNodesFromEditorBlocks(editor, editorBlocks)
    return {
      blockNodes: blocks.map((b) => b.toJson()) as HMBlockNode[],
      blobs,
    }
  }

  const handleImageClick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.multiple = true

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || [])
      if (files.length === 0) return

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
              mediaRef: props.mediaRef,
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
              mediaRef: props.mediaRef,
              name: props.name,
            },
          }
        } else {
          blockNode = {
            id: newId,
            type: 'file',
            props: {
              fileBinary: props.fileBinary,
              mediaRef: props.mediaRef,
              name: props.name,
              size: props.size,
            },
          }
        }

        const blockInfo = getBlockInfoFromPos(ttEditor.view.state, pos)
        editor.insertBlocks(
          // @ts-expect-error
          [blockNode],
          blockInfo.block.node.attrs.id,
          'after',
        )
      }
    }

    input.click()
  }

  // Keep callback ref updated with latest getContent and reset
  submitCallbackRef.current = () => {
    editor._tiptapEditor.commands.blur()
    handleSubmit(getContent, reset)
  }

  // Handle submit triggered by keyboard shortcut
  useEffect(() => {
    if (submitTrigger > 0) {
      submitCallbackRef.current?.()
    }
  }, [submitTrigger])

  useEffect(() => {
    function handleSelectAll(event: KeyboardEvent) {
      if (event.key == 'a' && (event.metaKey || event.ctrlKey)) {
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
                        mediaRef: props.mediaRef,
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
                        mediaRef: props.mediaRef,
                        name: props.name,
                      },
                    }
                  } else {
                    blockNode = {
                      id: newId,
                      type: 'file',
                      props: {
                        fileBinary: props.fileBinary,
                        mediaRef: props.mediaRef,
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

  if (!editor) {
    console.error('CommentEditor: editor is null/undefined')
    return (
      <div className="border-destructive bg-destructive/10 rounded border p-4">
        <p className="text-destructive text-sm">
          Error: Editor failed to initialize. Check console for details.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex w-full items-start gap-2">
        <div className="flex shrink-0 grow-0">
          {account?.metadata ? (
            <LinkIcon id={account.id} metadata={account.metadata} size={32} />
          ) : (
            <UIAvatar
              url={avatarPlaceholder}
              size={32}
              onPress={onAvatarPress}
              className="rounded-full"
            />
          )}
        </div>
        <div className="bg-muted w-full min-w-0 flex-1 rounded-lg">
          <div
            className={cn(
              'comment-editor max-h-[160px] min-h-8 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto md:max-h-full',
              isEditorFocused
                ? 'justify-start px-3 pt-1 pb-2'
                : 'justify-center',
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
              <HyperMediaEditorView editor={editor} openUrl={openUrl} />
            ) : (
              <Button
                onClick={() => {
                  setIsEditorFocused(true)
                  setTimeout(() => {
                    editor._tiptapEditor.commands.focus()
                  }, 100)
                }}
                className={cn(
                  'text-muted-foreground m-0 h-auto min-h-8 w-full flex-1 items-center justify-start border-0 text-left text-base hover:bg-transparent focus:bg-transparent',
                  'plausible-event-name=Comment+Box+Click',
                )}
                variant="ghost"
                size="sm"
              >
                {tx('Start a Discussion')}
              </Button>
            )}
          </div>
          {isEditorFocused ? (
            <div
              className={cn(
                'mx-2 mb-2 flex gap-2',
                isMobile ? 'justify-between' : 'justify-end',
              )}
            >
              {isMobile && (
                <div className="flex items-center gap-2">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => setIsMentionsDialogOpen(true)}
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
                    onClick={() => setIsSlashDialogOpen(true)}
                  >
                    <SlashSquareIcon className="h-4 w-4" />
                  </Button>
                </div>
              )}

              <div className="flex gap-2">
                {submitButton({
                  reset,
                  getContent,
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile dialogs */}
      {isMobile && (
        <>
          <MobileMentionsDialog
            isOpen={isMentionsDialogOpen}
            onClose={() => setIsMentionsDialogOpen(false)}
            onSelect={(mention) => {
              const {state, schema} = editor._tiptapEditor
              const node = schema.nodes['inline-embed'].create(
                {link: mention.id.id},
                schema.text(' '),
              )
              editor._tiptapEditor.view.dispatch(
                state.tr.replaceSelectionWith(node).scrollIntoView(),
              )
              setIsMentionsDialogOpen(false)
              setTimeout(() => editor._tiptapEditor.commands.focus(), 100)
            }}
            perspectiveAccountUid={perspectiveAccountUid}
          />
          <MobileSlashDialog
            isOpen={isSlashDialogOpen}
            onClose={() => setIsSlashDialogOpen(false)}
            editor={editor}
          />
        </>
      )}
    </>
  )
}
