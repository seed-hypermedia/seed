import {DAEMON_FILE_UPLOAD_URL, MAX_FILE_SIZE_B, MAX_FILE_SIZE_MB} from '@shm/shared/constants'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {Button} from '@shm/ui/button'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {useRef, useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {InlineContent} from './blocknote/react/ReactBlockSpec'
import {markBlockUploaded, MediaType} from './media-render'
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
  const [drag, setDrag] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const isEmbed = ['embed', 'web-embed'].includes(mediaType)
  const {canEdit, beginEditIfNeeded} = useEditorGate()

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
      if (selected) setSelected(false)
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
        const relatedTarget = e.relatedTarget as HTMLElement
        e.preventDefault()
        e.stopPropagation()
        setDrag(true)
        if ((!relatedTarget || !e.currentTarget.contains(relatedTarget)) && e.dataTransfer.effectAllowed !== 'move') {
          setSelected(true)
        }
      }
    },
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
      const relatedTarget = e.relatedTarget as HTMLElement
      e.preventDefault()
      e.stopPropagation()
      setDrag(false)
      if ((!relatedTarget || !e.currentTarget.contains(relatedTarget)) && e.dataTransfer.effectAllowed !== 'move') {
        setSelected(false)
      }
    },
  }

  const mediaProps = {
    ...styleProps,
    ...(isEmbed || !canEdit ? {} : dragProps),
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
      draggable={canEdit ? 'true' : 'false'}
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
          'group relative flex flex-col rounded-md border-2 transition-colors',
          mediaType === 'file' ? 'w-full' : 'w-full',
          drag || selected ? 'border-foreground/20 dark:border-foreground/30' : 'border-border',
          drag && 'border-dashed',
          editor.commentEditor && !drag && !selected ? 'bg-black/5 dark:bg-white/10' : 'bg-muted',
          className ?? block.type,
        )}
        style={{width}}
        {...mediaProps}
        contentEditable={false}
      >
        {mediaType !== 'embed' && canEdit && (
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
            <Button
              variant="accent"
              size="xs"
              className={cn(
                'absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                selected && 'opacity-100',
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              replace
            </Button>
          </>
        )}
        {children}
      </div>
      {mediaType === 'image' && <InlineContent className="image-caption" contentEditable={true} />}
    </div>
  )
}
