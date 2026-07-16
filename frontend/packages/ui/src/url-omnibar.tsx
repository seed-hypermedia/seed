import {Copy} from 'lucide-react'
import {type ReactNode, useEffect, useRef, useState} from 'react'
import {Button} from './button'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/**
 * A read-only, omnibar-styled URL pill: a rounded bordered container showing a
 * URL, with a copy button on the right — matching the main app omnibar's idle
 * look. It is not editable. Clicking it reveals + selects the `copyUrl`
 * (e.g. a shareable gateway link) while resting on `restingUrl` otherwise.
 *
 * Shared so any surface that needs an omnibar-like read-only URL (e.g. the IPFS
 * file viewer) gets the same appearance and copy affordance.
 */
export function OmnibarUrl({
  restingUrl,
  copyUrl,
  copyLabel = 'Copy link',
  rightActions,
  className,
}: {
  /** The URL shown at rest (e.g. `ipfs://<cid>`). */
  restingUrl: string
  /** The URL revealed/selected on click and copied by the button (e.g. a gateway https link). Defaults to `restingUrl`. */
  copyUrl?: string
  copyLabel?: string
  /** Extra controls rendered inside the pill, right of the copy button. */
  rightActions?: ReactNode
  className?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [revealed, setRevealed] = useState(false)
  const reveal = copyUrl ?? restingUrl
  const value = revealed ? reveal : restingUrl

  // Select the revealed text once React has committed the new value.
  useEffect(() => {
    if (revealed) inputRef.current?.select()
  }, [revealed])

  const copy = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(reveal)
    toast.success('Copied link')
  }

  return (
    <div
      className={cn(
        'no-window-drag border-border flex min-w-0 flex-1 cursor-text items-center gap-2 overflow-hidden rounded-full border-2 bg-white pl-3 dark:bg-black',
        'hover:bg-muted/50 max-w-2xl transition-colors',
        className,
      )}
      onClick={() => {
        setRevealed(true)
        inputRef.current?.focus()
      }}
    >
      <input
        ref={inputRef}
        readOnly
        value={value}
        spellCheck={false}
        onFocus={() => setRevealed(true)}
        onBlur={() => setRevealed(false)}
        className="text-muted-foreground min-w-0 flex-1 truncate border-none bg-transparent py-1.5 font-mono text-xs outline-none"
      />
      <div className="mr-1 flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
        <Tooltip content={copyLabel}>
          <Button variant="ghost" size="iconSm" aria-label={copyLabel} onClick={copy}>
            <Copy className="size-3.5" />
          </Button>
        </Tooltip>
        {rightActions}
      </div>
    </div>
  )
}
