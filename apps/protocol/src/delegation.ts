/**
 * Delegation budgets shared by the agents server and every settings UI.
 *
 * A run tree can fan out (children per run) and nest (delegation depth). Both are bounded by a
 * budget the root run is created with and every child inherits. "Thoroughness" is the
 * user-facing knob: a preset that maps onto those two numbers, chosen per agent as the default
 * and overridable per session, so a quick question and a deep research task can run under the
 * same agent without either being wrong.
 */

/** A user-selectable delegation preset, ordered from least to most delegation. */
export type Thoroughness = 'quick' | 'normal' | 'deep'

/** All presets in display order. */
export const THOROUGHNESS_LEVELS: Thoroughness[] = ['quick', 'normal', 'deep']

/** The preset in effect when neither the agent nor the session names one. */
export const DEFAULT_THOROUGHNESS: Thoroughness = 'normal'

/** Delegation limits enforced from the run tree. */
export type DelegationLimits = {
  /**
   * Deepest allowed delegation depth. A user's or trigger's run is depth 0, a model child it
   * delegates is 1, that child's children are 2, and so on. Script children do not count: a
   * script is orchestration, not thinking, so a model child spawned from a script sits one level
   * below the script's own parent. A run at this depth is a leaf: it cannot delegate at all.
   */
  maxDepth: number
  /** Most children one run may spawn (awaited or detached, model or script). */
  maxChildren: number
}

export const THOROUGHNESS_PRESETS: Record<Thoroughness, DelegationLimits> = {
  quick: {maxDepth: 1, maxChildren: 4},
  normal: {maxDepth: 3, maxChildren: 10},
  deep: {maxDepth: 5, maxChildren: 16},
}

/** Display label per preset, used by dropdowns and tags. */
export const THOROUGHNESS_LABELS: Record<Thoroughness, string> = {
  quick: 'Quick',
  normal: 'Normal',
  deep: 'Deep',
}

/** Short human explanation per preset, used by dropdowns and tooltips. */
export const THOROUGHNESS_DESCRIPTIONS: Record<Thoroughness, string> = {
  quick: 'One round of helpers at most — fast answers, little delegation.',
  normal: 'Helpers can delegate a few levels down — balanced for most tasks.',
  deep: 'Wide, deep delegation trees — thorough research at higher cost.',
}

/** Type guard for values arriving from stored definitions or API input. */
export function isThoroughness(value: unknown): value is Thoroughness {
  return typeof value === 'string' && (THOROUGHNESS_LEVELS as string[]).includes(value)
}

/** The limits a preset stands for. */
export function delegationLimitsFor(thoroughness: Thoroughness | undefined): DelegationLimits {
  return THOROUGHNESS_PRESETS[thoroughness ?? DEFAULT_THOROUGHNESS]
}
