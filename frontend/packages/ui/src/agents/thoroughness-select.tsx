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
 * Segmented picker for a delegation preset (quick / normal / deep). With `inheritedValue` set, a
 * leading "Default" segment stands for "follow the agent" and `onChange(undefined)` clears the
 * override — the session-level use; without it the picker edits the agent's own default.
 */
export function ThoroughnessPicker({
  value,
  inheritedValue,
  onChange,
  disabled,
  compact,
}: {
  value: Thoroughness | undefined
  /** The agent's preset a cleared value falls back to; presence enables the "Default" segment. */
  inheritedValue?: Thoroughness
  onChange: (value: Thoroughness | undefined) => void
  disabled?: boolean
  compact?: boolean
}) {
  const effective = value ?? inheritedValue ?? DEFAULT_THOROUGHNESS
  const limits = THOROUGHNESS_PRESETS[effective]
  const segments: Array<{key: Thoroughness | 'default'; label: string; tooltip: string}> = [
    ...(inheritedValue !== undefined
      ? [
          {
            key: 'default' as const,
            label: 'Default',
            tooltip: `Follow the agent's setting (${THOROUGHNESS_LABELS[inheritedValue]}).`,
          },
        ]
      : []),
    ...THOROUGHNESS_LEVELS.map((level) => ({
      key: level,
      label: THOROUGHNESS_LABELS[level],
      tooltip: `${THOROUGHNESS_DESCRIPTIONS[level]} Depth ${THOROUGHNESS_PRESETS[level].maxDepth}, ${THOROUGHNESS_PRESETS[level].maxChildren} helpers per turn.`,
    })),
  ]
  const active: Thoroughness | 'default' = value ?? (inheritedValue !== undefined ? 'default' : effective)
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
        {segments.map((segment) => {
          const isActive = segment.key === active
          return (
            <Tooltip key={segment.key} content={segment.tooltip}>
              <button
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={disabled}
                onClick={() => onChange(segment.key === 'default' ? undefined : segment.key)}
                className={cn(
                  'flex-1 rounded-sm px-2 py-1 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  isActive ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {segment.label}
              </button>
            </Tooltip>
          )
        })}
      </div>
      {!compact ? <span className="text-muted-foreground text-xs">{THOROUGHNESS_DESCRIPTIONS[effective]}</span> : null}
    </div>
  )
}
