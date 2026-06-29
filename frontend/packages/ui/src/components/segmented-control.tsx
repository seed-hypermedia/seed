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
}: {
  value: T
  onChange: (value: T) => void
  options: {value: T; label: string}[]
  disabled?: boolean
  className?: string
}) {
  return (
    <div className={cn('bg-muted inline-flex items-center rounded-full p-1', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-full px-4 py-1 text-sm font-medium transition-colors disabled:opacity-50',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground bg-transparent',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
