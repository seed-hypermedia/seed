import {Switch} from '@shm/ui/components/switch'
import {isIpfsUrl, useFileProxyUrl} from '@shm/ui/get-file-url'
import {ResizeHandle} from '@shm/ui/resize-handle'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {useEffect, useRef, useState} from 'react'
import {RiVideoAddLine} from 'react-icons/ri'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {createReactBlockSpec} from './blocknote/react/ReactBlockSpec'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'
import {HMBlockSchema} from './schema'
import {isValidUrl, youtubeParser} from './utils'

export const getSourceType = (name: string) => {
  const nameArray = name.split('.')
  const ext = nameArray[nameArray.length - 1]?.toLowerCase()
  if (!ext) return undefined
  // MOV files typically use H.264/AAC codecs that browsers support
  if (ext === 'mov') return 'video/mp4'
  return `video/${ext}`
}

function getVideoIframeSrc(link: string) {
  const url = new URL(link)
  if (url.host.includes('youtube.com')) {
    url.searchParams.set('rel', '0')
    return url.toString()
  }
  return link
}

export const VideoBlock = createReactBlockSpec({
  type: 'video',
  propSchema: {
    ...defaultProps,
    url: {
      default: '',
    },
    fileBinary: {
      default: '',
    },
    displaySrc: {
      default: '',
    },
    mediaRef: {
      default: '', // object with {draftId, mediaId, name, mime, size}
    },
    src: {
      default: '',
    },
    name: {
      default: '',
    },
    width: {
      default: '',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'false',
    },
    autoplay: {
      values: ['false', 'true'],
      default: 'false',
    },
    loop: {
      values: ['false', 'true'],
      default: 'false',
    },
    muted: {
      values: ['false', 'true'],
      default: 'false',
    },
  },
  containsInlineContent: true,
  // @ts-ignore
  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) =>
    Render(block, editor),

  parseHTML: [
    {
      tag: 'video[src]',
      getAttrs: (element) => {
        if (element.closest('[data-content-type="video"]')) return false
        return {src: element.getAttribute('src')}
      },
    },
    {
      tag: 'iframe',
      getAttrs: (element) => {
        if (element.closest('[data-content-type="video"]')) return false
        return {src: element.getAttribute('src')}
      },
    },
  ],
})

const Render = (block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) => {
  const submitVideo = (url: string, assign: any, setFileName: any) => {
    if (isValidUrl(url)) {
      let embedUrl = 'https://www.youtube.com/embed/'
      if (url.includes('youtu.be') || url.includes('youtube')) {
        let ytId = youtubeParser(url)
        if (ytId) {
          embedUrl = embedUrl + ytId
        } else {
          setFileName({name: `Unsupported Youtube Url:${url}`, color: 'red'})
          return
        }
      } else if (url.includes('vimeo')) {
        const urlArray = url.split('/')
        embedUrl = `https://player.vimeo.com/video/${urlArray[urlArray.length - 1]}`
      } else {
        setFileName({name: 'Unsupported video source.', color: 'red'})
        return
      }
      assign({props: {url: embedUrl}} as MediaType)
    } else setFileName({name: 'The provided URL is invalid.', color: 'red'})
    const cursorPosition = editor.getTextCursorPosition()
    editor.focus()
    if (cursorPosition.block.id === block.id) {
      if (cursorPosition.nextBlock) editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
      else {
        editor.insertBlocks([{type: 'paragraph', content: ''}], block.id, 'after')
        editor.setTextCursorPosition(editor.getTextCursorPosition().nextBlock!, 'start')
      }
    }
  }

  return (
    <MediaRender
      block={block}
      hideForm={!!block.props.url || !!block.props.displaySrc}
      editor={editor}
      mediaType="video"
      submit={submitVideo}
      DisplayComponent={display}
      icon={<RiVideoAddLine className="text-black dark:text-white" />}
      validateFile={validateFile}
    />
  )
}

function validateFile(file: File) {
  const supportedTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']
  if (file.type && !supportedTypes.includes(file.type)) {
    toast.error('This video file format is not supported. Upload as a file, or convert the video to .mp4')
    return false
  }
  return true
}

