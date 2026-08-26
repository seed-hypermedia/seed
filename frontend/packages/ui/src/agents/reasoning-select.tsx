import {
  isReasoningLevel,
  modelReasoningSupport,
  REASONING_LEVELS,
  REASONING_LEVEL_DESCRIPTIONS,
  REASONING_LEVEL_LABELS,
  type ReasoningLevel,
} from '@seed-hypermedia/agents-protocol'
import {Tooltip} from '@shm/ui/tooltip'
import {Brain} from 'lucide-react'

const OFF_VALUE = '__off__'

/**
 * Discrete reasoning-level slider: leftmost is off (or the provider default
 * when reasoning cannot be disabled), then each level the model accepts.
 * Renders nothing for models without reasoning support. `onChange` fires per
 * step while dragging, so callers that persist should debounce.
 */
export function ReasoningSlider({
  providerType,
  model,
  value,
  onChange,
  disabled,
}: {
  providerType: string | undefined
  model: string
  value: ReasoningLevel | undefined
  onChange: (level: ReasoningLevel | undefined) => void
  disabled?: boolean
}) {
  const support = providerType ? modelReasoningSupport(providerType, model) : null
  if (!support) return null
  const offLabel = support.offBehavior === 'default' ? 'Default' : 'Off'
  const steps: (ReasoningLevel | undefined)[] = [undefined, ...support.levels]
  const index = value && support.levels.includes(value) ? steps.indexOf(value) : 0
  const current = steps[index]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <Brain className="size-3" />
          Reasoning
        </span>
        <Tooltip
          content={
            current
              ? REASONING_LEVEL_DESCRIPTIONS[current]
              : support.offBehavior === 'default'
                ? 'The provider decides how much this model reasons.'
                : 'The model answers directly without extra reasoning.'
          }
        >
          <span className="text-xs font-medium">{current ? REASONING_LEVEL_LABELS[current] : offLabel}</span>
        </Tooltip>
      </div>
      <input
        type="range"
        aria-label="Reasoning level"
        min={0}
        max={steps.length - 1}
        step={1}
        value={index}
        disabled={disabled}
        onChange={(event) => onChange(steps[Number(event.currentTarget.value)])}
        className="accent-primary h-4 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="text-muted-foreground flex justify-between text-[10px]">
        {steps.map((step) => (
          <span key={step ?? OFF_VALUE}>{step ? REASONING_LEVEL_LABELS[step] : offLabel}</span>
        ))}
      </div>
    </div>
  )
}

/**
 * Tiny pie-chart glyph encoding the reasoning level as the filled fraction of
 * a circle on the global level scale: off is an empty ring, `xhigh` a full
 * disc. Rendered inline inside the model tag; wrap in a Tooltip where hover
 * help is wanted.
 */
export function ReasoningPie({level, className}: {level: ReasoningLevel | undefined; className?: string}) {
  const rank = level && isReasoningLevel(level) ? REASONING_LEVELS.indexOf(level) + 1 : 0
  const fraction = rank / REASONING_LEVELS.length
  const label = level && isReasoningLevel(level) ? `Reasoning ${REASONING_LEVEL_LABELS[level]}` : 'Reasoning off'
  const c = 7
  const r = 5.5
  let wedge: string | null = null
  if (fraction > 0 && fraction < 1) {
    const angle = 2 * Math.PI * fraction
    const x = c + r * Math.sin(angle)
    const y = c - r * Math.cos(angle)
    wedge = `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)} Z`
  }
  return (
    <svg
      viewBox="0 0 14 14"
      width={12}
      height={12}
      role="img"
      aria-label={label}
      className={`shrink-0 ${className ?? ''}`}
    >
      <circle cx={c} cy={c} r={r} fill="none" stroke="currentColor" strokeWidth={1.25} opacity={0.45} />
      {fraction >= 1 ? (
        <circle cx={c} cy={c} r={r} fill="currentColor" />
      ) : wedge ? (
        <path d={wedge} fill="currentColor" />
      ) : null}
    </svg>
  )
}

/** Drops a stored reasoning level the newly selected model cannot honor. */
export function coerceReasoningLevel(
  providerType: string | undefined,
  model: string,
  level: ReasoningLevel | undefined,
): ReasoningLevel | undefined {
  if (!level) return undefined
  const support = providerType ? modelReasoningSupport(providerType, model) : null
  if (!support || !support.levels.includes(level)) return undefined
  return level
}
