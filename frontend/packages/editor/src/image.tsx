import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {Block} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {createReactBlockSpec} from '@/blocknote/react'
import {MediaContainer} from '@/media-container'
import {DisplayComponentProps, MediaRender, MediaType} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {isValidUrl, timeoutPromise} from '@/utils'
import {useDocContentContext} from '@shm/ui/document-content'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {ResizeHandle} from '@shm/ui/resize-handle'
import {useEffect, useState} from 'react'
import {RiImage2Line} from 'react-icons/ri'
import {useTheme} from 'tamagui'

export const ImageBlock = createReactBlockSpec({
  type: 'image',
  propSchema: {
    ...defaultProps,
    url: {
      default: '',
    },
    fileBinary: {
      default: '', // really a Uint8Array
    },
    displaySrc: {
      default: '',
    },
    alt: {
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

  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),

  parseHTML: [
    {
      tag: 'img[src]',
      getAttrs: (element) => {
        const name = element.getAttribute('title')
        const width = element.getAttribute('width') || element.style.width
        const alt = element.getAttribute('alt')
        return {
          url: element.getAttribute('src'),
          src: element.getAttribute('src'),
          name,
          width,
          alt,
          // content: [
          //   {type: 'paragraph', content: [{type: 'text', text: altText}]},
          // ],
        }
      },
      node: 'image',
    },
  ],
})

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const theme = useTheme()
  const {importWebFile} = useDocContentContext()

  const submitImage = (
    url: string,
    assign: any,
    setFileName: any,
    setLoading: any,
  ) => {
    if (isValidUrl(url)) {
      setLoading(true)
      if (typeof importWebFile?.mutateAsync === 'function') {
        timeoutPromise(importWebFile.mutateAsync(url), 5000, {
          reason: 'Error fetching the image.',
        })
          .then((imageData) => {
            setLoading(false)
            if (imageData?.cid) {
              if (!imageData.type.includes('image')) {
                setFileName({
                  name: 'The provided URL is not an image.',
                  color: 'red',
                })
                return
              }
              assign({props: {url: `ipfs://${imageData.cid}`}} as MediaType)
              setLoading(false)
            } else {
              let imgTypeSplit = imageData.type.split('/')
              setFileName({
                name: `uploadedImage.${imgTypeSplit[imgTypeSplit.length - 1]}`,
                color: 'red',
              })
              setLoading(false)
            }
          })
          .catch((e) => {
            setFileName({
              name: e.reason,
              color: 'red',
            })
            setLoading(false)
          })
      } else {
        importWebFile(url)
          .then((imageData) => {
            setLoading(false)
            if (imageData?.displaySrc && imageData?.fileBinary) {
              if (!imageData.type.includes('image')) {
                setFileName({
                  name: 'The provided URL is not an image.',
                  color: 'red',
                })
                return
              }
              assign({
                props: {
                  fileBinary: imageData.fileBinary,
                  displaySrc: imageData.displaySrc,
                },
              } as MediaType)
              setLoading(false)
            } else {
              let imgTypeSplit = imageData.type.split('/')
              setFileName({
                name: `uploadedImage.${imgTypeSplit[imgTypeSplit.length - 1]}`,
                color: 'red',
              })
              setLoading(false)
            }
          })
          .catch((e) => {
            setFileName({
              name: "Couldn't fetch the image from this URL due to restrictions. Please download it manually and upload it from your device.",
              color: 'red',
            })
            setLoading(false)
          })
      }
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
      mediaType="image"
      submit={submitImage}
      DisplayComponent={display}
      icon={<RiImage2Line fill={theme.color12?.get()} />}
    />
  )
}

const display = ({
  editor,
  block,
  selected,
  setSelected,
  assign,
}: DisplayComponentProps) => {
  const {importWebFile} = useDocContentContext()
  useEffect(() => {
    if (!block.props.displaySrc && !block.props.url.startsWith('ipfs://')) {
      const url = block.props.url
      if (isValidUrl(url)) {
        timeoutPromise(importWebFile.mutateAsync(url), 5000, {
          reason: 'Error fetching the image.',
        })
          .then((imageData) => {
            if (imageData?.cid) {
              if (!imageData.type.includes('image')) {
                return
              }
              assign({props: {url: `ipfs://${imageData.cid}`}} as MediaType)
            }
          })
          .catch((e) => {
            console.error(e)
          })
      }
    }
  }, [])
  const imageSrc = block.props.displaySrc || getDaemonFileUrl(block.props.url)
  // Min image width in px.
  const minWidth = 64
  // Max image height in px.
  const maxHeight = 600

  let width: number =
    parseFloat(block.props.width) ||
    editor.domElement.firstElementChild!.clientWidth
  const [currentWidth, setCurrentWidth] = useState(width)
  const [showHandle, setShowHandle] = useState(false)
  // Track image natural dimensions for aspect ratio calculation
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null)

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

  // Handle image load to get aspect ratio
  const handleImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    if (img.naturalWidth && img.naturalHeight) {
      const aspectRatio = img.naturalWidth / img.naturalHeight
      setImageAspectRatio(aspectRatio)

      // If current width would make height exceed maxHeight, adjust width
      if (aspectRatio && currentWidth / aspectRatio > maxHeight) {
        const newWidth = maxHeight * aspectRatio
        setCurrentWidth(newWidth)
        assign({
          props: {
            width: newWidth.toString(),
          },
        })
      }
    }
  }

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

    // Ensures the image is not wider than the editor and not smaller than a
    // predetermined minimum width.
    if (newWidth < minWidth) {
      width = minWidth
      setCurrentWidth(minWidth)
    } else if (newWidth > editor.domElement.firstElementChild!.clientWidth) {
      width = editor.domElement.firstElementChild!.clientWidth
      setCurrentWidth(editor.domElement.firstElementChild!.clientWidth)
    } else {
      // Check if new width would make height exceed maxHeight (if we know aspect ratio)
      if (imageAspectRatio) {
        const projectedHeight = newWidth / imageAspectRatio
        if (projectedHeight > maxHeight) {
          // Limit width based on maxHeight and aspect ratio
          newWidth = maxHeight * imageAspectRatio
        }
      }

      width = newWidth
      setCurrentWidth(newWidth)
    }
  }

  // Stops mouse movements from resizing the image and updates the block's
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

  // Hides the resize handles when the cursor leaves the image
  const imageMouseLeaveHandler = (event) => {
    if (resizeParams) {
      return
    }

    setShowHandle(false)
  }

  // Sets the resize params, allowing the user to begin resizing the image by
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

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="image"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
      onHoverIn={() => {
        if (editor.isEditable) {
          setShowHandle(true)
        }
      }}
      onHoverOut={imageMouseLeaveHandler}
      width={currentWidth}
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
      {imageSrc && (
        <img
          style={{
            width: `100%`,
            maxHeight: `${maxHeight}px`,
            objectFit: 'contain',
          }}
          src={imageSrc}
          alt={block.props.name || block.props.alt}
          contentEditable={false}
          onLoad={handleImageLoad}
        />
      )}
    </MediaContainer>
  )
}
