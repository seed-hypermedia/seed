import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {useBlocksContentContext} from '@shm/ui/document-content'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {InlineContent} from './blocknote/react/ReactBlockSpec'
import {MaxFileSizeB, MaxFileSizeMB} from './file'
import {MediaType} from './media-render'
import {HMBlockSchema} from './schema'

interface ContainerProps {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  mediaType: string
  styleProps?: Object
  selected: boolean
  setSelected: any
  assign: any
  children: any
  onHoverIn?: () => void
  onHoverOut?: (e: any) => void
  width?: number | string
  className?: string
  onPress?: (e: Event) => void
  validateFile?: (file: File) => boolean
}

export const MediaContainer = ({
  editor,
  block,
  mediaType,
  styleProps,
  selected,
  setSelected,
  assign,
  children,
  onHoverIn,
  onHoverOut,
  width = '100%',
  className,
  onPress,
  validateFile,
}: ContainerProps) => {
  const [hover, setHover] = useState(false)
  const [drag, setDrag] = useState(false)
  const isEmbed = ['embed', 'web-embed'].includes(mediaType)
  const {comment} = useBlocksContentContext()

  const handleDragReplace = async (file: File) => {
    if (file.size > MaxFileSizeB) {
      toast.error(`The size of ${file.name} exceeds ${MaxFileSizeMB} MB.`)
      return
    }

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
        method: 'POST',
        body: formData,
      })
      const data = await response.text()

      assign({
        props: {
          url: data ? `ipfs://${data}` : '',
          name: file.name,
          size: file.size.toString(),
        },
      } as MediaType)
    } catch (error) {
      console.error(
        `Editor: ${mediaType} upload error (MediaComponent): ${mediaType}: ${file.name} error: ${error}`,
      )
    }
  }

  const dragProps = {
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer.effectAllowed === 'move') return
      e.preventDefault()
      e.stopPropagation()
      setDrag(false)
      if (selected) setSelected(false)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = Array.from(e.dataTransfer.files)[0]
        // @ts-ignore
        if (validateFile && !validateFile(file)) {
          return
        }
        // @ts-ignore
        if (!file.type.includes(`${mediaType}/`) && mediaType !== 'file') {
          toast.error(
            `The dragged file is not ${
              mediaType === 'image' ? 'an' : 'a'
            } ${mediaType}.`,
          )
          return
        }
        // @ts-ignore
        handleDragReplace(file)
        return
      }
    },
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
      if (
        e.dataTransfer &&
        e.dataTransfer.types &&
        Array.from(e.dataTransfer.types).includes('Files')
      ) {
        e.preventDefault()
        e.stopPropagation()
        setDrag(true)
      }
    },
    onDragEnter: (e: React.DragEvent<HTMLDivElement>) => {
      if (
        e.dataTransfer &&
        e.dataTransfer.types &&
        Array.from(e.dataTransfer.types).includes('Files')
      ) {
        const relatedTarget = e.relatedTarget as HTMLElement
        e.preventDefault()
        e.stopPropagation()
        setDrag(true)
        if (
          (!relatedTarget || !e.currentTarget.contains(relatedTarget)) &&
          e.dataTransfer.effectAllowed !== 'move'
        ) {
          setSelected(true)
        }
      }
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      const relatedTarget = e.relatedTarget as HTMLElement
      e.preventDefault()
      e.stopPropagation()
      setDrag(false)
      if (
        (!relatedTarget || !e.currentTarget.contains(relatedTarget)) &&
        e.dataTransfer.effectAllowed !== 'move'
      ) {
        setSelected(false)
      }
    },
  }

  const mediaProps = {
    ...styleProps,
    ...(isEmbed ? {} : dragProps),
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (onHoverIn) onHoverIn()
      setHover(true)
    },
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
      if (onHoverOut) onHoverOut(e)
      setHover(false)
    },
  }

  return (
    <div
      className="relative flex w-full flex-col items-center gap-2 self-center"
      // className={cn(
      //   'relative flex w-full flex-col gap-2 self-center',
      //   mediaType === 'file' ? 'items-stretch' : 'items-center',
      // )}
      draggable="true"
      onDragStart={(e: any) => {
        // Uncomment to allow drag only if block is selected
        // if (!selected) {
        //   e.preventDefault()
        //   return
        // }
        e.stopPropagation()
        editor.sideMenu.blockDragStart(e)
      }}
      onDragEnd={(e: any) => {
        e.stopPropagation()
        editor.sideMenu.blockDragEnd()
      }}
      onClick={
        onPress
          ? (e) => {
              e.preventDefault()
              e.stopPropagation()
              // @ts-expect-error
              onPress(e)
            }
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
          'relative flex flex-col rounded-md border-2 transition-colors',
          mediaType === 'file' ? 'w-full' : 'w-full',
          drag || selected
            ? 'border-foreground/20 dark:border-foreground/30'
            : 'border-border',
          drag && 'border-dashed',
          comment && !drag && !selected
            ? 'bg-black/5 dark:bg-white/10'
            : 'bg-muted',
          className ?? block.type,
        )}
        style={{width}}
        {...mediaProps}
        contentEditable={false}
      >
        {(hover || selected) && mediaType !== 'embed' && editor.isEditable && (
          <Button
            variant="ghost"
            size="xs"
            className="dark:bg-background bg-muted absolute top-2 right-2 z-3 w-[60px]"
            onClick={() =>
              assign({
                props: {
                  url: '',
                  name: '',
                  size: '0',
                  displaySrc: '',
                  width:
                    mediaType === 'image' || mediaType === 'video'
                      ? editor.domElement.firstElementChild!.clientWidth
                      : undefined,
                },
                children: [],
                content: [],
                type: mediaType,
              } as MediaType)
            }
          >
            replace
          </Button>
        )}
        {children}
      </div>
      {mediaType === 'image' && (
        <InlineContent className="image-caption" contentEditable={true} />
      )}
    </div>
  )
}