function SegmentedToggle({
  options,
  value,
  onChange,
  disabled,
}: {
  options: {label: string; value: string}[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div
      className={cn(
        'bg-muted inline-flex items-center rounded-lg border border-black/10 p-0.5 dark:border-white/10',
        disabled && 'opacity-50',
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          className={cn(
            'cursor-default rounded-md px-3 py-1 text-xs font-medium transition-colors select-none',
            value === option.value ? 'bg-brand text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
            disabled && 'pointer-events-none',
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function VideoOptions({
  autoplay,
  setAutoplay,
  loop,
  setLoop,
  muted,
  setMuted,
}: {
  autoplay: boolean
  setAutoplay: (v: boolean) => void
  loop: boolean
  setLoop: (v: boolean) => void
  muted: boolean
  setMuted: (v: boolean) => void
}) {
  return (
    <div className="flex w-full cursor-default flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm select-none">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground cursor-default text-xs font-medium select-none">Autoplay</span>
        <Switch checked={autoplay} onCheckedChange={setAutoplay} />
      </div>
      <div className="bg-border h-4 w-px shrink-0" />
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground cursor-default text-xs font-medium select-none">Loop</span>
        <SegmentedToggle
          options={[
            {label: 'Once', value: 'once'},
            {label: 'Loop', value: 'loop'},
          ]}
          value={loop ? 'loop' : 'once'}
          onChange={(v) => setLoop(v === 'loop')}
        />
      </div>
      <div className="bg-border h-4 w-px shrink-0" />
      {autoplay ? (
        <Tooltip content="Autoplay videos must be muted" side="top">
          <div className="flex items-center gap-2 opacity-50">
            <span className="text-muted-foreground cursor-default text-xs font-medium select-none">Sound</span>
            <SegmentedToggle
              options={[
                {label: 'Off', value: 'off'},
                {label: 'On', value: 'on'},
              ]}
              value="off"
              onChange={() => {}}
              disabled
            />
          </div>
        </Tooltip>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground cursor-default text-xs font-medium select-none">Sound</span>
          <SegmentedToggle
            options={[
              {label: 'Off', value: 'off'},
              {label: 'On', value: 'on'},
            ]}
            value={muted ? 'off' : 'on'}
            onChange={(v) => setMuted(v === 'off')}
          />
        </div>
      )}
    </div>
  )
}

const display = ({editor, block, selected, setSelected, assign}: DisplayComponentProps) => {
  const getFileUrl = useFileProxyUrl()
  const autoplay = block.props.autoplay === 'true'
  const loop = block.props.loop === 'true'
  const muted = block.props.muted === 'true'

  const setAutoplay = (v: boolean) => {
    if (v) {
      assign({props: {autoplay: 'true', muted: 'true'}})
    } else {
      assign({props: {autoplay: 'false'}})
    }
  }
  const setLoop = (v: boolean) => assign({props: {loop: v ? 'true' : 'false'}})
  const setMuted = (v: boolean) => assign({props: {muted: v ? 'true' : 'false'}})

  // Determine video source
  const videoSrc = (() => {
    // @ts-ignore
    const displaySrc = block.props.displaySrc
    // @ts-ignore
    const url = block.props.url

    if (displaySrc) {
      return displaySrc
    }
    if (url) {
      // Skip invalid blob URLs from old drafts
      if (url.startsWith('blob:')) {
        console.warn('Skipping invalid blob URL from old draft:', url)
        return ''
      }
      if (isIpfsUrl(url)) {
        return getFileUrl(url)
      }
      return url
    }
    return ''
  })()

  // Min video width in px.
  const minWidth = 256
  let width: number =
    // @ts-ignore
    parseFloat(block.props.width) || editor.domElement.firstElementChild!.clientWidth
  const [currentWidth, setCurrentWidth] = useState(width)
  const [showHandle, setShowHandle] = useState(false)
  const resizeParamsRef = useRef<{
    handleUsed: 'left' | 'right'
    initialWidth: number
    initialClientX: number
  } | null>(null)

  useEffect(() => {
    if (block.props.width) {
      width = parseFloat(block.props.width)
      setCurrentWidth(parseFloat(block.props.width))
    } else {
      width = editor.domElement.firstElementChild!.clientWidth
      setCurrentWidth(width)
    }
  }, [block.props.width])

  const windowMouseMoveHandler = (event: MouseEvent) => {
    if (!resizeParamsRef.current) {
      return
    }

    const {handleUsed, initialClientX, initialWidth} = resizeParamsRef.current

    let newWidth: number
    if (handleUsed === 'left') {
      newWidth = initialWidth + (initialClientX - event.clientX) * 2
    } else {
      newWidth = initialWidth + (event.clientX - initialClientX) * 2
    }

    // Ensures the video is not wider than the editor and not smaller than a
    // predetermined minimum width.
    if (newWidth < minWidth) {
      width = minWidth
      setCurrentWidth(minWidth)
    } else if (newWidth > editor.domElement.firstElementChild!.clientWidth) {
      width = editor.domElement.firstElementChild!.clientWidth
      setCurrentWidth(editor.domElement.firstElementChild!.clientWidth)
    } else {
      width = newWidth
      setCurrentWidth(newWidth)
    }
  }

  // Stops mouse movements from resizing the video and updates the block's
  // `width` prop to the new value.
  const windowMouseUpHandler = () => {
    setShowHandle(false)

    if (!resizeParamsRef.current) {
      return
    }
    resizeParamsRef.current = null

    assign({
      props: {
        width: width.toString(),
      },
    })
  }
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => windowMouseMoveHandler(e)
    const handleMouseUp = () => windowMouseUpHandler()

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // Hides the resize handles when the cursor leaves the video
  const videoMouseLeaveHandler = () => {
    if (resizeParamsRef.current) {
      return
    }

    setShowHandle(false)
  }

  // Sets the resize params, allowing the user to begin resizing the video by
  // moving the cursor left or right.
  const leftResizeHandleMouseDownHandler = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    setShowHandle(true)

    resizeParamsRef.current = {
      handleUsed: 'left',
      // @ts-ignore
      initialWidth: width || parseFloat(block.props.width),
      initialClientX: event.clientX,
    }
    editor.setTextCursorPosition(block.id, 'start')
  }

  const rightResizeHandleMouseDownHandler = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()

    setShowHandle(true)

    resizeParamsRef.current = {
      handleUsed: 'right',
      // @ts-ignore
      initialWidth: width || parseFloat(block.props.width),
      initialClientX: event.clientX,
    }
    editor.setTextCursorPosition(block.id, 'start')
  }

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="video"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
      onHoverIn={() => {
        if (editor.isEditable) {
          setShowHandle(true)
        }
      }}
      onHoverOut={videoMouseLeaveHandler}
      width={currentWidth}
      validateFile={validateFile}
    >
      <div className="relative aspect-[16/9] w-full">
        {showHandle && (
          <>
            <ResizeHandle style={{left: 4}} onMouseDown={leftResizeHandleMouseDownHandler} />
            <ResizeHandle style={{right: 4}} onMouseDown={rightResizeHandleMouseDownHandler} />
          </>
        )}
        {block.props.displaySrc || isIpfsUrl(block.props.url || '') ? (
          <video
            key={videoSrc}
            contentEditable={false}
            playsInline
            controls
            preload="metadata"
            className="absolute top-0 left-0 h-full w-full"
          >
            <source
              src={videoSrc}
              // @ts-ignore
              type={getSourceType(block.props.name)}
            />
            <p>Error with the video file.</p>
          </video>
        ) : block.props.url ? (
          <iframe
            contentEditable={false}
            className={cn(
              'video-iframe absolute top-0 right-0 bottom-0 left-0',
              !editor.isEditable && 'pointer-events-auto',
              editor.isEditable && !selected && 'pointer-events-none',
              editor.isEditable && selected && 'pointer-events-auto',
            )}
            src={getVideoIframeSrc(block.props.url)}
            allowFullScreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : null}
      </div>
      {editor.isEditable && (block.props.displaySrc || isIpfsUrl(block.props.url || '')) && (
        <VideoOptions
          autoplay={autoplay}
          setAutoplay={setAutoplay}
          loop={loop}
          setLoop={setLoop}
          muted={muted}
          setMuted={setMuted}
        />
      )}
    </MediaContainer>
  )
}
