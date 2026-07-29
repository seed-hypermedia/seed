import {Download, X} from 'lucide-react'
import {ChangeEvent, useCallback, useEffect, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {Button} from './button'
import {useImageUrl} from './get-file-url'
import {cn} from './utils'

interface DocumentCoverProps {
  cover?: string
  className?: string
  onRemove?: () => void
  onChangeCover?: (file: File) => Promise<void> | void
}

export function DocumentCover({cover, className, onRemove, onChangeCover}: DocumentCoverProps) {
  const imageUrl = useImageUrl()
  const replacementInputRef = useRef<HTMLInputElement | null>(null)
  const [modalState, setModalState] = useState<'closed' | 'opening' | 'open'>('closed')
  const [isChangingCover, setIsChangingCover] = useState(false)

  const handleDoubleClick = useCallback(() => {
    setModalState('opening')
  }, [])

  const handleClose = useCallback(() => {
    setModalState('closed')
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && modalState === 'open') {
        handleClose()
      }
    },
    [modalState, handleClose],
  )

  const handleAnimationEnd = useCallback(() => {
    if (modalState === 'opening') {
      setModalState('open')
    }
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

  useEffect(() => {
    if (modalState !== 'closed') {
      document.addEventListener('keydown', handleKeyDown)
    } else {
      document.removeEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modalState, handleKeyDown])

  if (!cover) return null
  const coverUrl = imageUrl(cover, 'XL')
  const hasCoverActions = !!onChangeCover || !!onRemove || !!coverUrl

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
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            width: '100%',
            height: '100%',
          }}
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
        className={cn(
          'group/cover relative h-[25vh] w-full flex-shrink-0 cursor-pointer',
          cover ? 'bg-transparent' : 'bg-accent',
          className,
        )}
        onClick={handleDoubleClick}
        title="Click to maximize"
      >
        <img
          alt="Document cover"
          src={coverUrl}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            objectFit: 'cover',
            transition: 'transform 0.2s ease-out',
          }}
          className="transition-transform duration-200"
        />
        {hasCoverActions ? (
          <div
            data-document-cover-controls
            className="absolute right-4 bottom-4 z-20 flex items-center gap-1 rounded-lg bg-black/45 p-1 text-white opacity-100 shadow-sm backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none md:pointer-events-none md:opacity-0 md:group-hover/cover:pointer-events-auto md:group-hover/cover:opacity-100 md:focus-within:pointer-events-auto md:focus-within:opacity-100"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
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
      {typeof window !== 'undefined' &&
        (() => {
          return createPortal(maximizedContent, document.body)
        })()}
    </>
  )
}
