import {
  isReasoningLevel,
  modelReasoningSupport,
  REASONING_LEVEL_DESCRIPTIONS,
  REASONING_LEVEL_LABELS,
  type ReasoningLevel,
} from '@seed-hypermedia/agents-protocol'
import {Badge} from '@shm/ui/components/badge'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'
import {Tooltip} from '@shm/ui/tooltip'
import {Brain} from 'lucide-react'

const OFF_VALUE = '__off__'

/**
 * Reasoning-level dropdown paired with every model selector. Rendered only for
 * reasoning-capable models (`modelReasoningSupport` decides), listing just the
 * levels that model accepts. "Off" means no reasoning — or the provider default
 * when the model cannot disable it.
 */
export function ReasoningSelect({
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
  return (
    <Select
      value={value ?? OFF_VALUE}
      onValueChange={(next) => onChange(isReasoningLevel(next) ? next : undefined)}
      disabled={disabled}
    >
      <SelectTrigger>
        <SelectValue placeholder={offLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={OFF_VALUE}>
          <span className="flex flex-col items-start">
            <span>{offLabel}</span>
            <span className="text-muted-foreground text-xs">
              {support.offBehavior === 'default'
                ? 'The provider decides how much this model reasons.'
                : 'The model answers directly without extra reasoning.'}
            </span>
          </span>
        </SelectItem>
        {support.levels.map((level) => (
          <SelectItem key={level} value={level}>
            <span className="flex flex-col items-start">
              <span>{REASONING_LEVEL_LABELS[level]}</span>
              <span className="text-muted-foreground text-xs">{REASONING_LEVEL_DESCRIPTIONS[level]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
