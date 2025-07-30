import {EditorBlock, writeableStateStream} from '@shm/shared'
import {HMBlockNode} from '@shm/shared/hm-types'
import {useInlineMentions} from '@shm/shared/models/inline-mentions'
import {queryClient} from '@shm/shared/models/query-client'
import {useAccount} from '@shm/shared/src/models/entity'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Trash} from '@shm/ui/icons'
import {Tooltip} from '@shm/ui/tooltip'
import {Extension} from '@tiptap/core'
import {useEffect, useState} from 'react'
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

export default function CommentEditor({
  onDiscardDraft,
  submitButton,
  handleSubmit,
  perspectiveAccountUid,
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
  perspectiveAccountUid?: string | null | undefined
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
}) {
  const {editor} = useCommentEditor(perspectiveAccountUid)
  const {openUrl, handleFileAttachment} = useDocContentContext()
  const [isDragging, setIsDragging] = useState(false)

  const reset = () => {
    editor.removeBlocks(editor.topLevelBlocks)
  }

  const getContent = async (
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
    blocksWithAttachments.forEach((block, i) => {
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
    <div className="flex w-full flex-col gap-3">
      <div
        className="comment-editor bg-muted mt-1 flex min-h-[105px] flex-col gap-4 rounded-md px-4 pb-2"
        onClick={(e: MouseEvent) => {
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
        <HyperMediaEditorView editor={editor} openUrl={openUrl} />
      </div>
      <div className="flex justify-end gap-3">
        {onDiscardDraft ? (
          <Tooltip content="Discard Comment Draft">
            <Button variant="destructive" size="sm" onClick={onDiscardDraft}>
              <Trash size={16} />
            </Button>
          </Tooltip>
        ) : null}
        {submitButton({
          reset,
          getContent,
        })}
      </div>
    </div>
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

export function useCommentEditor(
  perspectiveAccountUid?: string | null | undefined,
) {
  const {onMentionsQuery} = useInlineMentions(perspectiveAccountUid)

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

export function CommentEditor2({
  submitButton,
  handleSubmit,
  account,
  autoFocus,
  perspectiveAccountUid,
}: {
  onDiscardDraft?: () => void
  account?: ReturnType<typeof useAccount>['data']
  autoFocus?: boolean
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
  perspectiveAccountUid?: string | null | undefined
}) {
  const {editor} = useCommentEditor(perspectiveAccountUid)
  const [isEditorFocused, setIsEditorFocused] = useState(
    () => autoFocus || false,
  )
  const {openUrl, handleFileAttachment} = useDocContentContext()
  const [isDragging, setIsDragging] = useState(false)
  const tx = useTx()
  const reset = () => {
    editor.removeBlocks(editor.topLevelBlocks)
  }

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
    const editorBlocks: EditorBlock[] = editor.topLevelBlocks
    const blocksWithAttachments = crawlEditorBlocks(
      editorBlocks,
      (block) => !!block.props?.fileBinary,
    )
    const {blobs, resultCIDs} = await prepareAttachments(
      blocksWithAttachments.map((block) => block.props.fileBinary),
    )
    blocksWithAttachments.forEach((block, i) => {
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
    <div className="flex w-full items-start gap-2">
      <div className="flex shrink-0 grow-0">
        {account?.metadata ? (
          <HMIcon
            color={'$color8'}
            id={account.id}
            metadata={account.metadata}
            size={32}
          />
        ) : null}
      </div>
      <div className="bg-muted w-full flex-1 rounded-md">
        <div
          justifyContent={isEditorFocused ? 'flex-start' : 'center'}
          flex={1}
          className="comment-editor"
          paddingHorizontal={isEditorFocused ? '$3' : undefined}
          // marginTop="$1"

          // minHeight={isEditorFocused ? 105 : 40}
          // paddingHorizontal="$4"
          onPress={(e: MouseEvent) => {
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
          // gap="$4"
          // paddingBottom="$2"
          // bg="$color4"
          // paddingHorizontal="$4"
          minHeight={40}
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
              variant="ghost"
              className="justify-start"
            >
              {tx('Start a Comment')}
            </Button>
          )}
        </div>
        {isEditorFocused ? (
          <div className="flex self-end">
            {submitButton({
              reset,
              getContent,
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
