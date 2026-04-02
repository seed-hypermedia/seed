import {BlockNoteEditor} from '../../core/BlockNoteEditor'
import {BlockSchema} from '../../core/extensions/Blocks/api/blockTypes'
import {imageGalleryPluginKey} from '../../core/extensions/ImageGallery/ImageGalleryPlugin'
import {ChevronLeft, ChevronRight, X} from 'lucide-react'
import {useCallback, useEffect} from 'react'
import {createPortal} from 'react-dom'
import {useEditorForceUpdate} from '../hooks/useEditorForceUpdate'

/** Props for the ImageGalleryOverlay component. */
export type ImageGalleryOverlayProps<BSchema extends BlockSchema> = {
  /** The BlockNote editor instance whose plugin state drives the overlay. */
  editor: BlockNoteEditor<BSchema>
  /**
   * Optional resolver that converts an IPFS or internal URL to a displayable
   * HTTP URL. The raw `url` value from the image node is passed in and the
   * return value is used as the `src` on the `<img>` element. When omitted
   * the URL is used as-is.
   */
  resolveImageUrl?: (url: string) => string
}

/**
 * Full-screen image gallery overlay driven by the `ImageGalleryPlugin`.
 *
 * Renders into `document.body` via a React portal so that it sits above all
 * other page content regardless of where the editor is mounted.
 *
 * Keyboard shortcuts:
 * - `ArrowLeft` / `ArrowRight` — navigate between images
 * - `Escape` — close the overlay
 *
 * The component re-renders on every editor transaction so that it always
 * reflects the latest plugin state.
 */
export function ImageGalleryOverlay<BSchema extends BlockSchema>({
  editor,
  resolveImageUrl,
}: ImageGalleryOverlayProps<BSchema>) {
  // Re-render whenever the editor emits a transaction (plugin state may change).
  useEditorForceUpdate(editor._tiptapEditor)

  const view = editor.prosemirrorView
  const pluginState = imageGalleryPluginKey.getState(view.state)

  const dispatch = useCallback(
    (action: Parameters<typeof view.state.tr.setMeta>[1]) => {
      view.dispatch(view.state.tr.setMeta(imageGalleryPluginKey, action))
    },
    [view],
  )

  const handleClose = useCallback(() => dispatch({type: 'close'}), [dispatch])
  const handleNext = useCallback(() => dispatch({type: 'next'}), [dispatch])
  const handlePrev = useCallback(() => dispatch({type: 'prev'}), [dispatch])

  useEffect(() => {
    if (!pluginState?.isOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') handleNext()
      else if (e.key === 'ArrowLeft') handlePrev()
      else if (e.key === 'Escape') handleClose()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pluginState?.isOpen, handleNext, handlePrev, handleClose])

  if (!pluginState?.isOpen) return null

  const {images, activeIndex} = pluginState
  const activeImage = images[activeIndex]
  if (!activeImage) return null

  const hasPrev = activeIndex > 0
  const hasNext = activeIndex < images.length - 1
  const showCounter = images.length > 1

  const resolvedSrc = resolveImageUrl ? resolveImageUrl(activeImage.url) : activeImage.url

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={handleClose}
      role="dialog"
      aria-modal
      aria-label="Image gallery"
    >
      {/* Prevent clicks on the inner wrapper from bubbling to the backdrop. */}
      <div className="relative flex size-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
        {/* Previous button */}
        {hasPrev && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handlePrev()
            }}
            className="absolute top-1/2 left-4 -translate-y-1/2 p-2 text-white/80 hover:text-white"
            aria-label="Previous image"
          >
            <ChevronLeft size={32} />
          </button>
        )}

        <img
          key={activeIndex}
          src={resolvedSrc}
          alt={activeImage.name}
          className="max-h-[90vh] max-w-[90vw] object-contain"
          onClick={(e) => e.stopPropagation()}
        />

        {/* Next button */}
        {hasNext && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              handleNext()
            }}
            className="absolute top-1/2 right-4 -translate-y-1/2 p-2 text-white/80 hover:text-white"
            aria-label="Next image"
          >
            <ChevronRight size={32} />
          </button>
        )}

        {/* Close button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleClose()
          }}
          className="absolute top-4 right-4 text-white/80 hover:text-white"
          aria-label="Close gallery"
        >
          <X size={24} />
        </button>

        {/* Counter */}
        {showCounter && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80">
            {activeIndex + 1} / {images.length}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(overlay, document.body)
}
