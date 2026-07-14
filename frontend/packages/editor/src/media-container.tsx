import {DAEMON_FILE_UPLOAD_URL, MAX_FILE_SIZE_B, MAX_FILE_SIZE_MB} from '@shm/shared/constants'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {Node as PMNode} from 'prosemirror-model'
import {NodeSelection} from 'prosemirror-state'
import type {ElementType} from 'react'
import {useRef, useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {getBlockInfoWithManualOffset} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {isInGridContainer} from './blocknote/core/extensions/Blocks/nodes/BlockChildren'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {InlineContent} from './blocknote/react/ReactBlockSpec'
import {markBlockUploaded, MediaType} from './media-render'
import {MediaSelectionMenu} from './media-selection-menu'
import {HMBlockSchema} from './schema'

interface ContainerProps {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  mediaType: string
  styleProps?: Object
  assign: any
  children: any
  onHoverIn?: () => void
  onHoverOut?: (e: any) => void
  width?: number | string
  className?: string
  onPress?: (e: Event) => void
  validateFile?: (file: File) => boolean
  onSubmitUrl?: (url: string) => void
  urlMenuLabel?: React.ReactNode
  urlInputPlaceholder?: string
  deleteLabel?: string
  extraMenuContent?: React.ReactNode
}

type BlockRange = {
  blockBeforePos: number
  blockAfterPos: number
  blockContentBeforePos: number
}

function findBlockRangeById(doc: PMNode, blockId: string): BlockRange | null {
  let range: BlockRange | null = null

  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'blockNode' || node.attrs?.id !== blockId) return true

    try {
      const blockInfo = getBlockInfoWithManualOffset(node, pos)
      range = {
        blockBeforePos: blockInfo.block.beforePos,
        blockAfterPos: blockInfo.block.afterPos,
        blockContentBeforePos: blockInfo.blockContent.beforePos,
      }
    } catch {
      range = {
        blockBeforePos: pos,
        blockAfterPos: pos + node.nodeSize,
        blockContentBeforePos: pos,
      }
    }
    return false
  })

  return range
}

function findBlockRangeContainingPos(doc: PMNode, targetPos: number): BlockRange | null {
  let range: BlockRange | null = null

  doc.descendants((node: PMNode, pos: number) => {
    if (node.type.name !== 'blockNode') return true

    const blockAfterPos = pos + node.nodeSize
    if (targetPos < pos || targetPos >= blockAfterPos) return true

    try {
      const blockInfo = getBlockInfoWithManualOffset(node, pos)
      range = {
        blockBeforePos: blockInfo.block.beforePos,
        blockAfterPos: blockInfo.block.afterPos,
        blockContentBeforePos: blockInfo.blockContent.beforePos,
      }
    } catch {
      range = {
        blockBeforePos: pos,
        blockAfterPos,
        blockContentBeforePos: pos,
      }
    }
    return false
  })

  return range
}

