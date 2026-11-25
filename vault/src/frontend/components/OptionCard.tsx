import {cn} from '@/frontend/utils'
import type {LucideIcon} from 'lucide-react'
import type {ReactNode} from 'react'

/**
 * A full-width selectable card with an icon, a title, and optional badge and description.
 * Used for picking how to secure an account and how to sign in.
 */
export function OptionCard({
  icon: Icon,
  title,
  badge,
  description,
  recommended = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon
  title: string
  badge?: ReactNode
  description?: string
  recommended?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full gap-3 rounded-lg border p-4 text-left transition-colors',
        description ? 'items-start' : 'items-center',
        recommended
          ? 'border-brand bg-brand/5'
          : 'border-black/10 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5',
        disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent dark:hover:bg-transparent' : 'cursor-pointer',
      )}
    >
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          recommended ? 'bg-brand text-white' : 'text-foreground bg-black/5 dark:bg-white/10',
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{title}</span>
          {badge ? (
            <span className="bg-brand/15 text-brand rounded-full px-2 py-0.5 text-xs font-medium">{badge}</span>
          ) : null}
        </div>
        {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
      </div>
    </button>
  )
}
