import {AlertCircle} from 'lucide-react'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function InlineError({
  message = 'Could not be found',
  className,
}: {
  message?: string
  className?: string
}) {
  return (
    <Tooltip content={message}>
      <AlertCircle className={cn('text-destructive size-3', className)} />
    </Tooltip>
  )
}
