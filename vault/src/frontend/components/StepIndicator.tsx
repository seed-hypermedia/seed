import {cn} from '@/frontend/utils'

interface StepIndicatorProps {
  /** The current active step (1-based). */
  currentStep: number
  /** Total number of steps. Defaults to 4. */
  totalSteps?: number
}

/** Displays step progress as colored dots. */
export function StepIndicator({currentStep, totalSteps = 4}: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({length: totalSteps}, (_, i) => (
        <div
          key={i}
          className={cn(
            'size-2.5 rounded-full',
            i + 1 === currentStep ? 'bg-brand' : 'bg-neutral-300 dark:bg-neutral-600',
          )}
        />
      ))}
    </div>
  )
}
