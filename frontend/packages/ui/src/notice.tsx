import {CircleAlert, Info, Loader2, RotateCcw, TriangleAlert} from 'lucide-react'
import type {ReactNode} from 'react'
import {cn} from './utils'

export type NoticeTone = 'error' | 'warning' | 'info'

/**
 * Sticky, in-place feedback: a query that failed, a server that cannot be reached, a setting that
 * is broken. Transient outcomes (a save that failed, a copy that succeeded) belong in a toast, not
 * here — a notice stays on screen until the condition it describes is gone.
 *
 * Three tones, deliberately kept apart:
 * - `error`: something is wrong and needs the reader's attention (a request the server refused, a
 *   run that failed).
 * - `warning`: something is degraded but not broken (one of several servers is unreachable and
 *   its content is hidden until it comes back).
 * - `info`: context worth knowing that asks nothing of the reader.
 *
 * Shares its look — a tinted icon bubble beside a foreground title and muted detail — with the
 * app-level error page (see the desktop's `AppErrorContent`), so an error reads the same whatever
 * scale it appears at.
 */
export function Notice({
  tone = 'error',
  title,
  children,
  icon,
  size = 'md',
  action,
  onRetry,
  retryPending,
  retryLabel = 'Retry',
  className,
}: {
  tone?: NoticeTone
  /** Short headline, sentence case, no trailing period. */
  title?: ReactNode
  /** Optional detail beneath the title: what happened and what it means for the reader. */
  children?: ReactNode
  /** Overrides the tone's default icon. */
  icon?: ReactNode
  /** `sm` for dense contexts: dropdowns, sidebars, table rows. */
  size?: 'sm' | 'md'
  /** Trailing control, for anything other than a plain retry. */
  action?: ReactNode
  /** Renders a standard retry control in the action slot. */
  onRetry?: () => void
  retryPending?: boolean
  retryLabel?: string
  className?: string
}) {
  const styles = TONE_STYLES[tone]
  const Icon = tone === 'error' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info
  const retry = onRetry ? (
    <button
      type="button"
      onClick={onRetry}
      disabled={retryPending}
      className={cn(
        'bg-background/80 hover:bg-background text-foreground border-border inline-flex shrink-0 items-center gap-1 rounded-full border font-medium transition-colors disabled:opacity-60',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
      )}
    >
      {retryPending ? (
        <Loader2 className={cn('shrink-0 animate-spin', size === 'sm' ? 'size-2.5' : 'size-3')} />
      ) : (
        <RotateCcw className={cn('shrink-0', size === 'sm' ? 'size-2.5' : 'size-3')} />
      )}
      {retryLabel}
    </button>
  ) : null

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn(
        'flex min-w-0 items-start rounded-lg border',
        size === 'sm' ? 'gap-2 px-2.5 py-1.5 text-xs' : 'gap-3 px-3 py-2.5 text-sm',
        styles.frame,
        className,
      )}
    >
      {size === 'sm' ? (
        <span className={cn('mt-0.5 flex shrink-0', styles.icon)}>{icon ?? <Icon className="size-3.5" />}</span>
      ) : (
        <span
          className={cn(
            'mt-px flex size-7 shrink-0 items-center justify-center rounded-full',
            styles.bubble,
            styles.icon,
          )}
        >
          {icon ?? <Icon className="size-4" />}
        </span>
      )}
      <div className={cn('min-w-0 flex-1', size === 'sm' ? 'py-px' : 'py-0.5')}>
        {title ? <p className="text-foreground font-medium break-words">{title}</p> : null}
        {children ? (
          <div className={cn('break-words', title ? 'text-muted-foreground mt-0.5' : 'text-foreground')}>
            {children}
          </div>
        ) : null}
      </div>
      {action || retry ? (
        <div className={cn('flex shrink-0 items-center gap-1.5 self-center')}>
          {action}
          {retry}
        </div>
      ) : null}
    </div>
  )
}

const TONE_STYLES: Record<NoticeTone, {frame: string; bubble: string; icon: string}> = {
  error: {
    frame: 'border-destructive/30 bg-destructive/5',
    bubble: 'bg-destructive/10',
    icon: 'text-destructive',
  },
  warning: {
    frame: 'border-amber-500/30 bg-amber-500/5',
    bubble: 'bg-amber-500/10',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  info: {
    frame: 'border-border bg-muted/40',
    bubble: 'bg-muted',
    icon: 'text-muted-foreground',
  },
}

/** Text color for a one-line status that carries a notice tone without the frame. */
export const NOTICE_TONE_TEXT_CLASS: Record<NoticeTone, string> = {
  error: 'text-destructive',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-muted-foreground',
}

/** Dot color for a status indicator that carries a notice tone. */
export const NOTICE_TONE_DOT_CLASS: Record<NoticeTone, string> = {
  error: 'bg-destructive',
  warning: 'bg-amber-500',
  info: 'bg-muted-foreground/40',
}
