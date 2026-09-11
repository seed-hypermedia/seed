import {mentionCandidateSubtitle} from '@shm/shared/models/mention-ranking'
import {InlineMentionsResult} from '@shm/shared/models/inline-mentions'
import {Button} from '@shm/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {LoadedHMIcon} from '@shm/ui/hm-icon'
import {X} from '@shm/ui/icons'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {MentionMode} from './mention-suggestion-plugin'

/** Mobile presentation of the same ranked suggestions and insertion operation as desktop. */
export function MobileMentionsDialog({
  isOpen,
  onClose,
  onSelect,
  mode,
  query,
  onQuery,
  results,
  loading,
  error,
  onRetry,
  onRestoreFocus,
}: {
  isOpen: boolean
  onClose: () => void
  onSelect: (item: InlineMentionsResult[number]) => void
  mode: MentionMode
  query: string
  onQuery: (query: string) => void
  results: InlineMentionsResult
  loading: boolean
  error: boolean
  onRetry: () => void
  onRestoreFocus: () => void
}) {
  const wasOpen = useRef(isOpen)
  useEffect(() => {
    if (wasOpen.current && !isOpen) onRestoreFocus()
    wasOpen.current = isOpen
  }, [isOpen, onRestoreFocus])
  const [viewportBounds, setViewportBounds] = useState<{height: number; top: number}>()
  useLayoutEffect(() => {
    if (!isOpen || !window.visualViewport) return
    const viewport = window.visualViewport
    const update = () => setViewportBounds({height: viewport.height, top: viewport.offsetTop})
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [isOpen])
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="mention-mobile-dialog top-0 h-dvh max-h-dvh w-full max-w-full translate-y-0 rounded-none p-0"
        style={
          viewportBounds
            ? {height: viewportBounds.height, maxHeight: viewportBounds.height, top: viewportBounds.top}
            : undefined
        }
        aria-describedby={undefined}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <div className="flex h-full flex-col overflow-hidden">
          <DialogHeader className="border-b p-4">
            <div className="flex items-center justify-between">
              <DialogTitle>{mode === 'account' ? 'Mention account' : 'Link document'}</DialogTitle>
              <Button size="icon" variant="ghost" aria-label="Cancel mention" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
          </DialogHeader>
          <div className="border-b p-4">
            <Input
              aria-label={mode === 'account' ? 'Search accounts' : 'Search documents'}
              placeholder={mode === 'account' ? 'Search accounts…' : 'Search documents…'}
              value={query}
              onChange={(event) => onQuery(event.target.value)}
              autoFocus
            />
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            role="listbox"
            aria-label={mode === 'account' ? 'Accounts' : 'Documents'}
            aria-busy={loading}
          >
            {loading && (
              <p role="status" className="text-muted-foreground p-4">
                Searching…
              </p>
            )}
            {error && (
              <div role="alert" className="p-4">
                Unable to load mentions or resolve the published version.{' '}
                <Button variant="ghost" onClick={onRetry}>
                  Retry
                </Button>
              </div>
            )}
            {!loading && !error && !results.length && (
              <p role="status" className="text-muted-foreground p-4">
                No {mode === 'account' ? 'accounts' : 'documents'} found
              </p>
            )}
            {results.map((item) => (
              <Button
                key={item.id.id}
                role="option"
                aria-selected={false}
                disabled={loading || error}
                variant="ghost"
                className="h-auto min-h-12 w-full justify-start gap-3 px-4 py-3"
                onClick={() => onSelect(item)}
              >
                <LoadedHMIcon id={item.id} size={32} />
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span>{item.title || item.id.uid}</span>
                  <span
                    className="text-muted-foreground text-xs"
                    title={item.type === 'account' ? item.id.uid : undefined}
                  >
                    {mentionCandidateSubtitle(item)}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
