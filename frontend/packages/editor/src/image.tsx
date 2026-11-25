import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {useImageUrl} from '@shm/ui/get-file-url'
import {ResizeHandle} from '@shm/ui/resize-handle'
import {toast} from '@shm/ui/toast'
import {useCallback, useEffect, useRef, useState} from 'react'
import {RiImage2Line} from 'react-icons/ri'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {createReactBlockSpec} from './blocknote/react'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'
import {HMBlockSchema} from './schema'
import {isValidUrl, timeoutPromise} from './utils'

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
    mediaRef: {
      default: '', // object with {draftId, mediaId, name, mime, size}
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

  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) =>
    Render(block, editor),

  parseHTML: [
    {
      tag: 'img[src]',
      getAttrs: (element) => {
        if (element.closest('[data-content-type="image"]')) return false

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

const Render = (block: Block<HMBlockSchema>, editor: BlockNoteEditor<HMBlockSchema>) => {
  const submitImage = (url: string, assign: any, setFileName: any, setLoading: any) => {
    if (!editor.importWebFile) {
      setFileName({
        name: 'Image import is not configured.',
        color: 'red',
      })
      return
    }

    if (isValidUrl(url)) {
      setLoading(true)
      timeoutPromise(editor.importWebFile(url), 5000, {
        reason: 'Error fetching the image.',
      })
        .then((imageData) => {
          setLoading(false)
          // Check if this is desktop result (has cid)
          if ('cid' in imageData) {
            if (!imageData.type.includes('image')) {
              setFileName({
                name: 'The provided URL is not an image.',
                color: 'red',
              })
              return
            }
            assign({props: {url: `ipfs://${imageData.cid}`}} as MediaType)
          }
          // Web result (has displaySrc and fileBinary)
          else if ('displaySrc' in imageData && 'fileBinary' in imageData) {
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
          } else {
            const imgTypeSplit = imageData.type.split('/')
            setFileName({
              name: `uploadedImage.${imgTypeSplit[imgTypeSplit.length - 1]}`,
              color: 'red',
            })
          }
        })
        .catch((e) => {
          setFileName({
            name: e.reason || e?.message || "Couldn't fetch the image from this URL.",
            color: 'red',
          })
          setLoading(false)
        })
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
      mediaType="image"
      submit={submitImage}
      DisplayComponent={ImageDisplay}
      icon={<RiImage2Line className="text-black dark:text-white" />}
    />
  )
}

/** Renders an image block with responsive sizing and editor resize handles. */
export const ImageDisplay = ({editor, block, assign}: DisplayComponentProps) => {
  const getImageUrl = useImageUrl()
  const {canEdit} = useEditorGate()

  /** Re-embed handler for the selection menu's "Insert from URL" item. */
  const handleMenuUrl = useCallback(
    (url: string) => {
      if (!editor.importWebFile) {
        toast.error('Image import is not configured.')
        return
      }
      if (!isValidUrl(url)) {
        toast.error('The provided URL is invalid.')
        return
      }
      timeoutPromise(editor.importWebFile(url), 5000, {reason: 'Error fetching the image.'})
        .then((imageData: any) => {
          if ('cid' in imageData) {
            if (!imageData.type.includes('image')) {
              toast.error('The provided URL is not an image.')
              return
            }
            assign({props: {url: `ipfs://${imageData.cid}`, displaySrc: '', mediaRef: ''}} as unknown as MediaType)
          } else if ('displaySrc' in imageData && 'fileBinary' in imageData) {
            if (!imageData.type.includes('image')) {
              toast.error('The provided URL is not an image.')
              return
            }
            assign({
              props: {fileBinary: imageData.fileBinary, displaySrc: imageData.displaySrc, url: '', mediaRef: ''},
            } as unknown as MediaType)
          }
        })
        .catch((e: any) => {
          toast.error(e?.reason || "Couldn't fetch the image from this URL.")
        })
    },
    [editor, assign],
  )

  useEffect(() => {
    const url = block.props.url
    // Skip if this is a draft media (has mediaRef), a binary URL or an IPFS URL
    if (block.props.displaySrc || block.props.mediaRef || (url && url.startsWith('ipfs://'))) {
      return
    }
    // Also skip invalid blob URLs from old drafts
    if (url && url.startsWith('blob:')) {
      return
    }
    if (url && isValidUrl(url) && editor.importWebFile) {
      // The import finishes a paste on the editor's behalf: keep it out of the undo history so
      // Cmd-Z undoes the paste that created the block rather than reverting the URL swap (which
      // would only trigger this effect again).
      const silently = {addToHistory: false}
      timeoutPromise(editor.importWebFile(url), 5000, {
        reason: 'Error fetching the image.',
      })
        .then((imageData) => {
          // Desktop result
          if ('cid' in imageData) {
            if (!imageData.type.includes('image')) {
              return
            }
            assign({props: {url: `ipfs://${imageData.cid}`}} as MediaType, silently)
          }
          // Web result
          else if ('displaySrc' in imageData && 'fileBinary' in imageData) {
            if (!imageData.type.includes('image')) {
              return
            }
            assign(
              {
                props: {
                  fileBinary: imageData.fileBinary,
                  displaySrc: imageData.displaySrc,
                },
              } as MediaType,
              silently,
            )
          }
        })
        .catch((e) => {
          console.error('Could not fetch image from URL:', e)
        })
    }
  }, [editor.importWebFile, block.props.displaySrc, block.props.mediaRef, block.props.url])
  // Determine image source:
  // 1. Use displaySrc if available
  // 2. Otherwise use url if it's an IPFS URL
  // 3. Skip invalid blob URLs from old drafts
  const imageSrc = (() => {
    const displaySrc = block.props.displaySrc
    const url = block.props.url
    let mediaRef = block.props.mediaRef

    // Parse mediaRef from JSON string if needed
    if (mediaRef && typeof mediaRef === 'string') {
      try {
        mediaRef = JSON.parse(mediaRef)
      } catch (e) {
        console.error('Failed to parse mediaRef in image display:', e)
        mediaRef = ''
      }
    }

    if (displaySrc) {
      return displaySrc
    }
    if (url) {
      // Skip invalid blob URLs from old drafts
      if (url.startsWith('blob:')) {
        console.warn('Skipping invalid blob URL from old draft:', url)
        return ''
      }
      // Handle IPFS URLs
      if (url.startsWith('ipfs://')) {
        return getImageUrl(url)
      }
      // Handle other URLs
      return url
    }
    console.warn('No valid image source found for block:', block.id)
    return ''
  })()
  // Min image width in px.
  const minWidth = 64
  // Max image height in px.
  const maxHeight = 600

  // Render the saved CSS width directly, including before the editor mounts.
  // Caching pixels here makes later hover/scroll renders use stale layout.
  const widthProp = block.props.width
  const width = widthProp?.endsWith('%') ? widthProp : parseFloat(widthProp || '') || '100%'
  const [resizeWidth, setResizeWidth] = useState<string | null>(null)
  const [showHandle, setShowHandle] = useState(false)

  const resizeParamsRef = useRef<{
    handleUsed: 'left' | 'right'
    initialWidth: number
    initialClientX: number
    containerWidth: number
    currentWidth: number
  } | null>(null)

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const params = resizeParamsRef.current
      if (!params) return

      const {handleUsed, initialClientX, initialWidth, containerWidth} = params
      const delta = handleUsed === 'left' ? initialClientX - event.clientX : event.clientX - initialClientX
      params.currentWidth = Math.min(containerWidth, Math.max(minWidth, initialWidth + delta * 2))
      setResizeWidth(`${Math.round((params.currentWidth / containerWidth) * 10000) / 100}%`)
    }

    const handleMouseUp = () => {
      const params = resizeParamsRef.current
      if (!params) return
      resizeParamsRef.current = null
      setShowHandle(false)
      assign({
        props: {
          width: `${Math.round((params.currentWidth / params.containerWidth) * 10000) / 100}%`,
        },
      })
      setResizeWidth(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [assign])

  // Hides the resize handles when the cursor leaves the image
  const imageMouseLeaveHandler = () => {
    if (resizeParamsRef.current) {
      return
    }

    setShowHandle(false)
  }

  // Sets the resize params, allowing the user to begin resizing the image by
  // moving the cursor left or right.
  const startResize = (event: React.MouseEvent<HTMLDivElement>, handleUsed: 'left' | 'right') => {
    event.preventDefault()
    setShowHandle(true)

    // The handle sits inside MediaContainer's sized frame. Its parent defines
    // the available width, including any list indentation or table column.
    const media = event.currentTarget.parentElement!
    const initialWidth = media.getBoundingClientRect().width
    resizeParamsRef.current = {
      handleUsed,
      initialWidth,
      initialClientX: event.clientX,
      containerWidth: media.parentElement!.clientWidth,
      currentWidth: initialWidth,
    }
    editor.setTextCursorPosition(block.id, 'start')
  }

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="image"
      assign={assign}
      onHoverIn={() => {
        // Suppress resize handles in viewer render type (discussion panel)
        if (editor.renderType !== 'viewer' && (canEdit || editor.isEditable)) {
          setShowHandle(true)
        }
      }}
      onHoverOut={imageMouseLeaveHandler}
      width={resizeWidth ?? width}
      onSubmitUrl={handleMenuUrl}
      urlMenuLabel="Insert from URL"
      urlInputPlaceholder="Paste an image URL"
      deleteLabel="Delete image"
    >
      {showHandle && (
        <>
          <ResizeHandle style={{left: 4}} onMouseDown={(event) => startResize(event, 'left')} />
          <ResizeHandle style={{right: 4}} onMouseDown={(event) => startResize(event, 'right')} />
        </>
      )}
      {imageSrc && (
        <img
          style={{
            width: `100%`,
            height: 'auto',
            maxHeight: `${maxHeight}px`,
            objectFit: 'contain',
          }}
          src={imageSrc}
          alt={block.props.name || block.props.alt}
          contentEditable={false}
          draggable={false}
        />
      )}
    </MediaContainer>
  )
}
