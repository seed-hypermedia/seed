import {type ReactNode} from 'react'
import {cn} from './utils'

// The empty/loading/error panel of the explorer.
export function ExploreState({
  icon,
  title,
  detail,
  tone,
}: {
  icon: ReactNode
  title: string
  detail: string
  tone?: 'error'
}) {
  return (
    <div
      className={cn(
        'border-border bg-muted/20 flex min-h-48 flex-col items-center justify-center rounded-lg border p-6 text-center',
        tone === 'error' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <span className={cn('text-muted-foreground mb-3', tone === 'error' && 'text-destructive')}>{icon}</span>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{detail}</p>
    </div>
  )
}