export const MediaContainer = ({
  editor,
  block,
  mediaType,
  styleProps,
  assign,
  children,
  onHoverIn,
  onHoverOut,
  width = '100%',
  className,
  onPress,
  validateFile,
  onSubmitUrl,
  urlMenuLabel,
  urlInputPlaceholder,
  deleteLabel,
  extraMenuContent,
}: ContainerProps) => {
  const [drag, setDrag] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEmbed = ['embed', 'web-embed'].includes(mediaType)
  // Card/Link embeds render a self-contained card with its own border+shadow,
  // so the MediaContainer chrome frame (border + muted bg) would double up.
  const embedView = isEmbed ? (block.props as {view?: string}).view : undefined
  const isSelfFramedEmbed = embedView === 'Card' || embedView === 'Link'
  const {canEdit, isEditing, beginEditIfNeeded} = useEditorGate()

  const handleDragReplace = async (file: File) => {
    if (file.size > MAX_FILE_SIZE_B) {
      toast.error(`The size of ${file.name} exceeds ${MAX_FILE_SIZE_MB} MB.`)
      return
    }

    const {name, size} = file

    if (editor.handleFileAttachment) {
      try {
        const result = await editor.handleFileAttachment(file)
        const props: Record<string, any> = {
          name,
          size: size.toString(),
          width: undefined,
        }
        if (result.url) {
          props.url = result.url
          props.displaySrc = ''
        } else if (result.mediaRef) {
          props.mediaRef = typeof result.mediaRef === 'string' ? result.mediaRef : JSON.stringify(result.mediaRef)
          props.url = ''
          if (block.type !== 'file') {
            props.displaySrc = result.displaySrc
          }
        } else {
          props.fileBinary = result.fileBinary
          props.url = ''
          if (block.type !== 'file') {
            props.displaySrc = result.displaySrc
          }
        }
        markBlockUploaded(block.id)
        assign({props} as MediaType)
      } catch (error) {
        console.error(`Editor: ${mediaType} replace error: ${error}`)
        toast.error(`Failed to replace ${mediaType}`)
      }
    } else {
      const formData = new FormData()
      formData.append('file', file)

      try {
        const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
          method: 'POST',
          body: formData,
        })
        if (!response.ok) {
          throw new Error(`File upload failed (${response.status}): ${await response.text()}`)
        }
        const data = await response.text()

        markBlockUploaded(block.id)
        assign({
          props: {
            url: data ? `ipfs://${data}` : '',
            name,
            size: size.toString(),
            displaySrc: '',
            width: undefined,
          },
        } as MediaType)
      } catch (error) {
        console.error(`Editor: ${mediaType} replace error (daemon): ${file.name}: ${error}`)
        toast.error(`Failed to replace ${mediaType}`)
      }
    }
  }

  const dragProps = {
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.effectAllowed === 'move') return
      e.preventDefault()
      e.stopPropagation()
      setDrag(false)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = Array.from(e.dataTransfer.files)[0]
        // @ts-ignore
        if (validateFile && !validateFile(file)) {
          return
        }
        // @ts-ignore
        if (!file.type.includes(`${mediaType}/`) && mediaType !== 'file') {
          toast.error(`The dragged file is not ${mediaType === 'image' ? 'an' : 'a'} ${mediaType}.`)
          return
        }
        // @ts-ignore
        handleDragReplace(file)
        return
      }
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault()
        e.stopPropagation()
        setDrag(true)
      }
    },
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault()
        e.stopPropagation()
        setDrag(true)
      }
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDrag(false)
    },
  }

  // The editor accepts authoring when the user has edit permission
  // or when the editor instance itself is editable
  const canAuthor = editor.renderType !== 'viewer' && (canEdit || editor.isEditable)
  const selectBlock = (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    const target = e.target as Element | null
    if (
      target?.closest?.(
        'a[href], .link, button, input, textarea, select, [role="button"], [data-media-container-ignore-select]',
      )
    ) {
      return
    }

    const view = editor._tiptapEditor?.view
    if (!view) return

    const targetRange = findBlockRangeById(view.state.doc, block.id)
    const blockContentPos = targetRange?.blockContentBeforePos ?? null

    if (blockContentPos == null) return

    if (isInGridContainer(view.state, blockContentPos)) return

    e.preventDefault()
    e.stopPropagation()
    beginEditIfNeeded()

    if (e.shiftKey) {
      const currentSelection = view.state.selection
      const anchorRange =
        currentSelection instanceof NodeSelection || currentSelection instanceof MultipleNodeSelection
          ? findBlockRangeContainingPos(view.state.doc, currentSelection.anchor)
          : null

      if (anchorRange && targetRange) {
        const from = Math.min(anchorRange.blockBeforePos, targetRange.blockBeforePos)
        const to = Math.max(anchorRange.blockAfterPos, targetRange.blockAfterPos)
        const $from = view.state.doc.resolve(from)
        const $to = view.state.doc.resolve(to)

        if ($from.depth === $to.depth && $from.node($from.depth).eq($to.node($to.depth))) {
          view.dispatch(
            view.state.tr.setSelection(MultipleNodeSelection.create(view.state.doc, from, to)).scrollIntoView(),
          )
          view.focus()
          return
        }
      }
    }

    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, blockContentPos)).scrollIntoView())
    view.focus()
  }

  const handleImageCaptionKeyDown = (event: React.KeyboardEvent<ElementType>) => {
    if (event.key !== 'Enter' || event.shiftKey) return

    event.preventDefault()
    event.stopPropagation()

    const cursorPosition = editor.getTextCursorPosition()
    if (cursorPosition.block.id !== block.id) return

    if (cursorPosition.nextBlock) {
      editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
    } else {
      editor.insertBlocks([{type: 'paragraph', content: ''}], block.id, 'after')
      const nextBlock = editor.getTextCursorPosition().nextBlock
      if (nextBlock) editor.setTextCursorPosition(nextBlock, 'start')
    }

    editor.focus()
  }

  const mediaProps = {
    ...styleProps,
    ...(isEmbed || !canAuthor ? {} : dragProps),
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (onHoverIn) onHoverIn()
    },
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (onHoverOut) onHoverOut(e)
    },
  }

  return (
    <div
      className="relative flex w-full flex-col items-center gap-2 self-center"
      // className={cn(
      //   'relative flex w-full flex-col gap-2 self-center',
      //   mediaType === 'file' ? 'items-stretch' : 'items-center',
      // )}
      draggable={canAuthor ? 'true' : 'false'}
      onDragStart={(e: any) => {
        // Uncomment to allow drag only if block is selected
        // if (!selected) {
        //   e.preventDefault()
        //   return
        // }
        e.stopPropagation()
        beginEditIfNeeded()
        editor.sideMenu!.blockDragStart(e)
      }}
      onDragEnd={(e: any) => {
        e.stopPropagation()
        editor.sideMenu!.blockDragEnd()
      }}
      onClick={
        onPress
          ? (e) => {
              if (canAuthor && e.shiftKey) {
                selectBlock(e)
                return
              }
              e.preventDefault()
              e.stopPropagation()
              // @ts-expect-error
              onPress(e)
            }
          : canAuthor
            ? selectBlock
            : undefined
      }
    >
      {drag && !isEmbed && (
        <div className="pointer-events-none absolute inset-0 z-5 flex items-center justify-center">
          <div className="bg-background border-muted relative flex rounded-md border-2 px-4 py-2">
            <Text className="font-mono text-sm">Drop to replace</Text>
          </div>
          <div className="bg-muted absolute inset-0 flex opacity-75" />
        </div>
      )}
      <div
        className={cn(
          'group relative flex w-full max-w-full flex-col rounded-md transition-colors',
          // Image/video carry their own rounding + shadow (see hm-prose.css),
          // so they get no chrome border; other media keep the framed box.
          // The dashed border still appears while dragging as a drop target.
          drag
            ? 'border-foreground/20 dark:border-foreground/30 border-2 border-dashed'
            : mediaType === 'image' || mediaType === 'video' || isSelfFramedEmbed
              ? ''
              : 'border-border border-2',
          editor.commentEditor && !drag ? 'bg-black/5 dark:bg-white/10' : isSelfFramedEmbed ? '' : 'bg-muted',
          className ?? block.type,
        )}
        style={{width}}
        {...mediaProps}
        contentEditable={false}
      >
        {mediaType !== 'embed' && editor.renderType !== 'viewer' && canEdit && (mediaType !== 'file' || isEditing) && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={mediaType === 'file' ? undefined : `${mediaType}/*`}
              style={{display: 'none'}}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                if (validateFile && !validateFile(file)) return
                handleDragReplace(file)
                e.target.value = ''
              }}
            />
            {onSubmitUrl ? (
              <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <MediaSelectionMenu
                  onReplaceFile={() => fileInputRef.current?.click()}
                  onSubmitUrl={onSubmitUrl}
                  onDelete={() => editor.removeBlocks([block.id])}
                  currentUrl={((block.props as Record<string, unknown>).url as string | undefined) ?? ''}
                  urlMenuLabel={urlMenuLabel ?? 'Insert from URL'}
                  urlInputPlaceholder={urlInputPlaceholder}
                  deleteLabel={deleteLabel}
                  testIdPrefix={mediaType}
                  extraContent={extraMenuContent}
                />
              </div>
            ) : (
              <Button
                variant="accent"
                size="xs"
                className="replace-btn absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                onClick={() => fileInputRef.current?.click()}
              >
                replace
              </Button>
            )}
          </>
        )}
        {children}
      </div>
      {mediaType === 'image' && (
        <InlineContent
          className="image-caption"
          contentEditable={editor.isEditable}
          data-media-container-ignore-select
          onKeyDown={handleImageCaptionKeyDown}
        />
      )}
    </div>
  )
}
