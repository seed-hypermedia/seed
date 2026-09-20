import {Download, Move, X} from 'lucide-react'
import {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {createPortal} from 'react-dom'
import {Button} from './button'
import {useImageUrl} from './get-file-url'
import {cn} from './utils'

export type CoverPosition = {x: number; y: number}

const DEFAULT_COVER_POSITION: CoverPosition = {x: 50, y: 50}
const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

/** A complete, bounded cover focal point. Invalid or missing coordinates default to center. */
export function normalizeCoverPosition(position: Partial<CoverPosition> | null | undefined): CoverPosition {
  return {
    x:
      typeof position?.x === 'number' && Number.isFinite(position.x)
        ? clampPercent(position.x)
        : DEFAULT_COVER_POSITION.x,
    y:
      typeof position?.y === 'number' && Number.isFinite(position.y)
        ? clampPercent(position.y)
        : DEFAULT_COVER_POSITION.y,
  }
}

/** Translate a pointer delta into a focal point without exposing empty image space. */
export function moveCoverPosition(
  position: CoverPosition,
  delta: {x: number; y: number},
  overflow: {x: number; y: number},
): CoverPosition {
  return {
    x: overflow.x > 0 ? clampPercent(position.x - (delta.x / overflow.x) * 100) : position.x,
    y: overflow.y > 0 ? clampPercent(position.y - (delta.y / overflow.y) * 100) : position.y,
  }
}

interface DocumentCoverProps {
  cover?: string
  position?: Partial<CoverPosition> | null
  className?: string
  onRemove?: () => void
  onChangeCover?: (file: File) => Promise<void> | void
  onChangePosition?: (position: CoverPosition) => void
}

export function DocumentCover({
  cover,
  position,
  className,
  onRemove,
  onChangeCover,
  onChangePosition,
}: DocumentCoverProps) {
  const imageUrl = useImageUrl()
  const replacementInputRef = useRef<HTMLInputElement | null>(null)
  const coverRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    start: {x: number; y: number}
    position: CoverPosition
    overflow: {x: number; y: number}
  } | null>(null)
  const savedPosition = useMemo(() => normalizeCoverPosition(position), [position?.x, position?.y])
  const [draftPosition, setDraftPosition] = useState(savedPosition)
  const [modalState, setModalState] = useState<'closed' | 'opening' | 'open'>('closed')
  const [isChangingCover, setIsChangingCover] = useState(false)
  const [isRepositioning, setIsRepositioning] = useState(false)

  useEffect(() => {
    if (!isRepositioning) setDraftPosition(savedPosition)
    else coverRef.current?.focus()
  }, [savedPosition, isRepositioning])

  const handleDoubleClick = useCallback(() => {
    if (!isRepositioning) setModalState('opening')
  }, [isRepositioning])

  const handleClose = useCallback(() => {
    setModalState('closed')
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalState === 'open') handleClose()
    },
    [modalState, handleClose],
  )

  const handleAnimationEnd = useCallback(() => {
    if (modalState === 'opening') setModalState('open')
  }, [modalState])

  const handleReplacementChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file || !onChangeCover) return
      setIsChangingCover(true)
      try {
        await onChangeCover(file)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Failed to change document cover image: ${message}`, error)
      } finally {
        setIsChangingCover(false)
        event.target.value = ''
      }
    },
    [onChangeCover],
  )

  const startRepositioning = useCallback(() => {
    setDraftPosition(savedPosition)
    setIsRepositioning(true)
  }, [savedPosition])

  const cancelRepositioning = useCallback(() => {
    dragRef.current = null
    setDraftPosition(savedPosition)
    setIsRepositioning(false)
  }, [savedPosition])

  const saveRepositioning = useCallback(() => {
    onChangePosition?.({x: Math.round(draftPosition.x), y: Math.round(draftPosition.y)})
    setIsRepositioning(false)
  }, [draftPosition, onChangePosition])

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isRepositioning || !imageRef.current) return
      const box = event.currentTarget.getBoundingClientRect()
      const image = imageRef.current
      if (!image.naturalWidth || !image.naturalHeight) return
      const scale = Math.max(box.width / image.naturalWidth, box.height / image.naturalHeight)
      dragRef.current = {
        pointerId: event.pointerId,
        start: {x: event.clientX, y: event.clientY},
        position: draftPosition,
        overflow: {
          x: Math.max(0, image.naturalWidth * scale - box.width),
          y: Math.max(0, image.naturalHeight * scale - box.height),
        },
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      event.preventDefault()
    },
    [draftPosition, isRepositioning],
  )

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setDraftPosition(
      moveCoverPosition(
        drag.position,
        {x: event.clientX - drag.start.x, y: event.clientY - drag.start.y},
        drag.overflow,
      ),
    )
  }, [])

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const handleRepositionKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isRepositioning) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancelRepositioning()
        return
      }
      const targetIsCover = event.target === event.currentTarget
      if (event.key === 'Enter' && targetIsCover) {
        event.preventDefault()
        saveRepositioning()
        return
      }
      if (!targetIsCover) return
      const step = event.shiftKey ? 10 : 1
      const delta =
        event.key === 'ArrowLeft'
          ? {x: -step, y: 0}
          : event.key === 'ArrowRight'
            ? {x: step, y: 0}
            : event.key === 'ArrowUp'
              ? {x: 0, y: -step}
              : event.key === 'ArrowDown'
                ? {x: 0, y: step}
                : null
      if (!delta) return
      event.preventDefault()
      setDraftPosition((current) => ({
        x: clampPercent(current.x + delta.x),
        y: clampPercent(current.y + delta.y),
      }))
    },
    [cancelRepositioning, isRepositioning, saveRepositioning],
  )

  useEffect(() => {
    if (modalState !== 'closed') document.addEventListener('keydown', handleKeyDown)
    else document.removeEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [modalState, handleKeyDown])

  if (!cover) return null
  const coverUrl = imageUrl(cover, 'XL')
  const hasCoverActions = !!onChangeCover || !!onRemove || !!onChangePosition || !!coverUrl
  const renderedPosition = isRepositioning ? draftPosition : savedPosition

  const maximizedContent = modalState !== 'closed' && (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm',
        modalState === 'opening' ? 'animate-in fade-in duration-300' : '',
      )}
      onClick={handleClose}
    >
      <div
        className="relative flex size-full items-center justify-center"
        onClick={(e) => {
          e.stopPropagation()
          handleClose()
        }}
      >
        <img
          alt="Document cover"
          src={imageUrl(cover, 'L')}
          className={cn('object-contain', modalState === 'opening' ? 'animate-in zoom-in-50 duration-300' : '')}
          style={{maxWidth: '90vw', maxHeight: '90vh', width: '100%', height: '100%'}}
          onAnimationEnd={handleAnimationEnd}
        />
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          aria-label="Close"
        >
          <X size={20} />
        </button>
      </div>
    </div>
  )

  return (
    <>
      <div
        ref={coverRef}
        className={cn(
          'group/cover relative h-[25vh] w-full flex-shrink-0',
          isRepositioning ? 'cursor-grab touch-none select-none active:cursor-grabbing' : 'cursor-pointer',
          cover ? 'bg-transparent' : 'bg-accent',
          className,
        )}
        onClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onKeyDown={handleRepositionKeyDown}
        tabIndex={isRepositioning ? 0 : undefined}
        role={isRepositioning ? 'application' : undefined}
        aria-label={isRepositioning ? 'Reposition document cover image' : undefined}
        title={isRepositioning ? 'Drag to reposition. Arrow keys adjust the focal point.' : 'Click to maximize'}
      >
        <img
          ref={imageRef}
          alt="Document cover"
          src={coverUrl}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            objectFit: 'cover',
            objectPosition: `${renderedPosition.x}% ${renderedPosition.y}%`,
          }}
          className={cn(!isRepositioning && 'transition-[object-position] duration-200 motion-reduce:transition-none')}
        />
        {isRepositioning ? (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/20 text-sm font-medium text-white">
              Drag to reposition
            </div>
            <div
              data-document-cover-controls
              className="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg bg-black/55 p-1 text-white shadow-sm backdrop-blur-sm"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-7 rounded-md px-2 text-xs text-white hover:bg-white/15 hover:text-white active:bg-white/20"
                onClick={cancelRepositioning}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="xs"
                className="h-7 rounded-md px-2 text-xs"
                onClick={saveRepositioning}
              >
                Save position
              </Button>
            </div>
          </>
        ) : hasCoverActions ? (
          <div
            data-document-cover-controls
            className="absolute top-4 right-4 z-20 flex items-center gap-1 rounded-lg bg-black/45 p-1 text-white opacity-100 shadow-sm backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none md:pointer-events-none md:opacity-0 md:group-hover/cover:pointer-events-auto md:group-hover/cover:opacity-100 md:focus-within:pointer-events-auto md:focus-within:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            {onChangePosition ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Reposition document cover image"
                className="h-7 rounded-md px-2 text-xs text-white hover:bg-white/15 hover:text-white active:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation()
                  startRepositioning()
                }}
              >
                <Move className="size-3.5" />
                Reposition
              </Button>
            ) : null}
            {onChangeCover ? (
              <>
                <input
                  ref={replacementInputRef}
                  type="file"
                  accept="image/*"
                  aria-label="Choose replacement cover image"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => void handleReplacementChange(event)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label="Change document cover image"
                  loading={isChangingCover}
                  className="h-7 rounded-md px-2 text-xs text-white hover:bg-white/15 hover:text-white active:bg-white/20"
                  onClick={(event) => {
                    event.stopPropagation()
                    replacementInputRef.current?.click()
                  }}
                >
                  Change
                </Button>
              </>
            ) : null}
            {coverUrl ? (
              <Button
                asChild
                variant="ghost"
                size="iconSm"
                aria-label="Download document cover image"
                className="h-7 min-w-7 rounded-md text-white hover:bg-white/15 hover:text-white active:bg-white/20"
              >
                <a
                  href={coverUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                >
                  <Download className="size-3.5" />
                </a>
              </Button>
            ) : null}
            {onRemove ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-label="Remove document cover image"
                className="h-7 rounded-md px-2 text-xs text-white hover:bg-white/15 hover:text-white active:bg-white/20"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemove()
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {typeof window !== 'undefined' && createPortal(maximizedContent, document.body)}
    </>
  )
}
