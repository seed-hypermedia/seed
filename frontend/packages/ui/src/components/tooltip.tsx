import {
  Tooltip as TheTooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip'

export function Tooltip({
  content,
  side = 'top',
  children,
  delay = 200,
  ...props
}: React.ComponentProps<typeof TheTooltip> & {
  delay?: number
  content: string
  side?: React.ComponentProps<typeof TooltipContent>['side']
}) {
  return (
    <TheTooltip {...props} delayDuration={delay}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </TheTooltip>
  )
}
