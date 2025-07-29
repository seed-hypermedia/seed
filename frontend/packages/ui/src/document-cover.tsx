import {useImageUrl} from '@shm/ui/get-file-url'
import {cn} from '@shm/ui/utils'
import {X} from 'lucide-react'
import {useCallback, useEffect, useState} from 'react'
import {createPortal} from 'react-dom'

interface DocumentCoverProps {
  cover?: string
  className?: string
}

export function DocumentCover({cover, className}: DocumentCoverProps) {
  const imageUrl = useImageUrl()
  const [modalState, setModalState] = useState<'closed' | 'opening' | 'open'>(
    'closed',
  )

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

  const maximizedContent = modalState !== 'closed' && (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm',
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
          className={cn(
            'object-contain',
            modalState === 'opening'
              ? 'animate-in zoom-in-50 duration-300'
              : '',
          )}
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
          'relative h-[25vh] w-full flex-shrink-0 cursor-pointer',
          cover ? 'bg-transparent' : 'bg-secondary',
          className,
        )}
        onClick={handleDoubleClick}
        title="Click to maximize"
      >
        <img
          src={imageUrl(cover, 'XL')}
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
      </div>
      {typeof window !== 'undefined' &&
        (() => {
          return createPortal(maximizedContent, document.body)
        })()}
    </>
  )
}
