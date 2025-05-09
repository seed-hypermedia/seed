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
import {useEffect, useState} from 'react'
import {RiVideoAddLine} from 'react-icons/ri'
import {SizableText, XStack, useTheme} from 'tamagui'
import {toast} from '../../ui/src/toast'

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
  const theme = useTheme()
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
      icon={<RiVideoAddLine fill={theme.color12?.get()} />}
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
    parseFloat(block.props.width) ||
    editor.domElement.firstElementChild!.clientWidth
  const [currentWidth, setCurrentWidth] = useState(width)
  const [showHandle, setShowHandle] = useState(false)
  let resizeParams:
    | {
        handleUsed: 'left' | 'right'
        initialWidth: number
        initialClientX: number
      }
    | undefined

  useEffect(() => {
    if (block.props.width) {
      width = parseFloat(block.props.width)
      setCurrentWidth(parseFloat(block.props.width))
    }
  }, [block.props.width])

  const windowMouseMoveHandler = (event: MouseEvent) => {
    if (!resizeParams) {
      return
    }

    let newWidth: number
    if (resizeParams.handleUsed === 'left') {
      newWidth =
        resizeParams.initialWidth +
        (resizeParams.initialClientX - event.clientX) * 2
    } else {
      newWidth =
        resizeParams.initialWidth +
        (event.clientX - resizeParams.initialClientX) * 2
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
  const windowMouseUpHandler = (event: MouseEvent) => {
    setShowHandle(false)

    if (!resizeParams) {
      return
    }
    resizeParams = undefined

    assign({
      props: {
        width: width.toString(),
      },
    })

    // @ts-expect-error
    editor.updateBlock(block.id, {
      ...block,
      props: {
        width: width.toString(),
      },
    })
  }
  window.addEventListener('mousemove', windowMouseMoveHandler)
  window.addEventListener('mouseup', windowMouseUpHandler)

  // Hides the resize handles when the cursor leaves the video
  const videoMouseLeaveHandler = () => {
    if (resizeParams) {
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

    resizeParams = {
      handleUsed: 'left',
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

    resizeParams = {
      handleUsed: 'right',
      initialWidth: width || parseFloat(block.props.width),
      initialClientX: event.clientX,
    }
    editor.setTextCursorPosition(block.id, 'start')
  }

  const videoProps = {
    paddingBottom: '56.25%',
    position: 'relative',
    height: 0,
  }

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="video"
      styleProps={videoProps}
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
      {showHandle && (
        <>
          <ResizeHandle
            left={4}
            onMouseDown={leftResizeHandleMouseDownHandler}
          />
          <ResizeHandle
            right={4}
            onMouseDown={rightResizeHandleMouseDownHandler}
          />
        </>
      )}
      {block.props.displaySrc ? (
        <XStack
          tag="video"
          contentEditable={false}
          playsInline
          controls
          preload="metadata"
          top={0}
          left={0}
          position="absolute"
          width="100%"
          height="100%"
        >
          <source
            src={block.props.displaySrc}
            type={getSourceType(block.props.name)}
          />
          <SizableText>Something is wrong with the video file.</SizableText>
        </XStack>
      ) : isIpfsUrl(block.props.url) ? (
        <XStack
          tag="video"
          contentEditable={false}
          playsInline
          controls
          preload="metadata"
          top={0}
          left={0}
          position="absolute"
          width="100%"
          height="100%"
        >
          <source
            src={getDaemonFileUrl(block.props.url)}
            type={getSourceType(block.props.name)}
          />
          <SizableText>Something is wrong with the video file.</SizableText>
        </XStack>
      ) : (
        <XStack
          pointerEvents={editor.isEditable ? 'none' : 'auto'}
          tag="iframe"
          position="absolute"
          className="video-iframe"
          top={0}
          left={0}
          bottom={0}
          right={0}
          src={block.props.url}
          frameBorder="0"
          allowFullScreen
        />
      )}
    </MediaContainer>
  )
}
