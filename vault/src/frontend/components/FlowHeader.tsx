import {StepIndicator} from '@/frontend/components/StepIndicator'
import {useActions} from '@/frontend/store'
import {X} from 'lucide-react'

/**
 * Progress dots plus an X that leaves the flow.
 */
export function FlowHeader({step}: {step: number}) {
  const actions = useActions()

  return (
    <div className="mb-2 flex items-center justify-between">
      <StepIndicator currentStep={step} />
      <button
        type="button"
        aria-label="Close"
        className="text-muted-foreground hover:text-foreground -mr-1 cursor-pointer transition-colors"
        onClick={() => void actions.handleLogout()}
      >
        <X className="size-5" />
      </button>
    </div>
  )
}
