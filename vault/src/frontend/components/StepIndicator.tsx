import {cn} from '@/frontend/utils'

interface StepIndicatorProps {
  /** The current active step (1-based). */
  currentStep: number
  /** Total number of steps. Defaults to 3. */
  totalSteps?: number
}

/** Displays step progress as colored dots with a text counter. */
export function StepIndicator({currentStep, totalSteps = 3}: StepIndicatorProps) {
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
      <span className="text-muted-foreground ml-1 text-[10px]">
        {currentStep} of {totalSteps}
      </span>
    </div>
  )
}
