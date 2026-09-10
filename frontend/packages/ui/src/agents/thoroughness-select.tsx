import {
  DEFAULT_THOROUGHNESS,
  THOROUGHNESS_DESCRIPTIONS,
  THOROUGHNESS_LABELS,
  THOROUGHNESS_LEVELS,
  THOROUGHNESS_PRESETS,
  type Thoroughness,
} from '@seed-hypermedia/agents-protocol'
import {Tooltip} from '@shm/ui/tooltip'
import {Layers} from 'lucide-react'
import {cn} from '@shm/ui/utils'

/**
 * Segmented picker for a delegation preset: Quick / Normal / Deep, Normal being the default. It
 * always shows a concrete preset — the caller resolves "unset" to whatever applies (the agent's
 * own, or `normal`) before passing `value`.
 */
export function ThoroughnessPicker({
  value,
  onChange,
  disabled,
  compact,
}: {
  value: Thoroughness | undefined
  onChange: (value: Thoroughness) => void
  disabled?: boolean
  compact?: boolean
}) {
  const effective = value ?? DEFAULT_THOROUGHNESS
  const limits = THOROUGHNESS_PRESETS[effective]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Layers className="size-3" />
          Thoroughness
        </span>
        <span className="text-muted-foreground text-[10px]">
          depth {limits.maxDepth} · {limits.maxChildren}/turn
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Thoroughness"
        className={cn('bg-muted/60 flex rounded-md p-0.5', compact ? 'text-[11px]' : 'text-xs')}
      >
        {THOROUGHNESS_LEVELS.map((level) => {
          const isActive = level === effective
          const preset = THOROUGHNESS_PRESETS[level]
          return (
            <Tooltip
              key={level}
              content={`${THOROUGHNESS_DESCRIPTIONS[level]} Depth ${preset.maxDepth}, ${preset.maxChildren} helpers per turn.`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={disabled}
                onClick={() => onChange(level)}
                className={cn(
                  'flex-1 rounded-sm px-2 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  isActive ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {THOROUGHNESS_LABELS[level]}
              </button>
            </Tooltip>
          )
        })}
      </div>
      {!compact ? <span className="text-muted-foreground text-xs">{THOROUGHNESS_DESCRIPTIONS[effective]}</span> : null}
    </div>
  )
}
