import type {ComponentType} from 'react'
import {cn} from '../utils'

/**
 * A compact segmented control (pill toggle): a rounded muted track with the
 * active option shown as a raised light pill. Shared so any 2+-way choice looks
 * consistent across the apps.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: {value: T; label: string; icon?: ComponentType<{className?: string}>}[]
  disabled?: boolean
  className?: string
  'aria-label'?: string
}) {
  return (
    <div
      className={cn('inline-flex items-center rounded-full bg-black/10 p-1 dark:bg-white/10', className)}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const active = option.value === value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={option.icon ? option.label : undefined}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-4 py-1 text-sm font-medium transition-colors disabled:opacity-50',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground bg-transparent',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {!Icon && option.label}
          </button>
        )
      })}
    </div>
  )
}
