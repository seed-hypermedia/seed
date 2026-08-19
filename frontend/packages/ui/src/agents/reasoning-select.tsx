import {
  isReasoningLevel,
  modelReasoningSupport,
  REASONING_LEVEL_DESCRIPTIONS,
  REASONING_LEVEL_LABELS,
  type ReasoningLevel,
} from '@seed-hypermedia/agents-protocol'
import {Badge} from '@shm/ui/components/badge'
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
 * Compact reasoning-level tag shown beside model tags, with a tooltip that
 * explains what the level means. Renders nothing when the agent has no
 * reasoning level configured.
 */
export function ReasoningBadge({level}: {level: ReasoningLevel | undefined}) {
  if (!level || !isReasoningLevel(level)) return null
  return (
    <Tooltip content={`Reasoning ${REASONING_LEVEL_LABELS[level]}: ${REASONING_LEVEL_DESCRIPTIONS[level]}`} asChild>
      <Badge variant="outline" className="flex-none gap-1">
        <Brain className="size-3" />
        {REASONING_LEVEL_LABELS[level]}
      </Badge>
    </Tooltip>
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
