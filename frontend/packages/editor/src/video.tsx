import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {Block} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {createReactBlockSpec} from '@/blocknote/react/ReactBlockSpec'
import {MediaContainer} from '@/media-container'
import {DisplayComponentProps, MediaRender, MediaType} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {isValidUrl, youtubeParser} from '@/utils'
import {getDaemonFileUrl, isIpfsUrl} from '@shm/ui/get-file-url'
import {ResizeHandle} from '@shm/ui/resize-handle'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {useEffect, useRef, useState} from 'react'
import {RiVideoAddLine} from 'react-icons/ri'

export const getSourceType = (name: string) => {
  const nameArray = name.split('.')
  return nameArray[nameArray.length - 1]
    ? `video/${nameArray[nameArray.length - 1]}`
    : undefined
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
  },
  containsInlineContent: true,
  // @ts-ignore
  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),

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

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
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
        embedUrl = `https://player.vimeo.com/video/${
          urlArray[urlArray.length - 1]
        }`
      } else {
        setFileName({name: 'Unsupported video source.', color: 'red'})
        return
      }
      assign({props: {url: embedUrl}} as MediaType)
    } else setFileName({name: 'The provided URL is invalid.', color: 'red'})
    const cursorPosition = editor.getTextCursorPosition()
    editor.focus()
    if (cursorPosition.block.id === block.id) {
      if (cursorPosition.nextBlock)
        editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
      else {
        editor.insertBlocks(
          [{type: 'paragraph', content: ''}],
          block.id,
          'after',
        )
        editor.setTextCursorPosition(
          editor.getTextCursorPosition().nextBlock!,
          'start',
        )
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
  if (file.type === 'video/quicktime') {
    toast.error(
      'This video file format is not supported. Upload as a file, or convert the video to .mp4',
    )
    return false
  }
  return true
}

const display = ({
  editor,
  block,
  selected,
  setSelected,
  assign,
}: DisplayComponentProps) => {
  // const videoSrc = block.props.displaySrc || getDaemonFileUrl(block.props.url)

  // Min video width in px.
  const minWidth = 256
  let width: number =
    // @ts-expect-error
    parseFloat(block.props.width) ||
    editor.domElement.firstElementChild!.clientWidth
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
  const leftResizeHandleMouseDownHandler = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()

    setShowHandle(true)

    resizeParamsRef.current = {
      handleUsed: 'left',
      // @ts-expect-error
      initialWidth: width || parseFloat(block.props.width),
      initialClientX: event.clientX,
    }
    editor.setTextCursorPosition(block.id, 'start')
  }

  const rightResizeHandleMouseDownHandler = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()

    setShowHandle(true)

    resizeParamsRef.current = {
      handleUsed: 'right',
      // @ts-expect-error
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
            <ResizeHandle
              style={{left: 4}}
              onMouseDown={leftResizeHandleMouseDownHandler}
            />
            <ResizeHandle
              style={{right: 4}}
              onMouseDown={rightResizeHandleMouseDownHandler}
            />
          </>
        )}
        {block.props.displaySrc ? (
          <video
            contentEditable={false}
            playsInline
            controls
            preload="metadata"
            className="absolute top-0 left-0 h-full w-full"
          >
            <source
              src={block.props.displaySrc || getDaemonFileUrl(block.props.url)}
              // @ts-expect-error
              type={getSourceType(block.props.name)}
            />
            <p>Error with the video file.</p>
          </video>
        // @ts-expect-error
        ) : isIpfsUrl(block.props.url) ? (
          <video
            contentEditable={false}
            playsInline
            controls
            preload="metadata"
            className="absolute top-0 left-0 h-full w-full"
          >
            <source
              src={getDaemonFileUrl(block.props.url)}
              // @ts-expect-error
              type={getSourceType(block.props.name)}
            />
            <p>Error with the video file.</p>
          </video>
        ) : (
          <iframe
            contentEditable={false}
            className={cn(
              'video-iframe absolute top-0 right-0 bottom-0 left-0',
              !editor.isEditable && 'pointer-events-auto',
              editor.isEditable && 'pointer-events-none',
            )}
            src={block.props.url}
            frameBorder="0"
            allowFullScreen
          />
        )}
      </div>
    </MediaContainer>
  )
}
